"""
Stack adherence — daily "did you take X today?" tracking.

David's insight (2026-07-09): the current stack-efficacy engine compares
before/after averages using the profile-entry date as the "start."
Problem: users often add supplements retroactively, and nobody takes
every dose every day. The efficacy claim is fiction without adherence.

This module gives users a checklist per active med/supp/peptide, one
tap per item per day. Downstream the efficacy engine can compare
"days-taken" vs "days-missed" instead of "before-added" vs "after-added"
— a much cleaner signal, unpolluted by weekend skips or the mid-cycle
"I ran out" gap.

Also drives a small points reward for the streak system so tracking
becomes intrinsically motivating.

Public API:
  log_adherence(user_id, date, item_kind, item_key, item_name, taken, notes?)
  get_day(user_id, date) → list of adherence rows for that day
  get_range(user_id, start, end) → list of adherence rows
  today_snapshot(user_id, today_iso, profile) → { items: [...], summary: {...} }
      Combines the user's stack (from profile) with today's adherence,
      returning a checklist-ready payload.
  count_recent(user_id, days) → int — used by the points bonus.
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, timedelta
from typing import Optional


log = logging.getLogger(__name__)


_VALID_KINDS = {"medication", "supplement", "peptide"}


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _norm_key(name: str) -> str:
    """Lowercase, strip, collapse whitespace. Matches how we key the
    profile stack elsewhere so an item added on the profile side lines
    up with its adherence entry."""
    return " ".join((name or "").strip().lower().split())


# ── writes ──────────────────────────────────────────────────────────────

def log_adherence(
    user_id:   str,
    date_str:  str,
    item_kind: str,
    item_name: str,
    taken:     bool,
    notes:     Optional[str] = None,
) -> dict:
    if not user_id:
        raise ValueError("user_id required")
    if item_kind not in _VALID_KINDS:
        raise ValueError(f"item_kind must be one of {sorted(_VALID_KINDS)}")
    name = (item_name or "").strip()
    if not name:
        raise ValueError("item_name required")
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")
    row = {
        "user_id":   user_id,
        "date":      date_str,
        "item_kind": item_kind,
        "item_key":  _norm_key(name),
        "item_name": name[:120],
        "taken":     bool(taken),
        "notes":     (notes or "").strip()[:200] or None,
    }
    # Upsert on the unique key so re-tapping the same box just flips it
    # rather than exploding rows.
    res = (sb.table("stack_adherence_log")
             .upsert(row, on_conflict="user_id,date,item_kind,item_key")
             .execute())
    return (res.data or [row])[0]


# ── reads ───────────────────────────────────────────────────────────────

def get_day(user_id: str, date_str: str) -> list[dict]:
    if not (user_id and date_str):
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        res = (sb.table("stack_adherence_log")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("date", date_str)
                 .execute())
        return res.data or []
    except Exception:
        return []


def get_range(user_id: str, start_iso: str, end_iso: str) -> list[dict]:
    if not user_id:
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        res = (sb.table("stack_adherence_log")
                 .select("*")
                 .eq("user_id", user_id)
                 .gte("date", start_iso)
                 .lte("date", end_iso)
                 .order("date", desc=True)
                 .limit(4000).execute())
        return res.data or []
    except Exception:
        return []


def count_recent(user_id: str, days: int = 7) -> int:
    """How many adherence entries the user has logged in the last N
    days. Used to award points ('You logged 5 items today +5 pts')."""
    if not user_id:
        return 0
    sb = _sb()
    if not sb:
        return 0
    try:
        cutoff = (_date.today() - timedelta(days=days)).isoformat()
        res = (sb.table("stack_adherence_log")
                 .select("id", count="exact")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .execute())
        return int(res.count or len(res.data or []))
    except Exception:
        return 0


# ── higher-level snapshot ───────────────────────────────────────────────

def _items_from_profile(profile: dict) -> list[dict]:
    """Extract the union of med / supp / peptide names from the user's
    profile. Returns [{kind, name}, ...]. De-duplicates by (kind, key)."""
    if not isinstance(profile, dict):
        return []
    out:  list[dict] = []
    seen: set[tuple[str, str]] = set()
    for kind, field in (
        ("medication", "medications"),
        ("supplement", "supplements"),
        ("peptide",    "peptides"),
    ):
        arr = profile.get(field) or []
        if not isinstance(arr, list):
            continue
        for item in arr:
            name = ""
            if isinstance(item, dict):
                name = (item.get("name") or "").strip()
            elif isinstance(item, str):
                name = item.strip()
            if not name:
                continue
            k = (kind, _norm_key(name))
            if k in seen:
                continue
            seen.add(k)
            out.append({"kind": kind, "name": name})
    return out


def today_snapshot(user_id: str, today_iso: str, profile: dict) -> dict:
    """Combined view for the frontend checklist. Each stack item gets a
    boolean `taken_today` (from today's log rows if any) plus a 7-day
    streak count so the UI can show "5 of the last 7 days"."""
    items = _items_from_profile(profile)
    if not items:
        return {"date": today_iso, "items": [], "summary": {
            "total_items": 0, "taken_today": 0, "logged_today": 0,
        }}
    day_rows = {(r.get("item_kind"), r.get("item_key")): r for r in get_day(user_id, today_iso)}
    # 7-day streak lookup
    start_7 = (_date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
    hist = get_range(user_id, start_7, today_iso)
    hist_taken: dict[tuple[str, str], int] = {}
    for r in hist:
        if not r.get("taken"):
            continue
        k = (r.get("item_kind"), r.get("item_key"))
        hist_taken[k] = hist_taken.get(k, 0) + 1

    enriched: list[dict] = []
    taken_today  = 0
    logged_today = 0
    for it in items:
        key = _norm_key(it["name"])
        k   = (it["kind"], key)
        row = day_rows.get(k)
        taken = bool(row.get("taken")) if row else False
        if row is not None:
            logged_today += 1
        if taken:
            taken_today += 1
        enriched.append({
            "kind":         it["kind"],
            "name":         it["name"],
            "key":          key,
            "taken_today":  taken,
            "logged_today": row is not None,
            "notes":        (row or {}).get("notes"),
            "days_taken_7": hist_taken.get(k, 0),
        })

    return {
        "date": today_iso,
        "items": enriched,
        "summary": {
            "total_items":  len(items),
            "taken_today":  taken_today,
            "logged_today": logged_today,
        },
    }


__all__ = [
    "log_adherence", "get_day", "get_range", "count_recent",
    "today_snapshot",
]
