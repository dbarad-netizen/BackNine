"""
Friends graph + activity event log for BackNine.

Bidirectional friendships established via one-time invite codes. The same
short-code style as challenges (see challenges._short_id) — 6 chars, no
ambiguous glyphs.

Schema lives in supabase_friends_and_events.sql.

This module is intentionally a thin wrapper around Supabase. It does NOT
verify auth — callers (main.py routes) handle that.
"""

import os
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


# ── Constants ─────────────────────────────────────────────────────────────────

INVITE_TTL_HOURS = 72   # invites are short-lived; resend if stale
INVITE_CODE_LEN  = 6


# ── Supabase client ───────────────────────────────────────────────────────────

def _sb():
    """Return a Supabase client. Lazily imported to mirror challenges.py."""
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _short_code(length: int = INVITE_CODE_LEN) -> str:
    """6-char alphanumeric code, no ambiguous glyphs (0/O/1/I)."""
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


def _ordered_pair(u1: str, u2: str) -> tuple[str, str]:
    """Return (a, b) such that a < b — canonical friendship ordering."""
    return (u1, u2) if u1 < u2 else (u2, u1)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Invites ───────────────────────────────────────────────────────────────────

def create_invite(inviter_id: str, inviter_name: str) -> dict:
    """Create a one-time invite code for inviter_id to share."""
    if not inviter_name or inviter_name.strip().lower() in {"backnine user", "a backnine friend", ""}:
        inviter_name = "Friend"

    sb = _sb()
    code = _short_code()
    # Vanishingly unlikely to collide, but loop once just in case.
    for _ in range(3):
        try:
            expires = _now() + timedelta(hours=INVITE_TTL_HOURS)
            sb.table("friend_invites").insert({
                "code":         code,
                "inviter_id":   inviter_id,
                "inviter_name": inviter_name,
                "expires_at":   expires.isoformat(),
            }).execute()
            return {
                "code":         code,
                "inviter_name": inviter_name,
                "expires_at":   expires.isoformat(),
            }
        except Exception:
            code = _short_code()
            continue
    raise RuntimeError("Could not generate a unique invite code after 3 tries")


def accept_invite(code: str, accepter_id: str, accepter_name: str) -> dict:
    """
    Consume an invite code and create the friendship.

    Returns the new friendship row. Raises ValueError if the code is missing,
    expired, already used, or self-targeted.
    """
    if not code:
        raise ValueError("Missing invite code")
    code = code.strip().upper()

    sb = _sb()
    res = (
        sb.table("friend_invites")
        .select("*")
        .eq("code", code)
        .execute()
    )
    row = (res.data or [None])[0]
    if not row:
        raise ValueError("Invite code not found")
    if row.get("used_by"):
        raise ValueError("This invite has already been used")

    # Expiry check — server-side belt-and-suspenders
    try:
        exp = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        if exp < _now():
            raise ValueError("This invite has expired")
    except ValueError:
        raise
    except Exception:
        pass  # if parsing fails, fall through and trust the DB

    inviter_id   = row["inviter_id"]
    inviter_name = row.get("inviter_name") or "Friend"
    if inviter_id == accepter_id:
        raise ValueError("You can't friend yourself")

    user_a, user_b = _ordered_pair(inviter_id, accepter_id)
    user_a_name = inviter_name if user_a == inviter_id else (accepter_name or "Friend")
    user_b_name = inviter_name if user_b == inviter_id else (accepter_name or "Friend")

    # Idempotent: if a row already exists for this pair, either it's still
    # active (no-op) or it was soft-deleted (auto-restore by clearing
    # deleted_at and refreshing the captured names). This is the "I removed
    # them by accident, here's a fresh invite" recovery path.
    existing = (
        sb.table("friendships")
        .select("*")
        .eq("user_id_a", user_a)
        .eq("user_id_b", user_b)
        .execute()
    )
    if existing.data:
        existing_row = existing.data[0]
        # Mark the invite consumed regardless of restore outcome
        sb.table("friend_invites").update({
            "used_by": accepter_id,
            "used_at": _now().isoformat(),
        }).eq("code", code).execute()
        if existing_row.get("deleted_at"):
            # Auto-restore: clear deleted_at and refresh names from the
            # current invite (which may have a better name than the original
            # row captured if a user has since set their display name).
            sb.table("friendships").update({
                "deleted_at":   None,
                "user_a_name":  user_a_name,
                "user_b_name":  user_b_name,
            }).eq("user_id_a", user_a).eq("user_id_b", user_b).execute()
            refreshed = (
                sb.table("friendships")
                .select("*")
                .eq("user_id_a", user_a)
                .eq("user_id_b", user_b)
                .execute()
            )
            return (refreshed.data or [existing_row])[0]
        return existing_row

    insert_res = sb.table("friendships").insert({
        "user_id_a":    user_a,
        "user_id_b":    user_b,
        "user_a_name":  user_a_name,
        "user_b_name":  user_b_name,
        "initiated_by": inviter_id,
    }).execute()

    # Mark the invite consumed
    sb.table("friend_invites").update({
        "used_by": accepter_id,
        "used_at": _now().isoformat(),
    }).eq("code", code).execute()

    return (insert_res.data or [{}])[0]


# ── Friends list ──────────────────────────────────────────────────────────────

def _names_for(sb, user_ids: list[str]) -> dict[str, str]:
    """Look up the live display name for each user_id from user_profiles.

    Returns a map of user_id -> name. Users missing from user_profiles or
    with a null/empty `name` column are simply absent from the map; callers
    should fall back to the denormalized name on the source row.
    """
    if not user_ids:
        return {}
    try:
        res = sb.table("user_profiles").select("user_id, name").in_("user_id", user_ids).execute()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for r in (res.data or []):
        n = (r.get("name") or "").strip()
        if n:
            out[r["user_id"]] = n
    return out


def list_friends(user_id: str) -> list[dict]:
    """Return the user's currently-active friendships (filters soft-deleted rows).

    The friend's display name is resolved live from user_profiles every read,
    so updates to a friend's profile name surface immediately in your list
    instead of waiting for the denormalized cache to be refreshed. Falls back
    to the cached row name, then to "Friend".
    """
    sb = _sb()
    a = sb.table("friendships").select("*").eq("user_id_a", user_id).is_("deleted_at", "null").execute()
    b = sb.table("friendships").select("*").eq("user_id_b", user_id).is_("deleted_at", "null").execute()
    rows = (a.data or []) + (b.data or [])
    # Single IN-query for all friend names rather than N+1 individual lookups.
    friend_ids = [
        (r["user_id_b"] if r["user_id_a"] == user_id else r["user_id_a"])
        for r in rows
    ]
    live_names = _names_for(sb, friend_ids)

    friends: list[dict] = []
    for r in rows:
        if r["user_id_a"] == user_id:
            fid    = r["user_id_b"]
            cached = r.get("user_b_name")
        else:
            fid    = r["user_id_a"]
            cached = r.get("user_a_name")
        # Prefer the live profile name; ignore stale "BackNine user" cached values.
        name = live_names.get(fid) or (cached if cached and cached != "BackNine user" else None) or "Friend"
        friends.append({
            "user_id": fid,
            "name":    name,
            "since":   r.get("created_at"),
        })
    friends.sort(key=lambda f: f.get("since") or "", reverse=True)
    return friends


def remove_friend(user_id: str, friend_user_id: str) -> dict:
    """Soft-delete the friendship between user_id and friend_user_id.

    The row is kept in place with deleted_at = now() so the friendship can
    be recovered later (via restore_friend, or auto-restored when one side
    accepts a fresh invite from the other).
    """
    a, b = _ordered_pair(user_id, friend_user_id)
    sb = _sb()
    sb.table("friendships").update({
        "deleted_at": _now().isoformat(),
    }).eq("user_id_a", a).eq("user_id_b", b).is_("deleted_at", "null").execute()
    return {"removed": True, "friend_user_id": friend_user_id}


def restore_friend(user_id: str, friend_user_id: str) -> dict:
    """Clear deleted_at on a previously soft-deleted friendship.

    Used for forensic recovery (e.g. "I accidentally removed my friend and
    can't re-invite right now"). The auto-restore path on accept_invite
    handles the common case.
    """
    a, b = _ordered_pair(user_id, friend_user_id)
    sb = _sb()
    res = sb.table("friendships").update({
        "deleted_at": None,
    }).eq("user_id_a", a).eq("user_id_b", b).execute()
    return {"restored": bool(res.data), "friend_user_id": friend_user_id}


# ── Activity events ───────────────────────────────────────────────────────────

# Limit so a runaway payload can't blow up the table.
MAX_PAYLOAD_KEYS  = 12
MAX_PAYLOAD_BYTES = 2_000


def _trim_payload(payload: dict) -> dict:
    """Defensive: trim user-supplied payloads to something sensible."""
    if not isinstance(payload, dict):
        return {}
    out: dict[str, Any] = {}
    for i, (k, v) in enumerate(payload.items()):
        if i >= MAX_PAYLOAD_KEYS:
            break
        if isinstance(v, str) and len(v) > 200:
            v = v[:200]
        out[str(k)[:40]] = v
    return out


def record_event(
    user_id: str,
    event_type: str,
    payload: Optional[dict] = None,
    user_name: Optional[str] = None,
) -> Optional[dict]:
    """Insert an activity event. Best-effort — never raises."""
    try:
        sb = _sb()
        row = {
            "user_id":    user_id,
            "user_name":  user_name or "Friend",
            "event_type": event_type,
            "payload":    _trim_payload(payload or {}),
        }
        res = sb.table("activity_events").insert(row).execute()
        return (res.data or [{}])[0]
    except Exception:
        return None


def list_friend_events(user_id: str, limit: int = 30) -> list[dict]:
    """
    Return recent events from the user's friends + themselves.

    Each row carries the original event fields plus:
      • summary    — a one-line human description
      • is_me      — whether the current user is the author
      • reactions  — list of { emoji, count, i_reacted } aggregated across reactors
    """
    sb = _sb()
    friends = list_friends(user_id)
    visible_ids = [f["user_id"] for f in friends] + [user_id]
    if not visible_ids:
        return []
    res = (
        sb.table("activity_events")
        .select("id, user_id, user_name, event_type, payload, created_at")
        .in_("user_id", visible_ids)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return []

    # Live-join author names so a recent profile rename shows up immediately
    # in the feed instead of waiting for the denormalized fan-out.
    author_ids = list({r["user_id"] for r in rows})
    live_names = _names_for(sb, author_ids)

    # Fetch reactions for these events in one round-trip
    event_ids = [r["id"] for r in rows]
    react_res = (
        sb.table("event_reactions")
        .select("event_id, user_id, emoji")
        .in_("event_id", event_ids)
        .execute()
    )
    react_rows = react_res.data or []

    # Aggregate: { event_id: { emoji: {count, i_reacted} } }
    react_by_event: dict[str, dict[str, dict]] = {}
    for rr in react_rows:
        eid   = rr["event_id"]
        emoji = rr["emoji"]
        slot  = react_by_event.setdefault(eid, {}).setdefault(emoji, {"count": 0, "i_reacted": False})
        slot["count"] += 1
        if rr["user_id"] == user_id:
            slot["i_reacted"] = True

    out: list[dict] = []
    for r in rows:
        agg = react_by_event.get(r["id"], {})
        # Prefer live profile name; ignore stale "BackNine user" cached value.
        cached_name = r.get("user_name")
        live_name = live_names.get(r["user_id"])
        author_name = (
            live_name
            or (cached_name if cached_name and cached_name != "BackNine user" else None)
            or "Friend"
        )
        out.append({
            **r,
            "user_name": author_name,
            "is_me":     r["user_id"] == user_id,
            "summary":   _summarize_event({**r, "user_name": author_name}),
            "reactions": [
                {"emoji": e, "count": v["count"], "i_reacted": v["i_reacted"]}
                for e, v in agg.items()
            ],
        })
    return out


# ── Reactions ─────────────────────────────────────────────────────────────────

ALLOWED_REACTIONS = {"🔥", "💪", "👀", "🙌", "😤"}


def toggle_reaction(user_id: str, event_id: str, emoji: str) -> dict:
    """
    Toggle a reaction. If (event_id, user_id, emoji) exists → delete it.
    Otherwise insert it. Returns the updated reactions list for the event.

    Raises ValueError for bad input or self-reaction attempts.
    """
    if not event_id or not emoji:
        raise ValueError("event_id and emoji are required")
    if emoji not in ALLOWED_REACTIONS:
        raise ValueError(f"emoji must be one of {sorted(ALLOWED_REACTIONS)}")

    sb = _sb()

    # Reject self-reactions — you can't 🔥 your own workout
    evt = (
        sb.table("activity_events")
        .select("user_id")
        .eq("id", event_id)
        .execute()
    )
    if not evt.data:
        raise ValueError("event not found")
    if evt.data[0]["user_id"] == user_id:
        raise ValueError("you can't react to your own event")

    # Check existing
    existing = (
        sb.table("event_reactions")
        .select("id")
        .eq("event_id", event_id)
        .eq("user_id", user_id)
        .eq("emoji", emoji)
        .execute()
    )
    if existing.data:
        sb.table("event_reactions").delete().eq("id", existing.data[0]["id"]).execute()
    else:
        sb.table("event_reactions").insert({
            "event_id": event_id,
            "user_id":  user_id,
            "emoji":    emoji,
        }).execute()

    # Return the fresh aggregated reaction summary for this event
    res = (
        sb.table("event_reactions")
        .select("user_id, emoji")
        .eq("event_id", event_id)
        .execute()
    )
    rows = res.data or []
    agg: dict[str, dict] = {}
    for r in rows:
        slot = agg.setdefault(r["emoji"], {"count": 0, "i_reacted": False})
        slot["count"] += 1
        if r["user_id"] == user_id:
            slot["i_reacted"] = True
    return {
        "event_id":  event_id,
        "reactions": [
            {"emoji": e, "count": v["count"], "i_reacted": v["i_reacted"]}
            for e, v in agg.items()
        ],
    }


def _summarize_event(row: dict) -> str:
    """Turn an event row into a single-line human summary for the feed."""
    et = row.get("event_type") or ""
    name = row.get("user_name") or "Someone"
    p = row.get("payload") or {}

    if et == "workout_logged":
        what = p.get("name") or "a workout"
        dur  = p.get("duration_min")
        if dur:
            return f"{name} logged {what} ({int(dur)} min)"
        return f"{name} logged {what}"
    if et == "weight_logged":
        w = p.get("weight_lbs")
        if w:
            return f"{name} logged a weigh-in ({w} lbs)"
        return f"{name} logged a weigh-in"
    if et == "challenge_joined":
        cname = p.get("challenge_name") or "a challenge"
        return f"{name} joined {cname}"
    if et == "challenge_completed":
        cname = p.get("challenge_name") or "a challenge"
        return f"{name} completed {cname}"
    if et == "streak_milestone":
        n = p.get("days")
        kind = p.get("kind") or "streak"
        if n:
            return f"{name} hit a {int(n)}-day {kind}"
        return f"{name} extended a streak"
    return f"{name} did something"
