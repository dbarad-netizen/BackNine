"""
Coach Al goal-plan generator.

When a user sets a goal, Coach Al turns it into a concrete multi-week plan:
a headline, a short overview, and a focus + a few actions for each week. One
Claude Haiku call at creation; the plan is cached on the goal row.
"""

import json
import os
import re
from typing import Optional


def _build_system_prompt(metric_label: str, unit: str, baseline, target, duration_weeks: int, profile: dict) -> str:
    name = (profile or {}).get("name") or ""
    age = (profile or {}).get("age")
    sex = (profile or {}).get("biological_sex")

    base_str = "unknown (no recent data yet)" if baseline is None else f"{baseline}{unit}"
    parts: list[str] = []
    parts.append(
        "You are Coach Al, the personal AI health coach inside the BackNine app. "
        "The user just committed to a goal and you are designing their plan. Build a "
        f"realistic {duration_weeks}-week plan to move their {metric_label} from a "
        f"starting point of {base_str} toward a target of {target}{unit}.\n\n"
        "Return ONLY a JSON object with exactly these keys:\n"
        '  "headline":  a short, motivating title for the plan (max ~60 chars, no trailing period).\n'
        '  "overview":  2-3 sentences, plain prose, explaining the approach and why it works. '
        "Encouraging and specific; reference the starting point and target.\n"
        f'  "weeks":     an array of exactly {duration_weeks} objects, each '
        '{ "week": <int 1-based>, "focus": "<short focus phrase>", '
        '"actions": ["<concrete action>", "<concrete action>"] }. '
        "Each week should build on the last (progressive overload / habit stacking). "
        "Actions must be concrete and measurable (e.g. 'Two 30-min Zone 2 cardio sessions'), "
        "1-3 per week.\n\n"
        "RULES:\n"
        "• Ground the plan in evidence-based training/health practice for this metric.\n"
        "• Be realistic for the timeframe — don't promise unsafe or impossible change.\n"
        "• Address the user by first name once in the overview if you have one.\n"
        "• Plain prose inside each string: no markdown, no nested lists.\n"
        "• Output the raw JSON object only — no code fences, no commentary."
    )
    parts.append("\n=== USER ===")
    if name:
        parts.append(f"First name: {name}")
    if age:
        parts.append(f"Age: {age}")
    if sex:
        parts.append(f"Biological sex: {sex}")
    parts.append(f"\nGoal metric: {metric_label}")
    parts.append(f"Starting point: {base_str}")
    parts.append(f"Target: {target}{unit}")
    parts.append(f"Timeframe: {duration_weeks} weeks")
    return "\n".join(parts)


def _parse_json(text: str) -> Optional[dict]:
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    m = re.search(r"\{.*\}", t, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def generate_plan(metric_label: str, unit: str, baseline, target, duration_weeks: int, profile: dict) -> dict:
    """Return {headline, overview, weeks:[{week,focus,actions}]}.

    Falls back to a simple generic plan if Claude is unavailable or unparseable,
    so creating a goal never hard-fails.
    """
    fallback = {
        "headline": f"Your {duration_weeks}-week {metric_label} plan",
        "overview": (
            f"We'll work toward {target}{unit} over {duration_weeks} weeks with small, "
            "consistent steps. Check in here each week and log your data so we can track progress."
        ),
        "weeks": [
            {"week": i + 1, "focus": "Build the habit", "actions": ["Stay consistent and log your data daily."]}
            for i in range(duration_weeks)
        ],
    }

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return fallback
    try:
        import anthropic
    except ImportError:
        return fallback

    try:
        client = anthropic.Anthropic(api_key=api_key)
        system = _build_system_prompt(metric_label, unit, baseline, target, duration_weeks, profile or {})
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            system=system,
            messages=[{"role": "user", "content": "Create the plan now. Output only the JSON object."}],
        )
        parsed = _parse_json(resp.content[0].text.strip())
        if not parsed or not parsed.get("weeks"):
            return fallback
        # Normalize
        weeks = []
        for i, w in enumerate(parsed.get("weeks", [])[:duration_weeks]):
            weeks.append({
                "week":    int(w.get("week", i + 1)),
                "focus":   str(w.get("focus", "")).strip() or "Stay consistent",
                "actions": [str(a).strip() for a in (w.get("actions") or []) if str(a).strip()][:3],
            })
        if not weeks:
            return fallback
        return {
            "headline":  str(parsed.get("headline", fallback["headline"])).strip(),
            "overview":  str(parsed.get("overview", fallback["overview"])).strip(),
            "weeks":     weeks,
        }
    except Exception:
        return fallback
