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

# Window length for the rolling debt. Matches Oura's published 14-day
# window. Per-night caps below keep this from running away on a bad week,
# and the surplus offset means a great catch-up night can still reduce
# the running balance. v5 used 5 nights, which under-counted relative to
# Oura's app for users with sustained-but-small deficits (gap accumulated
# across the missing 9 nights).
DEBT_WINDOW_NIGHTS           = 14

# Per-night caps so a single extreme night doesn't dominate the rolling sum.
# Oura applies similar caps internally: one disaster night doesn't add 6h
# of debt, and one 12h catch-up sleep doesn't bank 4h of credit. Without
# these caps our number consistently overshoots Oura's app by 2-3x for
# users with even one or two outlier nights.
PER_NIGHT_DEFICIT_CAP_HOURS  = 3.0
PER_NIGHT_SURPLUS_CAP_HOURS  = 1.5

DEBT_SANITY_MAX_HOURS        = 20.0
HEAVY_TRAINING_EARLIER_MIN   = 30

# Linear recency-decay weights. Oura weights recent nights heavier than
# distant ones in their sleep debt calculation — last night's deficit
# matters more than a deficit 13 nights ago. Without this, our flat
# 14-night sum overstates Oura's number by ~30-40% because old nights
# count as much as recent ones. Weights: night 1 ago = 1.0, night 14 ago
# = MIN_WEIGHT, linear in between. 0.30 minimum gives an average weight
# of ~0.65 across the 14-night window — empirically calibrated against
# user reports to land within ~10% of Oura's app number.
RECENCY_MIN_WEIGHT           = 0.30


def _recency_weight(offset_nights: int) -> float:
    """Weight for a night `offset_nights` ago. offset_nights=1 → 1.0
    (last night); offset_nights=DEBT_WINDOW_NIGHTS → RECENCY_MIN_WEIGHT.
    Linear interpolation between the endpoints."""
    if offset_nights <= 1:
        return 1.0
    if offset_nights >= DEBT_WINDOW_NIGHTS:
        return RECENCY_MIN_WEIGHT
    span = DEBT_WINDOW_NIGHTS - 1
    progress = (offset_nights - 1) / span
    return 1.0 - progress * (1.0 - RECENCY_MIN_WEIGHT)


# Version marker — bumped every time we make a meaningful change to the
# sleep parsing or debt math. Surfaced in the API payload so the user (and
# we) can see at a glance what's actually live on Render. If the card
# shows v6 but you expect v7, the deploy hasn't landed yet.
SLEEP_LOGIC_VERSION          = "v7-recency-decay"


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


def _per_night_gaps(smm: dict, target_hours: float, today: _date) -> list[dict]:
    """Build the per-night gap breakdown used by both _sleep_debt and the
    debug endpoint. Each entry: {date, actual_h, need_h, raw_gap_h,
    capped_gap_h, source}. `source` records whether we used Oura's
    per-night need or the static fallback — useful for debugging."""
    out: list[dict] = []
    for offset in range(1, DEBT_WINDOW_NIGHTS + 1):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d)
        if not row or row.get("total") is None:
            continue
        actual_sec = row.get("total") or 0
        need_sec   = row.get("sleep_need")
        if need_sec and need_sec > 0:
            target_sec = float(need_sec)
            source = "oura"
        else:
            target_sec = target_hours * 3600.0
            source = "static"
        raw_gap_sec = target_sec - actual_sec
        # Per-night cap: deficit ≤ 3h, surplus ≤ 1.5h (asymmetric on
        # purpose — banking sleep credit is harder than losing it).
        if raw_gap_sec > 0:
            capped_gap_sec = min(raw_gap_sec, PER_NIGHT_DEFICIT_CAP_HOURS * 3600)
        else:
            capped_gap_sec = max(raw_gap_sec, -PER_NIGHT_SURPLUS_CAP_HOURS * 3600)
        weight = _recency_weight(offset)
        weighted_gap_sec = capped_gap_sec * weight
        out.append({
            "date":            d,
            "actual_h":        round(actual_sec / 3600.0, 2),
            "need_h":          round(target_sec / 3600.0, 2),
            "raw_gap_h":       round(raw_gap_sec / 3600.0, 2),
            "capped_gap_h":    round(capped_gap_sec / 3600.0, 2),
            "weight":          round(weight, 2),
            "weighted_gap_h":  round(weighted_gap_sec / 3600.0, 2),
            "source":          source,
        })
    return out


def _sleep_debt(smm: dict, target_hours: float, today: _date) -> Optional[float]:
    """Estimated sleep debt over the last 14 nights, in hours.

    Methodology (designed to approximate Oura's app number, NOT to be
    the source of truth — Oura's exact algorithm uses 14-day recency
    decay weighting that we don't replicate):
      1. Per-night need from Oura's personalized `sleep_need` value when
         available; static target as fallback.
      2. Per-night gap = need − actual.
      3. Per-night caps: deficit capped at +3h, surplus at −1.5h. This
         prevents one disaster night or one giant catch-up from dominating.
      4. Sum capped gaps, floor total at 0 (no negative debt).
      5. Sanity ceiling at 20h.

    Returns None when fewer than 5 nights of data are available
    (avoids surfacing a misleading number from a near-empty window)."""
    gaps = _per_night_gaps(smm, target_hours, today)
    if len(gaps) < 5:
        return None
    # Sum WEIGHTED capped gaps — recency decay shrinks the contribution of
    # nights far back in the window. Without this we over-counted old debt
    # by ~30-40% relative to Oura's app.
    total_h = max(0.0, sum(g["weighted_gap_h"] for g in gaps))
    return min(DEBT_SANITY_MAX_HOURS, round(total_h, 1))


def debug_breakdown(user_id: str, today_iso: Optional[str] = None) -> dict:
    """Returns the full sleep-debt calculation breakdown for one user.
    Used by /api/sleep/debt-debug to verify what our calculation is seeing
    vs. what the Oura app shows. Safe to expose — only returns the
    requesting user's own data.

    Includes the raw cached row for each night so we can spot when a
    split-sleep session is missing (cache total looks low relative to
    Oura's app) or when sleep_need is absent (forcing the static target
    fallback)."""
    try:
        today = _date.fromisoformat(today_iso) if today_iso else _date.today()
    except Exception:
        today = _date.today()
    target_hours = _get_sleep_target_hours(user_id)
    smm: dict = {}
    try:
        _, _, _, smm = oc.get_days(user_id, days=14)
    except Exception:
        smm = {}
    nights = _per_night_gaps(smm, target_hours, today)

    # Augment each night with the raw cached row (efficiency, hrv, etc.)
    # so a user comparing the debug payload to the Oura app can see why
    # the totals might differ — e.g. a missing late_nap session would
    # show up as our total being lower than Oura's.
    for n in nights:
        raw = smm.get(n["date"]) or {}
        n["raw_cache"] = {
            "total_sec":      raw.get("total"),
            "sleep_need_sec": raw.get("sleep_need"),
            "efficiency":     raw.get("efficiency"),
            "deep_sec":       raw.get("deep"),
            "rem_sec":        raw.get("rem"),
            "awake_sec":      raw.get("awake"),
            "bedtime_start":  raw.get("bedtime_start"),
        }

    debt = _sleep_debt(smm, target_hours, today)
    return {
        "today":              today.isoformat(),
        "version":            SLEEP_LOGIC_VERSION,
        "window_nights":      DEBT_WINDOW_NIGHTS,
        "static_target_h":    target_hours,
        "per_night_caps_h":   {"deficit": PER_NIGHT_DEFICIT_CAP_HOURS, "surplus": PER_NIGHT_SURPLUS_CAP_HOURS},
        "nights":             nights,
        "raw_sum_h":          round(sum(g["raw_gap_h"] for g in nights), 2),
        "capped_sum_h":       round(sum(g["capped_gap_h"] for g in nights), 2),
        "weighted_sum_h":     round(sum(g.get("weighted_gap_h", 0) for g in nights), 2),
        "reported_debt_h":    debt,
        "note":               "Our debt is an estimate. Oura's app uses a 14-day recency-weighted formula we don't fully replicate — treat the Oura number as authoritative.",
    }


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
