"""
Nutrition & Body Composition Report.

For a dietitian, RDN, weight-loss coach, or anyone helping the user tune
their diet. Combines:

  • Daily macro intake (protein / carbs / fat / calories) over the window
  • Adherence to user's nutrition settings (target calories, protein, etc.)
  • Weight + body fat % trends
  • InBody segmental breakdown (latest reading): trunk, arms, legs muscle
    and fat, total body water
  • Current supplement / peptide / medication stack

Pure data layout — no recommendations. The dietitian uses this to see what
the user is actually eating and how it's translating into composition.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

from supabase import create_client, Client


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _date_range(end_iso: str, days: int) -> tuple[str, str]:
    try:
        end_d = datetime.strptime(end_iso, "%Y-%m-%d").date()
    except Exception:
        end_d = _date.today()
    days = max(1, min(int(days), 365))
    start_d = end_d - timedelta(days=days - 1)
    return start_d.isoformat(), end_d.isoformat()


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


def _fetch_daily_totals(user_id: str, start: str, end: str) -> list[dict]:
    """Per-day rollup of meals → kcal/protein/carbs/fat. Reads from the
    `nutrition_meals` table. The DB columns are `protein`, `carbs`, `fat`
    (no `_g` suffix); we map them to the report's `_g` shape so the
    frontend types stay clean."""
    sb = _sb()
    if not sb:
        return []
    try:
        res = (
            sb.table("nutrition_meals")
            .select("date, calories, protein, carbs, fat")
            .eq("user_id", user_id)
            .gte("date", start)
            .lte("date", end)
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
        slot = by_day.setdefault(d, {"date": d, "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "meal_count": 0})
        slot["calories"]  += int(r.get("calories") or 0)
        slot["protein_g"] += int(float(r.get("protein") or 0))
        slot["carbs_g"]   += int(float(r.get("carbs")   or 0))
        slot["fat_g"]     += int(float(r.get("fat")     or 0))
        slot["meal_count"] += 1
    return sorted(by_day.values(), key=lambda r: r["date"])


def _fetch_weights(user_id: str, start: str, end: str) -> list[dict]:
    """Weight entries in window from nutrition_weight (table name confirmed
    via schema introspection)."""
    sb = _sb()
    if not sb:
        return []
    try:
        res = (
            sb.table("nutrition_weight")
            .select("*")
            .eq("user_id", user_id)
            .gte("date", start)
            .lte("date", end)
            .order("date", desc=False)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _stack(profile: dict) -> dict:
    def _clean(arr) -> list[dict]:
        if not isinstance(arr, list):
            return []
        out = []
        for item in arr:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip()
            if not name:
                continue
            out.append({
                "name":   name,
                "dose":   (item.get("dose")   or "").strip() or None,
                "timing": (item.get("timing") or "").strip() or None,
                "notes":  (item.get("notes")  or "").strip() or None,
            })
        return out
    return {
        "medications": _clean(profile.get("medications")),
        "supplements": _clean(profile.get("supplements")),
        "peptides":    _clean(profile.get("peptides")),
    }


def build_report(user_id: str, profile: dict, *, days: int = 30, end_iso: Optional[str] = None) -> dict:
    end = end_iso or _date.today().isoformat()
    start, end = _date_range(end, days)

    daily = _fetch_daily_totals(user_id, start, end)
    weights = _fetch_weights(user_id, start, end)

    # Aggregates
    avg = {
        "calories":  _safe_int_avg([d["calories"]   for d in daily]),
        "protein_g": _safe_int_avg([d["protein_g"]  for d in daily]),
        "carbs_g":   _safe_int_avg([d["carbs_g"]    for d in daily]),
        "fat_g":     _safe_int_avg([d["fat_g"]      for d in daily]),
        "days_logged": len([d for d in daily if d["meal_count"] > 0]),
    }

    cal_trend     = _trend([(d["date"], d["calories"])  for d in daily if d["calories"]])
    protein_trend = _trend([(d["date"], d["protein_g"]) for d in daily if d["protein_g"]])
    weight_trend  = _trend([(w["date"], w.get("weight_lbs")) for w in weights])
    bf_trend      = _trend([(w["date"], w.get("body_fat_pct")) for w in weights])

    # InBody segmental from latest weight entry that has the data
    inbody = None
    for w in reversed(weights):
        if any(w.get(k) is not None for k in ("trunk_muscle_lbs", "right_arm_muscle_lbs", "trunk_fat_lbs")):
            inbody = {
                "date": w.get("date"),
                "muscle": {
                    "trunk":     w.get("trunk_muscle_lbs"),
                    "right_arm": w.get("right_arm_muscle_lbs"),
                    "left_arm":  w.get("left_arm_muscle_lbs"),
                    "right_leg": w.get("right_leg_muscle_lbs"),
                    "left_leg":  w.get("left_leg_muscle_lbs"),
                },
                "fat": {
                    "trunk":     w.get("trunk_fat_lbs"),
                    "right_arm": w.get("right_arm_fat_lbs"),
                    "left_arm":  w.get("left_arm_fat_lbs"),
                    "right_leg": w.get("right_leg_fat_lbs"),
                    "left_leg":  w.get("left_leg_fat_lbs"),
                },
                "water": {
                    "total":         w.get("total_body_water_lbs"),
                    "intracellular": w.get("intracellular_water_lbs"),
                    "extracellular": w.get("extracellular_water_lbs"),
                },
            }
            break

    return {
        "generated_at":  datetime.utcnow().isoformat() + "Z",
        "range":         {"start": start, "end": end, "days": days},
        "patient":       _patient(profile),
        "averages":      avg,
        "daily":         daily,
        "trends": {
            "calories":   cal_trend,
            "protein":    protein_trend,
            "weight_lbs": weight_trend,
            "body_fat":   bf_trend,
        },
        "weights":       [
            {
                "date":         w.get("date"),
                "weight_lbs":   w.get("weight_lbs"),
                "body_fat_pct": w.get("body_fat_pct"),
                "lean_mass":    w.get("lean_mass_lbs"),
                "fat_mass":     w.get("fat_mass_lbs"),
                "notes":        w.get("notes"),
            }
            for w in sorted(weights, key=lambda r: r.get("date") or "", reverse=True)
        ],
        "inbody":        inbody,
        "stack":         _stack(profile),
    }
