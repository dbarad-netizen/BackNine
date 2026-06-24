"""
Symptom journal + correlation analysis.

The user taps "How do you feel today?" and selects from a curated tag
list — Low Energy, Headache, Brain Fog, Anxiety/Stressed, Joint Pain,
Poor Sleep, GI Issues, Sore — with optional severity (mild / moderate /
severe) and a free-text note.

Once they have 5+ symptom-day rows in a 30-day window, the correlation
endpoint runs a simple delta analysis: for each metric (sleep_hours, HRV,
RHR, training_count, calories, breath, awake_min, ...) it compares
averages on symptom-positive vs symptom-negative days within the window.
The biggest deltas surface as candidate signals — Coach Al narrates the
top 2-3 with Claude so the user sees "On your low-energy days, you slept
5.8h on average vs 7.1h on other days. Sleep is the strongest correlate."

Pure correlation — never causation. The disclaimer in the UI is explicit
about this.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import apple_health as ah

from supabase import create_client, Client


log = logging.getLogger(__name__)


# Curated symptom catalog. Keep tight (8 items) to avoid decision
# paralysis. "Other" is supported via the free-text note field so users
# aren't blocked when their symptom isn't here.
SYMPTOM_CATALOG: list[dict] = [
    {"id": "low_energy",  "label": "Low energy",     "emoji": "🪫"},
    {"id": "headache",    "label": "Headache",       "emoji": "🤕"},
    {"id": "brain_fog",   "label": "Brain fog",      "emoji": "🌫️"},
    {"id": "anxiety",     "label": "Anxious",        "emoji": "😟"},
    {"id": "joint_pain",  "label": "Joint pain",     "emoji": "🦴"},
    {"id": "poor_sleep",  "label": "Poor sleep",     "emoji": "😴"},
    {"id": "gi_issues",   "label": "GI issues",      "emoji": "🤢"},
    {"id": "sore",        "label": "Muscle sore",    "emoji": "💪"},
]

VALID_SYMPTOM_IDS = {s["id"] for s in SYMPTOM_CATALOG}
VALID_SEVERITIES  = {"mild", "moderate", "severe"}


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── CRUD ────────────────────────────────────────────────────────────────

def upsert_log(user_id: str, date_iso: str, symptoms: list[str],
               severity: Optional[str] = None, notes: Optional[str] = None) -> dict:
    """Insert or update today's symptom log. Sanitizes symptom ids and
    severity against the curated catalog so bad client input can't
    pollute the table."""
    sb = _sb()
    if not sb:
        return {}
    clean_symptoms = [s for s in (symptoms or []) if s in VALID_SYMPTOM_IDS][:8]
    clean_severity = severity if severity in VALID_SEVERITIES else None
    clean_notes    = (notes or "").strip()[:500] or None

    row = {
        "user_id":  user_id,
        "date":     date_iso,
        "symptoms": clean_symptoms,
        "severity": clean_severity,
        "notes":    clean_notes,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    try:
        res = sb.table("symptom_logs").upsert(row, on_conflict="user_id,date").execute()
        return (res.data or [{}])[0]
    except Exception as exc:
        log.warning("symptoms.upsert_log failed: %s", exc)
        return {}


def list_logs(user_id: str, days: int = 90) -> list[dict]:
    """Return the user's symptom logs over the last `days` days, newest first."""
    sb = _sb()
    if not sb:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        res = (sb.table("symptom_logs")
                 .select("*")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .order("date", desc=True)
                 .limit(180)
                 .execute())
        return res.data or []
    except Exception:
        return []


def delete_log(user_id: str, date_iso: str) -> bool:
    sb = _sb()
    if not sb:
        return False
    try:
        res = (sb.table("symptom_logs")
                 .delete()
                 .eq("user_id", user_id)
                 .eq("date", date_iso)
                 .execute())
        return bool(res.data)
    except Exception:
        return False


# ── Correlation analysis ────────────────────────────────────────────────

def _build_metrics_window(user_id: str, days: int) -> dict[str, dict]:
    """For each day in the window, gather every metric we have.
    Returns: { 'YYYY-MM-DD': { metric: value, ... } }
    Used by the correlation engine to compare symptom-positive vs
    symptom-negative day distributions."""
    end_d   = _date.today()
    start_d = end_d - timedelta(days=days - 1)

    try:
        rm, slm, am, smm = oc.get_days(user_id, days=days + 1)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    sb = _sb()

    # Workouts per day
    workouts_by_day: dict[str, int] = {}
    cardio_min_by_day: dict[str, int] = {}
    if sb:
        try:
            res = (sb.table("training_workouts")
                     .select("date, kind, duration_min")
                     .eq("user_id", user_id)
                     .gte("date", start_d.isoformat())
                     .lte("date", end_d.isoformat())
                     .execute())
            for r in (res.data or []):
                d = r.get("date")
                if not d:
                    continue
                workouts_by_day[d] = workouts_by_day.get(d, 0) + 1
                if (r.get("kind") or "").lower() == "cardio":
                    cardio_min_by_day[d] = cardio_min_by_day.get(d, 0) + int(r.get("duration_min") or 0)
        except Exception:
            pass

    # Nutrition totals per day
    nutrition_by_day: dict[str, dict] = {}
    if sb:
        try:
            res = (sb.table("nutrition_meals")
                     .select("date, calories, protein, carbs, fat")
                     .eq("user_id", user_id)
                     .gte("date", start_d.isoformat())
                     .lte("date", end_d.isoformat())
                     .execute())
            for r in (res.data or []):
                d = r.get("date")
                if not d:
                    continue
                slot = nutrition_by_day.setdefault(d, {"calories": 0, "protein_g": 0})
                slot["calories"]  += int(r.get("calories") or 0)
                slot["protein_g"] += int(float(r.get("protein") or 0))
        except Exception:
            pass

    # BP per day (use average of readings on that day)
    bp_by_day: dict[str, dict] = {}
    if sb:
        try:
            res = (sb.table("blood_pressure_log")
                     .select("date, systolic, diastolic")
                     .eq("user_id", user_id)
                     .gte("date", start_d.isoformat())
                     .lte("date", end_d.isoformat())
                     .execute())
            tmp: dict[str, list[tuple[int, int]]] = {}
            for r in (res.data or []):
                d = r.get("date")
                if not d:
                    continue
                tmp.setdefault(d, []).append((int(r.get("systolic") or 0), int(r.get("diastolic") or 0)))
            for d, pairs in tmp.items():
                if pairs:
                    sys_avg = sum(p[0] for p in pairs) / len(pairs)
                    dia_avg = sum(p[1] for p in pairs) / len(pairs)
                    bp_by_day[d] = {"sys": round(sys_avg, 1), "dia": round(dia_avg, 1)}
        except Exception:
            pass

    out: dict[str, dict] = {}
    for offset in range(days):
        d = (end_d - timedelta(days=offset)).isoformat()
        row = {}
        sm = smm.get(d) or {}
        if sm.get("total"):       row["sleep_hours"] = round(sm["total"] / 3600, 2)
        if sm.get("hrv")        is not None: row["hrv"] = sm["hrv"]
        if sm.get("rhr")        is not None: row["rhr"] = sm["rhr"]
        if sm.get("breath")     is not None: row["breath"] = sm["breath"]
        if sm.get("efficiency") is not None: row["sleep_eff"] = sm["efficiency"]
        if sm.get("awake")      is not None: row["waso_min"] = round(sm["awake"] / 60, 1)
        if sm.get("spo2")       is not None: row["spo2"] = sm["spo2"]
        rd = rm.get(d) or {}
        if rd.get("score") is not None:      row["readiness"] = rd["score"]

        steps = None
        try:
            ah_day = ah.get_day(user_id, d)
            if ah_day and ah_day.get("steps") is not None:
                steps = ah_day["steps"]
        except Exception:
            pass
        if steps is None and (am.get(d) or {}).get("steps") is not None:
            steps = am[d]["steps"]
        if steps is not None: row["steps"] = int(steps)

        if d in workouts_by_day:    row["workouts"]    = workouts_by_day[d]
        if d in cardio_min_by_day:  row["cardio_min"]  = cardio_min_by_day[d]
        if d in nutrition_by_day:
            row["calories"]  = nutrition_by_day[d]["calories"]
            row["protein_g"] = nutrition_by_day[d]["protein_g"]
        if d in bp_by_day:
            row["bp_sys"] = bp_by_day[d]["sys"]
            row["bp_dia"] = bp_by_day[d]["dia"]

        out[d] = row

    return out


METRIC_LABELS: dict[str, dict] = {
    "sleep_hours": {"label": "Sleep duration",  "unit": "hrs",     "direction": "higher_better"},
    "sleep_eff":   {"label": "Sleep efficiency","unit": "%",       "direction": "higher_better"},
    "waso_min":    {"label": "Awake (WASO)",    "unit": "min",     "direction": "lower_better"},
    "hrv":         {"label": "HRV",             "unit": "ms",      "direction": "higher_better"},
    "rhr":         {"label": "Resting HR",      "unit": "bpm",     "direction": "lower_better"},
    "breath":      {"label": "Breathing rate",  "unit": "br/min",  "direction": "lower_better"},
    "spo2":        {"label": "O₂ saturation",   "unit": "%",       "direction": "higher_better"},
    "readiness":   {"label": "Readiness",       "unit": "",        "direction": "higher_better"},
    "steps":       {"label": "Steps",           "unit": "",        "direction": "higher_better"},
    "workouts":    {"label": "Workouts (n)",    "unit": "",        "direction": "neutral"},
    "cardio_min":  {"label": "Cardio minutes",  "unit": "min",     "direction": "neutral"},
    "calories":    {"label": "Calories",        "unit": "kcal",    "direction": "neutral"},
    "protein_g":   {"label": "Protein",         "unit": "g",       "direction": "neutral"},
    "bp_sys":      {"label": "BP systolic",     "unit": "mmHg",    "direction": "lower_better"},
    "bp_dia":      {"label": "BP diastolic",    "unit": "mmHg",    "direction": "lower_better"},
}


def correlate(user_id: str, days: int = 30, symptom_id: Optional[str] = None) -> dict:
    """Compute per-metric averages on symptom-positive vs symptom-negative
    days in the window. If symptom_id is provided, restrict to that
    specific symptom; otherwise treats ANY symptom day as positive.

    Returns:
      {
        symptom: "low_energy" | None,
        symptom_label: "Low energy" | "Any symptom",
        symptom_day_count: 7,
        symptom_free_day_count: 17,
        deltas: [
          {metric, label, unit, direction,
           symptom_avg, symptom_free_avg, delta, abs_delta_pct, worse_on_symptom},
          ...
        ],   // sorted by |abs_delta_pct| desc
        narrative: "..."  // Claude-generated summary; null on failure
      }
    """
    logs = list_logs(user_id, days=days)
    # Build symptom-day set
    if symptom_id:
        symptom_dates = {l["date"] for l in logs
                         if symptom_id in (l.get("symptoms") or [])}
    else:
        symptom_dates = {l["date"] for l in logs if (l.get("symptoms") or [])}

    metrics_window = _build_metrics_window(user_id, days=days)
    all_dates = set(metrics_window.keys())
    sym_dates = symptom_dates & all_dates
    free_dates = all_dates - symptom_dates

    if len(sym_dates) < 3:
        return {
            "symptom":              symptom_id,
            "symptom_label":        _symptom_label(symptom_id),
            "symptom_day_count":    len(sym_dates),
            "symptom_free_day_count": len(free_dates),
            "deltas":               [],
            "narrative":            None,
            "insufficient_data":    True,
        }

    # Compute averages per metric
    deltas: list[dict] = []
    for key, meta in METRIC_LABELS.items():
        sym_vals = [metrics_window[d][key] for d in sym_dates  if key in metrics_window[d]]
        free_vals = [metrics_window[d][key] for d in free_dates if key in metrics_window[d]]
        if len(sym_vals) < 2 or len(free_vals) < 2:
            continue
        sym_avg  = sum(sym_vals) / len(sym_vals)
        free_avg = sum(free_vals) / len(free_vals)
        delta    = sym_avg - free_avg
        denom    = max(abs(free_avg), 0.001)
        abs_delta_pct = round(abs(delta) / denom * 100, 1)
        # "worse_on_symptom" is true if the direction is bad given the metric
        if meta["direction"] == "higher_better":
            worse = delta < 0   # symptom days had LOWER values of a higher-is-better metric
        elif meta["direction"] == "lower_better":
            worse = delta > 0   # symptom days had HIGHER values of a lower-is-better metric
        else:
            worse = None
        deltas.append({
            "metric":               key,
            "label":                meta["label"],
            "unit":                 meta["unit"],
            "direction":            meta["direction"],
            "symptom_avg":          round(sym_avg, 2),
            "symptom_free_avg":     round(free_avg, 2),
            "delta":                round(delta, 2),
            "abs_delta_pct":        abs_delta_pct,
            "worse_on_symptom":     worse,
        })

    # Sort by magnitude of relative change; biggest deltas first
    deltas.sort(key=lambda r: r["abs_delta_pct"], reverse=True)

    narrative = _narrate_correlation(symptom_id, list(sym_dates), list(free_dates), deltas[:5])

    return {
        "symptom":                  symptom_id,
        "symptom_label":            _symptom_label(symptom_id),
        "symptom_day_count":        len(sym_dates),
        "symptom_free_day_count":   len(free_dates),
        "deltas":                   deltas,
        "narrative":                narrative,
        "insufficient_data":        False,
    }


def _symptom_label(symptom_id: Optional[str]) -> str:
    if not symptom_id:
        return "Any symptom"
    for s in SYMPTOM_CATALOG:
        if s["id"] == symptom_id:
            return s["label"]
    return symptom_id


def _narrate_correlation(symptom_id: Optional[str], sym_dates: list[str], free_dates: list[str], top_deltas: list[dict]) -> Optional[str]:
    """Claude Haiku narrates the top deltas into 2-3 sentences a user can
    actually act on. Best-effort — returns None if generation fails;
    the UI shows the raw deltas table instead."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or not top_deltas:
        return None
    try:
        import anthropic
    except ImportError:
        return None

    label = _symptom_label(symptom_id)
    system = """You write the 2-3 sentence narrative for a symptom-correlation
card inside BackNine. The user has logged a symptom across several days;
the data shows which of their daily metrics differed most on symptom
days vs symptom-free days.

Voice:
- Lead with the strongest correlation, with specific numbers from the
  data.
- 2-3 sentences max. Plain English.
- Pure correlation language — NEVER imply causation. Use "associated
  with" / "differed by" / "tended to be lower on" — never "caused" or
  "made you feel".
- Don't recommend medical changes. A behavior suggestion ("try going to
  bed 30 min earlier") is fine.
- End with one sentence acknowledging it's an observational pattern,
  not proof.

Output ONLY: {"narrative": "..."}  No code fences."""

    user_msg = (
        f"Symptom: {label}. {len(sym_dates)} symptom days, {len(free_dates)} symptom-free days "
        f"in the window. Top metric deltas (largest relative differences first):\n"
        + json.dumps(top_deltas, default=str)
        + "\n\nWrite the 2-3 sentence narrative now."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = (response.content[0].text if response.content else "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`").strip()
            if raw.startswith("json"):
                raw = raw[4:].strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            start = raw.find("{"); end = raw.rfind("}")
            if start != -1 and end > start:
                parsed = json.loads(raw[start:end+1])
            else:
                return None
        text = (parsed.get("narrative") or "").strip()
        return text or None
    except Exception as exc:
        log.warning("symptoms._narrate_correlation failed: %s", exc)
        return None
