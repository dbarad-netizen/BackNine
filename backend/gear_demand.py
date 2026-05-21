"""
Gear demand tracking for BackNine.

Every Coach Al gear search is logged (best-effort — it must never break the
finder). Aggregated, this becomes a running "what people want" list the owner
can use to decide what to add to the catalog next.

Schema: supabase_gear_searches.sql.
"""

import os
from collections import Counter
from datetime import datetime, timezone, timedelta


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


def log_search(
    user_id: str,
    query: str,
    had_match: bool,
    pick_ids: list[str] | None = None,
    suggestion_titles: list[str] | None = None,
) -> None:
    """Best-effort insert. Swallows all errors so the finder is never affected."""
    q = (query or "").strip()
    if not q:
        return
    try:
        sb = _sb()
        sb.table("gear_searches").insert({
            "user_id":           user_id,
            "query":             q[:300],
            "had_match":         bool(had_match),
            "pick_ids":          [str(p)[:80] for p in (pick_ids or [])][:10],
            "suggestion_titles": [str(s)[:120] for s in (suggestion_titles or [])][:10],
        }).execute()
    except Exception:
        pass


def _norm(s: str) -> str:
    return " ".join((s or "").strip().lower().split())


def top_demand(days: int = 120, limit: int = 50) -> dict:
    """
    Aggregate the demand signal over the last `days`. Returns:
      total_searches:    int
      match_rate:        float (0-1) — share of searches we had a catalog pick for
      gaps:              [{title, count}]  most-requested product types NOT in catalog
      unmatched_queries: [{query, count}] recent queries we had no pick for
      recent:            [{query, had_match, created_at}] latest searches
    """
    since = (datetime.now(tz=timezone.utc) - timedelta(days=max(1, days))).isoformat()
    try:
        sb = _sb()
        res = (
            sb.table("gear_searches")
            .select("query, had_match, pick_ids, suggestion_titles, created_at")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .limit(2000)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    total = len(rows)
    matched = sum(1 for r in rows if r.get("had_match"))

    # Most-requested gap product types — what Coach Al kept suggesting we don't carry.
    gap_counter: Counter = Counter()
    gap_display: dict[str, str] = {}
    for r in rows:
        for title in (r.get("suggestion_titles") or []):
            key = _norm(title)
            if not key:
                continue
            gap_counter[key] += 1
            gap_display.setdefault(key, str(title).strip())
    gaps = [
        {"title": gap_display[k], "count": c}
        for k, c in gap_counter.most_common(limit)
    ]

    # Queries we couldn't satisfy from the catalog, grouped.
    unmatched_counter: Counter = Counter()
    unmatched_display: dict[str, str] = {}
    for r in rows:
        if r.get("had_match"):
            continue
        key = _norm(r.get("query", ""))
        if not key:
            continue
        unmatched_counter[key] += 1
        unmatched_display.setdefault(key, str(r.get("query", "")).strip())
    unmatched = [
        {"query": unmatched_display[k], "count": c}
        for k, c in unmatched_counter.most_common(limit)
    ]

    recent = [
        {
            "query":      str(r.get("query", "")).strip(),
            "had_match":  bool(r.get("had_match")),
            "created_at": r.get("created_at"),
        }
        for r in rows[:30]
    ]

    return {
        "total_searches": total,
        "match_rate":     round(matched / total, 2) if total else None,
        "gaps":           gaps,
        "unmatched_queries": unmatched,
        "recent":         recent,
    }
