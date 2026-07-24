"""
AI-generated report intros — Claude Haiku reads a structured Health Report
payload and writes the 2–4 sentence opening a clinician notices first.

One helper, six report types. Each report's endpoint calls
`narrate(report_type, payload)` after assembling the structured data, and
the result lands in the response as `ai_narrative` for the frontend to
render at the top of the tab.

Design rules baked in:
  • Observational only — never diagnose, never prescribe, never tell the
    user to stop or start a medication.
  • Numeric. Mention specific values from the payload so it's clearly
    grounded in *their* data, not generic advice.
  • Surface the most interesting thing first ("what stands out") instead
    of a polite paragraph.
  • Plain English. The user shares this with a doctor — clarity beats
    cleverness.
  • If the payload is empty/missing data, return a short honest sentence
    rather than hallucinating.

The whole module is best-effort: any failure returns None and the report
renders without the narrative section. We never let narrative generation
block the actual report data.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional


log = logging.getLogger(__name__)


# Per-report system prompts. Each one steers Claude toward the angles a
# clinician/coach for that report's audience will care about most.
_PROMPTS = {
    "sleep": """You are the AI assistant inside BackNine, writing the
short opening paragraph of a comprehensive Personal Health Report (the
'Sleep' tab — but covers BP, sleep, cardio, weight, and the user's
medication / supplement / peptide stack). The reader is the user's
primary-care physician or a similar clinician.

Write 2–4 sentences that surface what stands out in the data. Be specific
with numbers. Note any pattern worth a clinician's attention (elevated BP
average, frequent sleep fragmentation, low SpO₂, etc.). Do NOT diagnose
or recommend treatment. Do NOT tell the user to start or stop anything.
End with a single sentence framing what the doctor might want to discuss.""",

    "cardio": """You are writing the opening paragraph of a Cardiometabolic
Report — for a cardiologist or PCP focused on heart/vascular health.
Audience cares about: BP trend, RHR, HRV, weight, body fat, VO₂. Write
2–4 sentences highlighting the most clinically interesting pattern in
the payload. Be specific with numbers. Observational only — no diagnosis,
no Rx changes.""",

    "preproc": """You are writing the opening paragraph of a Pre-Procedure
Medication & Supplement Reconciliation. The reader is a surgeon or
anesthesiologist about to perform a procedure on the user. Write 2–4
sentences. If there are HIGH-priority flagged items in the payload, lead
with them by category (e.g. 'omega-3 and curcumin — both with antiplatelet
effects at the user's listed doses'). If there are no flags, say so
clearly. Always end with one sentence reinforcing the user should
coordinate any holds with the prescribing physician.""",

    "training": """You are writing the opening paragraph of a Training &
Recovery Report for a personal trainer, PT, or athletic coach. Audience
cares about: weekly volume (strength + cardio), readiness, HRV, sleep
efficiency, missed-day pattern. Write 2–4 sentences highlighting load-vs-
recovery trends or anything the coach should adjust next session. Be
specific with numbers (sessions per week, average readiness, HRV trend).
No medical interpretation.""",

    "nutrition": """You are writing the opening paragraph of a Nutrition
& Body Composition Report for a dietitian or RDN. Audience cares about:
daily calorie average vs target, protein adequacy, weight trend, body
composition (lean vs fat mass), supplement stack. Write 2–4 sentences
calling out the most actionable pattern. Specific numbers. No
prescriptive advice — let the dietitian interpret.""",

    "goal": """You are writing the opening paragraph of a Goal Progress
Report for the user's coach. Audience cares about: is the user on pace
toward their stated goal, and which supporting behaviors are pulling
their weight (or not). Write 2–4 sentences. Lead with the pace verdict
(ahead / on pace / behind / starting). Then call out which supporting
metric is helping most and which one is the weakest. Specific numbers.""",

    "annual": """You are writing the opening paragraph of an Annual
Physical Snapshot for the user's primary-care physician. Audience scans
this in 60 seconds before the visit. Write 2–4 sentences highlighting
the most important pattern across vitals (BP, RHR, HRV), body comp,
labs (if any), and stack (medications/supplements). Mention specific
numbers. If BP is elevated, flag it. If recent labs are out of range,
flag them. End with one sentence suggesting what's worth discussing.""",
}


_VOICE_RULES = """
Voice and constraints:
- The reader is a physician skimming their patient's summary before a
  visit — write the paragraph they would want to see. Concise, clinical,
  numbers-first. Not a patient-facing pep talk.
- 2 to 4 sentences. No more, no less.
- Be specific. Use real numbers from the payload.
- No diagnosis, no Rx advice, no telling the user to start/stop anything.
- Use plain English a non-specialist clinician will scan in <10 seconds.
- No bullet points, no markdown, no headings — flowing prose only.
- Don't start with 'Looking at' or 'This report' — get to the substance.
- If the payload has very little data, say so honestly in 1 sentence.

CONSISTENCY WITH THE VISIBLE REPORT — critical (Fable IMPROVE #1 note):
- The narrative sits at the TOP of a report that renders the same payload
  visually below. Doctors will read your paragraph, then scan the tables
  right after it. Contradicting the tables destroys credibility. Rules:
  1. Do NOT say "no sleep data" or "no sleep quality metrics" if the
     payload has ANY of: sleep hours, efficiency, deep, REM, or a
     sleep-fragmentation section. If those exist, describe them.
  2. Do NOT say "no BP data" if the payload's `bp` section has readings.
  3. Do NOT say "no weight data" if a weight table exists in the payload.
  4. Units in the paragraph MUST match units elsewhere in the report:
     weight in lbs (never kg), height in ft/in (never cm), steps as
     whole integers (never decimals like 10485.2), BP in mmHg. If the
     payload has a `weight_lbs` field, use lbs.
  5. If the payload's `data_availability` field says "minimal", it is OK
     to lead with "Minimal data available" — but ONLY when that field
     actually says minimal. Do not preemptively cop out.

Output ONLY a JSON object with the shape: {"text": "your paragraph here"}
No code fences, no explanation, just the JSON.
"""


def _truncate_payload(payload: Any, max_chars: int = 8000) -> str:
    """Stringify the payload, dropping deep arrays past a size cap so we
    don't blow the token budget. Trend arrays are the usual culprits."""
    try:
        s = json.dumps(payload, default=str)
    except Exception:
        return "{}"
    if len(s) <= max_chars:
        return s
    # Hard truncate with a marker; Claude will still see structure.
    return s[:max_chars] + '..."<truncated>"'


def _parse_json_safe(raw: str) -> Optional[dict]:
    """Best-effort JSON extraction. Accept either {"text":...} or a stray
    code-fenced response."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        # Strip code fence
        raw = raw.strip("`").strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except Exception:
        # Try to find the first {...} block.
        try:
            start = raw.find("{")
            end   = raw.rfind("}")
            if start != -1 and end > start:
                return json.loads(raw[start : end + 1])
        except Exception:
            return None
    return None


def narrate(report_type: str, payload: dict, profile: Optional[dict] = None) -> Optional[str]:
    """Generate the 2–4 sentence AI intro for a report.

    Returns the paragraph string, or None if generation fails (caller
    renders the report without the narrative section).
    """
    prompt = _PROMPTS.get(report_type)
    if not prompt:
        log.warning("narrate: unknown report_type %s", report_type)
        return None

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        log.warning("narrate: ANTHROPIC_API_KEY not set; skipping")
        return None

    try:
        import anthropic
    except ImportError:
        log.warning("narrate: anthropic package not available")
        return None

    # Compose the system message — per-type angle + universal voice rules.
    system = prompt + "\n\n" + _VOICE_RULES

    # Patient context lets Claude calibrate (age band, sex). Profile is
    # optional and we never include sensitive fields.
    patient_hint = ""
    if profile:
        age = profile.get("age")
        sex = profile.get("biological_sex")
        if age or sex:
            parts = []
            if age: parts.append(f"age {age}")
            if sex: parts.append(str(sex))
            patient_hint = f"Patient: {', '.join(parts)}.\n\n"

    user_msg = (
        patient_hint
        + "Report data (JSON):\n"
        + _truncate_payload(payload)
        + "\n\nWrite the opening paragraph now."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text if response.content else ""
        parsed = _parse_json_safe(raw)
        if not parsed:
            log.warning("narrate: couldn't parse response: %s", raw[:200])
            return None
        text = (parsed.get("text") or "").strip()
        if not text:
            return None
        return text
    except Exception as exc:
        log.warning("narrate: generation failed for %s: %s", report_type, exc)
        return None
