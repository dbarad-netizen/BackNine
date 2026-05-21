"""
AI workout parsing for BackNine — turns a free-text description of a strength
workout into structured exercises + sets the user confirms.

"bench 3x8 @135, squats 5x5 @225, 20 min run" →
  exercises: [{name:"bench press", sets:[{weight_lbs:135,reps:8} x3]},
              {name:"squat", sets:[{weight_lbs:225,reps:5} x5]}],
  notes: "20 min run"

Uses the same Claude Haiku model the rest of the app uses.
"""

import json
import os
import re

MODEL = "claude-haiku-4-5-20251001"

_SYSTEM = (
    "You parse a free-text description of a workout into structured data. Respond with "
    "ONLY a JSON object (no prose, no code fences) of the form: "
    '{"type":"lifting","exercises":[{"name":string,"sets":[{"weight_lbs":number,"reps":number}]}],'
    '"duration_min":number|null,"notes":string}. Rules: '
    "Expand shorthand like '3x8 @135' into 3 sets of {weight_lbs:135, reps:8}. "
    "'4x10' with no weight (bodyweight) → 4 sets of {weight_lbs:0, reps:10}. "
    "If reps differ per set and are listed, reflect each; otherwise repeat the same set. "
    "Treat weights as pounds. Keep exercise names short and lowercase (e.g. 'bench press', 'romanian deadlift'). "
    "Anything that isn't sets-by-reps strength work (e.g. '20 min run', 'stretching', a walk) goes into "
    "\"notes\" as a short phrase — do NOT invent sets for it. "
    "duration_min = total session minutes if stated, else null. "
    "Always set type to 'lifting'. Return {\"type\":\"lifting\",\"exercises\":[],\"duration_min\":null,\"notes\":\"\"} "
    "if you can't parse any exercises."
)


def _client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.Anthropic(api_key=api_key)


def _parse(text: str) -> dict:
    empty = {"type": "lifting", "exercises": [], "duration_min": None, "notes": ""}
    if not text:
        return empty
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    data = None
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                data = None
    if not isinstance(data, dict):
        return empty

    exercises = []
    for ex in (data.get("exercises") or [])[:25]:
        if not isinstance(ex, dict):
            continue
        name = str(ex.get("name", "")).strip()[:80]
        if not name:
            continue
        sets = []
        for s in (ex.get("sets") or [])[:20]:
            if not isinstance(s, dict):
                continue
            try:
                sets.append({
                    "weight_lbs": max(0, round(float(s.get("weight_lbs") or 0), 1)),
                    "reps":       max(0, int(float(s.get("reps") or 0))),
                })
            except (TypeError, ValueError):
                continue
        if not sets:
            sets = [{"weight_lbs": 0, "reps": 0}]
        exercises.append({"name": name, "sets": sets})

    dur = data.get("duration_min")
    try:
        dur = int(dur) if dur is not None else None
    except (TypeError, ValueError):
        dur = None

    return {
        "type":         "lifting",
        "exercises":    exercises,
        "duration_min": dur,
        "notes":        str(data.get("notes") or "").strip()[:300],
    }


def parse_workout(text: str) -> dict:
    client = _client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=900,
        system=_SYSTEM,
        messages=[{"role": "user", "content": f"Workout: {text}\n\nReturn the JSON object."}],
    )
    return _parse(resp.content[0].text)
