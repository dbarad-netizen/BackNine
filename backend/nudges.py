"""
Proactive nudge budget — at most one nudge per user per day.

David 2026-07-23 (Fable competitive brief): Bevel's rebuilt Intelligence
proactively pings users; Aveil's philosophy is "only when worth acting
on." Both push. BackNine's parity move: proactive nudges, but hard-
capped at one per day so we can never become the app that cries wolf.

Detection rules run in priority order. First rule to fire wins the day.
Nothing else generates a nudge until tomorrow, even if a higher-priority
rule would have qualified — that's a feature, not a bug. Consistency of
"one thing today" is more valuable than showing every signal we found.

Priority (highest first):
  1. bp_high         — today's BP ≥ 140/90 sustained
  2. hrv_drop        — 15%+ drop vs 7-day avg
  3. sleep_debt      — >6h Oura sleep debt
  4. training_gap    — 4+ days since last workout AND readiness OK
  5. adherence_dip   — stack adherence < 50% over last 7 days
  6. alcohol_pattern — 3+ alcohol vice logs this week

Nudges live in public.nudges with a UNIQUE(user_id, date) constraint
so racing writes can't create doubles.

Public API:
    today(user_id) → dict | None
        Returns today's nudge if one already exists OR generates one
        if a rule fires. None if nothing qualifies.
    dismiss(user_id, nudge_id)
    mark_acted(user_id, nudge_id)
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional


log = logging.getLogger(__name__)


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Rule dispatch — each returns a dict or None ──────────────────────────
#
# A rule that fires returns:
#   {kind, title, body, action_label?, action_target?, priority}
# Priority is intrinsic to the rule (lower = more urgent). The first
# non-None rule wins today.

def _rule_bp_high(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        # Any reading today ≥ 140/90 — high enough to warrant nudge
        res = (sb.table("blood_pressure_log")
                 .select("systolic, diastolic")
                 .eq("user_id", user_id)
                 .eq("date", today.isoformat())
                 .execute())
        for r in (res.data or []):
            s = r.get("systolic") or 0
            d = r.get("diastolic") or 0
            if s >= 140 or d >= 90:
                return {
                    "kind":          "bp_high",
                    "title":         "Today's BP reading was elevated",
                    "body":          f"You logged {s}/{d} today. Save a note for your next doctor visit; a single elevated reading isn't itself a call to action, but a pattern is worth flagging.",
                    "action_label":  "Add to Visit Prep",
                    "action_target": "visits",
                    "priority":      10,
                }
    except Exception:
        pass
    return None


def _rule_hrv_drop(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        # Compare today's HRV to 7-day avg. We use apple_health_daily as
        # the primary source since it aggregates across Oura + AH.
        start = today - timedelta(days=7)
        res = (sb.table("apple_health_daily")
                 .select("date, hrv")
                 .eq("user_id", user_id)
                 .gte("date", start.isoformat())
                 .lte("date", today.isoformat())
                 .execute())
        rows = [r for r in (res.data or []) if r.get("hrv") is not None]
        today_row = next((r for r in rows if r["date"] == today.isoformat()), None)
        prior = [float(r["hrv"]) for r in rows if r["date"] != today.isoformat()]
        if today_row and len(prior) >= 4:
            today_hrv = float(today_row["hrv"])
            avg = sum(prior) / len(prior)
            if avg > 0 and (avg - today_hrv) / avg >= 0.15:
                pct = round(100 * (avg - today_hrv) / avg)
                return {
                    "kind":          "hrv_drop",
                    "title":         f"HRV is down {pct}% vs your baseline",
                    "body":          f"Today {round(today_hrv)} ms vs a 7-day average of {round(avg)}. Consider zone-2 or mobility today instead of intervals — recovery first, PRs tomorrow.",
                    "action_label":  "Open Training",
                    "action_target": "training",
                    "priority":      20,
                }
    except Exception:
        pass
    return None


def _rule_sleep_debt(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        start = today - timedelta(days=6)
        res = (sb.table("apple_health_daily")
                 .select("date, sleep_hours")
                 .eq("user_id", user_id)
                 .gte("date", start.isoformat())
                 .lte("date", today.isoformat())
                 .execute())
        vals = [float(r["sleep_hours"]) for r in (res.data or []) if r.get("sleep_hours") is not None]
        if len(vals) >= 5:
            # Simple debt: sum(max(0, 7.5 - each)) capped at 3h/night
            debt = sum(min(3.0, max(0.0, 7.5 - v)) for v in vals)
            if debt >= 6.0:
                return {
                    "kind":          "sleep_debt",
                    "title":         f"Sleep debt is ~{round(debt)}h this week",
                    "body":          "A single early night won't erase it, but a 30-min-earlier bedtime tonight and tomorrow will bend the curve. Wind-down starts now.",
                    "action_label":  "Open Sleep",
                    "action_target": "sleep",
                    "priority":      30,
                }
    except Exception:
        pass
    return None


def _rule_training_gap(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        cutoff = (today - timedelta(days=4)).isoformat()
        res = (sb.table("training_workouts")
                 .select("id", count="exact")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .limit(1)
                 .execute())
        if res.data:
            return None   # Trained recently, no gap
        # Additionally check today's readiness — don't nudge someone
        # whose ring says stay in bed
        rres = (sb.table("oura_daily_cache")
                  .select("date, readiness")
                  .eq("user_id", user_id)
                  .eq("date", today.isoformat())
                  .limit(1)
                  .execute())
        readiness_score = None
        for r in (rres.data or []):
            payload = r.get("readiness") or {}
            if isinstance(payload, dict):
                v = payload.get("score")
                if isinstance(v, (int, float)):
                    readiness_score = int(v)
                    break
        # Nudge only when readiness is unknown or > 70 (green light)
        if readiness_score is None or readiness_score >= 70:
            return {
                "kind":          "training_gap",
                "title":         "It's been 4+ days since your last workout",
                "body":          "Your body's ready — a 30-min zone-2 walk counts. Consistency beats intensity for the back-nine crowd.",
                "action_label":  "Open Training",
                "action_target": "training",
                "priority":      40,
            }
    except Exception:
        pass
    return None


def _rule_adherence_dip(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        # Count profile stack items
        pres = (sb.table("user_profiles")
                  .select("medications, supplements, peptides")
                  .eq("user_id", user_id)
                  .limit(1)
                  .execute())
        profile = (pres.data or [{}])[0]
        med_ct  = len(profile.get("medications")  or [])
        supp_ct = len(profile.get("supplements")  or [])
        pep_ct  = len(profile.get("peptides")     or [])
        total_stack = med_ct + supp_ct + pep_ct
        if total_stack < 3:
            return None    # Not enough stack to warrant an adherence nudge
        # Count last 7 days of taken=true rows
        cutoff = (today - timedelta(days=6)).isoformat()
        ares = (sb.table("stack_adherence_log")
                  .select("id", count="exact")
                  .eq("user_id", user_id)
                  .gte("date", cutoff)
                  .eq("taken", True)
                  .execute())
        actual = ares.count or 0
        expected = total_stack * 7
        rate = actual / expected if expected else 0
        if rate < 0.5:
            return {
                "kind":          "adherence_dip",
                "title":         "Stack adherence dipped this week",
                "body":          f"Only ~{round(rate*100)}% of doses logged. Even just the morning row is a win — one tap per item.",
                "action_label":  "Open Nutrition",
                "action_target": "nutrition",
                "priority":      50,
            }
    except Exception:
        pass
    return None


def _rule_alcohol_pattern(user_id: str, today: _date) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        cutoff = (today - timedelta(days=6)).isoformat()
        res = (sb.table("nutrition_vices")
                 .select("id, vice_type")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .execute())
        alcohol_ct = sum(1 for r in (res.data or []) if r.get("vice_type") == "alcohol")
        if alcohol_ct >= 3:
            return {
                "kind":          "alcohol_pattern",
                "title":         f"{alcohol_ct} drink nights this week",
                "body":          "Not a lecture — just noting it. Wine nights show up in your HRV; a dry night or two tests how much of your recovery hinges on it.",
                "action_label":  "See correlations",
                "action_target": "insights",
                "priority":      60,
            }
    except Exception:
        pass
    return None


_RULES = [
    _rule_bp_high,        # 10
    _rule_hrv_drop,       # 20
    _rule_sleep_debt,     # 30
    _rule_training_gap,   # 40
    _rule_adherence_dip,  # 50
    _rule_alcohol_pattern,# 60
]


# ── Public API ───────────────────────────────────────────────────────────

def today(user_id: str, today_date: Optional[_date] = None) -> Optional[dict]:
    """Return today's nudge — from cache if generated, or newly generated
    by running the rules in priority order. None when nothing qualifies.
    Silent-fail: any exception returns None (nudges are opportunistic
    UX, never a hard requirement)."""
    if not user_id:
        return None
    sb = _sb()
    if not sb:
        return None
    t = today_date or _date.today()

    # Cache check first — never re-run rules for a day that already has
    # a nudge, so the "one per day" cap is a stable UX contract.
    try:
        cached = (sb.table("nudges")
                    .select("*")
                    .eq("user_id", user_id)
                    .eq("date", t.isoformat())
                    .limit(1)
                    .execute())
        if cached.data:
            return cached.data[0]
    except Exception:
        pass

    # Generate — first rule to fire wins
    for rule in _RULES:
        try:
            payload = rule(user_id, t)
        except Exception:
            payload = None
        if payload:
            row = {
                "user_id":       user_id,
                "date":          t.isoformat(),
                "kind":          payload["kind"],
                "title":         payload["title"],
                "body":          payload["body"],
                "action_label":  payload.get("action_label"),
                "action_target": payload.get("action_target"),
                "priority":      payload.get("priority", 100),
            }
            try:
                # Upsert with (user_id, date) unique constraint — if a
                # racing request wrote first, we just return theirs.
                res = (sb.table("nudges")
                         .upsert(row, on_conflict="user_id,date")
                         .execute())
                return (res.data or [row])[0]
            except Exception:
                log.exception("nudges upsert failed")
                return None
    return None


def dismiss(user_id: str, nudge_id: str) -> None:
    sb = _sb()
    if not sb:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        (sb.table("nudges")
           .update({"dismissed_at": now_iso})
           .eq("id", nudge_id)
           .eq("user_id", user_id)
           .execute())
    except Exception:
        log.exception("nudges dismiss failed")


def mark_acted(user_id: str, nudge_id: str) -> None:
    sb = _sb()
    if not sb:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        (sb.table("nudges")
           .update({"acted_at": now_iso})
           .eq("id", nudge_id)
           .eq("user_id", user_id)
           .execute())
    except Exception:
        log.exception("nudges mark_acted failed")
