"""
Goal Progress Report.

Shows the user's active goal alongside the metrics actually moving (or
not moving) the needle toward it. Designed for a coach, dietitian, or
the user's own weekly self-review — at a glance, are the supporting
behaviors aligned with the target?

Sections:
  • Goal header — title, baseline, target, current, % complete, days
    left, pace banner (well ahead / on pace / behind / starting).
  • Primary metric trend — the goal's metric over time with start
    baseline and target overlay so trajectory is obvious.
  • Supporting metrics — adapted to the goal's metric type:
      body_fat_pct / weight_lbs → avg calories, protein, workouts/week,
        sleep efficiency (proxies for the inputs that drive composition)
      vo2_max → cardio minutes/week, training count
      hrv / rhr → sleep efficiency, sleep hours, workout volume
      generic fallback → workouts/week, sleep efficiency, calories
  • Plan — the structured Coach Al plan from goal_coach (read off the
    goal row's `plan` JSON if present).
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import goals
import oura_cache as oc

from supabase import create_client, Client


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _safe_int_avg(vals: list[int]) -> Optional[int]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return int(round(sum(vals) / len(vals)))


def _safe_avg(vals: list[float]) -> Optional[float]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 1)


def _trend(series: list[tuple[str, object]]) -> list[dict]:
    out: list[dict] = []
    for d, v in sorted(series):
        if v is None:
            continue
        out.append({"date": d, "value": v})
    return out


def _patient(profile: dict) -> dict:
    age = None
    bd = profile.get("birthdate")
    if bd:
        try:
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            today = _date.today()
            age = today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
        except Exception:
            pass
    return {
        "name":           (profile.get("name") or "").strip() or None,
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
        "health_goals":   profile.get("health_goals") or [],
    }


# ── Primary metric history ────────────────────────────────────────────────

def _metric_history(user_id: str, metric: str, days: int) -> list[dict]:
    """Return the (date, value) series for the goal's metric over the window.

    metric is the string key the goals system uses: body_fat_pct, weight_lbs,
    vo2_max, hrv, rhr, daily_steps, sleep_hours."""
    end_d   = _date.today()
    start_d = end_d - timedelta(days=days - 1)
    start, end = start_d.isoformat(), end_d.isoformat()

    sb = _sb()

    if metric in ("body_fat_pct", "weight_lbs"):
        if not sb:
            return []
        try:
            res = (
                sb.table("nutrition_weight")
                .select("date, weight_lbs, body_fat_pct")
                .eq("user_id", user_id)
                .gte("date", start)
                .lte("date", end)
                .order("date", desc=False)
                .execute()
            )
            rows = res.data or []
        except Exception:
            return []
        field = metric
        return _trend([(r["date"], r.get(field)) for r in rows])

    if metric in ("hrv", "rhr"):
        try:
            _, _, _, smm = oc.get_days(user_id, days=days)
        except Exception:
            return []
        return _trend([(d, row.get(metric)) for d, row in smm.items() if start <= d <= end])

    if metric == "sleep_hours":
        try:
            _, _, _, smm = oc.get_days(user_id, days=days)
        except Exception:
            return []
        return _trend([
            (d, round(row["total"] / 3600, 2) if row.get("total") else None)
            for d, row in smm.items() if start <= d <= end
        ])

    if metric == "daily_steps":
        try:
            _, _, am, _ = oc.get_days(user_id, days=days)
        except Exception:
            return []
        return _trend([(d, row.get("steps")) for d, row in am.items() if start <= d <= end])

    if metric == "vo2_max":
        # VO2 max changes slowly; we don't keep per-day history beyond Oura's
        # cardio_age endpoint. Return the current value as a single point.
        cur = goals.current_value(user_id, "vo2_max")
        return [{"date": end, "value": cur}] if cur is not None else []

    return []


# ── Supporting metrics (goal-type aware) ──────────────────────────────────

def _avg_calories_protein(user_id: str, start: str, end: str) -> dict:
    sb = _sb()
    if not sb:
        return {"calories": None, "protein_g": None, "days_logged": 0}
    try:
        res = (
            sb.table("nutrition_meals")
            .select("date, calories, protein")
            .eq("user_id", user_id)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        rows = res.data or []
    except Exception:
        return {"calories": None, "protein_g": None, "days_logged": 0}
    by_day: dict[str, dict] = {}
    for r in rows:
        d = r.get("date")
        if not d:
            continue
        slot = by_day.setdefault(d, {"calories": 0, "protein_g": 0})
        slot["calories"]  += int(r.get("calories") or 0)
        slot["protein_g"] += int(float(r.get("protein") or 0))
    cals = [v["calories"]  for v in by_day.values() if v["calories"]]
    prot = [v["protein_g"] for v in by_day.values() if v["protein_g"]]
    return {
        "calories":    _safe_int_avg(cals),
        "protein_g":   _safe_int_avg(prot),
        "days_logged": len(by_day),
    }


def _workout_volume(user_id: str, start: str, end: str) -> dict:
    sb = _sb()
    if not sb:
        return {"sessions": 0, "cardio_min": 0, "per_week": 0.0}
    try:
        res = (
            sb.table("training_workouts")
            .select("date, kind, duration_min")
            .eq("user_id", user_id)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        rows = res.data or []
    except Exception:
        return {"sessions": 0, "cardio_min": 0, "per_week": 0.0}
    sessions   = len(rows)
    cardio_min = sum(int(r.get("duration_min") or 0)
                     for r in rows if (r.get("kind") or "").lower() == "cardio")
    # Days in window
    try:
        sd = datetime.strptime(start, "%Y-%m-%d").date()
        ed = datetime.strptime(end,   "%Y-%m-%d").date()
        weeks = max((ed - sd).days / 7.0, 1.0)
    except Exception:
        weeks = 1.0
    return {
        "sessions":   sessions,
        "cardio_min": cardio_min,
        "per_week":   round(sessions / weeks, 1),
    }


def _sleep_signals(user_id: str, start: str, end: str) -> dict:
    try:
        _, _, _, smm = oc.get_days(user_id, days=120)
    except Exception:
        smm = {}
    eff_vals: list[int]   = []
    hrs_vals: list[float] = []
    for d, row in smm.items():
        if not (start <= d <= end):
            continue
        if row.get("efficiency") is not None:
            eff_vals.append(int(row["efficiency"]))
        if row.get("total") is not None:
            hrs_vals.append(round(row["total"] / 3600, 2))
    return {
        "avg_efficiency": _safe_int_avg(eff_vals),
        "avg_hours":      _safe_avg(hrs_vals),
        "nights":         len(eff_vals),
    }


def _supporting_for(metric: str, user_id: str, start: str, end: str) -> list[dict]:
    """Compose a list of supporting-metric tiles tuned to the goal type.

    Each tile is {label, value, unit, hint, status (good|watch|none)}.
    `status` is a coarse signal — green = trending in helpful direction,
    amber = worth watching. Pure heuristic; never claims causation."""
    nutri = _avg_calories_protein(user_id, start, end)
    wo    = _workout_volume(user_id, start, end)
    sleep = _sleep_signals(user_id, start, end)

    tiles: list[dict] = []

    if metric in ("body_fat_pct", "weight_lbs"):
        # Body composition: nutrition + training + sleep are the levers.
        tiles.append({
            "label":  "Avg calories",
            "value":  nutri["calories"],
            "unit":   "kcal/day",
            "hint":   f"{nutri['days_logged']} days logged",
        })
        tiles.append({
            "label":  "Avg protein",
            "value":  nutri["protein_g"],
            "unit":   "g/day",
            "hint":   "Higher protein supports lean mass during a cut",
        })
        tiles.append({
            "label":  "Training",
            "value":  wo["per_week"],
            "unit":   "sessions/wk",
            "hint":   f"{wo['sessions']} sessions in window",
        })
        tiles.append({
            "label":  "Sleep efficiency",
            "value":  sleep["avg_efficiency"],
            "unit":   "%",
            "hint":   "Better recovery aids fat loss and lean retention",
        })

    elif metric in ("hrv", "rhr"):
        # Recovery: sleep and training balance matter most.
        tiles.append({
            "label":  "Sleep efficiency",
            "value":  sleep["avg_efficiency"],
            "unit":   "%",
            "hint":   f"avg across {sleep['nights']} nights",
        })
        tiles.append({
            "label":  "Sleep hours",
            "value":  sleep["avg_hours"],
            "unit":   "hrs/night",
            "hint":   "Higher = more parasympathetic recovery time",
        })
        tiles.append({
            "label":  "Training",
            "value":  wo["per_week"],
            "unit":   "sessions/wk",
            "hint":   f"{wo['sessions']} sessions in window",
        })
        tiles.append({
            "label":  "Cardio min",
            "value":  wo["cardio_min"],
            "unit":   "min",
            "hint":   "Steady cardio builds aerobic base; spikes can suppress HRV",
        })

    elif metric == "vo2_max":
        tiles.append({
            "label":  "Cardio min",
            "value":  wo["cardio_min"],
            "unit":   "min total",
            "hint":   "Sustained cardio is the primary VO₂ driver",
        })
        tiles.append({
            "label":  "Training",
            "value":  wo["per_week"],
            "unit":   "sessions/wk",
            "hint":   f"{wo['sessions']} sessions in window",
        })
        tiles.append({
            "label":  "Sleep hours",
            "value":  sleep["avg_hours"],
            "unit":   "hrs/night",
            "hint":   "Recovery sleep is when adaptation happens",
        })

    else:
        # Generic — show everything available, let the coach interpret.
        tiles.append({"label": "Training",         "value": wo["per_week"],          "unit": "sessions/wk", "hint": f"{wo['sessions']} sessions in window"})
        tiles.append({"label": "Sleep efficiency", "value": sleep["avg_efficiency"], "unit": "%",           "hint": f"avg across {sleep['nights']} nights"})
        tiles.append({"label": "Avg calories",     "value": nutri["calories"],       "unit": "kcal/day",    "hint": f"{nutri['days_logged']} days logged"})

    return tiles


# ── Top-level builder ─────────────────────────────────────────────────────

def build_report(user_id: str, profile: dict, *, days: int = 30, end_iso: Optional[str] = None) -> dict:
    today_str = end_iso or _date.today().isoformat()
    end_d     = datetime.strptime(today_str, "%Y-%m-%d").date()
    start_d   = end_d - timedelta(days=days - 1)
    start, end = start_d.isoformat(), end_d.isoformat()

    goal = goals.get_active_goal(user_id, today_str)
    if not goal:
        return {
            "active":       False,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "range":        {"start": start, "end": end, "days": days},
            "patient":      _patient(profile),
            "message":      "No active goal — open the Goal card on the Scorecard to set one.",
        }

    metric = goal.get("metric") or ""
    history     = _metric_history(user_id, metric, days)
    supporting  = _supporting_for(metric, user_id, start, end)

    return {
        "active":         True,
        "generated_at":   datetime.utcnow().isoformat() + "Z",
        "range":          {"start": start, "end": end, "days": days},
        "patient":        _patient(profile),
        "goal":           goal,
        "metric_history": history,
        "supporting":     supporting,
    }
