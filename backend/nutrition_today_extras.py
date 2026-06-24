"""
Nutrition tab — Today's Plate and protein streak.

Brings Training-tab parity to Nutrition: a single Coach Al voice card at the
top of the Nutrition tab that says, in priority order:

  1. "On pace" / "behind on protein" / "way over" — based on the time of day
     and the user's macro targets, judge how the rest of the day should go.
  2. Protein streak — consecutive days where the user hit ≥80% of their
     protein target. Small daily-wins framing that the macro bars alone
     don't carry.
  3. Concrete next-meal suggestion — what's still on the plate to hit target
     (e.g. "still need 45g protein and 350 kcal — a 6oz chicken breast and
     half a sweet potato lands you on target").

The pace check uses the user's local time + an awake-window assumption
(6am-10pm) to figure out what % of the day has elapsed, then compares to
what % of the protein target has been eaten. If you're at 30% of protein at
2pm (50% of the day), Coach Al nudges. We're conservative — the nudge fires
only when the gap is meaningful (>20 percentage points).

Lookback for streak: 60 days. One Supabase query, in-memory roll-up.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────────

STREAK_LOOKBACK_DAYS  = 60
# Hit threshold for a streak day — 80% of protein target. Below 100 keeps
# real life from breaking a streak on travel days or short eating windows.
PROTEIN_HIT_PCT       = 0.80
# Awake-window assumption for the pace calc. 6am-10pm covers most people.
AWAKE_START_HOUR      = 6
AWAKE_END_HOUR        = 22
# Pace nudge fires only when the user is this many points behind / ahead of
# where they'd be if intake were perfectly linear.
PACE_GAP_THRESHOLD    = 0.20


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _fetch_recent_daily_totals(user_id: str, end_date: _date, days: int) -> list[dict]:
    """Daily macro rollup for the last `days` days ending at end_date
    (inclusive). One query, in-memory bucketing."""
    sb = _sb()
    if not sb:
        return []
    start_iso = (end_date - timedelta(days=days - 1)).isoformat()
    end_iso   = end_date.isoformat()
    try:
        res = (
            sb.table("nutrition_meals")
            .select("date, calories, protein, carbs, fat")
            .eq("user_id", user_id)
            .gte("date", start_iso)
            .lte("date", end_iso)
            .execute()
        )
        rows = res.data or []
    except Exception:
        return []

    by_day: dict[str, dict] = {}
    for r in rows:
        d = r.get("date")
        if not d:
            continue
        slot = by_day.setdefault(d, {
            "date": d, "calories": 0, "protein": 0, "carbs": 0, "fat": 0,
            "meal_count": 0,
        })
        slot["calories"] += int(r.get("calories") or 0)
        slot["protein"]  += float(r.get("protein") or 0)
        slot["carbs"]    += float(r.get("carbs")   or 0)
        slot["fat"]      += float(r.get("fat")     or 0)
        slot["meal_count"] += 1
    # Fill missing days with empty entries so the streak walk-back is correct.
    out: list[dict] = []
    for i in range(days):
        d = (end_date - timedelta(days=days - 1 - i)).isoformat()
        out.append(by_day.get(d, {
            "date": d, "calories": 0, "protein": 0, "carbs": 0, "fat": 0,
            "meal_count": 0,
        }))
    return out


def _protein_streak(daily: list[dict], target_protein_g: float) -> int:
    """Count consecutive recent COMPLETE days (excluding today) where
    protein >= 80% of target. Today is excluded because it's in progress —
    we don't break a streak on a half-eaten Tuesday."""
    if not daily or target_protein_g <= 0:
        return 0
    hit_pct = PROTEIN_HIT_PCT * target_protein_g
    # daily is oldest -> newest; today is the last entry. Skip it and walk
    # backward through previous days.
    streak = 0
    for entry in reversed(daily[:-1]):
        if entry["protein"] >= hit_pct:
            streak += 1
        else:
            break
    return streak


def _local_hour_now(local_now_iso: Optional[str]) -> float:
    """Parse the caller-supplied local time, fall back to UTC if missing.
    Returns hour-of-day as a float (e.g. 14.5 = 2:30pm). Capped to 0-23.99."""
    if local_now_iso:
        try:
            dt = datetime.fromisoformat(local_now_iso.replace("Z", "+00:00"))
            return min(23.99, max(0.0, dt.hour + dt.minute / 60.0))
        except Exception:
            pass
    dt = datetime.utcnow()
    return dt.hour + dt.minute / 60.0


def _day_progress_pct(hour_of_day: float) -> float:
    """How far through the awake window are we? Clamps to 0-1."""
    if hour_of_day <= AWAKE_START_HOUR:
        return 0.0
    if hour_of_day >= AWAKE_END_HOUR:
        return 1.0
    return (hour_of_day - AWAKE_START_HOUR) / (AWAKE_END_HOUR - AWAKE_START_HOUR)


def _pace_status(
    consumed_protein: float,
    target_protein:   float,
    consumed_kcal:    int,
    target_kcal:      int,
    day_progress:     float,
) -> dict:
    """Compare consumed vs. what a linear pace would have you at. Returns
    one of: 'on_pace', 'behind_protein', 'behind_calories', 'over_calories',
    'no_targets', 'early' (before 9am — no judgment yet), 'late_settled'
    (after 9pm — the day's mostly done).

    Plus a one-line `message` summarizing the situation."""
    # Very early or very late in the day: don't nudge. People skip breakfast
    # or finish eating by 8pm; we shouldn't yell at them either way.
    if day_progress < 0.18:  # < ~9am
        return {"kind": "early", "message": "Day's just getting started."}
    if day_progress >= 0.95:
        return {"kind": "late_settled", "message": "Day's nearly done — log what's left and call it."}

    if target_protein <= 0 or target_kcal <= 0:
        return {"kind": "no_targets", "message": "Set macro targets in nutrition settings to get a pace check."}

    protein_pct = consumed_protein / target_protein if target_protein else 0
    kcal_pct    = consumed_kcal    / target_kcal    if target_kcal    else 0

    protein_gap = day_progress - protein_pct
    kcal_gap    = day_progress - kcal_pct  # positive = behind, negative = ahead

    # Calorie overshoot is the loudest signal — if you're already past
    # budget at 3pm, that's the most actionable thing to flag.
    if kcal_pct >= 1.0:
        return {
            "kind":    "over_calories",
            "message": f"You've already passed your calorie budget ({consumed_kcal}/{target_kcal} kcal). Light dinner.",
        }

    if protein_gap > PACE_GAP_THRESHOLD:
        # Behind on protein — most common case at 50+ given typical Western
        # breakfasts. Coach Al's job is to flag the gap with a number.
        need = max(0, round(target_protein - consumed_protein))
        return {
            "kind":    "behind_protein",
            "message": f"Behind pace on protein — {need}g still to hit target.",
        }

    if kcal_gap > PACE_GAP_THRESHOLD * 1.5:
        # Way under calories late in the day — could be a fast day, or could
        # be under-fueling. Mention but don't push.
        return {
            "kind":    "behind_calories",
            "message": f"Light intake so far ({consumed_kcal} kcal). If that's intentional, ignore this.",
        }

    return {
        "kind":    "on_pace",
        "message": "On pace for today's targets.",
    }


def _next_meal_hint(
    remaining_protein_g: float,
    remaining_kcal:      int,
) -> Optional[str]:
    """Concrete suggestion for the next meal based on what's still on the
    plate. Very simple food-to-macro mapping — Coach Al's voice without the
    LLM bill."""
    if remaining_kcal <= 100 and remaining_protein_g <= 10:
        return "You're basically done. A small snack if hungry; otherwise, you're set."
    if remaining_protein_g >= 40 and remaining_kcal >= 400:
        return f"To land on target: ~6oz chicken or fish + a complex carb side (≈ {remaining_protein_g:.0f}g protein, {remaining_kcal} kcal)."
    if remaining_protein_g >= 25 and remaining_kcal <= 300:
        return f"You're light on protein, heavy on calorie budget. A protein shake (~{remaining_protein_g:.0f}g) is the easiest landing."
    if remaining_kcal >= 300 and remaining_protein_g < 15:
        return f"Calorie budget still open ({remaining_kcal} kcal) but protein is met. Carbs/fat or a snack of choice."
    return None


def build_payload(
    user_id:          str,
    today_iso:        str,
    consumed_totals:  dict,
    settings:         dict,
    local_now_iso:    Optional[str] = None,
) -> dict:
    """Compute everything the NutritionCoachCard needs in one shot.

    Args:
      user_id:         caller id
      today_iso:       caller's local date (YYYY-MM-DD)
      consumed_totals: {calories, protein, carbs, fat} already eaten today
      settings:        nutrition_settings row (calorie_target, protein_g, etc.)
      local_now_iso:   caller's local current datetime in ISO; falls back to UTC
    """
    try:
        end_date = _date.fromisoformat(today_iso)
    except Exception:
        end_date = _date.today()

    daily = _fetch_recent_daily_totals(user_id, end_date, STREAK_LOOKBACK_DAYS)

    target_protein = float(settings.get("protein_g") or 0)
    target_kcal    = int(settings.get("calorie_target") or 0)
    target_carbs   = float(settings.get("carbs_g") or 0)
    target_fat     = float(settings.get("fat_g") or 0)

    consumed_protein = float(consumed_totals.get("protein") or 0)
    consumed_kcal    = int(consumed_totals.get("calories") or 0)
    consumed_carbs   = float(consumed_totals.get("carbs")   or 0)
    consumed_fat     = float(consumed_totals.get("fat")     or 0)

    streak = _protein_streak(daily, target_protein)

    hour_now      = _local_hour_now(local_now_iso)
    day_progress  = _day_progress_pct(hour_now)
    pace          = _pace_status(
        consumed_protein, target_protein,
        consumed_kcal, target_kcal,
        day_progress,
    )

    remaining_protein = max(0.0, target_protein - consumed_protein)
    remaining_kcal    = max(0,   target_kcal    - consumed_kcal)
    suggestion        = _next_meal_hint(remaining_protein, remaining_kcal)

    return {
        "date":             end_date.isoformat(),
        "pace":             pace,                 # {kind, message}
        "streak_days":      streak,
        "streak_threshold_pct": int(PROTEIN_HIT_PCT * 100),
        "day_progress_pct": round(day_progress * 100),
        "targets": {
            "calories": target_kcal,
            "protein":  round(target_protein),
            "carbs":    round(target_carbs),
            "fat":      round(target_fat),
        },
        "consumed": {
            "calories": consumed_kcal,
            "protein":  round(consumed_protein),
            "carbs":    round(consumed_carbs),
            "fat":      round(consumed_fat),
        },
        "remaining": {
            "calories": remaining_kcal,
            "protein":  round(remaining_protein),
        },
        "next_meal_hint": suggestion,
    }
