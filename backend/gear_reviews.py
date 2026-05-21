"""
Communal gear reviews for BackNine.

Any user can leave one review per gear item (a 1-5 star rating and/or text),
visible to everyone — giving the gear shop social proof. gear_item_id is the
static catalog id from the frontend gearData.

Schema: supabase_gear_reviews.sql.
"""

import os
from datetime import datetime, timezone


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


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


def list_reviews(item_id: str, user_id: str) -> list[dict]:
    sb = _sb()
    res = (
        sb.table("gear_reviews")
        .select("*")
        .eq("gear_item_id", item_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []
    names = _names_for(sb, list({r["user_id"] for r in rows}))
    out = []
    for r in rows:
        out.append({
            "id":         r["id"],
            "user_id":    r["user_id"],
            "user_name":  names.get(r["user_id"], "Friend"),
            "rating":     r.get("rating"),
            "text":       r.get("text") or "",
            "created_at": r.get("created_at"),
            "is_me":      r["user_id"] == user_id,
        })
    # Put the current user's own review first so editing is obvious.
    out.sort(key=lambda x: (not x["is_me"], x["created_at"] or ""), reverse=False)
    out.sort(key=lambda x: x["is_me"], reverse=True)
    return out


def upsert_review(user_id: str, item_id: str, rating, text: str) -> dict:
    """Create or update the user's single review for this item."""
    r = None
    if rating is not None:
        try:
            r = max(1, min(5, int(rating)))
        except (TypeError, ValueError):
            r = None
    text = (text or "").strip()[:1000]
    if r is None and not text:
        raise ValueError("Add a rating or a comment")

    sb = _sb()
    sb.table("gear_reviews").upsert(
        {
            "gear_item_id": item_id,
            "user_id":      user_id,
            "rating":       r,
            "text":         text or None,
            "updated_at":   _now(),
        },
        on_conflict="gear_item_id,user_id",
    ).execute()
    return {"ok": True}


def delete_review(user_id: str, item_id: str) -> bool:
    sb = _sb()
    try:
        res = (
            sb.table("gear_reviews")
            .delete()
            .eq("gear_item_id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def summary() -> dict:
    """Return { gear_item_id: {avg, count} } across all items, for the shop grid."""
    sb = _sb()
    try:
        res = sb.table("gear_reviews").select("gear_item_id, rating").execute()
    except Exception:
        return {}
    agg: dict[str, dict] = {}
    for r in (res.data or []):
        item = r["gear_item_id"]
        a = agg.setdefault(item, {"sum": 0, "rated": 0, "count": 0})
        a["count"] += 1
        if r.get("rating"):
            a["sum"] += r["rating"]
            a["rated"] += 1
    return {
        item: {
            "avg":   round(a["sum"] / a["rated"], 1) if a["rated"] else None,
            "count": a["count"],
        }
        for item, a in agg.items()
    }
