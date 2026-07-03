"""
Doctor Handoff — one-page clinical summary.

Fable IMPROVE #1: "Doctors give a patient printout about 30 seconds.
The handoff needs a one-page clinical summary — trends, flags,
meds/supplements, patient-reported symptoms — with everything else
behind it."

This module produces exactly that: a concise, single-page payload the
user brings to their doctor. It sits ABOVE the seven detailed report
tabs in information architecture — the one-pager is the primary,
marketable artifact; the seven tabs remain as specialty views a curious
physician can drill into via a share link.

Sections (each ≤ 4 lines when rendered):
  • Patient snapshot        — name, age, sex, height, weight, biometrics
  • Vitals trends           — BP, RHR, HRV, sleep, VO2 with 30-day trends
  • Flags                   — anything trending in a concerning direction
  • Current stack           — medications, supplements, peptides (names only)
  • Patient-reported        — recent symptoms + Coach Al memory (injuries,
                              medical context the doctor should know)
  • Recent labs             — the latest 8-10 lab values with dates

Design principles:
  1. Ruthlessly one-page. If a section overflows, it gets truncated with
     "see full report for detail" pointing at the seven-tab layer.
  2. Trends are directional arrows (↑ / ↓ / →) with a magnitude, not raw
     charts. The doctor's job is to spot direction in seconds.
  3. Flags are objective, threshold-driven. No AI narration on the
     one-pager — narration lives in the detailed tabs.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import labs as lbs
import bp as bp_mod

from supabase import create_client, Client


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _age_from_birthdate(bd: Optional[str]) -> Optional[int]:
    if not bd:
        return None
    try:
        bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
        today = _date.today()
        return today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
    except Exception:
        return None


def _height_ft_in(cm: Optional[float]) -> Optional[str]:
    if not cm:
        return None
    total_in = float(cm) / 2.54
    feet = int(total_in // 12)
    inches = int(round(total_in - feet * 12))
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'{inches}\""


def _trend_arrow(current: Optional[float], baseline: Optional[float], threshold_pct: float = 3.0) -> str:
    """Single-character directional arrow. → when within ± threshold_pct."""
    if current is None or baseline is None or baseline == 0:
        return "→"
    delta_pct = (current - baseline) / abs(baseline) * 100
    if delta_pct > threshold_pct:
        return "↑"
    if delta_pct < -threshold_pct:
        return "↓"
    return "→"


def _mean(vals: list[float]) -> Optional[float]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


# ── section builders ─────────────────────────────────────────────────────

def _snapshot(profile: dict, latest_weight: Optional[float]) -> dict:
    return {
        "name":         (profile.get("name") or "").strip() or None,
        "age":          _age_from_birthdate(profile.get("birthdate")),
        "biological_sex": profile.get("biological_sex"),
        "height":       _height_ft_in(profile.get("height_cm")),
        "weight_lbs":   latest_weight,
        "report_date":  _date.today().isoformat(),
        "window_days":  30,
    }


def _vitals(user_id: str, days: int = 30) -> dict:
    """BP + Oura vitals with 30-day averages and directional arrows.
    Baseline = the same metric averaged over the *prior* 30 days so the
    trend arrow reflects "is this getting better or worse right now?"."""
    today = _date.today()
    now_start  = (today - timedelta(days=days)).isoformat()
    prior_end  = (today - timedelta(days=days)).isoformat()
    prior_start = (today - timedelta(days=days * 2)).isoformat()

    # ── BP ──
    bp_row = {"systolic_now": None, "diastolic_now": None, "systolic_trend": "→", "diastolic_trend": "→"}
    try:
        bp_entries = bp_mod.list_entries(user_id) or []
        # entries are dict rows with 'date', 'systolic', 'diastolic'
        now_bp = [e for e in bp_entries if e.get("date") and e["date"] >= now_start]
        prior_bp = [e for e in bp_entries if e.get("date") and prior_start <= e["date"] < prior_end]
        sys_now  = _mean([float(e["systolic"])  for e in now_bp   if e.get("systolic")])
        dia_now  = _mean([float(e["diastolic"]) for e in now_bp   if e.get("diastolic")])
        sys_prev = _mean([float(e["systolic"])  for e in prior_bp if e.get("systolic")])
        dia_prev = _mean([float(e["diastolic"]) for e in prior_bp if e.get("diastolic")])
        bp_row = {
            "systolic_now":     round(sys_now) if sys_now else None,
            "diastolic_now":    round(dia_now) if dia_now else None,
            "systolic_trend":   _trend_arrow(sys_now, sys_prev, threshold_pct=2.0),
            "diastolic_trend":  _trend_arrow(dia_now, dia_prev, threshold_pct=2.0),
            "n_readings":       len(now_bp),
        }
    except Exception:
        pass

    # ── Oura vitals (RHR, HRV, sleep hours) ──
    oura = {"rhr_now": None, "hrv_now": None, "sleep_h_now": None,
            "rhr_trend": "→", "hrv_trend": "→", "sleep_trend": "→"}
    try:
        _, _, _, smm = oc.get_days(user_id, days=days * 2 + 5)
        def _bucket(start_iso: str, end_iso: str) -> dict:
            rhr, hrv, sleep_h = [], [], []
            for d, row in smm.items():
                if start_iso <= d <= end_iso:
                    if row.get("rhr") is not None: rhr.append(float(row["rhr"]))
                    if row.get("hrv") is not None: hrv.append(float(row["hrv"]))
                    if row.get("total"):           sleep_h.append(float(row["total"]) / 3600)
            return {"rhr": _mean(rhr), "hrv": _mean(hrv), "sleep_h": _mean(sleep_h)}
        end_now_iso = today.isoformat()
        now  = _bucket(now_start, end_now_iso)
        prev = _bucket(prior_start, prior_end)
        oura = {
            "rhr_now":      round(now["rhr"]) if now["rhr"] else None,
            "hrv_now":      round(now["hrv"]) if now["hrv"] else None,
            "sleep_h_now":  round(now["sleep_h"], 1) if now["sleep_h"] else None,
            "rhr_trend":    _trend_arrow(now["rhr"], prev["rhr"], threshold_pct=2.0),
            "hrv_trend":    _trend_arrow(now["hrv"], prev["hrv"], threshold_pct=3.0),
            "sleep_trend":  _trend_arrow(now["sleep_h"], prev["sleep_h"], threshold_pct=3.0),
        }
    except Exception:
        pass

    return {"bp": bp_row, "oura": oura}


# Threshold-driven flags. Deliberately conservative — the one-pager
# should flag only what a doctor would want called out at a glance.
def _flags(vitals: dict, labs_list: list[dict]) -> list[str]:
    out: list[str] = []
    bp = vitals.get("bp") or {}
    ora = vitals.get("oura") or {}
    if bp.get("systolic_now") and bp["systolic_now"] >= 140:
        out.append(f"Systolic BP averaging {bp['systolic_now']} (Stage 2 hypertension range)")
    elif bp.get("systolic_now") and bp["systolic_now"] >= 130:
        out.append(f"Systolic BP averaging {bp['systolic_now']} (Stage 1 hypertension range)")
    if bp.get("diastolic_now") and bp["diastolic_now"] >= 90:
        out.append(f"Diastolic BP averaging {bp['diastolic_now']} (Stage 2 range)")
    if ora.get("rhr_now") and ora["rhr_now"] > 75 and ora.get("rhr_trend") == "↑":
        out.append(f"Resting HR trending up to {ora['rhr_now']} bpm over the last 30 days")
    if ora.get("sleep_h_now") and ora["sleep_h_now"] < 6.5:
        out.append(f"Average sleep {ora['sleep_h_now']}h/night (below 6.5h)")

    # Lab-driven flags (only when we have a value)
    labs_by_key: dict[str, dict] = {}
    for lab in labs_list or []:
        key = (lab.get("metric") or "").lower()
        if key and key not in labs_by_key:
            labs_by_key[key] = lab  # first (most recent) wins if sorted desc

    def _lab_val(key: str) -> Optional[float]:
        row = labs_by_key.get(key)
        if not row:
            return None
        try:
            return float(row.get("value"))
        except (TypeError, ValueError):
            return None
    ldl = _lab_val("ldl")
    if ldl and ldl >= 160:
        out.append(f"LDL {ldl:.0f} mg/dL (high)")
    a1c = _lab_val("hba1c") or _lab_val("a1c")
    if a1c and a1c >= 6.5:
        out.append(f"HbA1c {a1c:.1f}% (diabetic range)")
    elif a1c and a1c >= 5.7:
        out.append(f"HbA1c {a1c:.1f}% (pre-diabetic range)")

    return out


def _stack(profile: dict) -> dict:
    def _names(arr) -> list[str]:
        if not isinstance(arr, list):
            return []
        out = []
        for item in arr:
            if isinstance(item, dict):
                nm = (item.get("name") or "").strip()
                if nm:
                    out.append(nm)
        return out[:15]
    return {
        "medications": _names(profile.get("medications")),
        "supplements": _names(profile.get("supplements")),
        "peptides":    _names(profile.get("peptides")),
    }


def _patient_reported(user_id: str) -> dict:
    """Recent symptom tags + relevant Coach Al memory (injuries + medical
    context). Everything else in memory (goals, preferences) is filtered
    out — the doctor doesn't need to see 'wants to run October marathon'."""
    sb = _sb()
    symptoms: list[dict] = []
    if sb:
        try:
            cutoff = (_date.today() - timedelta(days=14)).isoformat()
            res = (
                sb.table("symptom_logs")
                .select("date, symptoms, severity, notes")
                .eq("user_id", user_id)
                .gte("date", cutoff)
                .order("date", desc=True)
                .execute()
            )
            symptoms = res.data or []
        except Exception:
            pass

    memory_medical: list[str] = []
    if sb:
        try:
            res = (
                sb.table("user_memory")
                .select("category, content")
                .eq("user_id", user_id)
                .eq("active", True)
                .in_("category", ["injury", "medical"])
                .execute()
            )
            for r in (res.data or [])[:8]:
                if r.get("content"):
                    memory_medical.append(f"[{r.get('category')}] {r['content']}")
        except Exception:
            pass

    return {
        "recent_symptoms": symptoms[:10],
        "memory_flags":    memory_medical,
    }


def _latest_weight(user_id: str) -> Optional[float]:
    sb = _sb()
    if not sb:
        return None
    try:
        res = (
            sb.table("nutrition_weight")
            .select("weight_lbs")
            .eq("user_id", user_id)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get("weight_lbs") is not None:
            return float(rows[0]["weight_lbs"])
    except Exception:
        pass
    return None


def _labs(user_id: str, limit: int = 10) -> list[dict]:
    """Latest lab values, most-recent-first. Reads from the canonical
    labs source (labs.get_entries) so this matches what shows on the
    Nutrition tab and Annual Physical Snapshot."""
    try:
        entries = lbs.get_entries(user_id) or []
    except Exception:
        return []
    # Sort by date desc and keep just the display fields
    def _key(e):
        return (e.get("date") or ""), (e.get("metric") or "")
    entries = sorted(entries, key=_key, reverse=True)
    trimmed: list[dict] = []
    seen_metrics: set[str] = set()
    for e in entries:
        metric = (e.get("metric") or "").lower()
        if not metric or metric in seen_metrics:
            continue
        seen_metrics.add(metric)
        trimmed.append({
            "metric": e.get("metric"),
            "value":  e.get("value"),
            "unit":   e.get("unit"),
            "date":   e.get("date"),
        })
        if len(trimmed) >= limit:
            break
    return trimmed


# ── public ───────────────────────────────────────────────────────────────

def build_one_pager(user_id: str, profile: dict) -> dict:
    """Assemble the full one-pager payload. Best-effort throughout — a
    missing section renders empty on the frontend, doesn't 500."""
    latest_wt = _latest_weight(user_id)
    labs_list = _labs(user_id, limit=10)
    vitals    = _vitals(user_id, days=30)
    return {
        "snapshot":          _snapshot(profile, latest_wt),
        "vitals":            vitals,
        "flags":             _flags(vitals, labs_list),
        "stack":             _stack(profile),
        "patient_reported":  _patient_reported(user_id),
        "labs":              labs_list,
    }
