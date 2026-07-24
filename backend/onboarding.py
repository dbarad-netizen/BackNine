"""
Cold-start onboarding — derived state for the welcome flow.

The welcome card on the Scorecard walks a brand-new user through three
steps in ~60 seconds:

  1. Connect your Oura ring (or skip — everything else still works).
  2. Set your #1 goal so Coach Al can personalize.
  3. Do your first check-in (mood tap on Daily Check-in).

Rather than a new "onboarding_steps" table with its own state machine,
this module *derives* completion from existing signals — the same rows
the rest of the app is already reading. That way there's no drift: the
card can never disagree with the app.

Signals:
  • foursome_invited ← row exists in friend_invites OR friendships for this user
  • oura_connected   ← row exists in oura_connections OR wearable_connections
  • goal_set         ← row exists in user_goals for this user
  • checked_in       ← row exists in symptom_logs OR mood_logs in last 3 days

Ordering (David 2026-07-23, Fable competitive brief): foursome-first.
Community is BackNine's structural moat that Bevel and Aveil can't
fast-follow. Making it the first step of onboarding (instead of a
hidden feature) is the highest-leverage default we can set.

Dismissal:
  • profiles.onboarding_dismissed_at timestamp column. Once set, we return
    show=false regardless of step completion.

Public API:
  status(user_id) → {
      show: bool,
      steps: {oura_connected, goal_set, checked_in},
      dismissed_at: str|None,
      completed: bool,
  }
  dismiss(user_id) → stamps profiles.onboarding_dismissed_at = now()
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import create_client, Client


log = logging.getLogger(__name__)


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _has_foursome(sb: Client, user_id: str) -> bool:
    """Any sent invite OR accepted friendship counts. The point of the
    step is the intent to include people — a pending invite is enough."""
    for table, cols in (
        ("friend_invites", "inviter_id"),
        ("friendships",    "user_id"),
    ):
        try:
            res = (sb.table(table)
                     .select("id", count="exact")
                     .eq(cols, user_id)
                     .limit(1).execute())
            if res.data:
                return True
        except Exception:
            continue
    # Also check reciprocal side of friendships (a friend added you)
    try:
        res = (sb.table("friendships")
                 .select("id", count="exact")
                 .eq("friend_id", user_id)
                 .limit(1).execute())
        if res.data:
            return True
    except Exception:
        pass
    return False


def _has_oura(sb: Client, user_id: str) -> bool:
    """Any live Oura connection under this user id."""
    try:
        res = (sb.table("oura_connections")
                 .select("user_id", count="exact")
                 .eq("user_id", user_id)
                 .limit(1).execute())
        if res.data:
            return True
    except Exception:
        pass
    try:
        res = (sb.table("wearable_connections")
                 .select("user_id", count="exact")
                 .eq("user_id", user_id)
                 .eq("provider", "oura")
                 .limit(1).execute())
        return bool(res.data)
    except Exception:
        return False


def _has_goal(sb: Client, user_id: str) -> bool:
    """Any user-set goal — the goals table is the source of truth."""
    for table in ("user_goals", "goals"):
        try:
            res = (sb.table(table)
                     .select("id", count="exact")
                     .eq("user_id", user_id)
                     .limit(1).execute())
            if res.data:
                return True
        except Exception:
            continue
    return False


def _has_recent_checkin(sb: Client, user_id: str) -> bool:
    """A check-in (mood tap or symptom log) in the last 3 days is enough
    to consider onboarding step 3 done. The 3-day window lets someone who
    onboarded on Friday come back Monday without re-triggering the card
    just because they missed the weekend."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).date().isoformat()
    for table in ("symptom_logs", "mood_logs", "daily_checkins"):
        try:
            res = (sb.table(table)
                     .select("id", count="exact")
                     .eq("user_id", user_id)
                     .gte("date", cutoff)
                     .limit(1).execute())
            if res.data:
                return True
        except Exception:
            continue
    return False


def _dismissed_at(sb: Client, user_id: str) -> Optional[str]:
    try:
        res = (sb.table("profiles")
                 .select("onboarding_dismissed_at")
                 .eq("id", user_id)
                 .limit(1).execute())
        if res.data:
            return res.data[0].get("onboarding_dismissed_at")
    except Exception:
        return None
    return None


def status(user_id: str) -> dict:
    """Return the derived onboarding state. Safe to call every dashboard
    load — reads at most 4 small Supabase rows."""
    empty = {
        "show":         False,
        "steps":        {
            "foursome_invited": False,
            "oura_connected":   False,
            "goal_set":         False,
            "checked_in":       False,
        },
        "dismissed_at": None,
        "completed":    False,
    }
    if not user_id:
        return empty
    sb = _sb()
    if not sb:
        return empty

    steps = {
        "foursome_invited": _has_foursome(sb, user_id),
        "oura_connected":   _has_oura(sb, user_id),
        "goal_set":         _has_goal(sb, user_id),
        "checked_in":       _has_recent_checkin(sb, user_id),
    }
    completed    = all(steps.values())
    dismissed_at = _dismissed_at(sb, user_id)

    # Show the card ONLY when there's real value in it: at least one
    # step is incomplete AND the user hasn't explicitly dismissed. That
    # keeps the Scorecard clean the second onboarding is meaningfully
    # done, and forever after a Skip tap.
    show = (not completed) and (not dismissed_at)

    return {
        "show":         show,
        "steps":        steps,
        "dismissed_at": dismissed_at,
        "completed":    completed,
    }


def dismiss(user_id: str) -> bool:
    """Stamp profiles.onboarding_dismissed_at with now(). Returns True on
    success, False on any failure. Best-effort — never raises."""
    if not user_id:
        return False
    sb = _sb()
    if not sb:
        return False
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        # Upsert so first-time users (no profiles row yet) also work.
        sb.table("profiles").upsert(
            {"id": user_id, "onboarding_dismissed_at": now_iso},
            on_conflict="id",
        ).execute()
        return True
    except Exception as exc:
        log.warning("onboarding.dismiss failed for %s: %s", user_id, exc)
        return False


__all__ = ["status", "dismiss"]
