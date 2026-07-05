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

def _snapshot(profile: dict, latest_weight: Optional[float],
              today_iso: Optional[str] = None) -> dict:
    """`today_iso` is the user's device-local YYYY-MM-DD passed by the
    caller (main.py's _user_local_today_iso). Falls back to server-local
    only when the caller didn't provide one (used by internal jobs)."""
    return {
        "name":         (profile.get("name") or "").strip() or None,
        "age":          _age_from_birthdate(profile.get("birthdate")),
        "biological_sex": profile.get("biological_sex"),
        "height":       _height_ft_in(profile.get("height_cm")),
        "weight_lbs":   latest_weight,
        "report_date":  today_iso or _date.today().isoformat(),
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
    # Fable Round 2 P0 fix: this used to call bp_mod.list_entries(user_id),
    # which doesn't exist — the actual function is bp_mod.list_readings.
    # The AttributeError got swallowed by the outer try/except and BP
    # silently came back as None/None on the Handoff. Meanwhile the
    # Cardiometabolic report (which uses bp.summary directly) was
    # correctly showing 17 readings averaging 151/95. That mismatch was
    # the highest-priority finding in the audit — a doctor scanning the
    # one-pager should see the same BP the specialty view shows.
    bp_row = {
        "systolic_now": None, "diastolic_now": None,
        "systolic_trend": "→", "diastolic_trend": "→",
        "n_readings": 0,
        "evening_systolic": None, "evening_diastolic": None,
    }
    try:
        # Pull enough history for both the current and prior windows in
        # one query. days*2 + a small buffer covers "compare last 30d to
        # the 30d before that" cleanly.
        bp_entries = bp_mod.list_readings(user_id, days=days * 2 + 7) or []
        now_bp   = [e for e in bp_entries if e.get("date") and e["date"] >= now_start]
        prior_bp = [e for e in bp_entries if e.get("date") and prior_start <= e["date"] < prior_end]
        sys_now  = _mean([float(e["systolic"])  for e in now_bp   if e.get("systolic")])
        dia_now  = _mean([float(e["diastolic"]) for e in now_bp   if e.get("diastolic")])
        sys_prev = _mean([float(e["systolic"])  for e in prior_bp if e.get("systolic")])
        dia_prev = _mean([float(e["diastolic"]) for e in prior_bp if e.get("diastolic")])

        # Evening split matters clinically — Fable flagged that this
        # user's evening average (155/98) was worse than the day
        # average, which is exactly the pattern a doctor wants to see
        # highlighted. "Evening" = a taken_at time ≥ 17:00 local.
        def _is_evening(row: dict) -> bool:
            t = row.get("taken_at") or row.get("time") or ""
            # Prefer taken_at ISO; fall back to a bare HH:MM string.
            if isinstance(t, str) and "T" in t:
                try:
                    return int(t.split("T")[1][:2]) >= 17
                except Exception:
                    return False
            if isinstance(t, str) and ":" in t:
                try:
                    return int(t.split(":")[0]) >= 17
                except Exception:
                    return False
            return False
        evening_now = [e for e in now_bp if _is_evening(e)]
        eve_sys = _mean([float(e["systolic"])  for e in evening_now if e.get("systolic")])
        eve_dia = _mean([float(e["diastolic"]) for e in evening_now if e.get("diastolic")])

        bp_row = {
            "systolic_now":     round(sys_now) if sys_now else None,
            "diastolic_now":    round(dia_now) if dia_now else None,
            "systolic_trend":   _trend_arrow(sys_now, sys_prev, threshold_pct=2.0),
            "diastolic_trend":  _trend_arrow(dia_now, dia_prev, threshold_pct=2.0),
            "n_readings":       len(now_bp),
            "evening_systolic":  round(eve_sys) if eve_sys else None,
            "evening_diastolic": round(eve_dia) if eve_dia else None,
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

    # Lab-driven flags. _labs() now emits rows with `key` (canonical
    # marker key from labs.REFERENCE_RANGES), which is what we index on
    # here. It also emits `status`, so we can generically flag anything
    # out of range without hard-coding one metric at a time.
    labs_by_key: dict[str, dict] = {}
    for lab in labs_list or []:
        key = (lab.get("key") or "").lower()
        if key and key not in labs_by_key:
            labs_by_key[key] = lab

    def _lab_val(key: str) -> Optional[float]:
        row = labs_by_key.get(key)
        if not row:
            return None
        try:
            return float(row.get("value"))
        except (TypeError, ValueError):
            return None

    # Priority flags — clinically meaningful thresholds a PCP would
    # want called out even before the generic out-of-range sweep.
    ldl = _lab_val("ldl")
    if ldl and ldl >= 160:
        out.append(f"LDL {ldl:.0f} mg/dL (high)")
    a1c = _lab_val("hba1c")
    if a1c and a1c >= 6.5:
        out.append(f"HbA1c {a1c:.1f}% (diabetic range)")
    elif a1c and a1c >= 5.7:
        out.append(f"HbA1c {a1c:.1f}% (pre-diabetic range)")

    # Generic out-of-range sweep. Skip markers already flagged above.
    already_flagged_keys = {"ldl", "hba1c"}
    for lab in labs_list or []:
        key = (lab.get("key") or "").lower()
        if key in already_flagged_keys:
            continue
        if lab.get("status") != "out_of_range":
            continue
        metric = lab.get("metric") or key
        value  = lab.get("value")
        unit   = lab.get("unit") or ""
        rng    = lab.get("range") or ""
        if value is None:
            continue
        # e.g. "hsCRP 2.1 mg/L (ref 0-1.0)"
        piece = f"{metric} {value}{(' ' + unit) if unit else ''}"
        if rng:
            piece += f" (ref {rng})"
        out.append(piece)

    return out


def _stack(profile: dict) -> dict:
    """Meds / supps / peptides list for the Handoff. Names pass through
    name_normalize so common misspellings ("taladafil" → "Tadalafil",
    "Reservatol" → "Resveratrol") are cleaned up before a physician
    reads them. This is credibility work — not medical judgment. When
    a name isn't recognized we return it unchanged so we never
    silently substitute a different drug."""
    try:
        from name_normalize import normalize_name
    except Exception:
        normalize_name = lambda s: s  # noqa: E731
    def _names(arr) -> list[str]:
        if not isinstance(arr, list):
            return []
        out = []
        for item in arr:
            if isinstance(item, dict):
                nm = (item.get("name") or "").strip()
                if nm:
                    out.append(normalize_name(nm))
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

    # Fable Round 2 hygiene fix: the Handoff was rendering
    # "Recent symptoms (14d): — (mild)" from rows where the user
    # opened the check-in card and picked a severity but never tagged a
    # symptom — those rows have an empty symptoms array. Filter them
    # out here so they never reach the frontend renderer.
    cleaned: list[dict] = []
    for row in symptoms:
        syms = row.get("symptoms") or []
        if not isinstance(syms, list) or len(syms) == 0:
            continue
        # Also drop rows where every tag is blank / whitespace.
        if not any((isinstance(s, str) and s.strip()) for s in syms):
            continue
        cleaned.append(row)

    return {
        "recent_symptoms": cleaned[:10],
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
    Nutrition tab and Annual Physical Snapshot.

    NOTE (bug fix): labs.get_entries returns entries with marker values
    as *top-level fields* per entry (e.g. {id, date, glucose: 92,
    ldl: 108, ...}). Earlier this function iterated looking for a
    single `metric` field on each entry, which meant it silently
    returned [] every time. Now we walk each entry's marker fields
    against REFERENCE_RANGES, and keep the most recent value per
    marker across all entries. Ranges + labels come from
    labs.REFERENCE_RANGES so we're consistent with the rest of the
    app.
    """
    try:
        entries = lbs.get_entries(user_id) or []
    except Exception:
        return []
    # Newest first — one entry can hold many markers.
    entries = sorted(entries, key=lambda e: e.get("date") or "", reverse=True)
    seen: set[str] = set()
    trimmed: list[dict] = []
    for e in entries:
        date_str = e.get("date")
        for key, ref in lbs.REFERENCE_RANGES.items():
            if key in seen:
                continue
            val = e.get(key)
            if val is None:
                continue
            try:
                fval = float(val)
            except (TypeError, ValueError):
                continue
            # Determine in-range status once, here, so the frontend
            # and the Handoff narrative don't recompute independently.
            low, high = ref.get("low"), ref.get("high")
            status = "unknown"
            try:
                if low is not None and high is not None:
                    status = "in_range" if low <= fval <= high else "out_of_range"
            except Exception:
                pass
            trimmed.append({
                "metric": ref.get("label", key),
                "key":    key,
                "value":  round(fval, 3),
                "unit":   ref.get("unit", ""),
                "date":   date_str,
                "range":  f"{low}-{high}" if (low is not None and high is not None) else "",
                "status": status,
            })
            seen.add(key)
            if len(trimmed) >= limit:
                return trimmed
    return trimmed


# ── public ───────────────────────────────────────────────────────────────

def build_one_pager(user_id: str, profile: dict,
                    today_iso: Optional[str] = None) -> dict:
    """Assemble the full one-pager payload. Best-effort throughout — a
    missing section renders empty on the frontend, doesn't 500.

    `today_iso`: user's device-local date. Passed by the endpoint so
    the "As of <date>" line never shows a future date under UTC drift.
    """
    latest_wt = _latest_weight(user_id)
    labs_list = _labs(user_id, limit=10)
    vitals    = _vitals(user_id, days=30)

    # Fable Round 2 P0 — auto-pin the most severe clinical escalation
    # flag to the top of the Handoff. This is the "bring to your
    # doctor" line a physician needs to see first when the app knows
    # BP is running above guideline.
    escalation_flags: list[dict] = []
    handoff_pin_row: Optional[dict] = None
    try:
        import clinical_escalation as _esc
        escalation_flags = _esc.assess(user_id, profile) or []
        handoff_pin_row  = _esc.handoff_pin(escalation_flags)
    except Exception:
        pass

    return {
        "snapshot":          _snapshot(profile, latest_wt, today_iso=today_iso),
        "vitals":            vitals,
        "flags":             _flags(vitals, labs_list),
        "stack":             _stack(profile),
        "patient_reported":  _patient_reported(user_id),
        "labs":              labs_list,
        "escalation_pin":    handoff_pin_row,   # None when no flags
        "escalation_flags":  escalation_flags,  # full list for optional expansion
    }
