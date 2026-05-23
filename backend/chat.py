"""
AI health coach chat for BackNine.

Builds a rich system prompt from the user's live health data and
calls Claude to answer questions about it.
"""

import os
from typing import Optional


def _format_metric(label: str, value: str, unit: str = "") -> str:
    """Format a single metric line."""
    if unit:
        return f"  • {label}: {value} {unit}"
    return f"  • {label}: {value}"


def _build_system_prompt(health_context: dict, profile: dict) -> str:
    """
    Build the system prompt with all available health data as context.

    Args:
        health_context: Dict with optional keys:
            - today (dict): today's readiness_score, sleep_score, hrv, rhr, activity_score, steps, sleep_hours
            - seven_day (dict): hrv_direction (str), hrv_avg, sleep_avg, readiness_avg
            - nutrition (dict): consumed {calories,protein,carbs,fat}, targets {...}, meals_logged
            - body (dict): logged weigh-in — weight_lbs, muscle_mass_lbs, lean_mass_lbs, change_since_prev_lbs
            - longevity_score (dict): score, grade, components, biological_age_delta
            - coaching (dict): short_term, mid_term, long_term (each a string)
        profile: Dict with keys:
            - name (str, optional)
            - age (int, optional)
            - biological_sex (str, optional: "male" or "female")
            - health_goals (list of str, optional)

    Returns:
        str: The system prompt for Claude.
    """
    prompt_parts = []

    # Introduction
    prompt_parts.append(
        "You are Coach Al, the personal AI health coach inside the BackNine app. "
        "You have a warm, direct, and motivating coaching voice — like a knowledgeable friend who happens to have "
        "deep expertise in longevity, recovery, and performance. You speak plainly, never use jargon unless you "
        "explain it, and you always ground advice in the user's real numbers rather than generic tips. "
        "You have access to the user's live health data from their wearable devices and activity trackers. "
        "Your role is to translate those metrics into clear, actionable, and personalized guidance.\n\n"
        "Personality traits:\n"
        "• Direct but encouraging — tell people what they need to hear, not just what they want to hear.\n"
        "• Data-driven — cite the user's actual numbers whenever relevant.\n"
        "• Concise by default — 2–4 sentences unless a thorough answer is genuinely needed.\n"
        "• Occasionally use a light coaching analogy or metaphor to make complex concepts click.\n"
        "• Sign off naturally — no need to repeat 'Coach Al' in every message."
    )

    # User Profile
    prompt_parts.append("\n=== USER PROFILE ===")
    name = profile.get("name", "User")
    age = profile.get("age")
    sex = profile.get("biological_sex")
    goals = profile.get("health_goals", [])

    prompt_parts.append(f"Name: {name}")
    if age:
        prompt_parts.append(f"Age: {age}")
    if sex:
        prompt_parts.append(f"Biological Sex: {sex}")
    if goals:
        prompt_parts.append(f"Health Goals: {', '.join(goals)}")

    # TODAY'S METRICS
    today = health_context.get("today", {})
    if today:
        prompt_parts.append("\n=== TODAY'S METRICS ===")

        readiness = today.get("readiness_score")
        if readiness is not None:
            prompt_parts.append(f"  • Readiness Score: {readiness}/100")

        sleep_score = today.get("sleep_score")
        if sleep_score is not None:
            prompt_parts.append(f"  • Sleep Score: {sleep_score}/100")

        hrv = today.get("hrv")
        if hrv is not None:
            prompt_parts.append(f"  • HRV (Heart Rate Variability): {hrv} ms")

        rhr = today.get("rhr")
        if rhr is not None:
            prompt_parts.append(f"  • Resting Heart Rate: {rhr} bpm")

        activity = today.get("activity_score")
        if activity is not None:
            prompt_parts.append(f"  • Activity Score: {activity}/100")

        steps = today.get("steps")
        if steps is not None:
            prompt_parts.append(f"  • Steps: {int(steps):,}")

        sleep_hours = today.get("sleep_hours")
        if sleep_hours is not None:
            prompt_parts.append(f"  • Sleep Duration: {sleep_hours:.1f} hours")

        body_fat = today.get("body_fat_percentage")
        if body_fat is not None:
            prompt_parts.append(f"  • Body Fat: {body_fat}%")

    # 7-DAY TRENDS
    seven_day = health_context.get("seven_day", {})
    if seven_day:
        prompt_parts.append("\n=== 7-DAY AVERAGES & TRENDS ===")

        hrv_avg = seven_day.get("hrv_avg")
        hrv_dir = seven_day.get("hrv_direction", "stable")
        if hrv_avg is not None:
            prompt_parts.append(f"  • HRV Avg: {hrv_avg} ms ({hrv_dir})")

        sleep_avg = seven_day.get("sleep_avg")
        if sleep_avg is not None:
            prompt_parts.append(f"  • Sleep Avg: {sleep_avg:.1f} hours")

        readiness_avg = seven_day.get("readiness_avg")
        if readiness_avg is not None:
            prompt_parts.append(f"  • Readiness Avg: {readiness_avg}/100")

    # TODAY'S NUTRITION (macros the user logged vs. their targets)
    nutrition = health_context.get("nutrition")
    if nutrition and nutrition.get("meals_logged"):
        c = nutrition.get("consumed", {})
        t = nutrition.get("targets", {})
        prompt_parts.append("\n=== TODAY'S NUTRITION (logged so far) ===")

        cal, cal_t = c.get("calories"), t.get("calories")
        if cal is not None:
            if cal_t:
                rem = round(cal_t - cal)
                prompt_parts.append(f"  • Calories: {cal} / {cal_t} target ({abs(rem)} {'remaining' if rem >= 0 else 'over'})")
            else:
                prompt_parts.append(f"  • Calories: {cal}")

        for label, key in (("Protein", "protein"), ("Carbs", "carbs"), ("Fat", "fat")):
            v, v_t = c.get(key), t.get(key)
            if v is None:
                continue
            if v_t:
                rem = round(v_t - v)
                prompt_parts.append(f"  • {label}: {v}g / {v_t}g target ({abs(rem)}g {'left' if rem >= 0 else 'over'})")
            else:
                prompt_parts.append(f"  • {label}: {v}g")

        prompt_parts.append(f"  • Meals logged today: {nutrition.get('meals_logged')}")
    elif nutrition:
        t = nutrition.get("targets", {})
        if any(t.get(k) for k in ("calories", "protein", "carbs", "fat")):
            prompt_parts.append("\n=== TODAY'S NUTRITION ===")
            prompt_parts.append("  • No meals logged yet today.")
            prompt_parts.append(
                f"  • Daily targets: {t.get('calories')} cal, {t.get('protein')}g protein, "
                f"{t.get('carbs')}g carbs, {t.get('fat')}g fat."
            )

    # BODY COMPOSITION (the user's own logged weigh-ins — weight, muscle, lean)
    body = health_context.get("body")
    if body and (body.get("weight_lbs") is not None or body.get("muscle_mass_lbs") is not None):
        prompt_parts.append("\n=== BODY COMPOSITION (from the user's logged weigh-ins) ===")
        w = body.get("weight_lbs")
        if w is not None:
            line = f"  • Weight: {w} lbs"
            if body.get("date"):
                line += f" (as of {body['date']})"
            prompt_parts.append(line)
        if body.get("muscle_mass_lbs") is not None:
            prompt_parts.append(f"  • Muscle Mass: {body['muscle_mass_lbs']} lbs")
        if body.get("lean_mass_lbs") is not None:
            prompt_parts.append(f"  • Lean Mass: {body['lean_mass_lbs']} lbs")
        chg = body.get("change_since_prev_lbs")
        if chg is not None:
            direction = "down" if chg < 0 else "up" if chg > 0 else "unchanged"
            prompt_parts.append(
                f"  • Change since previous weigh-in: {direction} {abs(chg)} lbs"
                + (f" (vs {body['prev_date']})" if body.get("prev_date") else "")
            )

    # LONGEVITY SCORE
    longevity = health_context.get("longevity_score", {})
    if longevity and longevity.get("score") is not None:
        prompt_parts.append("\n=== LONGEVITY SCORE ===")
        score = longevity.get("score")
        grade = longevity.get("grade")
        prompt_parts.append(f"  • Score: {score}/100 ({grade})")

        bio_delta = longevity.get("biological_age_delta")
        if bio_delta is not None:
            age_desc = "younger" if bio_delta < 0 else "older"
            prompt_parts.append(f"  • Biological Age Delta: {abs(bio_delta)} years {age_desc} than chronological age")

        # Component breakdown
        components = longevity.get("components", {})
        if components:
            prompt_parts.append("  • Component Breakdown:")
            for key, comp in components.items():
                label = comp.get("label")
                value = comp.get("value")
                points = comp.get("points")
                max_pts = comp.get("max")
                prompt_parts.append(f"    - {label}: {value} ({points}/{max_pts} pts)")

    # ACTIVE COACHING
    coaching = health_context.get("coaching", {})
    if coaching:
        prompt_parts.append("\n=== ACTIVE COACHING ===")

        short_term = coaching.get("short_term")
        if short_term:
            prompt_parts.append(f"Short-term Focus:\n  {short_term}")

        mid_term = coaching.get("mid_term")
        if mid_term:
            prompt_parts.append(f"Mid-term Focus:\n  {mid_term}")

        long_term = coaching.get("long_term")
        if long_term:
            prompt_parts.append(f"Long-term Focus:\n  {long_term}")

    # ACTIVE GOAL (the program Coach Al is guiding them through)
    goal = health_context.get("active_goal")
    if goal:
        unit = goal.get("unit") or ""
        prompt_parts.append("\n=== ACTIVE GOAL (the program you're coaching them through) ===")
        prompt_parts.append(f"  • Goal: {goal.get('label')} → target {goal.get('target')}{unit}")
        if goal.get("baseline") is not None:
            prompt_parts.append(f"  • Started at: {goal.get('baseline')}{unit}")
        if goal.get("current") is not None:
            prompt_parts.append(f"  • Currently: {goal.get('current')}{unit}")
        if goal.get("progress_pct") is not None:
            prompt_parts.append(
                f"  • Progress: {goal.get('progress_pct')}% "
                f"(week {goal.get('week')} of {goal.get('total_weeks')}, {goal.get('days_left')} days left)"
            )
        tw = goal.get("this_week")
        if tw:
            acts = "; ".join(tw.get("actions", []))
            prompt_parts.append(f"  • This week's focus: {tw.get('focus')} — {acts}")
        prompt_parts.append("  When relevant, connect your advice to this goal and how they're tracking toward it.")

    # Guidelines
    prompt_parts.append(
        "\n=== COACHING GUIDELINES ===\n"
        "• Always cite the user's actual numbers (e.g., 'Your HRV was 52 ms today, which is...').\n"
        "• Keep responses concise (2–4 sentences) unless a deeper explanation is genuinely warranted.\n"
        "• Give specific, actionable next steps — not vague suggestions.\n"
        "• Never provide medical diagnoses or prescriptions. Frame everything as wellness coaching.\n"
        "• If data is missing, acknowledge it briefly and offer your best general guidance.\n"
        "• Connect answers to the user's coaching focus areas and stated health goals when relevant.\n"
        "• You are Coach Al — bring energy and genuine care to every response."
    )

    return "\n".join(prompt_parts)


def chat(
    user_message: str,
    health_context: dict,
    profile: dict,
    history: Optional[list[dict]] = None,
) -> str:
    """
    Call Claude with health context as system prompt.

    Args:
        user_message: The user's question or message.
        health_context: Dict with health metrics and trends (passed to _build_system_prompt).
        profile: Dict with user profile info (passed to _build_system_prompt).
        history: Optional list of prior messages in format [{"role": "user"|"assistant", "content": str}, ...].
                 If not provided, defaults to empty list.

    Returns:
        str: The assistant's text response.

    Raises:
        RuntimeError: If ANTHROPIC_API_KEY is not set or anthropic package is not installed.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed — run: pip install anthropic")

    client = anthropic.Anthropic(api_key=api_key)
    system = _build_system_prompt(health_context, profile)

    # Prepare messages: keep last 20 conversation turns plus new user message
    if history is None:
        history = []
    messages = history[-20:] + [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system,
        messages=messages,
    )

    return response.content[0].text
