"""
Friends-at-a-glance — quick pulse on what each of your friends is up to.

Reuses the weekly_recap aggregator per friend so we get a consistent
snapshot: this-week sessions, PRs, sleep streak, protein days. One small
endpoint feeds the horizontal scroll strip at the top of the PulseFeed.

Why per-friend recap call (vs. one big query):
  • The recap aggregator is fast (small per-user queries) and already
    deals with sparse data gracefully.
  • Reusing it guarantees the friend-glance numbers MATCH whatever shows
    up when that friend shares their weekly recap to the feed — same
    source of truth, no drift.
  • Friend lists in BackNine are small (typical 5-20). We cap at MAX_FRIENDS
    just to bound worst-case latency.

Best-effort throughout. Any friend whose recap blows up just gets a
minimal "Friend" entry — the strip still renders.
"""

from __future__ import annotations

from typing import Optional

import friends as fr
import weekly_recap as wrecap


MAX_FRIENDS = 12


def _glance_for(user_id: str, friend_name: str) -> dict:
    """Compute one friend's pulse. Catches per-friend exceptions so a
    Supabase hiccup on one row doesn't kill the whole strip."""
    try:
        recap = wrecap.build_payload(user_id, None)
    except Exception:
        recap = None

    if not recap:
        return {
            "user_id":      user_id,
            "name":         friend_name,
            "has_activity": False,
            "workouts":     0,
            "pr_count":     0,
            "sleep_streak": 0,
            "protein_days": 0,
            "highlight":    None,
            "headline":     None,
        }

    t = recap.get("training")  or {}
    s = recap.get("sleep")     or {}
    n = recap.get("nutrition") or {}
    return {
        "user_id":      user_id,
        "name":         friend_name,
        "has_activity": bool(recap.get("has_content")),
        "workouts":     int(t.get("workouts") or 0),
        "pr_count":     int(t.get("pr_count") or 0),
        "sleep_streak": int(s.get("streak_nights") or 0),
        "protein_days": int(n.get("protein_days") or 0),
        "highlight":    recap.get("highlight"),
        "headline":     recap.get("headline"),
    }


def build_payload(viewer_id: str) -> dict:
    """Friend pulse strip for the viewer. Self is excluded — this is "your
    friends at a glance", not "your own dashboard"."""
    friends = fr.list_friends(viewer_id) or []
    friends = [f for f in friends if f.get("user_id") and f["user_id"] != viewer_id]
    if not friends:
        return {"friends": [], "viewer_has_friends": False}

    friends = friends[:MAX_FRIENDS]
    out: list[dict] = []
    for f in friends:
        glance = _glance_for(f["user_id"], (f.get("name") or "Friend").strip())
        out.append(glance)

    # Most-active first so the strip leads with the friend doing something
    # right now (highest pr_count, then workouts, then sleep streak).
    out.sort(
        key=lambda g: (
            -int(g.get("pr_count") or 0),
            -int(g.get("workouts") or 0),
            -int(g.get("sleep_streak") or 0),
            (g.get("name") or "").lower(),
        )
    )
    return {"friends": out, "viewer_has_friends": True}
