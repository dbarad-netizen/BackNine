"""
Cardiometabolic Report — heart-and-vascular focused doctor handoff.

Distinct from the comprehensive Doctor's Report (which covers everything).
This one zeroes in on the signals a cardiologist or primary-care doc would
weigh when assessing cardiovascular risk:

  • Blood pressure — trend, AM/PM split, full reading list
  • Resting heart rate trend
  • Heart Rate Variability trend (recovery signal)
  • Weight + body fat trend (metabolic-syndrome marker)
  • VO₂ max + cardiovascular age (if Oura published it)

The frontend renders this as a focused tab inside the Health Reports modal.
Pure data — no scoring, no interpretation; the same observational-only
disclaimer that covers the full report covers this one.
"""

from __future__ import annotations

from datetime import date as _date, datetime, timedelta
from typing import Optional

import bp
import oura_cache as oc
import nutrition as nut


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
    age: Optional[int] = None
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
        "birthdate":      profile.get("birthdate"),
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
        "vo2_max":        profile.get("vo2_max"),
    }


def _bp_section(user_id: str, days: int) -> dict:
    readings = bp.list_readings(user_id, days=days, limit=500)
    summary  = bp.summary(user_id, days=min(days, 30))
    return {
        "readings_count": len(readings),
        "summary":        summary,
        "readings":       readings,
    }


def _cardio_signals(smm: dict, start: str, end: str) -> dict:
    """Resting HR + HRV trends from Oura sleep model rows in window."""
    rhr_series: list[tuple[str, Optional[int]]]   = []
    hrv_series: list[tuple[str, Optional[int]]]   = []
    avg_hr_series: list[tuple[str, Optional[int]]] = []
    for d, row in smm.items():
        if not (start <= d <= end):
            continue
        rhr_series.append((d, row.get("rhr")))
        hrv_series.append((d, row.get("hrv")))
        avg_hr_series.append((d, row.get("avg_hr")))
    return {
        "rhr": {
            "trend":   _trend(rhr_series),
            "average": _safe_int_avg([v for _, v in rhr_series if v is not None]),
            "unit":    "bpm",
        },
        "hrv": {
            "trend":   _trend(hrv_series),
            "average": _safe_int_avg([v for _, v in hrv_series if v is not None]),
            "unit":    "ms",
        },
        "avg_hr": {
            "trend":   _trend(avg_hr_series),
            "average": _safe_int_avg([v for _, v in avg_hr_series if v is not None]),
            "unit":    "bpm",
        },
    }


def _weight_section(user_id: str, start: str, end: str) -> dict:
    try:
        entries = nut.get_weight_entries(user_id) or []
    except Exception:
        entries = []
    in_window = []
    for e in entries:
        d = e.get("date")
        if d and start <= d <= end:
            in_window.append({
                "date":         d,
                "weight_lbs":   e.get("weight_lbs"),
                "body_fat_pct": e.get("body_fat_pct"),
                "notes":        e.get("notes"),
            })
    in_window.sort(key=lambda r: r["date"])
    delta_lbs: Optional[float] = None
    delta_bf:  Optional[float] = None
    if len(in_window) >= 2:
        first_w = next((r["weight_lbs"] for r in in_window if r["weight_lbs"] is not None), None)
        last_w  = next((r["weight_lbs"] for r in reversed(in_window) if r["weight_lbs"] is not None), None)
        if first_w is not None and last_w is not None:
            delta_lbs = round(last_w - first_w, 1)
        first_bf = next((r["body_fat_pct"] for r in in_window if r["body_fat_pct"] is not None), None)
        last_bf  = next((r["body_fat_pct"] for r in reversed(in_window) if r["body_fat_pct"] is not None), None)
        if first_bf is not None and last_bf is not None:
            delta_bf = round(last_bf - first_bf, 1)
    return {
        "entries":   in_window,
        "delta_lbs": delta_lbs,
        "delta_bf":  delta_bf,
    }


def build_report(user_id: str, profile: dict, *, days: int = 30, end_iso: Optional[str] = None) -> dict:
    """Top-level — called by /api/cardiometabolic-report."""
    end = end_iso or _date.today().isoformat()
    start, end = _date_range(end, days)
    try:
        _, _, _, smm = oc.get_days(user_id, days=days)
    except Exception:
        smm = {}
    return {
        "generated_at":   datetime.utcnow().isoformat() + "Z",
        "range":          {"start": start, "end": end, "days": days},
        "patient":        _patient(profile),
        "blood_pressure": _bp_section(user_id, days),
        "cardio_signals": _cardio_signals(smm, start, end),
        "weight":         _weight_section(user_id, start, end),
    }
