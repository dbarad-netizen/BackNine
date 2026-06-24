"""
Tonight's Sleep prescription — Coach Al's forward-looking sleep card.

Mirrors Today's Workout but for sleep. Lives at the top of the Scorecard
(which is now the Sleep view per the rename) and answers the question that
the morning briefing doesn't: *what should I do tonight?*

Output:
  • recommended_bedtime / lights_out_window — when to start winding down
  • target_sleep_hours — pulled from user's sleep_target or default 8h
  • sleep_debt_hours — sum of (Oura's per-night sleep_need - actual)
    over the last 7 nights. Uses Oura's personalized need (which the ring
    calculates dynamically per user/night) so the number matches what the
    Oura app reports, instead of computing against a static 8h target.
  • streak_nights — consecutive nights of ≥7h AND ≥85% efficiency
  • last_night_summary — quick recap line
  • coach_note — one-line voice from Coach Al that ties the data together

Bedtime math:
  • Pull the user's typical wake time from Oura's recent sleep windows
    (median wake hour over the last 14 days).
  • Subtract target_sleep_hours plus a 30-min fall-asleep buffer to get
    the lights-out window.
  • If the user has heavy training prescribed for tomorrow, shift bedtime
    30 min earlier — recovery demands more sleep.

Conservative philosophy: if Oura data is sparse, we render `null` for
bedtime/streak/debt and let the frontend skip those sections rather than
fabricating numbers from thin air.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────────

DEFAULT_TARGET_HOURS         = 8.0
WIND_DOWN_BUFFER_MIN         = 30   # extra time before lights-out to actually fall asleep
STREAK_LOOKBACK_NIGHTS       = 30
STREAK_HIT_HOURS             = 7.0
STREAK_HIT_EFFICIENCY        = 85   # percent
DEBT_WINDOW_NIGHTS           = 7
# Sanity ceiling only — used to be 10h which created a confusing situation
# where the card said "10.0h" for any debt ≥ 10. Real Oura debts can easily
# exceed 8-10h during a bad week (e.g. 6h short × 7 nights = 42h on paper).
# 20h is high enough that real users never hit it.
DEBT_SANITY_MAX_HOURS        = 20.0
HEAVY_TRAINING_EARLIER_MIN   = 30


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _get_sleep_target_hours(user_id: str) -> float:
    """User's sleep target from user_profiles. Default 8h."""
    sb = _sb()
    if not sb:
        return DEFAULT_TARGET_HOURS
    try:
        res = (
            sb.table("user_profiles")
            .select("sleep_target_hours")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get("sleep_target_hours") is not None:
            return float(rows[0]["sleep_target_hours"])
    except Exception:
        pass
    return DEFAULT_TARGET_HOURS


def _check_tomorrow_workout_intensity(user_id: str, tomorrow_iso: str) -> Optional[str]:
    """Peek at tomorrow's Coach Al prescription (today_workout cache).
    Returns the intensity string ('heavy', 'moderate', 'easy', 'rest') or
    None if there's no prescription yet. Best-effort — the prescription is
    cached per-day so we may not have one for tomorrow yet."""
    sb = _sb()
    if not sb:
        return None
    try:
        res = (
            sb.table("today_workout")
            .select("intensity")
            .eq("user_id", user_id)
            .eq("date", tomorrow_iso)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return (rows[0].get("intensity") or "").lower() or None
    except Exception:
        pass
    return None


def _median_wake_hour(smm: dict, days: int = 14) -> Optional[float]:
    """Median hour-of-day the user has woken up over the last N days. Returns
    something like 6.5 (= 6:30am) or None if not enough Oura nights cached.

    Uses bedtime_end (when the user got out of bed). We parse the ISO time
    out of the timestamp, ignoring timezone — the time component IS local
    wake time as reported by the ring."""
    if not smm:
        return None
    today = _date.today()
    hours: list[float] = []
    for offset in range(0, days):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d) or {}
        end = row.get("bedtime_end") or row.get("end_time")
        if not end:
            continue
        try:
            dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            hours.append(dt.hour + dt.minute / 60.0)
        except Exception:
            continue
    if len(hours) < 3:
        return None
    hours.sort()
    mid = len(hours) // 2
    if len(hours) % 2 == 1:
        return hours[mid]
    return (hours[mid - 1] + hours[mid]) / 2


def _fmt_hour(h: float) -> str:
    """3.5 → '3:30am', 22.0 → '10:00pm'. Wraps at 24."""
    h = h % 24
    full = int(h)
    mins = int(round((h - full) * 60))
    if mins == 60:
        full = (full + 1) % 24
        mins = 0
    suffix = "am" if full < 12 else "pm"
    disp_h = full if 1 <= full <= 12 else (12 if full == 0 else full - 12)
    return f"{disp_h}:{mins:02d}{suffix}"


def _sleep_streak(smm: dict, today: _date) -> int:
    """Consecutive nights ending YESTERDAY of ≥STREAK_HIT_HOURS total +
    ≥STREAK_HIT_EFFICIENCY%. Today is excluded — tonight hasn't happened
    yet."""
    streak = 0
    # Start from yesterday and walk backward.
    for offset in range(1, STREAK_LOOKBACK_NIGHTS + 1):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d)
        if not row:
            break
        total = row.get("total") or 0
        eff   = row.get("efficiency") or 0
        if (total / 3600.0) >= STREAK_HIT_HOURS and eff >= STREAK_HIT_EFFICIENCY:
            streak += 1
        else:
            break
    return streak


def _sleep_debt(smm: dict, target_hours: float, today: _date) -> Optional[float]:
    """Sum of (per-night target - actual) over the last 7 nights.

    Critical: Oura calculates the user's sleep need DYNAMICALLY per night
    (age, recent recovery, training load) and we cache it as `sleep_need`
    in seconds. When that value is present we use it instead of the user's
    static target_hours — this is what makes the BackNine number match
    what the Oura app shows. Static fallback is only used when Oura hasn't
    reported a per-night need (rare; happens on partial-night data).

    Returns total debt in hours (one decimal). None if fewer than 4
    nights of data (avoids alarming the user from a 1-2 night sample)."""
    debts: list[float] = []
    for offset in range(1, DEBT_WINDOW_NIGHTS + 1):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d)
        if not row or row.get("total") is None:
            continue
        actual_sec = row.get("total") or 0
        # Prefer Oura's personalized need; fall back to user's static
        # target only when Oura didn't report one for this night.
        need_sec = row.get("sleep_need")
        if need_sec and need_sec > 0:
            target_sec = float(need_sec)
        else:
            target_sec = target_hours * 3600.0
        gap_sec = target_sec - actual_sec
        # Don't bank positive credits — sleeping 9h doesn't erase prior debt.
        debts.append(max(0.0, gap_sec))
    if len(debts) < 4:
        return None
    total_hours = sum(debts) / 3600.0
    return min(DEBT_SANITY_MAX_HOURS, round(total_hours, 1))


def _last_night_summary(smm: dict, today: _date) -> Optional[dict]:
    """Quick recap of last night's sleep. Returns None if no data."""
    last = (today - timedelta(days=1)).isoformat()
    row = smm.get(last)
    if not row or row.get("total") is None:
        return None
    total_h = (row.get("total") or 0) / 3600.0
    return {
        "date":       last,
        "hours":      round(total_h, 1),
        "efficiency": row.get("efficiency"),
        "hrv":        row.get("hrv"),
    }


def _coach_note(
    target_hours:    float,
    debt:            Optional[float],
    streak:          int,
    tomorrow_intensity: Optional[str],
) -> str:
    """One-line summary tying the data into a recommendation. Rules-based —
    we're not paying for an LLM call on every Scorecard load."""
    if debt is not None and debt >= 4.0:
        # Format as Xh Ym to match the Oura app's debt readout — keeps
        # the briefing and the ring on the same page.
        total_min = int(round(debt * 60))
        h, m = divmod(total_min, 60)
        debt_str = f"{h}h {m}m" if m else f"{h}h"
        return f"You're carrying {debt_str} of sleep debt — go to bed early tonight, not just on target."
    if tomorrow_intensity == "heavy":
        return "Heavy training tomorrow — protect tonight's full 8 hours. Lights out earlier than usual."
    if streak >= 7:
        return f"🔥 {streak}-night sleep streak — same routine tonight and you'll roll past a full week."
    if streak >= 3:
        return f"{streak} solid nights in a row. Hold the same lights-out time tonight."
    if debt is not None and debt >= 2.0:
        total_min = int(round(debt * 60))
        h, m = divmod(total_min, 60)
        debt_str = f"{h}h {m}m" if m else f"{h}h"
        return f"{debt_str} light over the last week — tonight's a bank-it night."
    return f"Aim for {target_hours:.0f}h tonight. Consistency beats catch-up."


def build_payload(user_id: str, today_iso: Optional[str] = None) -> dict:
    """Single call → everything the Tonight's Sleep card needs.

    today_iso is the caller's LOCAL today (the frontend passes its own date).
    """
    try:
        today = _date.fromisoformat(today_iso) if today_iso else _date.today()
    except Exception:
        today = _date.today()

    target_hours = _get_sleep_target_hours(user_id)

    smm: dict = {}
    try:
        _, _, _, smm = oc.get_days(user_id, days=30)
    except Exception:
        smm = {}

    median_wake = _median_wake_hour(smm)
    bedtime: Optional[dict] = None
    if median_wake is not None:
        tomorrow_iso = (today + timedelta(days=1)).isoformat()
        intensity = _check_tomorrow_workout_intensity(user_id, tomorrow_iso)

        # Lights-out = wake_hour - target_hours, wrapping into the previous
        # evening (negative hours wrap to 24+).
        raw_lights_out = median_wake - target_hours
        if intensity == "heavy":
            raw_lights_out -= HEAVY_TRAINING_EARLIER_MIN / 60.0
        # Add wind-down buffer = bedtime (start of winding down) BEFORE
        # lights-out.
        wind_down_start = raw_lights_out - WIND_DOWN_BUFFER_MIN / 60.0
        bedtime = {
            "wind_down_start": _fmt_hour(wind_down_start),
            "lights_out":      _fmt_hour(raw_lights_out),
            "target_wake":     _fmt_hour(median_wake),
            "target_hours":    target_hours,
            "earlier_for_training": intensity == "heavy",
        }

    streak       = _sleep_streak(smm, today) if smm else 0
    debt         = _sleep_debt(smm, target_hours, today) if smm else None
    last_night   = _last_night_summary(smm, today) if smm else None
    # Tomorrow intensity peeked inside the bedtime calc; re-fetch for the
    # coach_note in case we didn't compute a bedtime (sparse Oura history).
    tomorrow_iso = (today + timedelta(days=1)).isoformat()
    intensity    = _check_tomorrow_workout_intensity(user_id, tomorrow_iso)
    note         = _coach_note(target_hours, debt, streak, intensity)

    return {
        "date":              today.isoformat(),
        "target_hours":      target_hours,
        "bedtime":           bedtime,
        "streak_nights":     streak,
        "sleep_debt_hours":  debt,
        "last_night":        last_night,
        "tomorrow_intensity": intensity,
        "coach_note":        note,
    }
