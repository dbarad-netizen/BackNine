"""
Weekly Recap — Sunday-night celebration card.

Aggregates a user's most recent ISO week (Mon-Sun) across all three pillars
and packages it into one shareable summary. The card pops on the Scorecard
from Saturday onward and stays through Tuesday so people who don't open the
app every day still see their week.

Sections produced:
  • training   — workouts, lifting volume, PRs hit, top movement
  • nutrition  — days logged, protein streak inside the week, avg protein
  • sleep      — avg hours, streak nights (debt removed — see _sleep_section)
  • headline   — one short Coach Al voice line ("Six workouts. Two PRs. A 7h
                 average week of sleep. Nice work this week.")
  • highlight  — the single most impressive moment ("first 195lb bench")

The card has two CTAs:
  1. Share with friends — posts a `weekly_recap` activity_event into the
     PulseFeed so friends can react.
  2. Ask Coach Al — opens chat with a contextual seed.

Pure-data. No Claude call required — Coach Al's voice is rules-based off
the numbers so the recap renders instantly and offline-friendly.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import exercise_progression as exprog

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────────

PROTEIN_HIT_PCT     = 0.80   # % of target that counts as a "protein day"
SLEEP_STREAK_HOURS  = 7.0
SLEEP_STREAK_EFF    = 85     # %


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _week_bounds(anchor_iso: Optional[str]) -> tuple[_date, _date]:
    """Return (monday, sunday) for the ISO week containing anchor_iso.
    Defaults to the current week if anchor is empty/invalid."""
    try:
        anchor = _date.fromisoformat(anchor_iso) if anchor_iso else _date.today()
    except Exception:
        anchor = _date.today()
    monday = anchor - timedelta(days=anchor.isoweekday() - 1)
    sunday = monday + timedelta(days=6)
    return monday, sunday


# ── training section ────────────────────────────────────────────────────────

def _training_section(user_id: str, monday: _date, sunday: _date) -> dict:
    sb = _sb()
    if not sb:
        return {"workouts": 0, "lifting_volume_lbs": 0, "cardio_min": 0, "prs": [], "top_lift": None}
    try:
        res = (
            sb.table("training_workouts")
            .select("date, kind, duration_min, total_volume_lbs, exercises")
            .eq("user_id", user_id)
            .gte("date", monday.isoformat())
            .lte("date", sunday.isoformat())
            .order("date", desc=False)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    strength = sum(1 for r in rows if (r.get("kind") or "").lower() == "strength")
    cardio   = sum(1 for r in rows if (r.get("kind") or "").lower() == "cardio")
    vol      = sum(int(r.get("total_volume_lbs") or 0) for r in rows if (r.get("kind") or "").lower() == "strength")
    cardio_min = sum(int(r.get("duration_min") or 0) for r in rows if (r.get("kind") or "").lower() == "cardio")

    # Annotate with progression to count PRs hit this week. exprog handles
    # the heavy lifting (e1RM per session, lifetime-best comparison).
    annotated = exprog.annotate_workouts(user_id, rows)
    prs: list[str] = []
    top_lift: Optional[dict] = None
    for w in annotated:
        for ex in w.get("exercises") or []:
            if not isinstance(ex, dict):
                continue
            prog = ex.get("progression") or {}
            if prog.get("kind") == "pr":
                # Capture as a short string for the recap UI.
                weight = None
                reps   = None
                sets = ex.get("sets") or []
                if sets:
                    # Heaviest set by e1RM-ish; just pick max weight for the share.
                    best = max(sets, key=lambda s: float(s.get("weight_lbs") or 0))
                    weight = best.get("weight_lbs")
                    reps   = best.get("reps")
                label = ex.get("name") or "lift"
                if weight and reps:
                    prs.append(f"{label} — {int(weight)}×{int(reps)}")
                else:
                    prs.append(label)
                e1 = ex.get("e1rm_lbs")
                if e1 and (top_lift is None or e1 > top_lift.get("e1rm_lbs", 0)):
                    top_lift = {"name": label, "e1rm_lbs": e1}

    return {
        "workouts":           strength + cardio,
        "strength_sessions":  strength,
        "cardio_sessions":    cardio,
        "lifting_volume_lbs": vol,
        "cardio_min":         cardio_min,
        "prs":                prs[:5],     # cap so the share fits
        "pr_count":           len(prs),
        "top_lift":           top_lift,
    }


# ── nutrition section ──────────────────────────────────────────────────────

def _nutrition_section(user_id: str, monday: _date, sunday: _date) -> dict:
    sb = _sb()
    if not sb:
        return {"days_logged": 0, "protein_days": 0, "avg_protein": None}
    # Pull settings to get the protein target.
    target_protein = 0
    try:
        s_res = sb.table("nutrition_settings").select("protein_g").eq("user_id", user_id).limit(1).execute()
        rows = s_res.data or []
        if rows:
            target_protein = float(rows[0].get("protein_g") or 0)
    except Exception:
        pass

    try:
        res = (
            sb.table("nutrition_meals")
            .select("date, protein")
            .eq("user_id", user_id)
            .gte("date", monday.isoformat())
            .lte("date", sunday.isoformat())
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    by_day: dict[str, float] = {}
    for r in rows:
        d = r.get("date")
        if not d:
            continue
        by_day[d] = by_day.get(d, 0) + float(r.get("protein") or 0)

    days_logged = len(by_day)
    avg_protein = round(sum(by_day.values()) / days_logged, 1) if days_logged else None
    protein_days = 0
    if target_protein > 0:
        hit = PROTEIN_HIT_PCT * target_protein
        protein_days = sum(1 for v in by_day.values() if v >= hit)

    return {
        "days_logged":   days_logged,
        "protein_days":  protein_days,
        "avg_protein":   avg_protein,
        "target_protein": int(target_protein) if target_protein else None,
    }


# ── sleep section ──────────────────────────────────────────────────────────

def _sleep_section(user_id: str, monday: _date, sunday: _date, target_hours: float) -> dict:
    """Per the 'don't compete with Oura' principle, we no longer compute
    sleep debt here. Avg hours + streak count are unambiguous; debt was
    a flawed flat sum that didn't agree with Oura's app and added drama
    rather than value to the recap.

    target_hours is kept in the signature for backward compat / future
    use but is no longer referenced."""
    _ = target_hours  # intentionally unused
    try:
        _, _, _, smm = oc.get_days(user_id, days=30)
    except Exception:
        smm = {}

    if not smm:
        return {"avg_hours": None, "streak_nights": 0, "debt_hours": None, "nights_logged": 0}

    hours: list[float] = []
    nights_streak = 0
    for offset in range(7):
        d = (monday + timedelta(days=offset)).isoformat()
        row = smm.get(d) or {}
        total = row.get("total")
        if total is None:
            continue
        h = total / 3600.0
        hours.append(h)
        eff = row.get("efficiency") or 0
        if h >= SLEEP_STREAK_HOURS and eff >= SLEEP_STREAK_EFF:
            nights_streak += 1
    return {
        "avg_hours":      round(sum(hours) / len(hours), 1) if hours else None,
        "streak_nights":  nights_streak,
        # `debt_hours` permanently null going forward — kept in the response
        # shape only so older frontends don't 500. New frontends should not
        # render it.
        "debt_hours":     None,
        "nights_logged":  len(hours),
    }


# ── voice ─────────────────────────────────────────────────────────────────

def _headline(t: dict, n: dict, s: dict) -> str:
    """Coach Al voice — one upbeat line summarizing the week. Rules-based:
    we prioritize the most impressive numeric to lead with, then chain."""
    parts: list[str] = []

    workouts = t.get("workouts") or 0
    pr_count = t.get("pr_count") or 0
    if pr_count >= 3:
        parts.append(f"{pr_count} PRs in one week.")
    elif pr_count >= 1:
        parts.append(f"{pr_count} PR {'hit' if pr_count == 1 else 'hits'} this week.")
    if workouts >= 5:
        parts.append(f"{workouts} sessions logged.")
    elif workouts >= 3:
        parts.append(f"{workouts} solid sessions.")

    protein_days = n.get("protein_days") or 0
    if protein_days >= 5:
        parts.append(f"Protein target hit {protein_days} of {n.get('days_logged') or protein_days} days.")
    elif n.get("days_logged"):
        parts.append(f"{n['days_logged']} days of meals logged.")

    streak = s.get("streak_nights") or 0
    avg_h = s.get("avg_hours")
    if streak >= 5:
        parts.append(f"{streak}-night sleep streak.")
    elif avg_h:
        parts.append(f"Averaged {avg_h:.1f}h sleep.")

    if not parts:
        return "Light week — get one anchor session in and rebuild the rhythm."
    closers = ["Nice work.", "Keep it rolling.", "Stack another week.", "That's the game."]
    pr_count_idx = (pr_count + workouts) % len(closers)
    return " ".join(parts) + " " + closers[pr_count_idx]


def _highlight(t: dict, n: dict, s: dict) -> Optional[str]:
    """Single proudest moment. Pulls the heaviest PR or the streak crown."""
    top = t.get("top_lift")
    if top and top.get("name"):
        return f"🏆 New {top['name']} PR at {top['e1rm_lbs']} lb e1RM"
    streak = s.get("streak_nights") or 0
    if streak >= 5:
        return f"💤 {streak} solid nights in a row"
    pdays = n.get("protein_days") or 0
    if pdays >= 5:
        return f"🥩 {pdays} days of hitting protein target"
    if (t.get("workouts") or 0) >= 5:
        return f"💪 {t['workouts']} sessions logged"
    return None


# ── public ────────────────────────────────────────────────────────────────

def _sleep_target_hours(user_id: str) -> float:
    sb = _sb()
    if not sb:
        return 8.0
    try:
        res = sb.table("user_profiles").select("sleep_target_hours").eq("user_id", user_id).limit(1).execute()
        rows = res.data or []
        if rows and rows[0].get("sleep_target_hours"):
            return float(rows[0]["sleep_target_hours"])
    except Exception:
        pass
    return 8.0


def build_payload(user_id: str, anchor_iso: Optional[str] = None) -> dict:
    monday, sunday = _week_bounds(anchor_iso)
    target_hours = _sleep_target_hours(user_id)

    training  = _training_section(user_id, monday, sunday)
    nutrition = _nutrition_section(user_id, monday, sunday)
    sleep     = _sleep_section(user_id, monday, sunday, target_hours)

    headline  = _headline(training, nutrition, sleep)
    highlight = _highlight(training, nutrition, sleep)

    # "Is this week worth celebrating?" — used by the frontend to decide
    # whether to show the card prominently or quietly. Sparse weeks (no
    # workouts, no meal logs, no sleep nights) get a low-key render.
    has_content = (
        (training.get("workouts") or 0) > 0
        or (nutrition.get("days_logged") or 0) > 0
        or (sleep.get("nights_logged") or 0) > 0
    )

    # Sunday Scorecard ritual (Fable v2 recommendation): each recap
    # carries a next-week plan headline + one specific experiment to
    # try. Rendered on the card so the user leaves with a plan, not
    # just a look-back. Kept deterministic (no LLM cost per view);
    # simple rule-based prescriptions from the pillars.
    next_week_plan = _next_week_plan(training, nutrition, sleep)
    experiment     = _one_experiment(training, nutrition, sleep)

    return {
        "week_start":     monday.isoformat(),
        "week_end":       sunday.isoformat(),
        "is_current_week": sunday >= _date.today() >= monday,
        "training":       training,
        "nutrition":      nutrition,
        "sleep":          sleep,
        "headline":       headline,
        "highlight":      highlight,
        "has_content":    has_content,
        "next_week_plan": next_week_plan,
        "experiment":     experiment,
    }


def _next_week_plan(t: dict, n: dict, s: dict) -> Optional[str]:
    """One-sentence plan for the coming week — the ritual's forward
    half. Deterministic so it can render at scale without LLM cost.
    Priority: sleep first (biggest lever), then training gap, then
    nutrition consistency."""
    avg_h = s.get("avg_hours")
    if avg_h and avg_h < 6.8:
        return f"Sleep is the lever this week — target lights-out 30 min earlier to move avg past 7h."
    workouts = t.get("workouts") or 0
    if workouts < 3:
        return "Load up on training density: three sessions minimum, one lower-body and one cardio."
    if (n.get("protein_days") or 0) < (n.get("days_logged") or 0) - 1:
        return "Protein consistency was the miss — hit target on 5+ days this week."
    prs = t.get("pr_count") or 0
    if prs == 0:
        return "You held the line — try a PR attempt on one compound lift this week."
    return "Recovery week: hold volume, chase quality, one full rest day mid-week."


def _one_experiment(t: dict, n: dict, s: dict) -> Optional[str]:
    """A single, specific, testable thing to try. Fable's spec calls
    this out because 'try one thing' is the actionability people
    actually respond to."""
    # Cycle through experiments by domain deterministically based on
    # what looks weakest this week — pick the single most measurable one.
    avg_h = s.get("avg_hours")
    if avg_h and avg_h < 7:
        return "Wind-down cue: phone in a different room from 9:30pm every night — measure sleep score delta by Sunday."
    if (t.get("cardio_min") or 0) < 60:
        return "Add one 30-min Zone 2 walk mid-week — check whether RHR trends down over the following 5 nights."
    if (n.get("protein_days") or 0) < 4:
        return "Front-load protein at breakfast (35g+) every day this week; see whether the streak lasts past day 3."
    return "Two-minute morning breath practice before checking your phone — track energy at 11am on Friday."


# ── group recap aggregator ────────────────────────────────────────────────

def build_group_payload(group_id: str, anchor_iso: Optional[str] = None) -> dict:
    """Aggregate each group member's weekly recap into a single group view.

    Sections produced:
      • totals     — sum of sessions, lifting volume, cardio minutes, PRs
                     across all members
      • leaderboard — per-member capsule: workouts, prs, sleep streak, badge
      • top_perf   — best single performer per pillar (most sessions, biggest
                     lift PR, best sleep streak)
      • headline   — one short Coach Al voice line for the group
    """
    sb = _sb()
    if not sb or not group_id:
        return {"week_start": None, "week_end": None, "members": []}

    try:
        mres = sb.table("group_members").select("user_id").eq("group_id", group_id).execute()
        ids = [r["user_id"] for r in (mres.data or []) if r.get("user_id")]
    except Exception:
        ids = []
    if not ids:
        return {"week_start": None, "week_end": None, "members": [], "totals": {}, "leaderboard": [], "headline": "No members yet."}

    # Resolve display names once.
    names: dict[str, str] = {}
    try:
        n_res = sb.table("user_profiles").select("user_id, name").in_("user_id", ids).execute()
        names = {r["user_id"]: ((r.get("name") or "").strip() or "Friend") for r in (n_res.data or [])}
    except Exception:
        names = {uid: "Friend" for uid in ids}

    monday, sunday = _week_bounds(anchor_iso)

    members: list[dict] = []
    totals = {"workouts": 0, "strength_sessions": 0, "cardio_sessions": 0,
              "lifting_volume_lbs": 0, "cardio_min": 0, "pr_count": 0,
              "nights_logged": 0, "protein_days": 0, "active_members": 0}
    top_session_count = (None, 0)        # (user_id, count)
    top_pr            = (None, None, 0)  # (user_id, lift_name, e1rm)
    top_sleep_streak  = (None, 0)        # (user_id, streak)

    for uid in ids:
        try:
            recap = build_payload(uid, anchor_iso)
        except Exception:
            recap = None
        if not recap:
            continue
        t = recap.get("training")  or {}
        n = recap.get("nutrition") or {}
        s = recap.get("sleep")     or {}

        # Roll up totals
        totals["workouts"]            += int(t.get("workouts") or 0)
        totals["strength_sessions"]   += int(t.get("strength_sessions") or 0)
        totals["cardio_sessions"]     += int(t.get("cardio_sessions") or 0)
        totals["lifting_volume_lbs"]  += int(t.get("lifting_volume_lbs") or 0)
        totals["cardio_min"]          += int(t.get("cardio_min") or 0)
        totals["pr_count"]            += int(t.get("pr_count") or 0)
        totals["nights_logged"]       += int(s.get("nights_logged") or 0)
        totals["protein_days"]        += int(n.get("protein_days") or 0)
        if recap.get("has_content"):
            totals["active_members"]  += 1

        # Top-performers
        sess = int(t.get("workouts") or 0)
        if sess > top_session_count[1]:
            top_session_count = (uid, sess)
        top_lift = t.get("top_lift") or {}
        if top_lift.get("e1rm_lbs") and top_lift["e1rm_lbs"] > (top_pr[2] or 0):
            top_pr = (uid, top_lift.get("name"), top_lift["e1rm_lbs"])
        streak = int(s.get("streak_nights") or 0)
        if streak > top_sleep_streak[1]:
            top_sleep_streak = (uid, streak)

        members.append({
            "user_id":      uid,
            "name":         names.get(uid, "Friend"),
            "workouts":     int(t.get("workouts") or 0),
            "pr_count":     int(t.get("pr_count") or 0),
            "sleep_streak": int(s.get("streak_nights") or 0),
            "protein_days": int(n.get("protein_days") or 0),
            "highlight":    recap.get("highlight"),
        })

    # Sort members for the leaderboard view
    members.sort(key=lambda m: (-m["pr_count"], -m["workouts"], -m["sleep_streak"], m["name"].lower()))

    top_perf = {
        "sessions":     {"user_id": top_session_count[0], "name": names.get(top_session_count[0] or "", None), "value": top_session_count[1]} if top_session_count[0] else None,
        "pr":           {"user_id": top_pr[0], "name": names.get(top_pr[0] or "", None), "exercise": top_pr[1], "e1rm_lbs": top_pr[2]} if top_pr[0] else None,
        "sleep_streak": {"user_id": top_sleep_streak[0], "name": names.get(top_sleep_streak[0] or "", None), "value": top_sleep_streak[1]} if top_sleep_streak[0] else None,
    }

    # Headline — group voice
    bits: list[str] = []
    if totals["active_members"]:
        bits.append(f"{totals['active_members']}/{len(ids)} members logged something")
    if totals["pr_count"]:
        bits.append(f"{totals['pr_count']} PR{'s' if totals['pr_count'] != 1 else ''} across the crew")
    if totals["workouts"]:
        bits.append(f"{totals['workouts']} total sessions")
    if top_pr[0] and top_pr[2]:
        bits.append(f"top lift: {names.get(top_pr[0], 'Someone')} on {top_pr[1]} ({top_pr[2]} lb e1RM)")
    headline = " · ".join(bits) if bits else "Quiet week for the crew — somebody open the next chapter."

    return {
        "week_start":  monday.isoformat(),
        "week_end":    sunday.isoformat(),
        "totals":      totals,
        "leaderboard": members,
        "top_performers": top_perf,
        "headline":    headline,
    }


# ── share into PulseFeed ──────────────────────────────────────────────────

def build_share_payload(recap: dict) -> dict:
    """Compress the recap into the small payload shape that lives on the
    activity_event row. The PulseFeed _summarize_event helper renders this
    into a one-liner."""
    t = recap.get("training") or {}
    n = recap.get("nutrition") or {}
    s = recap.get("sleep") or {}
    return {
        "week_start":     recap.get("week_start"),
        "week_end":       recap.get("week_end"),
        "workouts":       t.get("workouts") or 0,
        "pr_count":       t.get("pr_count") or 0,
        "protein_days":   n.get("protein_days") or 0,
        "sleep_streak":   s.get("streak_nights") or 0,
        "avg_sleep":      s.get("avg_hours"),
        "highlight":      recap.get("highlight"),
        "headline":       recap.get("headline"),
    }
