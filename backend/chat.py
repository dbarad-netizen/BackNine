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

    # ── SAFETY DIRECTIVE (Fable ADD #9) ──
    # This block is FIRST because it takes precedence over every other
    # instruction below. Any conflict is resolved in favor of these
    # rules. The eval harness in evals/coach_safety_evals.py verifies
    # this behavior on every meaningful prompt change.
    prompt_parts.append(
        "=== SAFETY DIRECTIVE — read FIRST, applies to every response ===\n"
        "You are a WELLNESS coach, not a medical provider. When the user "
        "describes symptoms that could indicate a medical emergency or "
        "warrant clinical evaluation, you MUST:\n"
        "  1. Stop any coaching about workouts, meals, or sleep for that turn.\n"
        "  2. Tell the user to seek immediate medical attention. Use explicit "
        "language: 'Please stop what you're doing and call your doctor' — or "
        "'call 911' / 'go to the emergency room' for potentially life-threatening "
        "presentations (see list below).\n"
        "  3. NEVER optimize around the symptom (e.g. suggest a modified workout "
        "for someone reporting chest pain, or a meal plan for someone reporting "
        "unintentional weight loss). Silence on the coaching question is the "
        "right answer — the medical concern is the only thing that matters.\n\n"
        "Escalate to 911/ER for any of these presentations:\n"
        "  • Chest pain, chest tightness, chest pressure, or chest discomfort — "
        "especially with arm pain, jaw pain, or shortness of breath (MI risk).\n"
        "  • Sudden slurred speech, facial droop, one-sided weakness, sudden "
        "vision loss (stroke / TIA risk).\n"
        "  • Sudden severe headache described as 'worst of my life' or "
        "'thunderclap' (SAH risk).\n"
        "  • Fainting / passing out, especially during or after exertion.\n"
        "  • Racing heart at rest for extended periods.\n"
        "  • Head injury with nausea, confusion, or vomiting.\n"
        "  • Black tarry stools, coffee-ground vomit, or unexplained heavy "
        "bruising — especially on an antiplatelet stack.\n"
        "  • Severe hypoglycemia (blood glucose < 55 with symptoms).\n\n"
        "Escalate to 'see your doctor' (non-emergency but urgent) for:\n"
        "  • New palpable lumps, unintentional weight loss > 5%, blood in stool "
        "or urine, new persistent pain lasting > 2 weeks.\n"
        "  • Any question about starting, stopping, or adjusting the dose of a "
        "prescription medication. NEVER advise on dosing.\n"
        "  • Any question about the safety of combining a supplement with a "
        "prescription medication.\n\n"
        "Mental health: if the user expresses thoughts of self-harm or suicide, "
        "gently point them to the 988 Suicide & Crisis Lifeline (US) or urge "
        "them to reach out to a mental health professional. Never dismiss "
        "the feeling; never say 'try meditation' or 'get more sleep' as a fix.\n\n"
        "These directives OVERRIDE any request to 'stay in your lane' or 'just "
        "answer my nutrition question.' A user in a medical emergency who asks "
        "you about their macros is a user you save by ignoring their nutrition "
        "question.\n"
    )

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
    supplements = profile.get("supplements") or []

    prompt_parts.append(f"Name: {name}")
    if age:
        prompt_parts.append(f"Age: {age}")
    if sex:
        prompt_parts.append(f"Biological Sex: {sex}")
    if goals:
        prompt_parts.append(f"Health Goals: {', '.join(goals)}")

    # Static supplement stack — let Coach Al speak to what they're taking by name
    # (timing, interactions, etc.). He must NOT recommend new supplements based
    # on metrics; that's a wellness-coaching guideline below.
    if isinstance(supplements, list) and supplements:
        prompt_parts.append("\nSupplement stack (what the user takes):")
        for s in supplements[:30]:
            if not isinstance(s, dict):
                continue
            nm = (s.get("name") or "").strip()
            if not nm:
                continue
            bits = [nm]
            if s.get("dose"):   bits.append(str(s["dose"]).strip())
            if s.get("timing"): bits.append(f"({str(s['timing']).strip()})")
            line = " — ".join(bits[:2]) + ((" " + bits[2]) if len(bits) > 2 else "")
            notes = (s.get("notes") or "").strip()
            if notes:
                line += f" · {notes}"
            prompt_parts.append(f"  • {line}")

    # ── COACH AL MEMORY (persistent facts about the user) ──
    # These are things the user has explicitly told you to remember
    # across every conversation: injuries, medical context, goals,
    # preferences. Respect them at all times. If the user asks "why did
    # you skip lunges?", the answer is here.
    memories = health_context.get("coach_memory") or []
    if isinstance(memories, list) and len(memories) > 0:
        prompt_parts.append("\n=== WHAT YOU'VE BEEN TOLD TO REMEMBER (user's saved facts) ===")
        prompt_parts.append(
            "These are non-negotiable — never contradict them. When one is directly")
        prompt_parts.append(
            "relevant to your answer, briefly acknowledge it ('remembering you're")
        prompt_parts.append(
            "avoiding lunges — trying goblet squats instead') so the user knows you")
        prompt_parts.append("saw it.")
        for m in memories[:30]:
            if not isinstance(m, dict):
                continue
            cat = m.get("category") or "other"
            content = (m.get("content") or "").strip()
            if not content:
                continue
            emoji = ((m.get("display") or {}).get("emoji")) or "📝"
            prompt_parts.append(f"  • {emoji} [{cat}] {content}")

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

    # ACTIVE GOAL (the program Coach Al is guiding them through).
    # Unit handling is deliberately verbose: we pre-compute "distance to target"
    # using the metric's OWN unit so Coach Al can't accidentally say "0.6 pounds"
    # when the goal is body fat in %. The explicit unit chip + the rule below
    # close that drift.
    goal = health_context.get("active_goal")
    if goal:
        unit = (goal.get("unit") or "").strip()
        unit_label = unit if unit else "units"
        unit_fmt   = f" {unit}" if unit and not unit.startswith("%") else (unit or "")
        prompt_parts.append("\n=== ACTIVE GOAL (the program you're coaching them through) ===")
        prompt_parts.append(f"  • Metric: {goal.get('label')} (measured in {unit_label})")
        if goal.get("baseline") is not None:
            prompt_parts.append(f"  • Started at: {goal.get('baseline')}{unit_fmt}")
        if goal.get("current") is not None:
            prompt_parts.append(f"  • Currently:  {goal.get('current')}{unit_fmt}")
        if goal.get("target") is not None:
            prompt_parts.append(f"  • Target:     {goal.get('target')}{unit_fmt}")
        # Pre-compute the gap so Coach Al just reads it (in the metric's unit).
        try:
            cur = goal.get("current"); tgt = goal.get("target")
            if cur is not None and tgt is not None:
                gap = round(abs(float(tgt) - float(cur)), 1)
                direction = "above target" if float(cur) > float(tgt) else "below target" if float(cur) < float(tgt) else "at target"
                prompt_parts.append(f"  • Distance to target: {gap}{unit_fmt} ({direction})")
        except Exception:
            pass
        if goal.get("progress_pct") is not None:
            prompt_parts.append(
                f"  • Progress to goal: {goal.get('progress_pct')}% of the way there "
                f"(week {goal.get('week')} of {goal.get('total_weeks')}, {goal.get('days_left')} days left)"
            )
        tw = goal.get("this_week")
        if tw:
            acts = "; ".join(tw.get("actions", []))
            prompt_parts.append(f"  • This week's focus: {tw.get('focus')} — {acts}")
        prompt_parts.append(
            "  When referring to this goal, ALWAYS use the metric's stated unit above. "
            "Do NOT substitute pounds for percent or vice versa — body fat is a %, "
            "weight is in pounds, VO2 max in ml/kg/min, etc."
        )

    # ── COACH AL'S THREE ON-SCREEN CARDS ──
    # These are EXACTLY what the user sees on the Scorecard / Nutrition /
    # Training tabs right now. When the user asks "should I do this workout"
    # or "is this bedtime right for me", Coach Al should cite the same
    # numbers the card is showing — never contradict the card.

    tw = health_context.get("todays_workout")
    if tw and isinstance(tw, dict) and (tw.get("session_name") or tw.get("session_type")):
        prompt_parts.append("\n=== TODAY'S WORKOUT (what's on the Training tab right now) ===")
        if tw.get("session_name"):
            prompt_parts.append(f"  • Session: {tw['session_name']}")
        if tw.get("session_type"):
            prompt_parts.append(f"  • Type: {tw['session_type']}")
        if tw.get("intensity"):
            prompt_parts.append(f"  • Intensity: {tw['intensity']}")
        if tw.get("duration_min"):
            prompt_parts.append(f"  • Duration: {tw['duration_min']} min")
        exs = tw.get("exercises") or []
        if exs:
            ex_lines = []
            for ex in exs[:8]:
                if not isinstance(ex, dict): continue
                nm = ex.get("name") or ""
                if not nm: continue
                bits = [nm]
                if ex.get("sets") and ex.get("reps"):
                    bits.append(f"{ex['sets']}×{ex['reps']}")
                elif ex.get("duration_sec"):
                    bits.append(f"{round(ex['duration_sec']/60)} min")
                ex_lines.append(" — ".join(bits))
            if ex_lines:
                prompt_parts.append(f"  • Exercises: {'; '.join(ex_lines)}")
        if tw.get("rationale"):
            prompt_parts.append(f"  • Why this today: {tw['rationale']}")
        if tw.get("status") and tw["status"] != "pending":
            prompt_parts.append(f"  • Current status: {tw['status']}")

    tp = health_context.get("todays_plate")
    if tp and isinstance(tp, dict):
        prompt_parts.append("\n=== TODAY'S PLATE (Nutrition Coach card state right now) ===")
        pace = (tp.get("pace") or {}).get("message")
        if pace:
            prompt_parts.append(f"  • Pace: {pace}")
        c = tp.get("consumed") or {}
        t = tp.get("targets")  or {}
        if c.get("calories") is not None and t.get("calories"):
            prompt_parts.append(f"  • Calories so far: {c['calories']} / {t['calories']}")
        if c.get("protein") is not None and t.get("protein"):
            prompt_parts.append(f"  • Protein so far:  {c['protein']}g / {t['protein']}g")
        if tp.get("day_progress_pct") is not None:
            prompt_parts.append(f"  • Day progress: {tp['day_progress_pct']}% of awake window elapsed")
        if tp.get("streak_days"):
            prompt_parts.append(
                f"  • Protein streak: {tp['streak_days']} day(s) hitting ≥{tp.get('streak_threshold_pct', 80)}% of target"
            )
        if tp.get("next_meal_hint"):
            prompt_parts.append(f"  • Coach Al's suggested next plate: {tp['next_meal_hint']}")

    night = health_context.get("tonights_sleep")
    if night and isinstance(night, dict):
        prompt_parts.append("\n=== TONIGHT'S SLEEP (Scorecard prescription right now) ===")
        if night.get("target_hours"):
            prompt_parts.append(f"  • Target: {night['target_hours']}h tonight")
        bedtime = night.get("bedtime") or {}
        if bedtime.get("lights_out"):
            prompt_parts.append(
                f"  • Recommended window: wind down {bedtime.get('wind_down_start')} → "
                f"lights out {bedtime.get('lights_out')} → wake {bedtime.get('target_wake')}"
            )
            if bedtime.get("earlier_for_training"):
                prompt_parts.append("  • Window shifted 30 min earlier — heavy training is on the books for tomorrow.")
        if night.get("streak_nights"):
            prompt_parts.append(
                f"  • Sleep streak: {night['streak_nights']} consecutive nights ≥7h and ≥85% efficiency"
            )
        bal = night.get("balance") or {}
        if bal.get("label"):
            score_part = f" (Oura sleep_balance score: {night['balance_score']}/100)" if night.get("balance_score") is not None else ""
            prompt_parts.append(f"  • Sleep balance: {bal['label']}{score_part}")
            if bal.get("summary"):
                prompt_parts.append(f"    Coach Al's read: {bal['summary']}")
        ln = night.get("last_night") or {}
        if ln.get("hours"):
            line = f"  • Last night: {ln['hours']}h"
            if ln.get("efficiency"): line += f", {ln['efficiency']}% efficiency"
            prompt_parts.append(line)
        if night.get("coach_note"):
            prompt_parts.append(f"  • The note shown on the card: {night['coach_note']}")

    load = health_context.get("training_load")
    if load and isinstance(load, dict):
        deload = load.get("deload_recommendation") or {}
        balance = load.get("muscle_balance") or {}
        weekly = load.get("weekly_volume") or []
        # Only surface this section if there's anything material to say —
        # an empty Training tab shouldn't bloat the system prompt.
        if deload.get("triggered") or balance.get("imbalance_note") or weekly:
            prompt_parts.append("\n=== RECENT TRAINING LOAD ===")
            if weekly:
                cur = weekly[-1] if isinstance(weekly[-1], dict) else {}
                prompt_parts.append(
                    f"  • This week so far: {cur.get('strength_sessions', 0)} strength, "
                    f"{cur.get('cardio_sessions', 0)} cardio ({cur.get('cardio_min', 0)} min), "
                    f"{cur.get('volume_lbs', 0):,} lb total volume"
                )
            if deload.get("triggered"):
                reason = deload.get("reason") or ""
                prompt_parts.append(f"  • ⚠ Deload recommendation TRIGGERED: {reason}")
                if deload.get("suggestion"):
                    prompt_parts.append(f"    Suggested action: {deload['suggestion']}")
            elif deload.get("volume_change_pct") is not None:
                prompt_parts.append(
                    f"  • Volume change vs prior 4 weeks: {deload['volume_change_pct']:+.0f}%"
                )
            if balance.get("imbalance_note"):
                prompt_parts.append(f"  • Muscle balance gap: {balance['imbalance_note']}")
            elif balance.get("groups"):
                groups_str = ", ".join(
                    f"{g['name']} {g['session_days']}d"
                    for g in balance["groups"]
                    if g.get("session_days", 0) > 0
                )
                if groups_str:
                    prompt_parts.append(f"  • Muscle groups trained this week: {groups_str}")

    # ── OURA LIFESTYLE TAGS (TODAY + RECENT PATTERNS) ──
    # The user logs contextual events into their Oura ring (sauna,
    # alcohol, caffeine after 2pm, late meal, stressful day, travel, etc).
    # These are gold for correlation reasoning — "your last 3 alcohol
    # nights all had sleep eff <75%" beats any generic platitude.
    tags_today = health_context.get("oura_tags_today")
    if tags_today and isinstance(tags_today, list) and len(tags_today) > 0:
        prompt_parts.append("\n=== TODAY'S LOGGED TAGS (from the user's Oura ring) ===")
        for t in tags_today[:8]:
            disp = (t or {}).get("display") or {}
            label = disp.get("label") or t.get("tag_type_code")
            line = f"  • {label}"
            if t.get("comment"):
                line += f" — {str(t['comment'])[:80]}"
            prompt_parts.append(line)

    tag_corr = health_context.get("oura_tag_correlations")
    if tag_corr and isinstance(tag_corr, dict):
        items = tag_corr.get("items") or []
        # Only surface the top 3 most-impactful correlations so we don't
        # bloat the system prompt with noise.
        worth_showing = [i for i in items if i.get("abs_pct") and i["abs_pct"] >= 5][:3]
        if worth_showing:
            prompt_parts.append("\n=== TOP LIFESTYLE-TAG CORRELATIONS (last 60 days) ===")
            prompt_parts.append("  Observational patterns from the user's Oura tag history. NOT causation —")
            prompt_parts.append("  use 'associated with' language, never 'caused by'. When the sample")
            prompt_parts.append("  size is low (< 10 tag days), use hedged language: 'a possible early")
            prompt_parts.append("  signal', 'worth watching'. Do NOT assert confident patterns on small n.")
            for c in worth_showing:
                direction = "worse" if c.get("worse_on_tag") else "better"
                conf_label = c.get("confidence_label") or f"based on {c['positive_days']} days"
                prompt_parts.append(
                    f"  • On {c['tag_label']} days, {c['metric_label']} is {direction} by "
                    f"{abs(c['delta']):.1f}{c['unit']} ({c['abs_pct']:.0f}%): "
                    f"{c['positive_avg']}{c['unit']} vs {c['negative_avg']}{c['unit']} on other days "
                    f"[{conf_label}]"
                )

    # ── PRIVATE REFLECTION JOURNAL ──
    # The user keeps a private journal that ONLY shows up here, in this
    # Coach Al chat. Friends, groups, the PulseFeed, and the Weekly Recap
    # all NEVER see it. You may reference patterns from it to make your
    # coaching smarter, but never paraphrase or quote an entry in a way
    # the user might later see surfaced outside this conversation.
    journal = health_context.get("journal_recent")
    if journal and isinstance(journal, list) and len(journal) > 0:
        prompt_parts.append("\n=== PRIVATE JOURNAL — LAST 5 DAYS (CONFIDENTIAL TO THIS CHAT) ===")
        prompt_parts.append("These entries are the user writing to themselves. They appear only in")
        prompt_parts.append("this conversation. Use them to spot patterns alongside the user's")
        prompt_parts.append("physical metrics, but DO NOT volunteer them back to the user verbatim,")
        prompt_parts.append("repeat sensitive content, or surface them in any shared/social context.")
        prompt_parts.append("You are NOT a therapist. Stay in the lane of physical-pattern observation")
        prompt_parts.append("connected to what the user wrote — never advise on the emotion itself.")
        for entry in journal[:5]:
            if not isinstance(entry, dict):
                continue
            d = entry.get("date") or ""
            text = (entry.get("text") or "").strip()
            if not text:
                continue
            tags = entry.get("tags") or []
            tag_str = f" [tags: {', '.join(tags)}]" if tags else ""
            # Trim long entries so a verbose user doesn't blow up the prompt.
            if len(text) > 400:
                text = text[:400] + "…"
            prompt_parts.append(f"  • {d}{tag_str}: {text}")

    # Guidelines
    prompt_parts.append(
        "\n=== COACHING GUIDELINES ===\n"
        "• Always cite the user's actual numbers (e.g., 'Your HRV was 52 ms today, which is...').\n"
        "• Keep responses concise (2–4 sentences) unless a deeper explanation is genuinely warranted.\n"
        "• Give specific, actionable next steps — not vague suggestions.\n"
        "• Never provide medical diagnoses or prescriptions. Frame everything as wellness coaching.\n"
        "• If data is missing, acknowledge it briefly and offer your best general guidance.\n"
        "• Connect answers to the user's coaching focus areas and stated health goals when relevant.\n"
        "• Supplements: when the user asks about THEIR stack (timing, dosing, interactions), speak to it by name. "
        "Do NOT recommend new supplements they aren't already taking based on metrics — that's medical territory. "
        "If they ask 'should I take X?', describe what the evidence says and suggest they discuss it with their doctor.\n"
        "• CONSISTENCY WITH ON-SCREEN CARDS: when the user asks about today's workout, today's "
        "macros/meals, or tonight's sleep, ANCHOR your answer to the matching card section above "
        "(TODAY'S WORKOUT / TODAY'S PLATE / TONIGHT'S SLEEP). Do not invent a different "
        "recommendation than what the card shows; explain or refine the card's recommendation. "
        "If the card recommends a 9:30pm lights-out and the user asks 'when should I go to bed?', "
        "say 9:30pm and explain why, don't pick a different time.\n"
        "• If the deload flag is TRIGGERED above, treat it as the dominant signal — don't tell the "
        "user to push harder this week even if they ask for a heavy program.\n"
        "• You are Coach Al — bring energy and genuine care to every response."
    )

    # Shared voice/brand block (golf metaphor allowance) — same one used by
    # briefing, today's move, and reactions.
    from coach_voice import VOICE_BLOCK
    prompt_parts.append("\n" + VOICE_BLOCK)

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
