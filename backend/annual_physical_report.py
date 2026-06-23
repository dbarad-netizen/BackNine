"""
Annual Physical Snapshot.

A single-page, densely-packed everything-summary the user prints once a
year and hands to their PCP at the annual physical. Distinct from the
detailed Sleep / Cardiometabolic / Nutrition reports — those go deep on
one topic; this one stays shallow but covers EVERY signal.

Sections (top-to-bottom, dense layout):
  • Patient header — name, DOB, age, sex, height, weight, BMI
  • Vitals snapshot — latest BP + 30-day BP average + RHR + HRV + breath
  • Body composition — weight + body fat % + lean mass trend (90-day delta)
  • Activity — 30-day avg steps + active minutes
  • Sleep — 30-day avg hours + efficiency + WASO
  • Cardiovascular — VO₂ max + cardiovascular age (if Oura published)
  • Labs — every lab entered, newest first, with reference range and date
  • Complete stack — medications, supplements, peptides

The point: a PCP reviewing this in 60 seconds can spot patterns and
order targeted follow-up labs. No interpretation — just the data.
"""

from __future__ import annotations

from datetime import date as _date, datetime, timedelta
from typing import Optional

import bp
import oura_cache as oc
import nutrition as nut
import apple_health as ah


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
        "birthdate":      profile.get("birthdate"),
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
    }


def _bmi(weight_lbs: Optional[float], height_cm: Optional[float]) -> Optional[float]:
    """BMI = kg / m². Compute defensively; return None on missing inputs."""
    if not weight_lbs or not height_cm:
        return None
    try:
        kg  = float(weight_lbs) * 0.453592
        mtr = float(height_cm) / 100.0
        if mtr <= 0:
            return None
        return round(kg / (mtr * mtr), 1)
    except Exception:
        return None


def _vitals_snapshot(user_id: str) -> dict:
    """Latest BP + 30-day BP average + RHR/HRV/breath averages from sleep."""
    bp_sum = bp.summary(user_id, days=30)

    # RHR / HRV / breath rolling 30-day averages from Oura sleep model.
    try:
        _, _, _, smm = oc.get_days(user_id, days=30)
    except Exception:
        smm = {}
    rhr_vals    = [r.get("rhr")    for r in smm.values() if r.get("rhr")    is not None]
    hrv_vals    = [r.get("hrv")    for r in smm.values() if r.get("hrv")    is not None]
    breath_vals = [r.get("breath") for r in smm.values() if r.get("breath") is not None]
    spo2_vals   = [r.get("spo2")   for r in smm.values() if r.get("spo2")   is not None]

    return {
        "bp":     bp_sum,
        "rhr":    {"avg": _safe_int_avg(rhr_vals),    "n": len(rhr_vals),    "unit": "bpm"},
        "hrv":    {"avg": _safe_int_avg(hrv_vals),    "n": len(hrv_vals),    "unit": "ms"},
        "breath": {"avg": _safe_avg(breath_vals),     "n": len(breath_vals), "unit": "breaths/min"},
        "spo2":   {"avg": _safe_avg(spo2_vals),       "n": len(spo2_vals),   "unit": "%"},
    }


def _body_comp(user_id: str, profile: dict) -> dict:
    """Latest weight + body fat + 90-day deltas + BMI."""
    try:
        entries = nut.get_weight_entries(user_id) or []
    except Exception:
        entries = []
    latest = entries[-1] if entries else {}

    # 90-day window for delta
    cutoff = (_date.today() - timedelta(days=90)).isoformat()
    in_window = [e for e in entries if (e.get("date") or "") >= cutoff]
    earliest_in_window = in_window[0] if in_window else None

    delta_lbs = None
    delta_bf  = None
    if latest and earliest_in_window:
        if latest.get("weight_lbs") is not None and earliest_in_window.get("weight_lbs") is not None:
            delta_lbs = round(latest["weight_lbs"] - earliest_in_window["weight_lbs"], 1)
        if latest.get("body_fat_pct") is not None and earliest_in_window.get("body_fat_pct") is not None:
            delta_bf = round(latest["body_fat_pct"] - earliest_in_window["body_fat_pct"], 1)

    return {
        "latest_weight_lbs":   latest.get("weight_lbs"),
        "latest_body_fat_pct": latest.get("body_fat_pct"),
        "latest_lean_mass":    latest.get("lean_mass_lbs"),
        "latest_date":         latest.get("date"),
        "delta_lbs_90d":       delta_lbs,
        "delta_bf_pct_90d":    delta_bf,
        "bmi":                 _bmi(latest.get("weight_lbs"), profile.get("height_cm")),
    }


def _activity(user_id: str) -> dict:
    """30-day average daily steps (prefer Apple Health, fall back to Oura)."""
    # Apple Health first — live throughout the day, more authoritative
    ah_steps_vals: list[int] = []
    try:
        ah_sum = ah.get_summary(user_id, days=30)
        avg_steps = (ah_sum.get("averages") or {}).get("steps") if ah_sum else None
        if avg_steps is not None:
            return {"avg_steps_30d": int(round(float(avg_steps))), "source": "apple_health"}
    except Exception:
        pass

    # Oura fallback
    try:
        _, _, am, _ = oc.get_days(user_id, days=30)
        ah_steps_vals = [row.get("steps") for row in am.values() if row.get("steps") is not None]
    except Exception:
        pass
    return {
        "avg_steps_30d": _safe_int_avg(ah_steps_vals),
        "source":        "oura",
    }


def _sleep_snapshot(user_id: str) -> dict:
    """30-day avg sleep hours + efficiency + WASO."""
    try:
        _, _, _, smm = oc.get_days(user_id, days=30)
    except Exception:
        smm = {}
    hours_vals: list[float] = []
    eff_vals:   list[int]   = []
    waso_vals:  list[float] = []
    for row in smm.values():
        if row.get("total"):
            hours_vals.append(round(row["total"] / 3600, 2))
        if row.get("efficiency") is not None:
            eff_vals.append(int(row["efficiency"]))
        if row.get("awake") is not None:
            waso_vals.append(round(row["awake"] / 60, 1))
    return {
        "avg_hours_30d":       _safe_avg(hours_vals),
        "avg_efficiency_30d":  _safe_int_avg(eff_vals),
        "avg_waso_min_30d":    _safe_avg(waso_vals),
        "nights":              len(hours_vals),
    }


def _cardio_fitness(user_id: str, profile: dict) -> dict:
    """VO2 max from profile or Oura cardiovascular_age endpoint."""
    vo2 = profile.get("vo2_max")
    # Cardiovascular age comes back as an Oura-cached metric in some
    # accounts; we don't have a dedicated cache field for it here, so just
    # surface VO2.
    return {
        "vo2_max": vo2,
    }


def _labs_section(profile: dict) -> list[dict]:
    """Sanitized labs from the profile, sorted newest-first."""
    raw = profile.get("labs") or []
    if not isinstance(raw, list):
        return []
    cleaned: list[dict] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        cleaned.append({
            "name":            name,
            "value":           it.get("value"),
            "unit":            it.get("unit"),
            "date":            it.get("date"),
            "reference_range": it.get("reference_range"),
            "notes":           it.get("notes"),
        })
    cleaned.sort(key=lambda l: (l.get("date") or "0000-00-00", l.get("name") or ""), reverse=True)
    return cleaned


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


def build_report(user_id: str, profile: dict) -> dict:
    """One-page snapshot for the annual PCP visit.

    No date range — always pulls the 'as of right now' values plus rolling
    30-day / 90-day aggregates where helpful for trend context.
    """
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "patient":      _patient(profile),
        "vitals":       _vitals_snapshot(user_id),
        "body_comp":    _body_comp(user_id, profile),
        "activity":     _activity(user_id),
        "sleep":        _sleep_snapshot(user_id),
        "cardio_fit":   _cardio_fitness(user_id, profile),
        "labs":         _labs_section(profile),
        "stack":        _stack(profile),
    }
