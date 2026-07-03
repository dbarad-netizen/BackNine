"""
Coach Al persistent memory.

Fable IMPROVE #2: "If Coach Al doesn't hold stated goals, injuries, and
preferences across sessions — not just re-read the data — it will feel
dumber than the $12.99 competitor. If it does, surface it ('I remembered
you're avoiding lunges')."

This module manages a small set of user-authored facts Coach Al should
carry across every conversation. Categories:
    injury     — "torn meniscus, avoiding lunges"
    preference — "no coffee after 11am"
    goal       — "training for October 15 marathon"
    medical    — "hypertension, controlled with lisinopril"
    lifestyle  — "wake at 5am for surf"
    other      — free-form

Design principles:
  • The user OWNS these facts. They add and remove them explicitly —
    Coach Al doesn't infer them (auto-extraction from chat is possible
    but explicitly deferred to a later phase).
  • Every fact rendered to Coach Al is short (≤ 240 chars) and text-only.
    No structured medical data — keep this a wellness memory, not a
    health record.
  • Soft delete via `active=false` so history is preserved but Coach Al
    only sees the current set.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Literal, Optional

from supabase import create_client, Client


Category = Literal["injury", "preference", "goal", "medical", "lifestyle", "other"]

CATEGORIES: list[Category] = [
    "injury", "preference", "goal", "medical", "lifestyle", "other",
]

CATEGORY_DISPLAY: dict[str, dict] = {
    "injury":     {"label": "Injury / limitation", "emoji": "🩹"},
    "preference": {"label": "Preference",           "emoji": "⚙️"},
    "goal":       {"label": "Goal",                 "emoji": "🎯"},
    "medical":    {"label": "Medical context",      "emoji": "🩺"},
    "lifestyle":  {"label": "Lifestyle",            "emoji": "🌿"},
    "other":      {"label": "Other",                "emoji": "📝"},
}

MAX_CONTENT_LEN = 240
MAX_ACTIVE_PER_USER = 40   # soft cap; UI enforces


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def list_memories(user_id: str, active_only: bool = True) -> list[dict]:
    """User's memories, most-recently-updated first. Decorated with the
    category display info so the frontend can render without a lookup."""
    sb = _sb()
    if not sb or not user_id:
        return []
    try:
        q = (
            sb.table("user_memory")
              .select("id, category, content, source, active, created_at, updated_at")
              .eq("user_id", user_id)
              .order("updated_at", desc=True)
        )
        if active_only:
            q = q.eq("active", True)
        res = q.execute()
        rows = res.data or []
    except Exception:
        return []
    for r in rows:
        r["display"] = CATEGORY_DISPLAY.get(r["category"]) or CATEGORY_DISPLAY["other"]
    return rows


def add_memory(user_id: str, category: str, content: str) -> Optional[dict]:
    """Insert a new memory. Rejects invalid category, empty content, and
    content over MAX_CONTENT_LEN."""
    sb = _sb()
    if not sb or not user_id:
        return None
    cat = (category or "").strip().lower()
    if cat not in CATEGORIES:
        cat = "other"
    text = (content or "").strip()
    if not text:
        return None
    text = text[:MAX_CONTENT_LEN]
    row = {
        "user_id":    user_id,
        "category":   cat,
        "content":    text,
        "source":     "user",
        "active":     True,
        "updated_at": datetime.utcnow().isoformat(),
    }
    try:
        res = sb.table("user_memory").insert(row).execute()
        saved = (res.data or [row])[0]
        saved["display"] = CATEGORY_DISPLAY.get(saved["category"]) or CATEGORY_DISPLAY["other"]
        return saved
    except Exception:
        return None


def update_memory(user_id: str, memory_id: str, category: Optional[str] = None,
                  content: Optional[str] = None) -> Optional[dict]:
    """Patch a memory. Only updates fields the user actually changed."""
    sb = _sb()
    if not sb or not user_id or not memory_id:
        return None
    patch: dict = {"updated_at": datetime.utcnow().isoformat()}
    if category is not None:
        cat = category.strip().lower()
        if cat in CATEGORIES:
            patch["category"] = cat
    if content is not None:
        text = content.strip()[:MAX_CONTENT_LEN]
        if text:
            patch["content"] = text
    if len(patch) == 1:   # only updated_at → nothing meaningful
        return None
    try:
        res = (
            sb.table("user_memory")
              .update(patch)
              .eq("user_id", user_id)
              .eq("id", memory_id)
              .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        saved = rows[0]
        saved["display"] = CATEGORY_DISPLAY.get(saved["category"]) or CATEGORY_DISPLAY["other"]
        return saved
    except Exception:
        return None


def delete_memory(user_id: str, memory_id: str) -> bool:
    """Soft-delete via active=false. Preserves history for future undo/audit."""
    sb = _sb()
    if not sb or not user_id or not memory_id:
        return False
    try:
        res = (
            sb.table("user_memory")
              .update({"active": False, "updated_at": datetime.utcnow().isoformat()})
              .eq("user_id", user_id)
              .eq("id", memory_id)
              .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def get_active_memories_for_chat(user_id: str, limit: int = 40) -> list[dict]:
    """Return the memories Coach Al should see in his system prompt.
    Ordered by category priority (injury / medical first — those are the
    most important for him to respect), then most-recently-updated."""
    all_mem = list_memories(user_id, active_only=True)
    # Priority order — injuries and medical context should never fall
    # off the end of a long list.
    priority = {"injury": 0, "medical": 1, "goal": 2, "preference": 3, "lifestyle": 4, "other": 5}
    all_mem.sort(key=lambda m: (priority.get(m.get("category") or "other", 99), m.get("updated_at") or ""))
    return all_mem[:limit]
