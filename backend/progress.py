"""
Longitudinal progress tracking for BackNine.

Compares the current 30-day period against the previous 30-day period
across Oura, nutrition, and Apple Health data. Surfaces plain-language
progress items showing whether each metric is improving, holding, or slipping.

Each progress item:
  {
    "id":            str,
    "title":         str,
    "icon":          str,          # emoji
    "current_avg":   float | None, # average value this period
    "previous_avg":  float | None,
    "current_on":    int | None,   # days on target this period
    "previous_on":   int | None,
    "period_days":   int,          # days with data in current period
    "target":        float | None, # the threshold used for "on target"
    "target_label":  str | None,   # human-readable target description
    "unit":          str,
    "delta_avg":     float | None, # current_avg - previous_avg
    "delta_on":      int | None,   # current_on - previous_on
    "direction":     "positive" | "negative" | "neutral",
    "personal_best": float | None,
    "personal_best_date": str | None,
    "summary":       str,          # one-line plain-language summary
  }
"""

import os
from datetime import date, timedelta
from typing import Optional


# ── helpers ───────────────────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


def _avg(vals: list) -> Optional[float]:
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _date_range(days_ago_start: int, days_ago_end: int) -> tuple[str, str]:
    today = date.today()
    end   = (today - timedelta(days=days_ago_end)).isoformat()
    start = (today - timedelta(days=days_ago_start)).isoformat()
    return start, end


def _direction(delta: Optional[float], higher_is_better: bool = True) -> str:
    if delta is None or abs(delta) < 0.5:
        return "neutral"
    better = delta > 0 if higher_is_better else delta < 0
    return "positive" if better else "negative"


# ── data loaders ──────────────────────────────────────────────────────────────

def _oura_rows(user_id: str, start: str, end: str) -> list[dict]:
    sb = _sb()
    res = (
        sb.table("oura_daily_cache")
        .select("date, readiness, sleep_score, activity, sleep_model")
        .eq("user_id", user_id)
        .gte("date", start)
        .lte("date", end)
        .execute()
    )
    return res.data or []


def _nutrition_rows(user_id: str, start: str, end: str) -> dict:
    """Returns daily totals: { date: { calories, protein } }"""
    sb = _sb()
    res = (
        sb.table("nutrition_meals")
        .select("date, calories, protein")
        .eq("user_id", user_id)
        .gte("date", start)
        .lte("date", end)
        .execute()
    )
    daily: dict = {}
    for r in (res.data or []):
        d = str(r["date"])
        if d not in daily:
            daily[d] = {"calories": 0, "protein": 0.0}
        daily[d]["calories"] += int(r.get("calories") or 0)
        daily[d]["protein"]  += float(r.get("protein") or 0)
    return daily


def _apple_rows(user_id: str, start: str, end: str) -> list[dict]:
    sb = _sb()
    res = (
        sb.table("apple_health_daily")
        .select("date, steps, active_calories, sleep_hours")
        .eq("user_id", user_id)
        .gte("date", start)
        .lte("date", end)
        .execute()
    )
    return res.data or []


def _nutrition_settings(user_id: str) -> dict:
    try:
        sb = _sb()
        res = (
            sb.table("nutrition_settings")
            .select("calorie_target, protein_g")
            .eq("user_id", user_id)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else {}
    except Exception:
        return {}


# ── individual progress checks ────────────────────────────────────────────────

def _readiness_progress(cur_rows: list, prev_rows: list) -> Optional[dict]:
    target = 70
    cur_vals  = [r["readiness"]["score"] for r in cur_rows  if (r.get("readiness") or {}).get("score")]
    prev_vals = [r["readiness"]["score"] for r in prev_rows if (r.get("readiness") or {}).get("score")]
    if not cur_vals:
        return None

    cur_avg  = _avg(cur_vals)
    prev_avg = _avg(prev_vals)
    cur_on   = sum(1 for v in cur_vals  if v >= target)
    prev_on  = sum(1 for v in prev_vals if v >= target)
    delta_avg = round(cur_avg - prev_avg, 1) if (cur_avg and prev_avg) else None
    delta_on  = (cur_on - prev_on) if prev_vals else None

    all_vals  = cur_vals + prev_vals
    pb        = max(all_vals) if all_vals else None

    direction = _direction(delta_avg)
    if delta_avg is None:
        summary = f"Averaging {cur_avg} readiness — {cur_on} of {len(cur_vals)} days ≥{target}."
    elif delta_avg >= 3:
        summary = f"Readiness up {delta_avg} pts vs. last month — {cur_on}/{len(cur_vals)} days ≥{target}."
    elif delta_avg <= -3:
        summary = f"Readiness down {abs(delta_avg)} pts vs. last month — focus on recovery."
    else:
        summary = f"Readiness holding steady at {cur_avg} — {cur_on}/{len(cur_vals)} days ≥{target}."

    return {
        "id": "readiness", "title": "Readiness", "icon": "🎯",
        "current_avg": cur_avg, "previous_avg": prev_avg,
        "current_on": cur_on, "previous_on": prev_on if prev_vals else None,
        "period_days": len(cur_vals), "target": target,
        "target_label": f"≥{target} pts", "unit": "pts",
        "delta_avg": delta_avg, "delta_on": delta_on,
        "direction": direction,
        "personal_best": pb, "personal_best_date": None,
        "summary": summary,
    }


def _sleep_score_progress(cur_rows: list, prev_rows: list) -> Optional[dict]:
    target = 75
    cur_vals  = [r["sleep_score"]["score"] for r in cur_rows  if (r.get("sleep_score") or {}).get("score")]
    prev_vals = [r["sleep_score"]["score"] for r in prev_rows if (r.get("sleep_score") or {}).get("score")]
    if not cur_vals:
        return None

    cur_avg  = _avg(cur_vals)
    prev_avg = _avg(prev_vals)
    cur_on   = sum(1 for v in cur_vals  if v >= target)
    prev_on  = sum(1 for v in prev_vals if v >= target)
    delta_avg = round(cur_avg - prev_avg, 1) if (cur_avg and prev_avg) else None
    delta_on  = (cur_on - prev_on) if prev_vals else None
    pb        = max(cur_vals + prev_vals)

    direction = _direction(delta_avg)
    if delta_avg and delta_avg >= 3:
        summary = f"Sleep score up {delta_avg} pts — {cur_on}/{len(cur_vals)} nights ≥{target}."
    elif delta_avg and delta_avg <= -3:
        summary = f"Sleep score slipping ({abs(delta_avg)} pts down) — {cur_on}/{len(cur_vals)} nights ≥{target}."
    else:
        summary = f"Sleep averaging {cur_avg} — {cur_on}/{len(cur_vals)} nights ≥{target} target."

    return {
        "id": "sleep_score", "title": "Sleep Score", "icon": "😴",
        "current_avg": cur_avg, "previous_avg": prev_avg,
        "current_on": cur_on, "previous_on": prev_on if prev_vals else None,
        "period_days": len(cur_vals), "target": target,
        "target_label": f"≥{target} pts", "unit": "pts",
        "delta_avg": delta_avg, "delta_on": delta_on,
        "direction": direction,
        "personal_best": pb, "personal_best_date": None,
        "summary": summary,
    }


def _hrv_progress(cur_rows: list, prev_rows: list) -> Optional[dict]:
    cur_vals  = [r["sleep_model"]["hrv"] for r in cur_rows  if (r.get("sleep_model") or {}).get("hrv")]
    prev_vals = [r["sleep_model"]["hrv"] for r in prev_rows if (r.get("sleep_model") or {}).get("hrv")]
    if not cur_vals:
        return None

    cur_avg   = _avg(cur_vals)
    prev_avg  = _avg(prev_vals)
    delta_avg = round(cur_avg - prev_avg, 1) if (cur_avg and prev_avg) else None
    pb        = max(cur_vals + prev_vals) if (cur_vals + prev_vals) else None

    direction = _direction(delta_avg)
    if delta_avg and delta_avg >= 2:
        summary = f"HRV up {delta_avg} ms vs. last month — autonomic fitness improving."
    elif delta_avg and delta_avg <= -2:
        summary = f"HRV down {abs(delta_avg)} ms — may reflect accumulated fatigue or stress."
    else:
        summary = f"HRV stable at {cur_avg} ms average."

    return {
        "id": "hrv", "title": "HRV", "icon": "💓",
        "current_avg": cur_avg, "previous_avg": prev_avg,
        "current_on": None, "previous_on": None,
        "period_days": len(cur_vals), "target": None,
        "target_label": None, "unit": "ms",
        "delta_avg": delta_avg, "delta_on": None,
        "direction": direction,
        "personal_best": pb, "personal_best_date": None,
        "summary": summary,
    }


def _steps_progress(cur_oura: list, prev_oura: list,
                    cur_apple: list, prev_apple: list) -> Optional[dict]:
    target = 8000

    def _steps(oura_rows, apple_rows):
        by_date: dict = {}
        for r in apple_rows:
            if r.get("steps"):
                by_date[str(r["date"])] = r["steps"]
        for r in oura_rows:
            d = str(r.get("date", ""))
            if d not in by_date and (r.get("activity") or {}).get("steps"):
                by_date[d] = r["activity"]["steps"]
        return list(by_date.values())

    cur_vals  = _steps(cur_oura,  cur_apple)
    prev_vals = _steps(prev_oura, prev_apple)
    if not cur_vals:
        return None

    cur_avg   = _avg(cur_vals)
    prev_avg  = _avg(prev_vals)
    cur_on    = sum(1 for v in cur_vals  if v >= target)
    prev_on   = sum(1 for v in prev_vals if v >= target)
    delta_avg = round(cur_avg - prev_avg) if (cur_avg and prev_avg) else None
    delta_on  = (cur_on - prev_on) if prev_vals else None
    pb        = max(cur_vals + prev_vals) if (cur_vals + prev_vals) else None

    direction = _direction(delta_avg)
    if delta_on and delta_on >= 3:
        summary = f"{cur_on}/{len(cur_vals)} days ≥{target:,} steps — {delta_on} more than last month."
    elif delta_on and delta_on <= -3:
        summary = f"Step goal hit {cur_on}/{len(cur_vals)} days — {abs(delta_on)} fewer than last month."
    else:
        summary = f"Averaging {int(cur_avg):,} steps/day — {cur_on}/{len(cur_vals)} days ≥{target:,}."

    return {
        "id": "steps", "title": "Daily Steps", "icon": "👟",
        "current_avg": int(cur_avg) if cur_avg else None,
        "previous_avg": int(prev_avg) if prev_avg else None,
        "current_on": cur_on, "previous_on": prev_on if prev_vals else None,
        "period_days": len(cur_vals), "target": target,
        "target_label": f"≥{target:,} steps", "unit": "steps",
        "delta_avg": delta_avg, "delta_on": delta_on,
        "direction": direction,
        "personal_best": int(pb) if pb else None, "personal_best_date": None,
        "summary": summary,
    }


def _training_load_progress(cur_oura: list, prev_oura: list) -> Optional[dict]:
    """Days in optimal ACWR zone (0.8–1.3) — needs 35+ days of activity data."""

    def _acwr_series(rows: list) -> list[Optional[float]]:
        """Return daily ACWR for each day that has 28 days of prior data."""
        # Build a date-keyed dict of active calories
        by_date: dict = {}
        for r in rows:
            ac = (r.get("activity") or {}).get("active_cal")
            if ac and r.get("date"):
                by_date[str(r["date"])] = ac
        dates = sorted(by_date)
        acwrs = []
        for i, d in enumerate(dates):
            window_28 = [by_date[dates[j]] for j in range(max(0, i - 27), i + 1)]
            window_7  = [by_date[dates[j]] for j in range(max(0, i - 6),  i + 1)]
            if len(window_28) < 14 or len(window_7) < 4:
                continue
            chronic = sum(window_28) / len(window_28)
            acute   = sum(window_7)  / len(window_7)
            if chronic > 0:
                acwrs.append(acute / chronic)
        return acwrs

    # For ACWR we need all rows (cur + prev combined) to compute chronic load
    all_rows = prev_oura + cur_oura
    all_acwrs = _acwr_series(all_rows)
    if len(all_acwrs) < 14:
        return None

    # Split into current and previous halves
    mid = len(all_acwrs) // 2
    cur_vals  = all_acwrs[mid:]
    prev_vals = all_acwrs[:mid]

    cur_on    = sum(1 for v in cur_vals  if 0.8 <= v <= 1.3)
    prev_on   = sum(1 for v in prev_vals if 0.8 <= v <= 1.3)
    delta_on  = cur_on - prev_on
    cur_pct   = round(cur_on  / len(cur_vals)  * 100) if cur_vals  else 0
    prev_pct  = round(prev_on / len(prev_vals) * 100) if prev_vals else 0

    direction = "positive" if delta_on >= 2 else ("negative" if delta_on <= -2 else "neutral")

    if delta_on >= 2:
        summary = f"In optimal load zone {cur_on}/{len(cur_vals)} days — {delta_on} more than last month."
    elif delta_on <= -2:
        summary = f"Only {cur_on}/{len(cur_vals)} days in optimal load zone — {abs(delta_on)} fewer than last month."
    else:
        summary = f"Training load optimal {cur_on}/{len(cur_vals)} days ({cur_pct}% of the time)."

    return {
        "id": "training_load", "title": "Optimal Training Load", "icon": "⚡",
        "current_avg": cur_pct, "previous_avg": prev_pct,
        "current_on": cur_on, "previous_on": prev_on,
        "period_days": len(cur_vals), "target": None,
        "target_label": "ACWR 0.8–1.3", "unit": "%",
        "delta_avg": None, "delta_on": delta_on,
        "direction": direction,
        "personal_best": None, "personal_best_date": None,
        "summary": summary,
    }


def _protein_progress(cur_nutr: dict, prev_nutr: dict, settings: dict) -> Optional[dict]:
    target = settings.get("protein_g") or 150
    cur_vals  = [v["protein"] for v in cur_nutr.values()  if v.get("protein")]
    prev_vals = [v["protein"] for v in prev_nutr.values() if v.get("protein")]
    if len(cur_vals) < 5:
        return None

    cur_avg   = _avg(cur_vals)
    prev_avg  = _avg(prev_vals)
    cur_on    = sum(1 for v in cur_vals  if v >= target)
    prev_on   = sum(1 for v in prev_vals if v >= target)
    delta_avg = round(cur_avg - prev_avg, 1) if (cur_avg and prev_avg) else None
    delta_on  = (cur_on - prev_on) if prev_vals else None

    direction = _direction(delta_avg)
    if cur_on == len(cur_vals):
        summary = f"Hitting {target}g protein target every tracked day — great consistency."
    elif delta_on and delta_on >= 3:
        summary = f"Protein target hit {cur_on}/{len(cur_vals)} tracked days — {delta_on} more than last month."
    else:
        summary = f"Averaging {cur_avg}g protein — target ({target}g) hit {cur_on}/{len(cur_vals)} days."

    return {
        "id": "protein", "title": "Protein Target", "icon": "🥩",
        "current_avg": cur_avg, "previous_avg": prev_avg,
        "current_on": cur_on, "previous_on": prev_on if prev_vals else None,
        "period_days": len(cur_vals), "target": target,
        "target_label": f"≥{target}g", "unit": "g",
        "delta_avg": delta_avg, "delta_on": delta_on,
        "direction": direction,
        "personal_best": None, "personal_best_date": None,
        "summary": summary,
    }


def _activity_score_progress(cur_rows: list, prev_rows: list) -> Optional[dict]:
    target = 70
    cur_vals  = [(r.get("activity") or {}).get("score") for r in cur_rows]
    cur_vals  = [v for v in cur_vals if v]
    prev_vals = [(r.get("activity") or {}).get("score") for r in prev_rows]
    prev_vals = [v for v in prev_vals if v]
    if not cur_vals:
        return None

    cur_avg   = _avg(cur_vals)
    prev_avg  = _avg(prev_vals)
    cur_on    = sum(1 for v in cur_vals  if v >= target)
    prev_on   = sum(1 for v in prev_vals if v >= target)
    delta_avg = round(cur_avg - prev_avg, 1) if (cur_avg and prev_avg) else None
    delta_on  = (cur_on - prev_on) if prev_vals else None
    pb        = max(cur_vals + prev_vals) if (cur_vals + prev_vals) else None

    direction = _direction(delta_avg)
    summary = (
        f"Activity score up {delta_avg} pts — {cur_on}/{len(cur_vals)} days ≥{target}."
        if (delta_avg and delta_avg >= 3) else
        f"Activity averaging {cur_avg} — {cur_on}/{len(cur_vals)} days ≥{target}."
    )

    return {
        "id": "activity", "title": "Activity Score", "icon": "🏃",
        "current_avg": cur_avg, "previous_avg": prev_avg,
        "current_on": cur_on, "previous_on": prev_on if prev_vals else None,
        "period_days": len(cur_vals), "target": target,
        "target_label": f"≥{target} pts", "unit": "pts",
        "delta_avg": delta_avg, "delta_on": delta_on,
        "direction": direction,
        "personal_best": pb, "personal_best_date": None,
        "summary": summary,
    }


# ── main entry point ──────────────────────────────────────────────────────────

def get_progress(user_id: str) -> dict:
    """
    Return 30-day vs previous-30-day progress for all available metrics.
    """
    # Current period: last 30 days
    cur_start,  cur_end  = _date_range(29, 0)
    # Previous period: 30–59 days ago
    prev_start, prev_end = _date_range(59, 30)

    try:
        cur_oura   = _oura_rows(user_id, cur_start,  cur_end)
        prev_oura  = _oura_rows(user_id, prev_start, prev_end)
    except Exception:
        cur_oura = prev_oura = []

    try:
        cur_nutr   = _nutrition_rows(user_id, cur_start,  cur_end)
        prev_nutr  = _nutrition_rows(user_id, prev_start, prev_end)
    except Exception:
        cur_nutr = prev_nutr = {}

    try:
        cur_apple  = _apple_rows(user_id, cur_start,  cur_end)
        prev_apple = _apple_rows(user_id, prev_start, prev_end)
    except Exception:
        cur_apple = prev_apple = []

    try:
        settings = _nutrition_settings(user_id)
    except Exception:
        settings = {}

    checks = [
        lambda: _readiness_progress(cur_oura, prev_oura),
        lambda: _sleep_score_progress(cur_oura, prev_oura),
        lambda: _hrv_progress(cur_oura, prev_oura),
        lambda: _activity_score_progress(cur_oura, prev_oura),
        lambda: _steps_progress(cur_oura, prev_oura, cur_apple, prev_apple),
        lambda: _training_load_progress(cur_oura + prev_oura, []),
        lambda: _protein_progress(cur_nutr, prev_nutr, settings),
    ]

    items = []
    for check in checks:
        try:
            result = check()
            if result:
                items.append(result)
        except Exception:
            pass

    return {
        "items":        items,
        "period_label": "Last 30 days vs. previous 30",
        "cur_start":    cur_start,
        "cur_end":      cur_end,
        "prev_start":   prev_start,
        "prev_end":     prev_end,
    }
