"""
Weekly Health Span Score — BackNine's behavioral/process score.

Sits alongside Biological Age (clinical/outcome). Attia-style split:
  - Biological Age  → outcome: "how old does your body look?"
                      Inputs: HRV, RHR, VO2 max, body fat, HbA1c, LDL,
                      BP, hsCRP. Updates slowly.
  - Health Span     → process: "how well are you executing this week?"
                      Inputs: sleep hours, sleep consistency, daily
                      steps, weekly workout count, med adherence,
                      protein target hit rate, check-in streak,
                      hydration, CPAP compliance (if applicable).
                      Updates daily.

Zero overlap. Both matter — outcome tells you if you're healthy;
process tells you if you're doing the right things this week.
Someone with great Bio Age + low Health Span = coasting on genetics.
Someone with fair Bio Age + high Health Span = investing effort,
trust the effort will move the outcome over months.

David 2026-08-11.
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


def _score_workouts(count_last_7d: int) -> dict:
    if count_last_7d >= 4:   pts, tone = 15, "excellent"
    elif count_last_7d == 3: pts, tone = 12, "solid"
    elif count_last_7d == 2: pts, tone = 8,  "moderate"
    elif count_last_7d == 1: pts, tone = 4,  "light"
    else:                     pts, tone = 0,  "none"
    return {
        "label":  "Workouts this week",
        "value":  f"{count_last_7d}",
        "norm":   "3+ per week",
        "points": pts, "max": 15,
        "why": (f"{count_last_7d} logged workout{'s' if count_last_7d != 1 else ''} in the "
                f"last 7 days — {tone}. 3+ per week is the mortality "
                "floor per Ross et al. cardiorespiratory fitness work."),
    }


def _score_adherence(pct: Optional[float]) -> Optional[dict]:
    if pct is None:
        return None
    if pct >= 90:   pts, tone = 15, "excellent"
    elif pct >= 75: pts, tone = 12, "good"
    elif pct >= 60: pts, tone = 8,  "inconsistent"
    elif pct >= 40: pts, tone = 4,  "poor"
    else:            pts, tone = 0,  "very poor"
    return {
        "label":  "Med / supplement adherence",
        "value":  f"{int(pct)}%",
        "norm":   "≥90% ideal",
        "points": pts, "max": 15,
        "why": (f"You took {int(pct)}% of your scheduled meds & "
                f"supplements this week — {tone}. High adherence is "
                "essential for chronic disease meds to work."),
    }


def _score_protein(pct_days_hit: Optional[float]) -> Optional[dict]:
    if pct_days_hit is None:
        return None
    if pct_days_hit >= 85:   pts, tone = 15, "excellent"
    elif pct_days_hit >= 70: pts, tone = 12, "good"
    elif pct_days_hit >= 50: pts, tone = 8,  "inconsistent"
    elif pct_days_hit >= 25: pts, tone = 4,  "poor"
    else:                     pts, tone = 0,  "very poor"
    return {
        "label":  "Protein target",
        "value":  f"{int(pct_days_hit)}% of days",
        "norm":   "hit target ≥85% of days",
        "points": pts, "max": 15,
        "why": (f"You hit your protein target on {int(pct_days_hit)}% of "
                f"logged days — {tone}. Adequate protein preserves "
                "muscle mass, which is protective against all-cause "
                "mortality after 50."),
    }


def _score_checkin_streak(streak_days: int) -> dict:
    if streak_days >= 7:   pts = 10
    elif streak_days >= 5: pts = 8
    elif streak_days >= 3: pts = 6
    elif streak_days >= 1: pts = 3
    else:                   pts = 0
    return {
        "label":  "Daily check-in streak",
        "value":  f"{streak_days} day{'s' if streak_days != 1 else ''}",
        "norm":   "daily",
        "points": pts, "max": 10,
        "why": ("Regular self-check-in surfaces symptoms early and "
                "feeds correlations Coach Al uses to spot patterns. "
                "The habit itself is the point."),
    }


def _score_hydration(pct_days_hit: Optional[float]) -> Optional[dict]:
    if pct_days_hit is None:
        return None
    if pct_days_hit >= 85:   pts = 5
    elif pct_days_hit >= 60: pts = 3
    else:                     pts = 1
    return {
        "label":  "Hydration",
        "value":  f"{int(pct_days_hit)}% of days",
        "norm":   "hit target ≥85% of days",
        "points": pts, "max": 5,
        "why": (f"You hit your hydration target on {int(pct_days_hit)}% "
                "of logged days. Adequate fluid intake supports "
                "cognition and cardiovascular health."),
    }


def _score_cpap(qualifying_nights: int) -> dict:
    """Only present when user has 'cpap' capability enabled. Insurance
    rule is ≥4h on ≥75% of nights; we mirror that scoring."""
    if qualifying_nights >= 6:   pts = 5   # 6-7 nights → excellent
    elif qualifying_nights >= 4: pts = 3   # 4-5 → decent
    else:                         pts = 1  # 0-3 → at insurance risk
    return {
        "label":  "CPAP compliance",
        "value":  f"{qualifying_nights}/7 nights",
        "norm":   "≥4 h on 6+ nights",
        "points": pts, "max": 5,
        "why": (f"You used your CPAP ≥4 h on {qualifying_nights} of the "
                "last 7 nights. Consistent CPAP use is the highest-signal "
                "intervention for sleep apnea outcomes."),
    }


# ── Data loaders ────────────────────────────────────────────────────────

def _load_sleep_avg(user_id: str, oura_smm: dict) -> Optional[float]:
    """Prefer Oura (nightly total seconds), fall back to AH sleep_hours
    fetched from apple_health_daily. Self-contained — no map to pass."""
    vals = [oura_smm[d]["total"] / 3600 for d in sorted(oura_smm, reverse=True)[:7]
            if oura_smm.get(d, {}).get("total")]
    if vals:
        return round(sum(vals) / len(vals), 2)
    try:
        import apple_health as ah
        rows = ah.get_data(user_id, days=7)
        ah_vals = [float(r["sleep_hours"]) for r in rows if r.get("sleep_hours") is not None]
        return round(sum(ah_vals) / len(ah_vals), 2) if ah_vals else None
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


def _load_workouts_count(user_id: str, today_iso: str) -> int:
    sb = _sb()
    if not sb: return 0
    try:
        since = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
        res = (sb.table("training_workouts")
                 .select("id", count="exact")
                 .eq("user_id", user_id)
                 .gte("date", since)
                 .execute())
        return int(res.count or 0)
    except Exception:
        return 0


def _load_adherence_pct(user_id: str, today_iso: str) -> Optional[float]:
    """Rough % — count taken rows over expected rows across last 7 days.
    Expected = number of stack items × 7 (approximation)."""
    sb = _sb()
    if not sb: return None
    try:
        since = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
        res = (sb.table("stack_adherence_log")
                 .select("date, item_key, item_kind, taken, time_of_day")
                 .eq("user_id", user_id)
                 .gte("date", since)
                 .execute())
        rows = res.data or []
        if not rows:
            return None
        taken = sum(1 for r in rows if r.get("taken"))
        return round(taken / len(rows) * 100, 1)
    except Exception:
        return None


def _load_protein_hit_pct(user_id: str, today_iso: str, profile: dict) -> Optional[float]:
    """% of logged days where daily protein >= target. Target from
    nutrition_settings; fall back to 0.8 g/kg × user weight."""
    sb = _sb()
    if not sb: return None
    try:
        since = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
        # Fetch target
        res_s = (sb.table("nutrition_settings")
                   .select("protein_target_g")
                   .eq("user_id", user_id)
                   .limit(1)
                   .execute())
        target = None
        if res_s.data:
            target = res_s.data[0].get("protein_target_g")
        if target is None:
            # Fallback: 0.8 g/kg. Estimate weight from profile if present.
            wt_lb = None
            # Height stored as cm; weight not in profile. Skip fallback if unknown.
            return None

        # Aggregate meals by date
        res_m = (sb.table("nutrition_meals")
                   .select("date, protein")
                   .eq("user_id", user_id)
                   .gte("date", since)
                   .execute())
        per_day: dict = {}
        for r in (res_m.data or []):
            d = str(r.get("date"))
            per_day.setdefault(d, 0.0)
            per_day[d] += float(r.get("protein") or 0)
        if not per_day:
            return None
        hits = sum(1 for v in per_day.values() if v >= float(target))
        return round(hits / len(per_day) * 100, 1)
    except Exception:
        return None


def _load_checkin_streak(user_id: str, today_iso: str) -> int:
    """Consecutive days ending today with a daily_checkin. Streak breaks
    on a missed day."""
    sb = _sb()
    if not sb: return 0
    try:
        since = (_date.fromisoformat(today_iso) - timedelta(days=13)).isoformat()
        res = (sb.table("daily_checkins")
                 .select("date")
                 .eq("user_id", user_id)
                 .gte("date", since)
                 .order("date", desc=True)
                 .execute())
        dates = {str(r.get("date")) for r in (res.data or [])}
        streak = 0
        cur = _date.fromisoformat(today_iso)
        while cur.isoformat() in dates:
            streak += 1
            cur -= timedelta(days=1)
        return streak
    except Exception:
        return 0


def _load_hydration_pct(user_id: str, today_iso: str) -> Optional[float]:
    """% of logged days hitting hydration target. Target from
    nutrition_settings.hydration_target_oz; skip if unset."""
    sb = _sb()
    if not sb: return None
    try:
        res_s = (sb.table("nutrition_settings")
                   .select("hydration_target_oz")
                   .eq("user_id", user_id)
                   .limit(1)
                   .execute())
        target = None
        if res_s.data:
            target = res_s.data[0].get("hydration_target_oz")
        if not target:
            return None

        since = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
        res = (sb.table("hydration_log")
                 .select("date, ounces")
                 .eq("user_id", user_id)
                 .gte("date", since)
                 .execute())
        per_day: dict = {}
        for r in (res.data or []):
            d = str(r.get("date"))
            per_day.setdefault(d, 0.0)
            per_day[d] += float(r.get("ounces") or 0)
        if not per_day:
            return None
        hits = sum(1 for v in per_day.values() if v >= float(target))
        return round(hits / len(per_day) * 100, 1)
    except Exception:
        return None


def _load_cpap_qualifying_nights(user_id: str, today_iso: str) -> Optional[int]:
    """Nights with usage_hours >= 4 in last 7. None if user isn't
    logging CPAP at all (no rows)."""
    sb = _sb()
    if not sb: return None
    try:
        since = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
        res = (sb.table("cpap_nightly_log")
                 .select("date, usage_hours")
                 .eq("user_id", user_id)
                 .gte("date", since)
                 .execute())
        rows = res.data or []
        if not rows:
            return None
        return sum(1 for r in rows if float(r.get("usage_hours") or 0) >= 4)
    except Exception:
        return None


# ── Composite ───────────────────────────────────────────────────────────

def compute(user_id: str, today_iso: str, oura_am: dict, oura_smm: dict,
            profile: dict,
            capabilities: Optional[list] = None) -> dict:
    """Assemble the Weekly Health Span Score. All loaders self-hide
    when their data isn't available — final score is normalized to
    the max possible so users don't get penalized for gaps in what
    they haven't logged yet."""
    capabilities = capabilities or []
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

    workouts_n = _load_workouts_count(user_id, today_iso)
    c = _score_workouts(workouts_n)
    components["workouts"] = c; total_points += c["points"]; max_possible += c["max"]

    # --- Adherence bands ---
    adh_pct = _load_adherence_pct(user_id, today_iso)
    c = _score_adherence(adh_pct)
    if c: components["adherence"] = c; total_points += c["points"]; max_possible += c["max"]

    protein_pct = _load_protein_hit_pct(user_id, today_iso, profile)
    c = _score_protein(protein_pct)
    if c: components["protein"] = c; total_points += c["points"]; max_possible += c["max"]

    streak = _load_checkin_streak(user_id, today_iso)
    c = _score_checkin_streak(streak)
    components["checkin"] = c; total_points += c["points"]; max_possible += c["max"]

    hyd_pct = _load_hydration_pct(user_id, today_iso)
    c = _score_hydration(hyd_pct)
    if c: components["hydration"] = c; total_points += c["points"]; max_possible += c["max"]

    # --- CPAP band (capability-gated) ---
    if "cpap" in capabilities:
        cpap_nights = _load_cpap_qualifying_nights(user_id, today_iso)
        if cpap_nights is not None:
            c = _score_cpap(cpap_nights)
            components["cpap"] = c; total_points += c["points"]; max_possible += c["max"]

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
            "Weekly Health Span Score reflects your effort this week — "
            "sleep habits, movement, adherence, and check-ins. Complements "
            "Biological Age, which reflects your clinical state. Effort "
            "moves outcome over months."
        ),
    }
