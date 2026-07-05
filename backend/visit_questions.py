"""
Visit question drafts — Claude generates 3-7 questions the user should
ask their doctor, each grounded in the user's actual data.

Guardrails (per PRD "no medical advice generation"):
  • The model drafts QUESTIONS, never answers or instructions.
  • Never prescribes, dose-adjusts, or diagnoses.
  • Every question cites the specific data that motivated it.
  • Refuses to include questions the data doesn't support.

Input assembled here (safe subset of the user's data):
  • Clinical escalation flags (already thresholded)
  • Recent lab values that are out-of-range
  • BP averages, especially evening split
  • Symptom logs in the visit window
  • Active medication list (names only, not dose changes)
  • Provider type (steers the model toward the right specialty angle)

Output shape:
  [
    { "id": str, "text": str, "source_data": str, "provider_scope": str },
    ...
  ]

Failure mode: if the API is unavailable, we return a deterministic
fallback set built purely from the escalation flags — so a visit is
never left with zero questions on the packet.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import date as _date, timedelta
from typing import Optional


log = logging.getLogger(__name__)


_MAX_QUESTIONS = 7
_MIN_QUESTIONS = 3


_SYSTEM_PROMPT = """You draft QUESTIONS that a patient should ask their
own physician during an upcoming visit. You are not a physician. You
never diagnose, never recommend medication changes, never tell the
patient what to do — you help them ask the right questions.

Hard rules:
  1. Every output must be a question. If a line does not end in a
     question mark, drop it.
  2. Every question cites the specific data point that motivated it
     (BP average, lab value, symptom pattern, etc.) — verbatim from
     the "SOURCE DATA" section below. No inventing numbers.
  3. Never phrase a question as a diagnosis or a suggested treatment.
       BAD:  "Should I switch losartan to lisinopril?"
       GOOD: "Given my evening BP average of 155/98 over 17 readings,
              what should I do differently between doses?"
       BAD:  "Am I in stage 2 hypertension?"
       GOOD: "My 30-day BP average has been 151/95. What treatment
              adjustments would you consider?"
  4. Provider-scope aware: for a cardiology visit, cardiovascular
     questions come first. For urology, PSA / prostate. For a routine
     PCP visit, use the priority ordering below.
  5. 3 to 7 questions. Not more. Not fewer unless the data genuinely
     lacks enough signal to draft one — in which case output fewer.

Priority ordering (highest-value first):
  • Clinical escalation flags (BP over guideline, elevated RHR pattern)
  • Out-of-range labs
  • Persistent symptoms without a clear pattern
  • Preventive screening due (mention only, never schedule)
  • Medication timing / side effects the user has logged

Output ONLY a strict JSON object with this shape (no code fence, no prose):
{
  "questions": [
    {
      "text":            "The question, ending in a question mark.",
      "source_data":     "Short citation of the value that motivated it.",
      "provider_scope":  "primary_care | cardiology | urology | endocrinology | dermatology | general"
    }
  ]
}
"""


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Data assembly (safe subset) ─────────────────────────────────────────

def _bp_summary(user_id: str, days: int = 30) -> dict:
    try:
        import bp as _bp
        rows = _bp.list_readings(user_id, days=days) or []
        if not rows:
            return {}
        sys_all = [float(r["systolic"])  for r in rows if r.get("systolic")]
        dia_all = [float(r["diastolic"]) for r in rows if r.get("diastolic")]
        def _mean(xs):
            return round(sum(xs) / len(xs)) if xs else None

        # Evening split (>= 17:00 local, best-effort)
        def _is_evening(r):
            t = r.get("taken_at") or r.get("time") or ""
            if isinstance(t, str) and "T" in t:
                try:    return int(t.split("T")[1][:2]) >= 17
                except Exception: return False
            if isinstance(t, str) and ":" in t:
                try:    return int(t.split(":")[0]) >= 17
                except Exception: return False
            return False
        eve = [r for r in rows if _is_evening(r)]
        eve_sys = [float(r["systolic"])  for r in eve if r.get("systolic")]
        eve_dia = [float(r["diastolic"]) for r in eve if r.get("diastolic")]
        return {
            "n_readings":         len(rows),
            "systolic_avg":       _mean(sys_all),
            "diastolic_avg":      _mean(dia_all),
            "evening_systolic":   _mean(eve_sys),
            "evening_diastolic":  _mean(eve_dia),
            "window_days":        days,
        }
    except Exception:
        return {}


def _labs_out_of_range(user_id: str) -> list[dict]:
    """Latest value per marker with an out_of_range status."""
    try:
        import labs as _labs
        entries = _labs.get_entries(user_id) or []
        entries = sorted(entries, key=lambda e: e.get("date") or "", reverse=True)
        seen: set[str] = set()
        out: list[dict] = []
        for e in entries:
            for key, ref in _labs.REFERENCE_RANGES.items():
                if key in seen:
                    continue
                val = e.get(key)
                if val is None:
                    continue
                try:
                    fval = float(val)
                except (TypeError, ValueError):
                    continue
                low, high = ref.get("low"), ref.get("high")
                if low is None or high is None:
                    continue
                if low <= fval <= high:
                    seen.add(key)
                    continue
                out.append({
                    "marker":  ref.get("label", key),
                    "value":   fval,
                    "unit":    ref.get("unit", ""),
                    "date":    e.get("date"),
                    "range":   f"{low}-{high}",
                })
                seen.add(key)
        return out[:8]
    except Exception:
        return []


def _recent_symptoms(user_id: str, days: int = 30) -> list[dict]:
    sb = _sb()
    if not sb:
        return []
    try:
        cutoff = (_date.today() - timedelta(days=days)).isoformat()
        res = (sb.table("symptom_logs")
                 .select("date, symptoms, severity, notes")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .order("date", desc=True)
                 .limit(30).execute())
        rows = res.data or []
        # Drop empties (same rendering fix as Handoff)
        cleaned = []
        for r in rows:
            syms = r.get("symptoms") or []
            if not isinstance(syms, list) or not any(
                (isinstance(s, str) and s.strip()) for s in syms
            ):
                continue
            cleaned.append(r)
        return cleaned[:15]
    except Exception:
        return []


def _med_names(profile: dict) -> list[str]:
    try:
        from name_normalize import normalize_name
    except Exception:
        normalize_name = lambda s: s  # noqa: E731
    meds = profile.get("medications") or []
    out: list[str] = []
    for m in meds:
        if isinstance(m, dict):
            nm = normalize_name((m.get("name") or "").strip())
            if nm:
                out.append(nm)
        elif isinstance(m, str):
            nm = normalize_name(m.strip())
            if nm:
                out.append(nm)
    return out[:15]


def _escalation_flags(user_id: str, profile: dict) -> list[dict]:
    try:
        import clinical_escalation as _esc
        return _esc.assess(user_id, profile) or []
    except Exception:
        return []


# ── Fallback (no LLM) ───────────────────────────────────────────────────

def _fallback_questions(flags: list[dict], provider_type: str) -> list[dict]:
    """Deterministic Q's built from escalation flags alone. Ensures every
    visit gets at least a few high-value questions even if the LLM call
    fails or the API key is missing."""
    out: list[dict] = []
    for f in flags:
        title = (f.get("title") or "").strip()
        msg   = (f.get("message") or "").strip()
        if f.get("domain") == "bp":
            out.append({
                "text":          f"My BP has been running at these numbers ({title.lower()}). What changes would you consider?",
                "source_data":   title,
                "provider_scope": "primary_care",
            })
        elif f.get("domain") == "cardio":
            out.append({
                "text":          f"{title} — is that worth investigating, or is it likely training/stress-related?",
                "source_data":   title,
                "provider_scope": "primary_care",
            })
    if not out:
        out.append({
            "text":          "What labs or vitals would you like me to track between now and my next visit?",
            "source_data":   "General preventive question.",
            "provider_scope": provider_type or "primary_care",
        })
    return out


# ── LLM ─────────────────────────────────────────────────────────────────

def _call_claude(prompt_body: str) -> Optional[list[dict]]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    try:
        client   = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt_body}],
        )
        raw = response.content[0].text if response.content else ""
    except Exception as exc:
        log.warning("visit_questions: LLM call failed: %s", exc)
        return None
    # Parse
    s = raw.strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.startswith("json"):
            s = s[4:].strip()
    try:
        parsed = json.loads(s)
    except Exception:
        try:
            i = s.find("{"); j = s.rfind("}")
            if i != -1 and j > i:
                parsed = json.loads(s[i : j + 1])
            else:
                return None
        except Exception:
            return None
    qs = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(qs, list):
        return None
    # Guardrail: drop items that aren't questions or that lack a source.
    cleaned: list[dict] = []
    for q in qs:
        if not isinstance(q, dict):
            continue
        text = (q.get("text") or "").strip()
        src  = (q.get("source_data") or "").strip()
        scope = (q.get("provider_scope") or "general").strip()
        if not text or not src:
            continue
        if not text.rstrip().endswith("?"):
            continue
        cleaned.append({
            "text":           text[:300],
            "source_data":    src[:200],
            "provider_scope": scope[:40],
        })
        if len(cleaned) >= _MAX_QUESTIONS:
            break
    return cleaned


# ── Public API ──────────────────────────────────────────────────────────

def generate(user_id: str, profile: dict, provider_type: str = "primary_care",
             visit_reason: Optional[str] = None) -> list[dict]:
    """Generate the draft question list. Best-effort — returns fallback
    on any failure. Always returns at least 1 question so the packet
    never renders empty."""
    profile  = profile or {}
    flags    = _escalation_flags(user_id, profile)
    bp       = _bp_summary(user_id)
    labs_oor = _labs_out_of_range(user_id)
    symptoms = _recent_symptoms(user_id)
    meds     = _med_names(profile)

    # Build the LLM input. Trim liberally — the model doesn't need
    # more than headline metrics + a curated symptom count.
    src = {
        "provider_type":       provider_type,
        "visit_reason":        (visit_reason or "").strip() or None,
        "clinical_escalation": [{"title": f["title"], "domain": f["domain"],
                                 "severity": f["severity"]} for f in flags],
        "bp":                  bp,
        "labs_out_of_range":   labs_oor,
        "symptoms":            [{"date": s.get("date"),
                                 "symptoms": s.get("symptoms"),
                                 "severity": s.get("severity")}
                                for s in symptoms],
        "medications":         meds,
    }
    body = "SOURCE DATA (JSON):\n" + json.dumps(src, default=str)[:8000]
    llm_out = _call_claude(body)
    if llm_out and len(llm_out) >= _MIN_QUESTIONS:
        return _stamp_ids(llm_out)
    # Fallback: escalation-derived Q's.
    fb = _fallback_questions(flags, provider_type)
    return _stamp_ids(fb)


def _stamp_ids(qs: list[dict]) -> list[dict]:
    """Stable per-question id so the frontend can edit/delete/reorder
    without re-fetching from the model."""
    for q in qs:
        q.setdefault("id", str(uuid.uuid4())[:8])
        q.setdefault("user_edited", False)
    return qs


__all__ = ["generate"]
