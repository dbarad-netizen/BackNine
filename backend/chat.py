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
        "You are BackNine AI, a personal health coach for the BackNine app. "
        "You have access to the user's real, live health data from their wearable devices and activity trackers. "
        "Your role is to provide specific, actionable, and personalized health coaching based on their actual metrics."
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

    # Guidelines
    prompt_parts.append(
        "\n=== GUIDELINES ===\n"
        "• Be specific: cite the user's actual numbers (e.g., 'Your HRV was 52 ms today').\n"
        "• Keep responses concise (2–4 sentences) unless a detailed answer is needed.\n"
        "• Provide actionable advice based on their metrics and trends.\n"
        "• Never give medical diagnoses or prescriptions—offer wellness suggestions only.\n"
        "• If data is missing for a question, acknowledge it and offer general guidance.\n"
        "• Reference their coaching focus areas when relevant to their question."
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
