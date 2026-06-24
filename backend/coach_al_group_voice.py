"""
Coach Al voice in group chat.

When a user hits a celebration-worthy moment (PR, streak milestone, shared
weekly recap), Coach Al posts a short note into every group that user
belongs to. The voice keeps members engaged with each other's wins without
requiring anyone to actively share.

Sentinel user_id "coach-al" is used as the author so the frontend can
render the post with the brand avatar + tint. The group_messages table's
user_id is text (no FK constraint), so no migration is needed.

Posts are idempotent per (group_id, member_user_id, kind, anchor_date) —
when the same milestone is detected twice we don't double-post. The dedupe
key lives in group_messages.text as a hidden prefix that we strip on the
client side; cheap and zero new tables.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timezone
from typing import Optional

from supabase import create_client, Client


COACH_AL_USER_ID  = "coach-al"
COACH_AL_NAME     = "Coach Al"

# Hidden dedupe-key prefix. The client strips this off when rendering.
DEDUPE_PREFIX     = "::bn-coach::"


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _groups_for(user_id: str) -> list[str]:
    """Return the list of group_ids the user belongs to."""
    sb = _sb()
    if not sb:
        return []
    try:
        res = sb.table("group_members").select("group_id").eq("user_id", user_id).execute()
        return [r["group_id"] for r in (res.data or [])]
    except Exception:
        return []


def _user_display_name(user_id: str) -> str:
    sb = _sb()
    if not sb:
        return "Your teammate"
    try:
        res = sb.table("user_profiles").select("name").eq("user_id", user_id).limit(1).execute()
        rows = res.data or []
        if rows and rows[0].get("name"):
            return (rows[0]["name"] or "").strip() or "Your teammate"
    except Exception:
        pass
    return "Your teammate"


def _already_posted(sb, group_id: str, dedupe_key: str) -> bool:
    """Check if a coach post with this dedupe key already exists in the
    group. We do a `like` match against the hidden prefix + key so we
    catch the row regardless of the visible text after."""
    try:
        marker = f"{DEDUPE_PREFIX}{dedupe_key}::"
        res = (
            sb.table("group_messages")
            .select("id")
            .eq("group_id", group_id)
            .eq("user_id", COACH_AL_USER_ID)
            .ilike("text", f"{marker}%")
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def _post(group_id: str, dedupe_key: str, visible_text: str) -> Optional[dict]:
    """Insert one Coach Al group message. Idempotent on dedupe_key. The
    stored text is `{PREFIX}{key}::{visible_text}` — the client strips the
    prefix on render."""
    sb = _sb()
    if not sb:
        return None
    if _already_posted(sb, group_id, dedupe_key):
        return None
    stamped = f"{DEDUPE_PREFIX}{dedupe_key}::{visible_text}"[:2000]
    try:
        res = sb.table("group_messages").insert({
            "group_id": group_id,
            "user_id":  COACH_AL_USER_ID,
            "text":     stamped,
        }).execute()
        return (res.data or [{}])[0]
    except Exception:
        return None


# ── public announce hooks ──────────────────────────────────────────────────

def announce_pr(member_user_id: str, exercise_name: str, e1rm_lbs: int, top_weight_lbs: int, top_reps: int) -> int:
    """Announce a new lifetime PR. Returns count of groups posted to."""
    if not member_user_id or not exercise_name or not e1rm_lbs:
        return 0
    name = _user_display_name(member_user_id)
    today = _date.today().isoformat()
    key = f"pr|{member_user_id}|{exercise_name.lower()}|{today}|{e1rm_lbs}"
    text = (
        f"🏆 {name} just hit a new PR on {exercise_name} — "
        f"{top_weight_lbs} lb × {top_reps} ({e1rm_lbs} lb e1RM). Pile on the 👏!"
    )
    posted = 0
    for gid in _groups_for(member_user_id):
        if _post(gid, key, text):
            posted += 1
    return posted


def announce_sleep_streak(member_user_id: str, streak_nights: int) -> int:
    """Announce a meaningful sleep streak (only at 7/14/30/60/90 thresholds
    so we don't spam the group every single morning)."""
    if not member_user_id or streak_nights not in (7, 14, 30, 60, 90):
        return 0
    name = _user_display_name(member_user_id)
    today = _date.today().isoformat()
    key = f"sleep_streak|{member_user_id}|{streak_nights}|{today}"
    text = f"💤 {name} just stacked {streak_nights} solid nights of sleep in a row. Recovery wins."
    posted = 0
    for gid in _groups_for(member_user_id):
        if _post(gid, key, text):
            posted += 1
    return posted


def announce_weekly_recap_shared(member_user_id: str, recap_payload: dict) -> int:
    """When a user shares their weekly recap publicly, post a heads-up into
    their groups so members can react in-chat too."""
    if not member_user_id:
        return 0
    name = _user_display_name(member_user_id)
    workouts = recap_payload.get("workouts") or 0
    prs      = recap_payload.get("pr_count") or 0
    highlight = recap_payload.get("highlight")
    key = f"weekly_recap|{member_user_id}|{recap_payload.get('week_start')}"
    if highlight:
        text = f"📣 {name} just shared their week — {highlight}. Open the Pulse to react."
    elif workouts or prs:
        bits = []
        if workouts: bits.append(f"{workouts} sessions")
        if prs:      bits.append(f"{prs} PR{'s' if prs != 1 else ''}")
        text = f"📣 {name} just shared their week — " + ", ".join(bits) + ". Tap to react in the Pulse."
    else:
        text = f"📣 {name} just shared a weekly recap. Show some love in the Pulse."
    posted = 0
    for gid in _groups_for(member_user_id):
        if _post(gid, key, text):
            posted += 1
    return posted
