"""
Weekly Health Span Score — BackNine's behavioral/process score.

Sits alongside Biological Age (clinical/outcome). Attia-style split:
  - Biological Age  → outcome: "how old does your body look?"
                      Inputs: HRV, RHR, VO2 max, body fat, HbA1c, LDL,
                      BP, hsCRP. Updates slowly.
  - Health Span     → process: "how well are you executing this week?"
                      Updates daily.

v2 (David 2026-08-25): SENSOR-ONLY. v1 mixed sensor data with
logging-based bands (med adherence, protein, check-in streak,
hydration, CPAP) and the score ended up measuring logging diligence,
not health: "My med compliance is not necessarily my med adherence —
it is just what I log. This can't be about what I log. It needs to be
automated with data that is being supplied."

The four bands, all fed automatically by wearables/devices:
  1. Sleep hours       — Oura → Apple Health → manual entry
  2. Sleep timing      — Oura bedtime consistency (self-hides w/o Oura)
  3. Daily steps       — Oura → Apple Health
  4. Active days       — days with real movement (active calories from
                         Oura or Apple Health, or a logged workout);
                         catches walks and Pilates, not just gym logs

Logged behaviors (meds, meals, check-ins, CPAP) still live on their
own cards and still earn engagement points — they just don't move a
score that claims to measure health.

David 2026-08-11, reworked 2026-08-25.
"""

from __future__ import annotations

import os
import logging
import math
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger(__name__)


# ── Supabase handle ─────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL"); key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    try:
        return create_client(url, key)
    except Exception:
        log.exception("healthspan: supabase client init failed")
        return None


# ── Per-band scoring ────────────────────────────────────────────────────

def _score_sleep_hours(avg_hours: Optional[float]) -> Optional[dict]:
    if avg_hours is None:
        return None
    if 7 <= avg_hours <= 9:
        pts, tone = 15, "great"
    elif 6.5 <= avg_hours < 7 or 9 < avg_hours <= 10:
        pts, tone = 11, "close"
    elif 6 <= avg_hours < 6.5:
        pts, tone = 7, "short"
    else:
        pts, tone = 3, "off"
    return {
        "label":  "Sleep hours (7d avg)",
        "value":  f"{avg_hours:.1f} h",
        "norm":   "7-9 h optimal",
        "points": pts, "max": 15,
        "why": (f"Your 7-day sleep average is {avg_hours:.1f} h — {tone}. "
                "Consistently short or long sleep both associate with "
                "cardiovascular and metabolic risk."),
    }


def _score_sleep_consistency(bedtime_std_min: Optional[float]) -> Optional[dict]:
    if bedtime_std_min is None:
        return None
    if bedtime_std_min < 30:   pts, tone = 10, "excellent"
    elif bedtime_std_min < 45: pts, tone = 7,  "good"
    elif bedtime_std_min < 60: pts, tone = 4,  "variable"
    else:                       pts, tone = 1,  "very variable"
    return {
        "label":  "Sleep timing",
        "value":  f"±{int(bedtime_std_min)} min",
        "norm":   "<30 min std dev",
        "points": pts, "max": 10,
        "why": (f"Bedtime varied by ±{int(bedtime_std_min)} min over the "
                f"last 2 weeks — {tone}. Consistent sleep timing is one "
                "of the strongest levers on next-day HRV."),
    }


def _score_steps(avg_steps: Optional[float]) -> Optional[dict]:
    if avg_steps is None:
        return None
    if avg_steps >= 7500:   pts = 10
    elif avg_steps >= 6000: pts = 8
    elif avg_steps >= 4500: pts = 6
    elif avg_steps >= 3000: pts = 4
    else:                    pts = 2
    return {
        "label":  "Daily steps (7d avg)",
        "value":  f"{int(avg_steps):,}",
        "norm":   "7,000-8,000 optimal",
        "points": pts, "max": 10,
        "why": (f"Your 7-day step average is {int(avg_steps):,}. "
                "Mortality benefits plateau around 7-8k/day per the "
                "2020 JAMA meta-analysis — 10k is a marketing figure."),
    }


def _score_active_days(active_days: Optional[int]) -> Optional[dict]:
    """Days with real movement, detected automatically: active calories
    ≥300 from Oura or Apple Health, or a logged workout. Replaces the
    old logged-workouts band, which missed walks, Pilates, and anything
    the user didn't hand-enter (David 2026-08-25)."""
    if active_days is None:
        return None
    if active_days >= 5:   pts, tone = 15, "excellent"
    elif active_days == 4: pts, tone = 12, "solid"
    elif active_days == 3: pts, tone = 9,  "moderate"
    elif active_days == 2: pts, tone = 6,  "light"
    elif active_days == 1: pts, tone = 3,  "minimal"
    else:                   pts, tone = 0,  "sedentary"
    return {
        "label":  "Active days",
        "value":  f"{active_days}/7",
        "norm":   "4+ days with real movement",
        "points": pts, "max": 15,
        "why": (f"You had meaningful movement on {active_days} of the last "
                f"7 days — {tone}. Detected from your wearable's active "
                "calories (≥300 kcal) or a logged workout — walks and "
                "classes count, not just gym sessions. Regular movement "
                "most days is the mortality floor per cardiorespiratory "
                "fitness research."),
    }


# ── Data loaders ────────────────────────────────────────────────────────

def _load_sleep_avg(user_id: str, oura_smm: dict) -> Optional[float]:
    """Source chain: Oura (nightly total seconds) → Apple Health
    (apple_health_daily.sleep_hours) → manual entries in device_readings
    (source='manual', metric='sleep_hours'). The manual fallback is the
    Julie fix (2026-08-12, #185) — manual-only users were getting no
    sleep band at all despite diligently logging."""
    vals = [oura_smm[d]["total"] / 3600 for d in sorted(oura_smm, reverse=True)[:7]
            if oura_smm.get(d, {}).get("total")]
    if vals:
        return round(sum(vals) / len(vals), 2)
    try:
        import apple_health as ah
        rows = ah.get_data(user_id, days=7)
        ah_vals = [float(r["sleep_hours"]) for r in rows if r.get("sleep_hours") is not None]
        if ah_vals:
            return round(sum(ah_vals) / len(ah_vals), 2)
    except Exception:
        pass
    # Manual fallback
    sb = _sb()
    if not sb:
        return None
    try:
        since = (_date.today() - timedelta(days=6)).isoformat()
        res = (sb.table("device_readings")
                 .select("date, value")
                 .eq("user_id", user_id)
                 .eq("source", "manual")
                 .eq("metric", "sleep_hours")
                 .gte("date", since)
                 .execute())
        m_vals = [float(r["value"]) for r in (res.data or []) if r.get("value") is not None]
        return round(sum(m_vals) / len(m_vals), 2) if m_vals else None
    except Exception:
        return None


def _load_sleep_consistency(user_id: str, oura_smm: dict) -> Optional[float]:
    """Standard deviation of bedtime hour over last 14 nights.
    Uses Oura's bedtime_start when available."""
    times: list[float] = []
    for d in sorted(oura_smm, reverse=True)[:14]:
        bs = oura_smm.get(d, {}).get("bedtime_start")
        if not bs: continue
        try:
            # bedtime_start is ISO. Get hour-of-day as a float 0-24, but
            # normalize to a "night hour" where 3am reads as 27 (so
            # 11pm=23, midnight=24, 1am=25 — all sortable/comparable).
            dt = datetime.fromisoformat(bs.replace("Z", "+00:00"))
            hr = dt.hour + dt.minute / 60.0
            if hr < 12:  # small morning hours belong to the previous "night"
                hr += 24
            times.append(hr)
        except Exception:
            continue
    if len(times) < 3:
        return None
    mean = sum(times) / len(times)
    var  = sum((t - mean) ** 2 for t in times) / len(times)
    sd_hours = math.sqrt(var)
    return round(sd_hours * 60, 0)  # convert to minutes


def _load_steps_avg(user_id: str, oura_am: dict) -> Optional[float]:
    """Oura steps first, AH fallback."""
    vals = [oura_am[d]["steps"] for d in sorted(oura_am, reverse=True)[:7]
            if oura_am.get(d, {}).get("steps")]
    if vals:
        return round(sum(vals) / len(vals))
    try:
        import apple_health as ah
        rows = ah.get_data(user_id, days=7)
        ah_vals = [int(r["steps"]) for r in rows if r.get("steps") is not None]
        return round(sum(ah_vals) / len(ah_vals)) if ah_vals else None
    except Exception:
        return None


ACTIVE_DAY_KCAL = 300  # ~45-60 min brisk walk; catches real movement without gym bias


def _load_active_days(user_id: str, today_iso: str, oura_am: dict) -> Optional[int]:
    """Count days in the last 7 with real movement, from ANY automated
    source: Oura active calories, Apple Health active calories, or a
    logged workout (logging still counts — it's real activity — it's
    just no longer REQUIRED). Returns None only when we have no
    movement data at all (no wearable, nothing logged), so the band
    self-hides instead of reading '0/7 sedentary' at a brand-new user.
    """
    try:
        today = _date.fromisoformat(today_iso)
    except Exception:
        today = _date.today()
    window = {(today - timedelta(days=i)).isoformat() for i in range(7)}

    have_any_data = False
    qualifying: set = set()

    # Oura active calories
    for d in window:
        cal = (oura_am.get(d) or {}).get("active_cal")
        if cal is not None:
            have_any_data = True
            if float(cal) >= ACTIVE_DAY_KCAL:
                qualifying.add(d)

    # Apple Health active calories
    try:
        import apple_health as ah
        for r in ah.get_data(user_id, days=7):
            d = str(r.get("date"))
            cal = r.get("active_calories")
            if d in window and cal is not None:
                have_any_data = True
                if float(cal) >= ACTIVE_DAY_KCAL:
                    qualifying.add(d)
    except Exception:
        pass

    # Logged workouts (count toward active days, never required)
    sb = _sb()
    if sb:
        try:
            since = (today - timedelta(days=6)).isoformat()
            res = (sb.table("training_workouts")
                     .select("date")
                     .eq("user_id", user_id)
                     .gte("date", since)
                     .execute())
            for r in (res.data or []):
                d = str(r.get("date"))
                if d in window:
                    have_any_data = True
                    qualifying.add(d)
        except Exception:
            pass

    if not have_any_data:
        return None
    return len(qualifying)


def persist_and_delta(user_id: str, today_iso: str, snapshot: dict) -> Optional[dict]:
    """Upsert today's Health Span snapshot, return delta vs ~7 days ago.
    Health Span moves weekly — 7-day delta is the right horizon.
    Returns None when today or prior snapshot is missing.

    Structure returned:
      { delta_pts: int, days_ago: int }
    delta_pts > 0 = improving (green), < 0 = declining (red)
    """
    sb = _sb()
    if not sb or not user_id:
        return None
    score = snapshot.get("score")
    if score is None:
        return None
    try:
        sb.table("weekly_healthspan_history").upsert({
            "user_id":       user_id,
            "date":          today_iso,
            "score":         int(score),
            "grade":         snapshot.get("grade"),
            "bands_present": snapshot.get("bands_present"),
        }, on_conflict="user_id,date").execute()
    except Exception:
        log.exception("healthspan history upsert failed for %s", user_id)

    # Lookup ~7 days ago with ±3-day tolerance
    from datetime import date as _d, timedelta as _td
    try:
        today = _d.fromisoformat(today_iso)
        lo    = (today - _td(days=10)).isoformat()
        hi    = (today - _td(days=4)).isoformat()
        res = (sb.table("weekly_healthspan_history")
                 .select("date, score")
                 .eq("user_id", user_id)
                 .gte("date", lo)
                 .lte("date", hi)
                 .order("date", desc=True)
                 .limit(1)
                 .execute())
        rows = res.data or []
        if not rows:
            return None
        prior      = rows[0]
        prior_date = _d.fromisoformat(prior["date"])
        delta      = int(score) - int(prior["score"])
        return {
            "delta_pts": delta,
            "days_ago":  (today - prior_date).days,
        }
    except Exception:
        log.exception("healthspan history lookup failed for %s", user_id)
        return None


# ── Composite ───────────────────────────────────────────────────────────

def compute(user_id: str, today_iso: str, oura_am: dict, oura_smm: dict,
            profile: dict,
            capabilities: Optional[list] = None) -> dict:
    """Assemble the Weekly Health Span Score — v2, sensor-only.

    Four automated bands: sleep hours, sleep timing, steps, active
    days. Each self-hides when its data source isn't available and the
    score renormalizes over what's present, so an Apple-Health-only
    user (no Oura → no bedtime data) competes fairly. Requires ≥2
    bands; below that we return None rather than a score built on one
    number.

    `capabilities` is accepted for signature compatibility but no
    longer used — CPAP compliance lives on the CPAP card only (v2:
    logging-based bands removed; see module docstring).
    """
    _ = capabilities  # retained for call-site compatibility
    components = {}
    total_points = 0
    max_possible = 0

    # --- Sleep bands ---
    sleep_avg = _load_sleep_avg(user_id, oura_smm)
    c = _score_sleep_hours(sleep_avg)
    if c: components["sleep_hours"] = c; total_points += c["points"]; max_possible += c["max"]

    sc_min = _load_sleep_consistency(user_id, oura_smm)
    c = _score_sleep_consistency(sc_min)
    if c: components["sleep_consistency"] = c; total_points += c["points"]; max_possible += c["max"]

    # --- Movement bands ---
    steps_avg = _load_steps_avg(user_id, oura_am)
    c = _score_steps(steps_avg)
    if c: components["steps"] = c; total_points += c["points"]; max_possible += c["max"]

    active_n = _load_active_days(user_id, today_iso, oura_am)
    c = _score_active_days(active_n)
    if c: components["active_days"] = c; total_points += c["points"]; max_possible += c["max"]

    # Minimum-data floor: one band isn't a "score", it's a repackaged
    # metric. Two or more real signals before we put a number on it.
    if len(components) < 2:
        max_possible = 0

    score = round(100 * total_points / max_possible) if max_possible > 0 else None
    if score is not None:
        score = max(0, min(100, score))

    if score is None:
        grade = "No data"
    elif score >= 85: grade = "Excellent"
    elif score >= 70: grade = "Good"
    elif score >= 55: grade = "Fair"
    else:              grade = "Needs Work"

    return {
        "score":         score,
        "grade":         grade,
        "components":    components,
        "bands_present": len(components),
        "max_possible":  max_possible,
        "caveat":        (
            "Weekly Health Span Score is built entirely from your "
            "wearable data — sleep, steps, and movement. Nothing you "
            "log (or forget to log) changes it. Complements Biological "
            "Age, which reflects your clinical state. Effort moves "
            "outcome over months."
        ),
    }
