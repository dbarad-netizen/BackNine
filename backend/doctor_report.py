"""
Doctor's Report aggregator.

Builds the payload behind the print-friendly clinical report a user can hand
to (or email) their physician. Pulls together blood pressure, sleep,
cardiovascular signals (HRV / RHR / breathing rate), weight, medications,
supplements, and peptides over a chosen date range.

This module is intentionally observational only — no scoring, no
interpretation, no thresholds. The frontend renders the data with a clear
"For discussion with your doctor" disclaimer, and Coach Al stays out of it
entirely. The point is to make the user a better-prepared patient, not to
practice medicine.

Data sources:
  - blood_pressure_log              → bp.list_readings + bp.summary
  - oura_daily_cache (sleep, HRV,   → oura_cache.get_days
    RHR, breathing rate)
  - apple_health_daily              → apple_health.get_summary (fallback for
                                       non-Oura users)
  - weight_log                      → nutrition.get_weight_entries
  - user_profiles                   → medications / supplements / peptides /
                                       name / birthdate
"""

from __future__ import annotations

from datetime import date as _date, datetime, timedelta
from typing import Any, Optional

import bp
import oura_cache as oc
import apple_health as ah
import nutrition as nut


def _iso(d: _date) -> str:
    return d.isoformat()


def _date_range(end_iso: str, days: int) -> tuple[str, str]:
    """Inclusive [start, end] window. End defaults to today; days back from end."""
    try:
        end_d = datetime.strptime(end_iso, "%Y-%m-%d").date()
    except Exception:
        end_d = _date.today()
    days = max(1, min(int(days), 365))  # clamp to a sane range
    start_d = end_d - timedelta(days=days - 1)
    return _iso(start_d), _iso(end_d)


def _safe_avg(vals: list[float]) -> Optional[float]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 1)


def _safe_int_avg(vals: list[int]) -> Optional[int]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return int(round(sum(vals) / len(vals)))


def _trend(series: list[tuple[str, Any]]) -> list[dict]:
    """Coerce a (date, value) series into a list of {date, value} dicts,
    chronologically ascending, skipping None values."""
    out = []
    for d, v in sorted(series):
        if v is None:
            continue
        out.append({"date": d, "value": v})
    return out


def _bp_section(user_id: str, days: int) -> dict:
    """Blood pressure: full reading list + 30-day summary + the table the
    report renders.  Day-of-week stays in the readings so the frontend can
    cluster by morning/evening if it wants."""
    readings = bp.list_readings(user_id, days=days, limit=500)
    summary  = bp.summary(user_id, days=min(days, 30))  # clinicians want the 30d snapshot
    return {
        "readings_count": len(readings),
        "summary":        summary,
        "readings":       readings,
    }


def _sleep_cardio_section(smm: dict, slm: dict, start: str, end: str) -> dict:
    """Sleep duration + HRV + RHR + breathing rate trends from Oura."""
    sleep_series: list[tuple[str, Optional[float]]] = []
    hrv_series:   list[tuple[str, Optional[int]]]   = []
    rhr_series:   list[tuple[str, Optional[int]]]   = []
    brth_series:  list[tuple[str, Optional[float]]] = []
    spo2_series:  list[tuple[str, Optional[float]]] = []
    sleep_score_series: list[tuple[str, Optional[int]]] = []

    for d, row in smm.items():
        if not (start <= d <= end):
            continue
        total = row.get("total")
        sleep_series.append((d, round(total / 3600, 2) if total else None))
        hrv_series.append((d, row.get("hrv")))
        rhr_series.append((d, row.get("rhr")))
        brth_series.append((d, row.get("breath")))
        spo2_series.append((d, row.get("spo2")))

    for d, row in slm.items():
        if not (start <= d <= end):
            continue
        sleep_score_series.append((d, row.get("score")))

    def _averaged(series) -> Optional[float]:
        return _safe_avg([v for _, v in series if v is not None])

    return {
        "sleep_hours": {
            "trend":   _trend(sleep_series),
            "average": _averaged(sleep_series),
        },
        "sleep_score": {
            "trend":   _trend(sleep_score_series),
            "average": _safe_int_avg([v for _, v in sleep_score_series if v is not None]),
        },
        "hrv": {
            "trend":   _trend(hrv_series),
            "average": _safe_int_avg([v for _, v in hrv_series if v is not None]),
            "unit":    "ms",
        },
        "rhr": {
            "trend":   _trend(rhr_series),
            "average": _safe_int_avg([v for _, v in rhr_series if v is not None]),
            "unit":    "bpm",
        },
        "breathing_rate": {
            "trend":   _trend(brth_series),
            "average": _averaged(brth_series),
            "unit":    "breaths/min",
        },
        "spo2": {
            # Overnight oxygen saturation average. None on Oura rings that
            # don't measure SpO2 — the frontend shows the empty state.
            "trend":   _trend(spo2_series),
            "average": _averaged(spo2_series),
            "unit":    "%",
        },
    }


def _apple_health_section(user_id: str, days: int) -> Optional[dict]:
    """Apple Health snapshot for users who don't have Oura. Lighter shape than
    the Oura section because AH doesn't give us breathing rate."""
    try:
        s = ah.get_summary(user_id, days=days)
    except Exception:
        return None
    if not s or not s.get("has_data"):
        return None
    return {
        "as_of":       s.get("as_of"),
        "today":       s.get("today")    or {},
        "averages":    s.get("averages") or {},
        "days_synced": s.get("days_synced"),
    }


def _weight_section(user_id: str, start: str, end: str) -> dict:
    """Weight entries inside the window + simple delta."""
    try:
        entries = nut.get_weight_entries(user_id) or []
    except Exception:
        entries = []
    # Entries are typically (date, weight_lbs, body_fat_pct, …). Be defensive.
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
    if len(in_window) >= 2:
        first = next((r["weight_lbs"] for r in in_window if r["weight_lbs"] is not None), None)
        last  = next((r["weight_lbs"] for r in reversed(in_window) if r["weight_lbs"] is not None), None)
        if first is not None and last is not None:
            delta_lbs = round(last - first, 1)
    return {
        "entries":   in_window,
        "delta_lbs": delta_lbs,
    }


def _stack_section(profile: dict) -> dict:
    """Active items in each pill category. Read directly from the profile —
    sanitization already happened at write time."""
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


def _patient_section(profile: dict) -> dict:
    """Top-of-report patient header. Birthdate → age computed here so the
    report shows BOTH (clinicians sometimes prefer one or the other)."""
    age: Optional[int] = None
    bd = profile.get("birthdate")
    if bd:
        try:
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            today = _date.today()
            age = today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
        except Exception:
            age = None
    return {
        "name":           (profile.get("name") or "").strip() or None,
        "birthdate":      profile.get("birthdate"),
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
    }


def build_report(user_id: str, profile: dict, *, days: int = 30, end_iso: Optional[str] = None) -> dict:
    """Top-level entrypoint called by the /api/doctor-report endpoint.

    profile is the user_profiles row as returned by _get_profile in main.py.
    We pass it in (rather than re-reading inside the module) so the caller
    controls auth and so tests can inject fixture profiles.
    """
    end = end_iso or _date.today().isoformat()
    start, end = _date_range(end, days)

    # Oura sleep/cardio comes straight from the cache. If the user has no Oura
    # connection, smm/slm will simply be empty and the Cardio section renders
    # an empty state.
    try:
        _, slm, _, smm = oc.get_days(user_id, days=days)
    except Exception:
        slm, smm = {}, {}

    return {
        "generated_at":  datetime.utcnow().isoformat() + "Z",
        "range":         {"start": start, "end": end, "days": days},
        "patient":       _patient_section(profile),
        "blood_pressure": _bp_section(user_id, days),
        "sleep_cardio":  _sleep_cardio_section(smm, slm, start, end),
        "apple_health":  _apple_health_section(user_id, days),
        "weight":        _weight_section(user_id, start, end),
        "stack":         _stack_section(profile),
    }
