"""
Coach Al's Weekly Insight.

Takes the single strongest cross-source correlation the engine found
(insights.py → get_insights, already ranked) and turns the dry statistical
finding into a warm, specific note in Coach Al's voice plus ONE concrete
experiment to run over the coming week.

Where the morning briefing is "what happened last night, what to do today",
this is "the most interesting pattern in your data this week, and an experiment
to test it." One Claude Haiku call per user per week; caching lives in the
route handler (main.py) keyed on (user_id, week_start).
"""

import json
import os
import re
from typing import Optional


def _build_system_prompt(insight: dict, profile: dict) -> str:
    name = (profile or {}).get("name") or ""
    age = (profile or {}).get("age")
    sex = (profile or {}).get("biological_sex")
    goals = (profile or {}).get("health_goals", []) or []

    parts: list[str] = []
    parts.append(
        "You are Coach Al, the personal AI health coach inside the BackNine app. "
        "You are writing this user's WEEKLY INSIGHT — a single, prominent note "
        "they read on their Scorecard. BackNine's correlation engine analyzed "
        "weeks of their data and found the pattern below (the strongest one this "
        "week). Your job is to turn that statistical finding into something warm, "
        "clear, and motivating, then give them ONE experiment to run this week.\n\n"
        "Return ONLY a JSON object with exactly these keys:\n"
        '  "headline":   a short, specific, curiosity-driving title (max ~60 chars, '
        "no period at the end). Make it about THEIR pattern, not generic.\n"
        '  "narrative":  1-2 short paragraphs, 45-90 words total, plain prose. '
        "Explain the pattern in human terms and cite the actual numbers from the "
        "finding. Encouraging, specific, never preachy.\n"
        '  "experiment": ONE concrete, testable action to try over the coming '
        "week, tied directly to the pattern, max ~35 words. Phrase it as a friendly "
        "challenge they can actually measure.\n\n"
        "RULES:\n"
        "• Address the user by first name once if you have one. Warm, not gushy.\n"
        "• Use ONLY the numbers provided below — never invent or round-trip new stats.\n"
        "• Plain prose only inside each field: no markdown, no bullet lists, no headers.\n"
        "• Do not sign off as 'Coach Al' — the UI shows the avatar.\n"
        "• If the pattern is a negative/correlational caution, frame it constructively.\n"
        "• Output the raw JSON object only — no code fences, no commentary."
    )

    parts.append("\n=== USER ===")
    if name:
        parts.append(f"First name: {name}")
    if age:
        parts.append(f"Age: {age}")
    if sex:
        parts.append(f"Biological sex: {sex}")
    if goals:
        parts.append(f"Goals: {', '.join(goals)}")

    parts.append("\n=== THE PATTERN (strongest this week) ===")
    parts.append(f"Topic: {insight.get('title')}")
    parts.append(f"Finding: {insight.get('finding')}")
    if insight.get("detail"):
        parts.append(f"Context: {insight.get('detail')}")
    parts.append(f"Direction: {insight.get('direction')}")
    parts.append(
        f"Effect size: {insight.get('magnitude')} {insight.get('unit')} "
        f"({insight.get('group_a_label')} avg {insight.get('group_a_avg')} vs "
        f"{insight.get('group_b_label')} avg {insight.get('group_b_avg')})"
    )
    _r = insight.get("r")
    if _r:
        parts.append(f"Based on {insight.get('n')} days of data (correlation r={_r}).")
    else:
        parts.append(f"Based on {insight.get('n')} days of data.")

    return "\n".join(parts)


def _parse_json(text: str) -> Optional[dict]:
    """Defensively parse the model's JSON (strip code fences / surrounding prose)."""
    if not text:
        return None
    t = text.strip()
    # Strip ```json ... ``` fences if present.
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    # Fall back to grabbing the first {...} block.
    m = re.search(r"\{.*\}", t, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def generate(insight: dict, profile: dict) -> dict:
    """Generate a Coach Al weekly insight from the strongest correlation.

    Returns {"headline": str, "narrative": str, "experiment": str}.

    Raises:
        RuntimeError: if ANTHROPIC_API_KEY is missing or anthropic isn't installed.
        ValueError:   if the model output couldn't be parsed.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed — run: pip install anthropic")

    client = anthropic.Anthropic(api_key=api_key)
    system = _build_system_prompt(insight, profile or {})

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        system=system,
        messages=[
            {
                "role": "user",
                "content": "Write this week's insight now. Output only the JSON object.",
            }
        ],
    )

    raw = response.content[0].text.strip()
    parsed = _parse_json(raw)
    if not parsed or not parsed.get("headline") or not parsed.get("narrative"):
        raise ValueError("weekly insight generation returned unparseable output")

    return {
        "headline":   str(parsed.get("headline", "")).strip(),
        "narrative":  str(parsed.get("narrative", "")).strip(),
        "experiment": str(parsed.get("experiment", "")).strip(),
    }
