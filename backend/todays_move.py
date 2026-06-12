"""
Coach Al's Today's Move — a single concrete next action.

Where briefing.py writes a 2-paragraph synthesis to read, this module produces
ONE action: an emoji, a short imperative title, a context line, and a CTA that
lets the user take that action with one tap. The dashboard renders this above
the briefing as the answer to "what should I actually do right now?"

Output is structured JSON so the frontend can wire the CTA to the right
component (meal logger, workout logger, chat, etc.) without parsing prose.
"""

import json
import os
import re
from typing import Optional


# CTA kinds the frontend knows how to handle. Keep the list narrow so Coach Al
# can't invent novel actions the UI doesn't support.
VALID_CTA_KINDS = {
    "chat",            # opens Coach Al chat (optionally seeded)
    "meal",            # opens the meal logger
    "workout",         # opens the workout logger
    "weight",          # opens the weigh-in form
    "walk",            # just a nudge — no special UI, button reads "Got it"
    "nav_nutrition",   # navigates to the Nutrition tab
    "nav_training",    # navigates to the Training tab
    "nav_clubhouse",   # navigates to Clubhouse
    "none",            # informational only, no button
}


def _build_system_prompt(
    health_context: dict,
    profile: dict,
    yesterday_mood: Optional[str] = None,
) -> str:
    """System prompt for the Today's Move generator.

    Tuned to return STRICT JSON in a single object with no surrounding prose.
    Keeps Haiku's output narrow: pick one action, justify it briefly, send the
    user somewhere they can act on it.
    """
    parts: list[str] = []

    parts.append(
        "You are Coach Al, the user's personal AI health coach inside BackNine. "
        "Your job RIGHT NOW is to recommend ONE concrete action the user can take "
        "in the next few hours that will move them toward their health goals. "
        "Not advice. Not analysis. ONE action.\n\n"
        "OUTPUT FORMAT — STRICT JSON, ONE OBJECT, NO MARKDOWN OR PROSE AROUND IT:\n"
        "{\n"
        '  "emoji":     "<1 emoji>",                       \n'
        '  "title":     "<imperative, ≤8 words>",          \n'
        '  "detail":    "<one short sentence of context, ≤18 words>",\n'
        '  "cta_label": "<button text, ≤3 words>",         \n'
        '  "cta_kind":  "<one of: chat | meal | workout | weight | walk | nav_nutrition | nav_training | nav_clubhouse | none>",\n'
        '  "cta_seed":  "<optional chat seed if cta_kind is chat, else empty>"\n'
        "}\n\n"
        "TITLE STYLE:\n"
        "• Use an imperative verb. 'Walk 4,200 steps' not 'You could walk'.\n"
        "• Include a specific number when possible: pulled from the data below.\n"
        "• Don't hedge. 'Get 30g protein at lunch' beats 'Try to get some protein'.\n\n"
        "DETAIL STYLE:\n"
        "• ONE sentence explaining WHY this is today's move.\n"
        "• Tie to actual numbers from the data — never invent.\n\n"
        "ARITHMETIC RULES — READ CAREFULLY:\n"
        "• DO NOT perform any subtraction, addition, or other arithmetic yourself.\n"
        "• The data below already includes pre-computed REMAINING / GAP values "
        "where relevant. Cite those values directly.\n"
        "• If you cite a number, it MUST appear verbatim in the data below — "
        "either as a raw value or as a pre-computed remaining/gap value.\n"
        "• If a calorie/protein/etc. line says 'REMAINING TO HIT TARGET: 1440 kcal', "
        "your recommendation must say 1440, not 800 and not 2000.\n"
        "• If a line says 'OVER by 200g', do NOT recommend MORE of that thing.\n\n"
        "CTA SELECTION:\n"
        "• If the action is 'log a meal' or 'eat X' → cta_kind = 'meal'\n"
        "• If 'log a workout' or 'do X workout' → cta_kind = 'workout'\n"
        "• If 'weigh in' or 'check body comp' → cta_kind = 'weight'\n"
        "• If 'walk N steps' or 'get outside' → cta_kind = 'walk'\n"
        "• If user should reflect / journal / ask the coach → cta_kind = 'chat', cta_seed = first message\n"
        "• Otherwise → 'none'\n"
        "• cta_label: a verb. 'Log it', 'Open logger', 'Got it', 'Ask Coach Al'.\n\n"
        "PRIORITIZE in this order (most important on top):\n"
        "1. Active goal pace — if behind, today's move should help close the gap.\n"
        "2. Today's incomplete habits — no checkin yet, no meal logged, no steps recorded.\n"
        "3. A protein/calorie shortfall relative to user's targets.\n"
        "4. A recovery cue — if sleep was short or HRV crashed, recommend rest, not strain.\n"
        "5. A streak / consistency hook — keep them engaged.\n\n"
        "Never recommend something the user has already done today. Never invent metrics."
    )

    # User identity
    name = (profile or {}).get("name") or "the user"
    parts.append(f"\n=== USER ===\n  • Name: {name}")
    age = (profile or {}).get("age")
    if age:
        parts.append(f"  • Age: {age}")
    sex = (profile or {}).get("biological_sex")
    if sex:
        parts.append(f"  • Sex: {sex}")

    # Yesterday's check-in (mood)
    if yesterday_mood:
        parts.append(f"\n=== YESTERDAY ===\n  • Mood: {yesterday_mood}")

    # Today's data — sleep, scores, steps, etc.
    today = health_context.get("today") or {}
    if today:
        parts.append("\n=== TODAY'S DATA ===")
        for k in ("sleep_score", "readiness_score", "activity_score",
                  "sleep_hours", "hrv", "rhr", "steps", "active_calories"):
            v = today.get(k)
            if v is not None:
                parts.append(f"  • {k}: {v}")

    # Active goal — the north star
    goal = health_context.get("active_goal") or {}
    if goal:
        pace = goal.get("pace") or {}
        parts.append("\n=== ACTIVE GOAL ===")
        parts.append(f"  • Metric: {goal.get('label')} (unit: {goal.get('unit') or '—'})")
        parts.append(f"  • Now: {goal.get('current')} → target: {goal.get('target')}")
        if pace.get("label"):
            parts.append(f"  • Pace: {pace.get('label')}")
        if pace.get("delta_pct") is not None:
            parts.append(f"  • Pace delta: {pace.get('delta_pct'):+d}% vs expected")
        focus = (goal.get("this_week") or {}).get("focus")
        if focus:
            parts.append(f"  • This week's focus: {focus}")

    # Nutrition state.
    #
    # IMPORTANT: pre-compute the gaps server-side and feed them directly to
    # Haiku. The previous prompt sent raw "560 / 2000" pairs and asked the
    # model to subtract — Haiku confidently produced wrong arithmetic
    # ("eat 800 to hit 2000" when 560 was already in). Treat the LLM like
    # the prose layer, not the math layer.
    nutrition = health_context.get("nutrition") or {}
    if nutrition:
        c = nutrition.get("consumed") or {}
        t = nutrition.get("targets") or {}
        parts.append("\n=== NUTRITION TODAY ===")
        parts.append(f"  • Meals logged: {nutrition.get('meals_logged', 0)}")
        if c or t:
            def _gap_line(label: str, consumed_key: str, target_key: str, unit: str) -> str:
                cur = c.get(consumed_key) or 0
                tgt = t.get(target_key)
                if tgt is None:
                    return f"  • {label}: {cur}{unit} consumed (no target set)"
                gap = round(float(tgt) - float(cur))
                if gap <= 0:
                    over = abs(gap)
                    return (
                        f"  • {label}: {cur}{unit} consumed of {tgt}{unit} target — "
                        f"{'AT TARGET' if over == 0 else f'OVER by {over}{unit}'}"
                    )
                return (
                    f"  • {label}: {cur}{unit} consumed of {tgt}{unit} target — "
                    f"REMAINING TO HIT TARGET: {gap}{unit}"
                )

            parts.append(_gap_line("Calories", "calories", "calories", " kcal"))
            parts.append(_gap_line("Protein",  "protein",  "protein",  "g"))
            parts.append(_gap_line("Carbs",    "carbs",    "carbs",    "g"))
            parts.append(_gap_line("Fat",      "fat",      "fat",      "g"))
            parts.append(
                "  (Use the REMAINING value directly — do NOT subtract yourself, "
                "do NOT recompute. If recommending more food, cite the REMAINING "
                "value exactly. If OVER, acknowledge it and don't recommend more.)"
            )

    # Body composition (latest weigh-in)
    body = health_context.get("body") or {}
    if body and body.get("weight_lbs") is not None:
        parts.append("\n=== BODY (LATEST) ===")
        parts.append(f"  • Weight: {body.get('weight_lbs')} lbs")
        if body.get("body_fat_pct") is not None:
            parts.append(f"  • Body fat: {body.get('body_fat_pct')}%")

    # Supplements
    supps = (profile or {}).get("supplements") or []
    if supps:
        names = ", ".join(s.get("name", "") for s in supps[:5] if s.get("name"))
        if names:
            parts.append(f"\n=== STACK ===\n  • Supplements: {names}")

    return "\n".join(parts)


def generate_todays_move(
    health_context: dict,
    profile: dict,
    yesterday_mood: Optional[str] = None,
) -> dict:
    """Generate Today's Move. Returns a dict with the shape described in the
    system prompt. Raises RuntimeError if the LLM call can't be made or the
    output can't be parsed as JSON — caller should fall back to a default.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed")

    client = anthropic.Anthropic(api_key=api_key)
    system = _build_system_prompt(health_context, profile, yesterday_mood)

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=system,
        messages=[{
            "role": "user",
            "content": "Output the JSON object now. No other text.",
        }],
    )
    raw = (response.content[0].text or "").strip()

    # Tolerant parse — sometimes Haiku wraps in ```json fences.
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"todays_move parse failed: {e}; raw={raw[:200]}")

    # Validate + clean — keep the surface area narrow.
    out: dict = {
        "emoji":     str(data.get("emoji", "💡"))[:4] or "💡",
        "title":     str(data.get("title", "")).strip()[:80],
        "detail":    str(data.get("detail", "")).strip()[:200],
        "cta_label": str(data.get("cta_label", "Got it")).strip()[:24] or "Got it",
        "cta_kind":  str(data.get("cta_kind", "none")).strip(),
        "cta_seed":  str(data.get("cta_seed", "")).strip()[:300],
    }
    if out["cta_kind"] not in VALID_CTA_KINDS:
        out["cta_kind"] = "none"
    if not out["title"]:
        raise RuntimeError("todays_move missing title")
    return out


def default_move() -> dict:
    """Sane fallback when Haiku is unreachable or output is malformed."""
    return {
        "emoji":     "👋",
        "title":     "Check in for today",
        "detail":    "Log your mood, then walk through the briefing.",
        "cta_label": "Open chat",
        "cta_kind":  "chat",
        "cta_seed":  "Help me figure out my best move for today.",
    }
