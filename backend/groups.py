"""
Groups (Crews) for BackNine — named shared spaces with a group chat.

Unlike 1:1 DMs (friends.py), a group is an explicit room people join via a
shareable code; every member sees the same chat. Membership is the consent
model — you can only read/post in a group you belong to (enforced here and in
the route handlers).

Schema: supabase_groups.sql (groups, group_members, group_messages).
"""

import os
import random
import string
from datetime import datetime, timezone


JOIN_CODE_LEN = 6


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


def _short_code(length: int = JOIN_CODE_LEN) -> str:
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _names_for(sb, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    try:
        res = sb.table("user_profiles").select("user_id, name").in_("user_id", ids).execute()
        return {r["user_id"]: ((r.get("name") or "").strip() or "Friend") for r in (res.data or [])}
    except Exception:
        return {}


def _is_member(sb, group_id: str, user_id: str) -> bool:
    res = (
        sb.table("group_members")
        .select("user_id")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(res.data)


def _members(sb, group_id: str) -> list[dict]:
    res = sb.table("group_members").select("user_id").eq("group_id", group_id).execute()
    ids = [r["user_id"] for r in (res.data or [])]
    names = _names_for(sb, ids)
    return [{"user_id": uid, "name": names.get(uid, "Friend")} for uid in ids]


def _group_dict(sb, row: dict, user_id: str) -> dict:
    members = _members(sb, row["id"])
    return {
        "id":           row["id"],
        "name":         row["name"],
        "join_code":    row["join_code"],
        "created_by":   row.get("created_by"),
        "member_count": len(members),
        "members":      members,
    }


# ── Group lifecycle ───────────────────────────────────────────────────────────

def create_group(user_id: str, name: str, creator_name: str) -> dict:
    sb = _sb()
    name = (name or "My Group").strip()[:60]
    code = _short_code()
    row = None
    for _ in range(4):
        try:
            res = sb.table("groups").insert({
                "name": name, "join_code": code, "created_by": user_id,
            }).execute()
            row = (res.data or [None])[0]
            break
        except Exception:
            code = _short_code()
            continue
    if not row:
        raise RuntimeError("Could not create group")
    # Creator auto-joins.
    try:
        sb.table("group_members").insert({"group_id": row["id"], "user_id": user_id}).execute()
    except Exception:
        pass
    return _group_dict(sb, row, user_id)


def join_group(code: str, user_id: str) -> dict:
    if not code:
        raise ValueError("Missing join code")
    code = code.strip().upper()
    sb = _sb()
    res = sb.table("groups").select("*").eq("join_code", code).execute()
    row = (res.data or [None])[0]
    if not row:
        raise ValueError("Group not found for that code")
    if not _is_member(sb, row["id"], user_id):
        try:
            sb.table("group_members").insert({"group_id": row["id"], "user_id": user_id}).execute()
        except Exception:
            pass  # unique violation on race is fine
    return _group_dict(sb, row, user_id)


def list_groups(user_id: str) -> list[dict]:
    sb = _sb()
    mem = sb.table("group_members").select("group_id").eq("user_id", user_id).execute()
    gids = [m["group_id"] for m in (mem.data or [])]
    if not gids:
        return []
    res = sb.table("groups").select("*").in_("id", gids).order("created_at", desc=True).execute()
    return [_group_dict(sb, row, user_id) for row in (res.data or [])]


def leave_group(user_id: str, group_id: str) -> bool:
    sb = _sb()
    try:
        res = (
            sb.table("group_members")
            .delete()
            .eq("group_id", group_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


# ── Group chat ────────────────────────────────────────────────────────────────

def list_messages(user_id: str, group_id: str, limit: int = 100) -> list[dict]:
    sb = _sb()
    if not _is_member(sb, group_id, user_id):
        raise PermissionError("Not a member of this group")
    res = (
        sb.table("group_messages")
        .select("*")
        .eq("group_id", group_id)
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    rows = res.data or []
    names = _names_for(sb, list({r["user_id"] for r in rows}))
    return [
        {
            "id":         r["id"],
            "user_id":    r["user_id"],
            "user_name":  names.get(r["user_id"], "Friend"),
            "text":       r["text"],
            "created_at": r["created_at"],
            "is_me":      r["user_id"] == user_id,
        }
        for r in rows
    ]


def post_message(user_id: str, group_id: str, text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty message")
    sb = _sb()
    if not _is_member(sb, group_id, user_id):
        raise PermissionError("Not a member of this group")
    res = sb.table("group_messages").insert({
        "group_id": group_id, "user_id": user_id, "text": text[:2000],
    }).execute()
    row = (res.data or [{}])[0]
    return {
        "id":         row.get("id"),
        "user_id":    user_id,
        "user_name":  "You",
        "text":       text[:2000],
        "created_at": row.get("created_at") or _now(),
        "is_me":      True,
    }
