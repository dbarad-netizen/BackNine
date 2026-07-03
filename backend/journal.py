"""
Private reflection journal.

The user writes a daily "what's on your mind" entry. Optional tags
(work / family / sleep / training / nutrition / stress / gratitude)
let the existing correlation engine connect dots to physical metrics.

PRIVACY CONTRACT — non-negotiable, enforced at every layer:
  • Journal text NEVER appears in PulseFeed, friend events, Weekly Recap,
    or Group chat.
  • Friends NEVER see your journal — not the text, not the existence of it.
  • Coach Al sees recent entries inside HIS own private chat with you,
    with an explicit instruction in his system prompt that the content
    stays in this conversation.
  • Only the user can read their own entries. Service-key access in this
    module is scoped per user_id at every query.

Out of scope (intentional, per product decision):
  • Active crisis detection / intervention. We expose a passive 988
    footer in the UI but do not classify or escalate entries.
  • Mood diagnostics (PHQ-9, GAD-7, etc.).
  • Therapist matching or any clinical referral pathway.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

from supabase import create_client, Client


# Suggested tag set surfaced to the user. Free-text tags are also allowed
# but suggesting these keeps the correlation engine usable (it needs
# repeated tag values to compute deltas).
SUGGESTED_TAGS = [
    "work",
    "family",
    "stress",
    "sleep",
    "training",
    "nutrition",
    "gratitude",
    "travel",
    "social",
    "solo",
]


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── CRUD ─────────────────────────────────────────────────────────────────

def save_entry(user_id: str, date_iso: str, text: str, tags: Optional[list[str]] = None) -> Optional[dict]:
    """Upsert one journal entry. One entry per (user, date) — re-saving
    on the same date overwrites. Returns the saved row."""
    sb = _sb()
    if not sb or not user_id or not date_iso:
        return None
    clean_text = (text or "").strip()
    if not clean_text:
        # Empty entry → delete any existing row for that day. Lets the
        # user clear out an entry without leaving a ghost.
        try:
            sb.table("journal_entries").delete().eq("user_id", user_id).eq("date", date_iso).execute()
        except Exception:
            pass
        return None
    clean_tags = []
    for t in (tags or []):
        s = (t or "").strip().lower()
        if s and len(s) <= 40:
            clean_tags.append(s)
    # De-dupe while preserving order, cap at 6
    seen: set[str] = set()
    deduped: list[str] = []
    for t in clean_tags:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    deduped = deduped[:6]

    row = {
        "user_id":    user_id,
        "date":       date_iso,
        "text":       clean_text[:5000],
        "tags":       deduped,
        "updated_at": datetime.utcnow().isoformat(),
    }
    try:
        res = sb.table("journal_entries").upsert(row, on_conflict="user_id,date").execute()
        return (res.data or [row])[0]
    except Exception:
        return None


def get_entry(user_id: str, date_iso: str) -> Optional[dict]:
    sb = _sb()
    if not sb or not user_id or not date_iso:
        return None
    try:
        res = (
            sb.table("journal_entries")
            .select("id, date, text, tags, created_at, updated_at")
            .eq("user_id", user_id)
            .eq("date", date_iso)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def list_recent(user_id: str, days: int = 30, limit: int = 60) -> list[dict]:
    """Return the user's recent entries, newest first. Used by Coach Al
    context and the correlation engine."""
    sb = _sb()
    if not sb or not user_id:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        res = (
            sb.table("journal_entries")
            .select("id, date, text, tags, created_at, updated_at")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .order("date", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def get_streak(user_id: str, today_iso: Optional[str] = None) -> int:
    """Consecutive days (ending TODAY or YESTERDAY) with at least one
    journal entry. Today is allowed in the streak — unlike sleep, the
    user has full control over whether they journal today.

    Walks back day by day until it finds a missing one."""
    try:
        today = _date.fromisoformat(today_iso) if today_iso else _date.today()
    except Exception:
        today = _date.today()
    sb = _sb()
    if not sb or not user_id:
        return 0
    cutoff = (today - timedelta(days=365)).isoformat()
    try:
        res = (
            sb.table("journal_entries")
            .select("date")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .order("date", desc=True)
            .execute()
        )
        dates: set[str] = {str(r.get("date")) for r in (res.data or []) if r.get("date")}
    except Exception:
        return 0
    if not dates:
        return 0
    # Start counting from today; if today missing, start from yesterday
    # (so a user who hasn't journaled YET today still sees their streak).
    cursor = today
    if cursor.isoformat() not in dates:
        cursor = cursor - timedelta(days=1)
    streak = 0
    while cursor.isoformat() in dates:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


# ── correlations ────────────────────────────────────────────────────────

def correlate_tags(user_id: str, days: int = 60, min_occurrences: Optional[int] = None) -> dict:
    """For each tag the user has used at least `min_occurrences` times in
    the window, compare metrics on tag-positive days vs. tag-negative
    days. Returns a list of (tag, metric, positive_avg, negative_avg).

    Mirrors the structure of oura_tags.correlate_tags so the frontend
    can render both side-by-side on the Insights page.

    Pure observational deltas — same 'associated with, not caused by'
    framing as the existing symptom-correlation panel.
    """
    sb = _sb()
    if not sb or not user_id:
        return {"window_days": days, "items": [], "tag_day_counts": {}}

    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        e_res = (
            sb.table("journal_entries")
            .select("date, tags")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .execute()
        )
        entries = e_res.data or []
    except Exception:
        entries = []

    tag_days: dict[str, set[str]] = {}
    for e in entries:
        date_str = str(e.get("date") or "")
        if not date_str:
            continue
        for t in (e.get("tags") or []):
            t_clean = (t or "").lower().strip()
            if t_clean:
                tag_days.setdefault(t_clean, set()).add(date_str)

    if not tag_days:
        return {"window_days": days, "items": [], "tag_day_counts": {}}

    try:
        c_res = (
            sb.table("oura_daily_cache")
            .select("date, readiness, sleep_model")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .execute()
        )
        cache_rows = c_res.data or []
    except Exception:
        cache_rows = []

    rm: dict[str, dict] = {}
    smm: dict[str, dict] = {}
    for r in cache_rows:
        d = str(r.get("date") or "")
        if not d:
            continue
        if r.get("readiness"):   rm[d]  = r["readiness"]
        if r.get("sleep_model"): smm[d] = r["sleep_model"]

    def _to_f(v) -> Optional[float]:
        if v is None: return None
        try: return float(v)
        except (TypeError, ValueError): return None

    def get_metrics(day: str) -> dict[str, Optional[float]]:
        sleep = smm.get(day) or {}
        ready = rm.get(day)  or {}
        total_sec = sleep.get("total")
        return {
            "sleep_total_h":     (total_sec / 3600.0) if total_sec else None,
            "sleep_efficiency":  _to_f(sleep.get("efficiency")),
            "hrv":               _to_f(sleep.get("hrv")),
            "rhr":               _to_f(sleep.get("rhr")),
            "readiness_score":   _to_f(ready.get("score")),
        }

    all_days = set(rm.keys()) | set(smm.keys())
    if not all_days:
        return {"window_days": days, "items": [], "tag_day_counts": {code: len(s) for code, s in tag_days.items()}}

    metric_units = {
        "sleep_total_h":    "h",
        "sleep_efficiency": "%",
        "hrv":              "ms",
        "rhr":              "bpm",
        "readiness_score":  "/100",
    }
    lower_better = {"rhr"}

    # Fable IMPROVE #4: shared confidence gate.
    from correlation_confidence import (
        MIN_SAMPLE_SIZE, MIN_NEG_SAMPLE_SIZE,
        confidence_level, should_surface, confidence_label,
    )
    threshold = min_occurrences if min_occurrences is not None else MIN_SAMPLE_SIZE

    items: list[dict] = []
    for tag, days_set in tag_days.items():
        if len(days_set) < threshold:
            continue
        for metric_key, unit in metric_units.items():
            pos_vals = [get_metrics(d)[metric_key] for d in days_set if d in all_days]
            pos_vals = [v for v in pos_vals if v is not None]
            neg_days = all_days - days_set
            neg_vals = [get_metrics(d)[metric_key] for d in neg_days]
            neg_vals = [v for v in neg_vals if v is not None]
            if len(pos_vals) < MIN_SAMPLE_SIZE or len(neg_vals) < MIN_NEG_SAMPLE_SIZE:
                continue
            pos_avg = sum(pos_vals) / len(pos_vals)
            neg_avg = sum(neg_vals) / len(neg_vals)
            delta   = pos_avg - neg_avg
            if abs(delta) < 0.05:
                continue
            pct = (delta / neg_avg * 100) if neg_avg else 0
            abs_pct = round(abs(pct), 1)
            if not should_surface(len(pos_vals), len(neg_vals), abs_pct):
                continue
            worse = (delta < 0) if metric_key not in lower_better else (delta > 0)
            conf = confidence_level(len(pos_vals), len(neg_vals))
            items.append({
                "tag":           tag,
                "metric":        metric_key,
                "metric_label":  metric_key.replace("_", " ").title(),
                "unit":          unit,
                "positive_days": len(pos_vals),
                "negative_days": len(neg_vals),
                "positive_avg":  round(pos_avg, 1),
                "negative_avg":  round(neg_avg, 1),
                "delta":         round(delta, 1),
                "abs_pct":       abs_pct,
                "worse_on_tag":  worse,
                "confidence":       conf,
                "confidence_label": confidence_label(conf, len(pos_vals)),
            })

    items.sort(key=lambda i: -i["abs_pct"])
    return {
        "window_days":    days,
        "items":          items[:20],
        "tag_day_counts": {tag: len(s) for tag, s in tag_days.items()},
        "min_sample_size": MIN_SAMPLE_SIZE,
    }
