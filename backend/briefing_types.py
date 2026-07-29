"""
Briefing day-type variety — David 2026-07-27 (Fable Layer 2).

Layer 1 killed most of the "same message every day" problem by feeding
Claude its own recent output and forbidding repetition. Layer 2 goes
further: instead of always producing the same TYPE of briefing (2
paragraphs, what-happened + one-action), we rotate through purposeful
types based on what today is actually about.

The type-picker inspects state — day of week, active experiments,
recent lab uploads, upcoming visits — and returns a type key that
carries its own prompt overlay. The overlay is APPENDED to the default
system prompt so the base voice/format/50+ rules still apply — only
the emphasis and any format tweaks come from the type.

Priority (first match wins — highest-signal type gets the day):
  1. lab_focus          — a lab was uploaded in the last 24h
  2. visit_prep         — an upcoming visit is 3-14 days out
  3. experiment_progress — mid-week check on an active experiment
                          (day 3-6 of 7 — day 1/2 too early, day 7 gets
                          the natural finalize excitement)
  4. sunday_recap       — Sunday
  5. monday_framing     — Monday
  6. default            — anything else, the Layer-1 anti-repetition
                          format

Design principles:
  • Silent fallback. Anything that errors returns "default" — the app
    keeps working even if a signal source is temporarily unavailable.
  • Read-only. This module never writes to Supabase; it just inspects
    state and picks a prompt overlay.
  • Explicit priority ordering. Debuggable by reading the picker top-
    to-bottom.

Public API:
    pick_type(user_id, today_date) -> str        # returns the type key
    overlay_for(briefing_type) -> str            # returns the prompt overlay
    label_for(briefing_type) -> str              # short human label for the UI
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional


log = logging.getLogger(__name__)


# ── Types ────────────────────────────────────────────────────────────────

TYPE_DEFAULT              = "default"
TYPE_SUNDAY_RECAP         = "sunday_recap"
TYPE_MONDAY_FRAMING       = "monday_framing"
TYPE_EXPERIMENT_PROGRESS  = "experiment_progress"
TYPE_LAB_FOCUS            = "lab_focus"
TYPE_VISIT_PREP           = "visit_prep"


# ── Supabase helper ──────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Signal probes ────────────────────────────────────────────────────────

def _recent_lab_upload(sb, user_id: str, today: _date, hours: int = 24) -> bool:
    """Any lab_entries row logged in the last N hours triggers lab_focus.
    We check `logged_at` (upload time) rather than `date` (result date)
    because the trigger is 'user just added something new,' not 'the
    labs are recent clinically.'"""
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        res = (sb.table("lab_entries")
                 .select("id", count="exact")
                 .eq("user_id", user_id)
                 .gte("logged_at", cutoff)
                 .limit(1)
                 .execute())
        return bool(res.data)
    except Exception:
        return False


def _upcoming_visit(sb, user_id: str, today: _date, min_days: int = 3, max_days: int = 14) -> Optional[dict]:
    """Nearest upcoming visit within [min_days, max_days]. We skip
    same-day / next-day / 2-day-out visits because at that horizon the
    user is already deep in prep — Visit Prep Mode is showing its own
    card. The briefing focus is the T-14 to T-3 sweet spot where the
    reader still has time to test something before the appointment."""
    try:
        window_start = (today + timedelta(days=min_days)).isoformat()
        window_end   = (today + timedelta(days=max_days)).isoformat()
        res = (sb.table("doctor_visits")
                 .select("id, visit_date, provider_type, reason, status")
                 .eq("user_id", user_id)
                 .eq("status", "upcoming")
                 .gte("visit_date", window_start)
                 .lte("visit_date", window_end)
                 .order("visit_date", desc=False)
                 .limit(1)
                 .execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def _mid_experiment(sb, user_id: str, today: _date) -> Optional[dict]:
    """Active experiment where today is between day 3 and day 6 of the
    test window (inclusive). Day 1/2 is too early to say anything
    meaningful, day 7 is finalize day and gets the natural attention."""
    try:
        # Fetch all active — small list, easier than a compound date filter
        res = (sb.table("experiments")
                 .select("id, action, metric_type, test_start_date, test_end_date, baseline_avg")
                 .eq("user_id", user_id)
                 .eq("status", "active")
                 .order("test_start_date", desc=True)
                 .execute())
        for r in (res.data or []):
            try:
                ts = _date.fromisoformat(r["test_start_date"])
                day = (today - ts).days + 1
                if 3 <= day <= 6:
                    r["_day"]   = day
                    r["_total"] = (_date.fromisoformat(r["test_end_date"]) - ts).days + 1
                    return r
            except Exception:
                continue
    except Exception:
        return None
    return None


# ── Public API ───────────────────────────────────────────────────────────

def pick_type(user_id: str, today: Optional[_date] = None) -> tuple[str, dict]:
    """Pick today's briefing type + return any context the overlay needs.

    Returns (type_key, context_dict). The context_dict carries the
    specifics the prompt overlay will reference — visit date, experiment
    action, etc. — so the caller can inject them into the prompt.

    Never raises. If anything is unavailable, returns (TYPE_DEFAULT, {})."""
    if not user_id:
        return TYPE_DEFAULT, {}
    t = today or _date.today()
    sb = _sb()
    if not sb:
        return TYPE_DEFAULT, {}

    # 1. Fresh lab upload — highest signal, user just did something
    if _recent_lab_upload(sb, user_id, t):
        return TYPE_LAB_FOCUS, {}

    # 2. Upcoming doctor visit in T-3..T-14 window
    visit = _upcoming_visit(sb, user_id, t)
    if visit:
        try:
            days_out = (_date.fromisoformat(visit["visit_date"]) - t).days
        except Exception:
            days_out = None
        return TYPE_VISIT_PREP, {
            "visit_date":    visit.get("visit_date"),
            "provider_type": visit.get("provider_type") or "your doctor",
            "reason":        visit.get("reason") or "",
            "days_out":      days_out,
        }

    # 3. Mid-experiment check-in
    exp = _mid_experiment(sb, user_id, t)
    if exp:
        return TYPE_EXPERIMENT_PROGRESS, {
            "action":       exp.get("action") or "",
            "metric_type":  exp.get("metric_type") or "",
            "baseline_avg": exp.get("baseline_avg"),
            "day":          exp.get("_day"),
            "total":        exp.get("_total"),
        }

    # 4/5. Day-of-week rotations. weekday(): Mon=0, Sun=6
    dow = t.weekday()
    if dow == 6:
        return TYPE_SUNDAY_RECAP, {}
    if dow == 0:
        return TYPE_MONDAY_FRAMING, {}

    # 6. Default — the Layer-1 anti-repetition format
    return TYPE_DEFAULT, {}


def label_for(briefing_type: str) -> str:
    """Short human-facing label — used by the UI to badge the briefing
    ('Sunday recap', 'Testing check-in') so users see the variety at a
    glance and understand today isn't just another briefing."""
    return {
        TYPE_DEFAULT:             "Today's briefing",
        TYPE_SUNDAY_RECAP:        "Sunday recap",
        TYPE_MONDAY_FRAMING:      "Week ahead",
        TYPE_EXPERIMENT_PROGRESS: "Testing check-in",
        TYPE_LAB_FOCUS:           "Lab-focused briefing",
        TYPE_VISIT_PREP:          "Visit prep briefing",
    }.get(briefing_type, "Today's briefing")


def overlay_for(briefing_type: str, ctx: Optional[dict] = None) -> str:
    """Return the prompt overlay for a given type. Appended to the base
    system prompt — the base voice/format/50+ rules still apply, this
    just changes the emphasis and any format tweaks.

    Returns "" for TYPE_DEFAULT (no overlay needed — the base prompt
    already does the right thing)."""
    ctx = ctx or {}

    if briefing_type == TYPE_SUNDAY_RECAP:
        return (
            "\n=== TODAY'S BRIEFING TYPE: SUNDAY RECAP ===\n"
            "Today is Sunday. This is a WEEK-IN-REVIEW briefing, not the "
            "usual last-night-plus-one-action format. Look back at the "
            "past 7 days.\n"
            "  • Paragraph 1: name the biggest METRIC that moved (up or "
            "    down) and the concrete behavior that likely drove it. "
            "    Use real numbers.\n"
            "  • Paragraph 2: name the biggest MISSED opportunity (a "
            "    logged intent that didn't get executed, an experiment "
            "    that stalled, a streak that broke). End with one "
            "    question the user should sit with before Monday, "
            "    phrased as: 'One question for the week ahead: X?'\n"
            "  • It's OK to run 90-130 words (slightly longer than "
            "    default) — a weekly recap earns the space.\n"
            "  • Do NOT use the phrase 'this week' more than once — the "
            "    context is already clear.\n"
        )

    if briefing_type == TYPE_MONDAY_FRAMING:
        return (
            "\n=== TODAY'S BRIEFING TYPE: MONDAY FRAMING ===\n"
            "Today is Monday. This is a WEEK-AHEAD framing briefing, not "
            "the usual last-night format. Look forward.\n"
            "  • Paragraph 1: name ONE specific commitment for this week "
            "    that's grounded in a signal from last week or an active "
            "    goal. Not 'try to sleep more' — 'aim for 5 nights at "
            "    10:30pm lights-out this week, given your 6.4h average.'\n"
            "  • Paragraph 2: give one concrete action for TODAY that "
            "    starts the week's commitment on the right foot.\n"
            "  • Skip the 'what happened last night' opener — the user "
            "    will see it later in the day. Monday is for looking "
            "    ahead.\n"
        )

    if briefing_type == TYPE_EXPERIMENT_PROGRESS:
        action = (ctx.get("action") or "").strip()
        metric = (ctx.get("metric_type") or "").strip()
        day    = ctx.get("day")
        total  = ctx.get("total") or 7
        baseline = ctx.get("baseline_avg")
        base_str = f" Baseline was {baseline}." if baseline is not None else ""
        return (
            "\n=== TODAY'S BRIEFING TYPE: EXPERIMENT PROGRESS ===\n"
            f"The user is on day {day} of {total} in an active experiment: "
            f'"{action[:120]}" testing {metric}.{base_str}\n'
            "This briefing's ENTIRE focus is that test, not the usual "
            "last-night synthesis.\n"
            "  • Paragraph 1: reference the test by name. Note where "
            "    the metric currently sits vs. baseline (use the fresh "
            "    data in the payload). If it's directionally moving, "
            "    say so cautiously ('early — {small trend} in the right "
            "    direction'). If it's flat or moving the wrong way, be "
            "    honest.\n"
            "  • Paragraph 2: give ONE specific thing to do today that "
            "    reinforces the test. Don't broaden — you're not "
            "    prescribing a NEW action, you're reinforcing the one "
            "    they committed to.\n"
            "  • Do NOT suggest a different experiment while this one is "
            "    running. Do NOT declare a result — that lands on the "
            "    Proven ledger on day 7.\n"
        )

    if briefing_type == TYPE_LAB_FOCUS:
        return (
            "\n=== TODAY'S BRIEFING TYPE: LAB FOCUS ===\n"
            "The user just uploaded a lab result. This briefing's focus "
            "is the labs, not the last-night sleep synthesis.\n"
            "  • Paragraph 1: name ONE marker from the payload's labs "
            "    section worth discussing at their next visit. Choose "
            "    based on what's out of the reference range OR what's "
            "    changed meaningfully vs the prior draw. Use the number "
            "    and unit, and give one sentence of context ('flagged "
            "    high vs the reference range' — don't diagnose, don't "
            "    prescribe, don't interpret causally).\n"
            "  • Paragraph 2: suggest ONE next step. Usually 'add this "
            "    to your Visit Prep' or 'flag this for your next visit' "
            "    — never 'start taking X supplement' or 'talk to your "
            "    doctor about Y medication.'\n"
            "  • If the payload has multiple flagged markers, pick the "
            "    highest-signal one. Don't list them all — that's what "
            "    the Doctor Report is for.\n"
        )

    if briefing_type == TYPE_VISIT_PREP:
        days_out = ctx.get("days_out")
        provider = ctx.get("provider_type") or "your doctor"
        when     = "in a few days" if days_out is None else (
            "tomorrow" if days_out == 1 else f"in {days_out} days"
        )
        return (
            "\n=== TODAY'S BRIEFING TYPE: VISIT PREP ===\n"
            f"The user has an appointment with {provider} {when}. "
            "This briefing focuses on prep, not the usual last-night "
            "synthesis.\n"
            "  • Paragraph 1: name the top TWO things worth raising at "
            "    the visit based on the payload — a clinical flag, a "
            "    trend that changed, a question the data raises. Cite "
            "    real numbers.\n"
            "  • Paragraph 2: name ONE data point to have ready before "
            "    the visit (a lab that needs uploading, a BP reading "
            "    pattern, a symptom log). If everything is already "
            "    ready, say so and suggest they open the Doctor Report "
            "    to review it before the visit.\n"
            "  • Do NOT recommend medication changes or treatments. "
            "    Frame everything as 'worth raising' or 'worth "
            "    reviewing together.'\n"
        )

    # TYPE_DEFAULT — no overlay, base prompt already handles it
    return ""


__all__ = [
    "TYPE_DEFAULT", "TYPE_SUNDAY_RECAP", "TYPE_MONDAY_FRAMING",
    "TYPE_EXPERIMENT_PROGRESS", "TYPE_LAB_FOCUS", "TYPE_VISIT_PREP",
    "pick_type", "label_for", "overlay_for",
]
