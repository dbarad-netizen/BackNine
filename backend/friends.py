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
from datetime import date, datetime, timedelta, timezone
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

    # Fetch reactions + comment counts for these events in one round-trip each.
    event_ids = [r["id"] for r in rows]
    comment_counts = _comment_counts_for(sb, event_ids)
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
            "user_name":     author_name,
            "is_me":         r["user_id"] == user_id,
            "summary":       _summarize_event({**r, "user_name": author_name}),
            "comment_count": comment_counts.get(r["id"], 0),
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


# ── Daily milestone events ────────────────────────────────────────────────────
#
# Auto-generated Pulse events from passive Oura data. Most BackNine users
# don't manually log workouts every day, but their bodies generate
# interesting numbers nightly via Oura — these milestones surface the
# noteworthy moments so a friend with great sleep/readiness/HRV broadcasts
# without lifting a finger.
#
# Privacy: only positive milestones broadcast to friends. Bad-news patterns
# (HRV drops, poor sleep) stay private in coach_observations.
# Dedup: each milestone fires at most once per user per calendar day per type.

MILESTONE_SLEEP_THRESHOLD     = 85
MILESTONE_READINESS_THRESHOLD = 85
MILESTONE_ACTIVITY_THRESHOLD  = 85
MILESTONE_HRV_REBOUND_PCT     = 0.15  # +15% vs yesterday


def _has_event_for_date(sb, user_id: str, event_type: str, anchor: str) -> bool:
    """True if a milestone of this type was already written for this user on
    this anchor date. Uses the payload.date field so backfilled events
    (whose created_at sits on the actual day, not 'today') dedup correctly.
    """
    try:
        res = (
            sb.table("activity_events")
            .select("id")
            .eq("user_id", user_id)
            .eq("event_type", event_type)
            .filter("payload->>date", "eq", anchor)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        # If the dedup check fails, prefer not writing (better to under-share
        # than to spam the feed with duplicates).
        return True


def generate_daily_milestones(
    user_id: str,
    user_name: str,
    *,
    anchor: str,
    t_rdy: dict,
    t_sl: dict,
    t_act: dict,
    t_sm: dict,
    rm: dict,
    slm: dict,
    am: dict,
    smm: dict,
    prediction_streak: Optional[int] = None,
    created_at_override: Optional[str] = None,
) -> list[dict]:
    """Detect and record milestone events for the given anchor date.

    When backfilling historical days, pass `created_at_override` (ISO8601) so
    the event's timestamp lands on the actual day rather than 'now' — keeps
    the feed sorted in chronological order.
    """
    if not user_id:
        return []
    sb = _sb()
    written: list[dict] = []

    def _emit(event_type: str, payload: dict) -> None:
        if _has_event_for_date(sb, user_id, event_type, anchor):
            return
        try:
            row: dict = {
                "user_id":    user_id,
                "user_name":  user_name or "Friend",
                "event_type": event_type,
                "payload":    {**_trim_payload(payload), "date": anchor},
            }
            if created_at_override:
                row["created_at"] = created_at_override
            res = sb.table("activity_events").insert(row).execute()
            if res.data:
                written.append(res.data[0])
        except Exception:
            pass

    # 1. Great sleep
    sleep_score = (t_sl or {}).get("score")
    if isinstance(sleep_score, (int, float)) and sleep_score >= MILESTONE_SLEEP_THRESHOLD:
        _emit("great_sleep", {"score": int(sleep_score)})

    # 2. Great readiness
    rdy_score = (t_rdy or {}).get("score")
    if isinstance(rdy_score, (int, float)) and rdy_score >= MILESTONE_READINESS_THRESHOLD:
        _emit("great_readiness", {"score": int(rdy_score)})

    # 3. Great activity
    act_score = (t_act or {}).get("score")
    if isinstance(act_score, (int, float)) and act_score >= MILESTONE_ACTIVITY_THRESHOLD:
        _emit("great_activity", {"score": int(act_score)})

    # 4. HRV rebound — today is meaningfully higher than yesterday
    today_hrv = (t_sm or {}).get("hrv")
    if today_hrv:
        # Find the most recent prior day with HRV data
        prior_days = [d for d in sorted(smm.keys(), reverse=True) if d < anchor]
        for pd in prior_days[:3]:  # walk back up to 3 days to handle gaps
            prev_hrv = (smm.get(pd) or {}).get("hrv")
            if prev_hrv:
                delta = today_hrv - prev_hrv
                if delta > 0 and delta / prev_hrv >= MILESTONE_HRV_REBOUND_PCT:
                    _emit("hrv_rebound", {
                        "hrv":       int(today_hrv),
                        "prev_hrv":  int(prev_hrv),
                        "delta":     int(delta),
                        "delta_pct": round(delta / prev_hrv * 100),
                    })
                break

    # 5. Personal best sleep — today is the 30-day high
    if isinstance(sleep_score, (int, float)):
        prior_scores = [
            (slm.get(d) or {}).get("score")
            for d in sorted(slm.keys(), reverse=True)
            if d < anchor
        ]
        prior_scores = [s for s in prior_scores if isinstance(s, (int, float)) and s > 0]
        if prior_scores and sleep_score > max(prior_scores[:30]):
            _emit("personal_best_sleep", {
                "score":    int(sleep_score),
                "previous": int(max(prior_scores[:30])),
            })

    # 6. Prediction streak — broadcast the same milestones we track privately
    if prediction_streak and prediction_streak in {3, 5, 7, 14, 30, 60, 100}:
        _emit("prediction_streak", {"streak": int(prediction_streak)})

    return written


def generate_milestones_with_backfill(
    user_id: str,
    user_name: str,
    *,
    rm: dict,
    slm: dict,
    am: dict,
    smm: dict,
    today: str,
    backfill_days: int = 7,
    prediction_streak: Optional[int] = None,
) -> int:
    """Run the milestone detector for `today` plus the prior `backfill_days`.

    This is the engine for catching up a friend's Pulse feed when they haven't
    logged in for a while — every dashboard load fans this across the user
    *and* each of their friends, so a single login fills in a week of history.

    Backfilled events get their created_at set to noon on the actual anchor
    date so the feed sorts naturally; only today's events use 'now'. Dedup is
    keyed by payload.date so re-running is a no-op.

    Returns the total number of events written across all days.
    """
    if not user_id:
        return 0
    try:
        today_d = date.fromisoformat(today)
    except Exception:
        return 0

    total = 0
    for d_offset in range(backfill_days + 1):
        anchor_date = (today_d - timedelta(days=d_offset)).isoformat()
        # Today gets natural `now` timestamp; backfilled days get noon on that day.
        created_at = None if d_offset == 0 else f"{anchor_date}T12:00:00+00:00"
        events = generate_daily_milestones(
            user_id,
            user_name,
            anchor=anchor_date,
            t_rdy=rm.get(anchor_date, {})  or {},
            t_sl=slm.get(anchor_date, {}) or {},
            t_act=am.get(anchor_date, {})  or {},
            t_sm=smm.get(anchor_date, {}) or {},
            rm=rm,
            slm=slm,
            am=am,
            smm=smm,
            # Only broadcast streak milestones for the most recent day. The
            # streak number is current-state; replaying it across history
            # would create misleading "you hit a 5-day streak 4 days ago" cards.
            prediction_streak=prediction_streak if d_offset == 0 else None,
            created_at_override=created_at,
        )
        total += len(events)
    return total


# ── Cheers (single-tap acknowledgment between friends) ───────────────────────
#
# A cheer is a lightweight, single-tap event a user sends to a friend from
# the daily leaderboard. It writes an activity_event with event_type='cheer'
# and payload {target_user_id, target_name, date}. Dedup: one cheer per
# (cheerer, target, day). Shows up in the recipient's Pulse feed.

# Single 'cheer' event_type carries different `kind`s in payload so the row
# stays unified in activity_events. Dedup is one taunt per (sender, target,
# day) regardless of kind — picking one CTA per day per friend keeps the
# preset row simple ("you already taunted Sarah today") and the feed clean.
TAUNT_KINDS = {"cheer", "catch_me", "race_me", "slow_today"}


def send_taunt(
    sender_id: str,
    target_id: str,
    sender_name: str,
    target_name: str,
    today: str,
    kind: str = "cheer",
) -> Optional[dict]:
    """Record a taunt (cheer / catch_me / race_me / slow_today) from
    sender_id to target_id for `today`.

    Dedup: one taunt per (sender, target, day) total, regardless of kind.
    If the user already sent a taunt today, returns that row instead of
    inserting a new one (idempotent — the UI's optimistic flip won't end up
    with duplicate events even if the user double-taps).
    """
    if not sender_id or not target_id or sender_id == target_id:
        return None
    kind = (kind or "cheer").lower()
    if kind not in TAUNT_KINDS:
        kind = "cheer"

    sb = _sb()
    try:
        existing = (
            sb.table("activity_events")
            .select("id, payload, created_at, event_type")
            .eq("user_id", sender_id)
            .eq("event_type", "cheer")
            .filter("payload->>date",            "eq", today)
            .filter("payload->>target_user_id",  "eq", target_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]
        row = {
            "user_id":    sender_id,
            "user_name":  sender_name or "Friend",
            "event_type": "cheer",
            "payload": {
                "kind":           kind,
                "target_user_id": target_id,
                "target_name":    target_name or "Friend",
                "date":           today,
            },
        }
        res = sb.table("activity_events").insert(row).execute()
        return (res.data or [row])[0]
    except Exception:
        return None


# Back-compat alias — older callers still invoke send_cheer.
def send_cheer(
    cheerer_id: str,
    target_id: str,
    cheerer_name: str,
    target_name: str,
    today: str,
) -> Optional[dict]:
    return send_taunt(cheerer_id, target_id, cheerer_name, target_name, today, kind="cheer")


def taunts_sent_today(sender_id: str, today: str) -> dict[str, str]:
    """Return {target_user_id: kind} for taunts sent today.

    Lets the frontend collapse the preset row to '✓ Sent 🔥 Catch me' for
    the friends already taunted, while keeping the row interactive for the
    rest. Empty dict on any failure (best-effort, never raises).
    """
    if not sender_id:
        return {}
    sb = _sb()
    try:
        res = (
            sb.table("activity_events")
            .select("payload")
            .eq("user_id", sender_id)
            .eq("event_type", "cheer")
            .filter("payload->>date", "eq", today)
            .execute()
        )
    except Exception:
        return {}
    out: dict[str, str] = {}
    for r in (res.data or []):
        p = r.get("payload") or {}
        tid  = p.get("target_user_id")
        kind = p.get("kind") or "cheer"
        if tid:
            out[tid] = kind
    return out


# Back-compat alias used by the existing /api/friends/leaderboard wrapper
# until callers migrate to taunts_sent_today.
def cheers_sent_today(cheerer_id: str, today: str) -> set[str]:
    return set(taunts_sent_today(cheerer_id, today).keys())


# ── Per-event comments (Pulse reply threads) ─────────────────────────────────
#
# Comments are scoped to a single activity_event. Tapping a Pulse card on the
# Scorecard expands an inline reply thread; this is the storage + read layer.
# Author display names are live-joined from user_profiles at read time so a
# friend who later sets their display name updates retroactively.

MAX_COMMENT_CHARS = 500


def _comment_counts_for(sb, event_ids: list[str]) -> dict[str, int]:
    """Aggregate comment counts per event in a single round-trip."""
    if not event_ids:
        return {}
    try:
        res = (
            sb.table("event_comments")
            .select("event_id")
            .in_("event_id", event_ids)
            .execute()
        )
    except Exception:
        return {}
    counts: dict[str, int] = {}
    for r in (res.data or []):
        eid = r["event_id"]
        counts[eid] = counts.get(eid, 0) + 1
    return counts


def list_event_comments(event_id: str, current_user_id: str, limit: int = 50) -> list[dict]:
    """Return all comments for an event, oldest-first. Live-joins user names."""
    if not event_id:
        return []
    sb = _sb()
    try:
        res = (
            sb.table("event_comments")
            .select("id, event_id, user_id, user_name, text, created_at")
            .eq("event_id", event_id)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
    except Exception:
        return []
    rows = res.data or []
    if not rows:
        return []
    user_ids = list({r["user_id"] for r in rows})
    live_names = _names_for(sb, user_ids)
    out: list[dict] = []
    for r in rows:
        cached = r.get("user_name")
        live = live_names.get(r["user_id"])
        author = (
            live
            or (cached if cached and cached not in {"BackNine user", "A BackNine friend"} else None)
            or "Friend"
        )
        out.append({
            **r,
            "user_name": author,
            "is_me":     r["user_id"] == current_user_id,
        })
    return out


def post_event_comment(event_id: str, user_id: str, user_name: str, text: str) -> dict:
    """Post a comment on an event. Server-side enforces length cap.

    Raises ValueError if text is empty or the event doesn't exist.
    """
    if not event_id:
        raise ValueError("event_id is required")
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Comment cannot be empty")
    cleaned = cleaned[:MAX_COMMENT_CHARS]

    sb = _sb()

    # Verify the event exists so we can't accumulate orphaned comments via
    # a stale event_id from a deleted post.
    evt = (
        sb.table("activity_events")
        .select("id")
        .eq("id", event_id)
        .limit(1)
        .execute()
    )
    if not evt.data:
        raise ValueError("event not found")

    row = {
        "event_id":  event_id,
        "user_id":   user_id,
        "user_name": user_name or "Friend",
        "text":      cleaned,
    }
    res = sb.table("event_comments").insert(row).execute()
    return (res.data or [row])[0]


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

    # ── Auto-generated milestone events ──
    if et == "great_sleep":
        s = p.get("score")
        return f"{name} had a strong night — sleep {s}" if s else f"{name} slept well"
    if et == "great_readiness":
        s = p.get("score")
        return f"{name} is primed today — readiness {s}" if s else f"{name} is feeling primed"
    if et == "great_activity":
        s = p.get("score")
        return f"{name} crushed it — activity {s}" if s else f"{name} had a big day"
    if et == "hrv_rebound":
        h = p.get("hrv")
        d = p.get("delta")
        if h and d:
            return f"{name}'s HRV bounced back to {h} (+{d} from yesterday)"
        return f"{name}'s HRV bounced back"
    if et == "personal_best_sleep":
        s = p.get("score")
        if s:
            return f"{name}'s best sleep in 30 days ({s})"
        return f"{name} set a sleep personal best"
    if et == "prediction_streak":
        s = p.get("streak")
        if s:
            return f"{name} hit a {int(s)}-day prediction streak 🔥"
        return f"{name} extended their streak"

    if et == "cheer":
        target = p.get("target_name") or "a friend"
        kind   = p.get("kind") or "cheer"
        if kind == "catch_me":
            return f"{name} told {target} to catch up 🔥"
        if kind == "race_me":
            return f"{name} challenged {target} to a race 💪"
        if kind == "slow_today":
            return f"{name} called {target} out for being slow 🐌"
        return f"{name} cheered {target} 👏"

    return f"{name} did something"
