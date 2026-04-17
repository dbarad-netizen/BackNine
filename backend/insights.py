"""
Cross-source correlation engine for BackNine.

Joins Oura, nutrition, and Apple Health data by date and surfaces
plain-language insights about how habits affect recovery and performance.

Each insight dict:
  {
    "id":          str,          # unique slug
    "title":       str,          # short label
    "finding":     str,          # one-sentence plain-language result
    "detail":      str,          # extra context sentence
    "direction":   "positive" | "negative" | "neutral",
    "magnitude":   float,        # size of the effect (in the insight's native unit)
    "unit":        str,          # e.g. "points", "bpm", "%"
    "n":           int,          # number of data-point pairs used
    "r":           float,        # Pearson r (−1 … 1)
    "group_a_label": str,
    "group_b_label": str,
    "group_a_avg":   float,
    "group_b_avg":   float,
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


def _pearson(xs: list, ys: list) -> float:
    """Pearson r between two equal-length lists. Returns 0 if undefined."""
    n = len(xs)
    if n < 3:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx  = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy  = sum((y - my) ** 2 for y in ys) ** 0.5
    return (num / (dx * dy)) if dx and dy else 0.0


def _group_diff(pairs: list[tuple], threshold, label_low: str, label_high: str):
    """
    Split (predictor, outcome) pairs at `threshold`.
    Returns (n_low, avg_low, n_high, avg_high) or None if too few points.
    """
    low  = [y for x, y in pairs if x is not None and y is not None and x <= threshold]
    high = [y for x, y in pairs if x is not None and y is not None and x >  threshold]
    if len(low) < 4 or len(high) < 4:
        return None
    return low, high


# ── data loading ──────────────────────────────────────────────────────────────

def _load_oura(user_id: str, since: str) -> dict:
    """Returns { date_str: { readiness, sleep_score, activity, sleep_model } }"""
    sb = _sb()
    res = (
        sb.table("oura_daily_cache")
        .select("date, readiness, sleep_score, activity, sleep_model")
        .eq("user_id", user_id)
        .gte("date", since)
        .execute()
    )
    out = {}
    for r in (res.data or []):
        out[str(r["date"])] = {
            "readiness":   r.get("readiness")   or {},
            "sleep_score": r.get("sleep_score") or {},
            "activity":    r.get("activity")    or {},
            "sleep_model": r.get("sleep_model") or {},
        }
    return out


def _load_nutrition_daily(user_id: str, since: str) -> dict:
    """Returns { date_str: { calories, protein, carbs, fat, meal_count } }"""
    sb = _sb()
    res = (
        sb.table("nutrition_meals")
        .select("date, calories, protein, carbs, fat")
        .eq("user_id", user_id)
        .gte("date", since)
        .execute()
    )
    daily: dict = {}
    for r in (res.data or []):
        d = str(r["date"])
        if d not in daily:
            daily[d] = {"calories": 0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "meal_count": 0}
        daily[d]["calories"]   += int(r.get("calories") or 0)
        daily[d]["protein"]    += float(r.get("protein") or 0)
        daily[d]["carbs"]      += float(r.get("carbs")   or 0)
        daily[d]["fat"]        += float(r.get("fat")     or 0)
        daily[d]["meal_count"] += 1
    return daily


def _load_apple_health(user_id: str, since: str) -> dict:
    """Returns { date_str: { steps, active_calories, sleep_hours, weight_kg } }"""
    sb = _sb()
    res = (
        sb.table("apple_health_daily")
        .select("date, steps, active_calories, sleep_hours, weight_kg")
        .eq("user_id", user_id)
        .gte("date", since)
        .execute()
    )
    return {
        str(r["date"]): {
            "steps":          r.get("steps"),
            "active_calories": r.get("active_calories"),
            "sleep_hours":    r.get("sleep_hours"),
            "weight_kg":      r.get("weight_kg"),
        }
        for r in (res.data or [])
    }


# ── correlation checks ────────────────────────────────────────────────────────

def _insight_high_cal_next_readiness(oura: dict, nutr: dict) -> Optional[dict]:
    """High calorie days → next-day readiness."""
    pairs = []
    dates = sorted(nutr)
    for i, d in enumerate(dates[:-1]):
        next_d = dates[i + 1]
        cal = nutr[d].get("calories")
        rdy = (oura.get(next_d) or {}).get("readiness", {}).get("score")
        if cal and rdy:
            pairs.append((cal, rdy))
    if len(pairs) < 8:
        return None

    threshold = 2500
    result = _group_diff(pairs, threshold, f"≤{threshold} cal", f">{threshold} cal")
    if not result:
        return None
    low, high = result
    avg_low  = round(sum(low)  / len(low),  1)
    avg_high = round(sum(high) / len(high), 1)
    delta = round(avg_low - avg_high, 1)
    if abs(delta) < 3:
        return None

    r = _pearson([x for x, _ in pairs], [y for _, y in pairs])
    direction = "positive" if delta > 0 else "negative"
    if delta > 0:
        finding = f"On days after eating ≤{threshold} cal, your readiness averages {abs(delta)} points higher ({avg_low} vs {avg_high})."
        detail  = "Lighter intake days appear to support better next-day recovery."
    else:
        finding = f"High calorie days (>{threshold} cal) correlate with {abs(delta)}-point better readiness the next day ({avg_high} vs {avg_low})."
        detail  = "You may be fueling recovery — ensure quality macros on those days."

    return {
        "id": "high_cal_readiness",
        "title": "Calories & Next-Day Readiness",
        "finding": finding,
        "detail": detail,
        "direction": direction,
        "magnitude": abs(delta),
        "unit": "points",
        "n": len(pairs),
        "r": round(r, 2),
        "group_a_label": f"≤{threshold} cal days",
        "group_b_label": f">{threshold} cal days",
        "group_a_avg": avg_low,
        "group_b_avg": avg_high,
    }


def _insight_protein_hrv(oura: dict, nutr: dict) -> Optional[dict]:
    """Daily protein intake → same-night HRV."""
    pairs = []
    for d in nutr:
        protein = nutr[d].get("protein")
        hrv = (oura.get(d) or {}).get("sleep_model", {}).get("hrv")
        if protein and hrv:
            pairs.append((protein, hrv))
    if len(pairs) < 8:
        return None

    threshold = 150
    result = _group_diff(pairs, threshold, f"≤{threshold}g", f">{threshold}g")
    if not result:
        return None
    low, high = result
    avg_low  = round(sum(low)  / len(low),  1)
    avg_high = round(sum(high) / len(high), 1)
    delta = round(avg_high - avg_low, 1)
    if abs(delta) < 2:
        return None

    r = _pearson([x for x, _ in pairs], [y for _, y in pairs])
    direction = "positive" if delta > 0 else "negative"
    if delta > 0:
        finding = f"On days you eat >{threshold}g protein, your HRV averages {abs(delta)} ms higher ({avg_high} vs {avg_low})."
        detail  = "Higher protein intake appears to support autonomic recovery overnight."
    else:
        finding = f"Days with >{threshold}g protein show {abs(delta)} ms lower HRV than lighter-protein days."
        detail  = "Consider whether total load (calories + protein) is creating digestive stress."

    return {
        "id": "protein_hrv",
        "title": "Protein & HRV",
        "finding": finding,
        "detail": detail,
        "direction": direction,
        "magnitude": abs(delta),
        "unit": "ms",
        "n": len(pairs),
        "r": round(r, 2),
        "group_a_label": f"≤{threshold}g protein",
        "group_b_label": f">{threshold}g protein",
        "group_a_avg": avg_low,
        "group_b_avg": avg_high,
    }


def _insight_sleep_hours_activity(oura: dict) -> Optional[dict]:
    """Sleep duration → next-day activity score."""
    dates = sorted(oura)
    pairs = []
    for i, d in enumerate(dates[:-1]):
        next_d = dates[i + 1]
        total  = oura[d].get("sleep_model", {}).get("total")
        act    = oura.get(next_d, {}).get("activity", {}).get("score")
        if total and act:
            hrs = total / 3600
            pairs.append((hrs, act))
    if len(pairs) < 8:
        return None

    threshold = 7.0
    result = _group_diff(pairs, threshold, f"<{threshold}h", f"≥{threshold}h")
    if not result:
        return None
    low, high = result
    avg_low  = round(sum(low)  / len(low),  1)
    avg_high = round(sum(high) / len(high), 1)
    delta = round(avg_high - avg_low, 1)
    if abs(delta) < 3:
        return None

    r = _pearson([x for x, _ in pairs], [y for _, y in pairs])
    direction = "positive" if delta > 0 else "negative"
    finding = (
        f"Nights with ≥{threshold}h sleep produce {abs(delta)}-point higher activity scores the next day ({avg_high} vs {avg_low})."
        if delta > 0 else
        f"Longer sleep nights don't predict higher activity scores in your data — other factors may dominate."
    )
    detail = "Sleep duration is one of the strongest predictors of how active you are the following day." if delta > 0 else ""

    return {
        "id": "sleep_activity",
        "title": "Sleep Duration & Next-Day Activity",
        "finding": finding,
        "detail": detail,
        "direction": direction,
        "magnitude": abs(delta),
        "unit": "points",
        "n": len(pairs),
        "r": round(r, 2),
        "group_a_label": f"<{threshold}h sleep",
        "group_b_label": f"≥{threshold}h sleep",
        "group_a_avg": avg_low,
        "group_b_avg": avg_high,
    }


def _insight_steps_readiness(oura: dict, apple: dict) -> Optional[dict]:
    """Daily steps → next-day readiness."""
    dates = sorted(set(list(oura) + list(apple)))
    pairs = []
    for i, d in enumerate(dates[:-1]):
        next_d = dates[i + 1]
        steps = (apple.get(d) or {}).get("steps") or (oura.get(d) or {}).get("activity", {}).get("steps")
        rdy   = (oura.get(next_d) or {}).get("readiness", {}).get("score")
        if steps and rdy:
            pairs.append((steps, rdy))
    if len(pairs) < 8:
        return None

    threshold = 8000
    result = _group_diff(pairs, threshold, f"<{threshold:,}", f"≥{threshold:,}")
    if not result:
        return None
    low, high = result
    avg_low  = round(sum(low)  / len(low),  1)
    avg_high = round(sum(high) / len(high), 1)
    delta = round(avg_high - avg_low, 1)
    if abs(delta) < 3:
        return None

    r = _pearson([x for x, _ in pairs], [y for _, y in pairs])
    direction = "positive" if delta > 0 else "negative"
    if delta > 0:
        finding = f"Days with ≥{threshold:,} steps lead to {abs(delta)}-point higher readiness the next day ({avg_high} vs {avg_low})."
        detail  = "Higher movement volume appears to support recovery — likely through better circulation and sleep quality."
    else:
        finding = f"Very high step days (≥{threshold:,}) correlate with {abs(delta)}-point lower next-day readiness ({avg_low} vs {avg_high})."
        detail  = "High volume days may be adding fatigue — watch your training load on big movement days."

    return {
        "id": "steps_readiness",
        "title": "Steps & Next-Day Readiness",
        "finding": finding,
        "detail": detail,
        "direction": direction,
        "magnitude": abs(delta),
        "unit": "points",
        "n": len(pairs),
        "r": round(r, 2),
        "group_a_label": f"<{threshold:,} steps",
        "group_b_label": f"≥{threshold:,} steps",
        "group_a_avg": avg_low,
        "group_b_avg": avg_high,
    }


def _insight_calorie_deficit_weight(nutr: dict, apple: dict) -> Optional[dict]:
    """Weekly average calorie deficit/surplus → weekly weight change trend."""
    # Need at least 3 weeks of overlapping data
    # Build weekly buckets
    from collections import defaultdict
    weekly_cal: dict = defaultdict(list)
    weekly_wt:  dict = defaultdict(list)

    for d, n in nutr.items():
        if n.get("calories"):
            try:
                dt = date.fromisoformat(d)
                wk = dt.isocalendar()[:2]  # (year, week)
                weekly_cal[wk].append(n["calories"])
            except ValueError:
                pass

    for d, a in apple.items():
        if a.get("weight_kg"):
            try:
                dt = date.fromisoformat(d)
                wk = dt.isocalendar()[:2]
                weekly_wt[wk].append(a["weight_kg"])
            except ValueError:
                pass

    weeks = sorted(set(weekly_cal) & set(weekly_wt))
    if len(weeks) < 3:
        return None

    weekly_avg_cal = {w: sum(weekly_cal[w]) / len(weekly_cal[w]) for w in weeks}
    weekly_avg_wt  = {w: sum(weekly_wt[w])  / len(weekly_wt[w])  for w in weeks}

    deficit_weeks = [w for w in weeks if weekly_avg_cal[w] < 2000]
    surplus_weeks = [w for w in weeks if weekly_avg_cal[w] >= 2000]

    if len(deficit_weeks) < 2 or len(surplus_weeks) < 2:
        return None

    avg_wt_deficit = sum(weekly_avg_wt[w] for w in deficit_weeks) / len(deficit_weeks)
    avg_wt_surplus = sum(weekly_avg_wt[w] for w in surplus_weeks) / len(surplus_weeks)
    delta_lbs = round((avg_wt_deficit - avg_wt_surplus) * 2.205, 1)

    if abs(delta_lbs) < 0.5:
        return None

    direction = "positive" if delta_lbs < 0 else "negative"
    finding = (
        f"Weeks averaging <2,000 cal/day correspond to {abs(delta_lbs)} lbs lower body weight than higher-intake weeks."
        if delta_lbs < 0 else
        f"Higher-calorie weeks (≥2,000 cal/day) correspond to {abs(delta_lbs)} lbs more body weight than lower-intake weeks."
    )

    return {
        "id": "deficit_weight",
        "title": "Calorie Intake & Weight Trend",
        "finding": finding,
        "detail": "Tracking calories consistently enough to see this pattern is itself a strong predictor of progress.",
        "direction": direction,
        "magnitude": abs(delta_lbs),
        "unit": "lbs",
        "n": len(weeks),
        "r": round(_pearson(
            [weekly_avg_cal[w] for w in weeks],
            [weekly_avg_wt[w]  for w in weeks]
        ), 2),
        "group_a_label": "<2,000 cal weeks",
        "group_b_label": "≥2,000 cal weeks",
        "group_a_avg": round(avg_wt_deficit * 2.205, 1),
        "group_b_avg": round(avg_wt_surplus * 2.205, 1),
    }


def _insight_hrv_trend(oura: dict) -> Optional[dict]:
    """30-day HRV trend — rising, falling, or flat."""
    dates = sorted(oura)
    hrv_series = [(d, oura[d].get("sleep_model", {}).get("hrv")) for d in dates]
    hrv_series = [(d, v) for d, v in hrv_series if v is not None]
    if len(hrv_series) < 10:
        return None

    mid = len(hrv_series) // 2
    first_half  = [v for _, v in hrv_series[:mid]]
    second_half = [v for _, v in hrv_series[mid:]]
    avg_first  = sum(first_half)  / len(first_half)
    avg_second = sum(second_half) / len(second_half)
    delta = round(avg_second - avg_first, 1)

    if abs(delta) < 2:
        return None

    direction = "positive" if delta > 0 else "negative"
    if delta > 0:
        finding = f"Your HRV has trended up {abs(delta)} ms over the past {len(hrv_series)} nights — a sign of improving autonomic fitness."
        detail  = "Rising HRV typically reflects better stress adaptation and recovery capacity."
    else:
        finding = f"Your HRV has trended down {abs(delta)} ms over the past {len(hrv_series)} nights."
        detail  = "Falling HRV can signal accumulated fatigue, stress, or under-recovery — consider a deload week."

    return {
        "id": "hrv_trend",
        "title": "HRV Trend",
        "finding": finding,
        "detail": detail,
        "direction": direction,
        "magnitude": abs(delta),
        "unit": "ms",
        "n": len(hrv_series),
        "r": round(_pearson(list(range(len(hrv_series))), [v for _, v in hrv_series]), 2),
        "group_a_label": "First half",
        "group_b_label": "Second half",
        "group_a_avg": round(avg_first,  1),
        "group_b_avg": round(avg_second, 1),
    }


# ── main entry point ──────────────────────────────────────────────────────────

def get_insights(user_id: str, days: int = 60) -> list[dict]:
    """
    Return a ranked list of cross-source insights for this user.
    Requires at least a few weeks of overlapping data to surface anything.
    """
    since = (date.today() - timedelta(days=days - 1)).isoformat()

    try:
        oura  = _load_oura(user_id, since)
    except Exception:
        oura  = {}
    try:
        nutr  = _load_nutrition_daily(user_id, since)
    except Exception:
        nutr  = {}
    try:
        apple = _load_apple_health(user_id, since)
    except Exception:
        apple = {}

    candidates = []

    checks = [
        lambda: _insight_hrv_trend(oura),
        lambda: _insight_sleep_hours_activity(oura),
        lambda: _insight_high_cal_next_readiness(oura, nutr),
        lambda: _insight_protein_hrv(oura, nutr),
        lambda: _insight_steps_readiness(oura, apple),
        lambda: _insight_calorie_deficit_weight(nutr, apple),
    ]

    for check in checks:
        try:
            result = check()
            if result:
                candidates.append(result)
        except Exception:
            pass

    # Sort by magnitude of effect (largest first) then by n (most data first)
    candidates.sort(key=lambda x: (x["magnitude"], x["n"]), reverse=True)
    return candidates
