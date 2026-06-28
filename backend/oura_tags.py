"""
Oura enhanced_tag — store, list, correlate.

Oura's enhanced_tag endpoint is a daily lifestyle log: sauna, ice bath,
meditation, alcohol, caffeine, late meal, stressful event, travel, sleep
medication, intimacy, period, headache, supplements, etc.

Three things this module does:
  • Persist tags into public.oura_tags (idempotent on external_id)
  • Surface today's + recent tags for the Scorecard pill row
  • Correlate tag-positive days vs. tag-negative days against the user's
    sleep, readiness, HRV — the missing X-axis the existing symptom
    correlation engine needed

Privacy: SAFE_TAGS is the allow-list of tag types we'll auto-post into
the PulseFeed as friend_events. Tags outside that list (alcohol, sex,
medication, period, headache) stay LOCAL to the user — they show up on
their own Scorecard but never get auto-shared with friends.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

from supabase import create_client, Client


# ── tag display catalog ────────────────────────────────────────────────────
# Maps Oura's tag_type_code → friendly label + emoji + privacy flag.
# Unknown codes fall through to a generic 🏷️ pill.
TAG_CATALOG: dict[str, dict] = {
    # Wellness / recovery
    "tag_generic_sauna":          {"label": "Sauna",         "emoji": "🧖", "category": "recovery"},
    "tag_generic_cold_exposure":  {"label": "Cold exposure", "emoji": "🧊", "category": "recovery"},
    "tag_generic_meditation":     {"label": "Meditation",    "emoji": "🧘", "category": "recovery"},
    "tag_generic_breathwork":     {"label": "Breathwork",    "emoji": "🌬️", "category": "recovery"},
    "tag_generic_massage":        {"label": "Massage",       "emoji": "💆", "category": "recovery"},
    "tag_generic_yoga":           {"label": "Yoga",          "emoji": "🧘", "category": "recovery"},
    "tag_generic_stretching":     {"label": "Stretching",    "emoji": "🤸", "category": "recovery"},
    # Lifestyle inputs we want to correlate against
    "tag_generic_alcohol":        {"label": "Alcohol",       "emoji": "🍷", "category": "lifestyle"},
    "tag_generic_caffeine":       {"label": "Late caffeine", "emoji": "☕", "category": "lifestyle"},
    "tag_generic_late_meal":      {"label": "Late meal",     "emoji": "🍽", "category": "lifestyle"},
    "tag_generic_supplements":    {"label": "Supplements",   "emoji": "💊", "category": "lifestyle"},
    "tag_generic_sleep_medication":{"label": "Sleep meds",   "emoji": "💊", "category": "lifestyle"},
    # Life events / state
    "tag_generic_travel":         {"label": "Travel",        "emoji": "✈️", "category": "life"},
    "tag_generic_stressful_event":{"label": "Stressful day", "emoji": "😬", "category": "life"},
    "tag_generic_sick":           {"label": "Sick",          "emoji": "🤒", "category": "health"},
    "tag_generic_headache":       {"label": "Headache",      "emoji": "🤕", "category": "health"},
    "tag_generic_pain":           {"label": "Pain",          "emoji": "🩹", "category": "health"},
    "tag_generic_period":         {"label": "Period",        "emoji": "🩸", "category": "health"},
    "tag_generic_intimacy":       {"label": "Intimacy",      "emoji": "❤️", "category": "private"},
    "tag_generic_weight":         {"label": "Weigh-in",      "emoji": "⚖️", "category": "tracking"},
}

# Tags we'll auto-post into friends' PulseFeed when the user logs them.
# Conservative on purpose — everything else stays on the user's own
# Scorecard and never leaks to friends. Alcohol / intimacy / medication /
# period / pain are intentionally NEVER auto-posted.
SAFE_TAGS: set[str] = {
    "tag_generic_sauna",
    "tag_generic_cold_exposure",
    "tag_generic_meditation",
    "tag_generic_breathwork",
    "tag_generic_yoga",
    "tag_generic_stretching",
    "tag_generic_massage",
    "tag_generic_travel",
}


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def describe(tag_type_code: str) -> dict:
    """Look up the friendly label/emoji/category for a code. Unknown codes
    get a generic display so we never error out on a new tag type."""
    info = TAG_CATALOG.get(tag_type_code)
    if info:
        return {**info, "code": tag_type_code}
    # Strip the boring prefix for a nicer fallback display.
    cleaned = (tag_type_code or "").replace("tag_generic_", "").replace("_", " ").title()
    return {
        "code":     tag_type_code,
        "label":    cleaned or "Tag",
        "emoji":    "🏷️",
        "category": "other",
    }


# ── persist ────────────────────────────────────────────────────────────────

def store_tags(user_id: str, raw_tags: list[dict]) -> int:
    """Upsert Oura enhanced_tag rows into public.oura_tags. Idempotent
    on (user_id, external_id). Returns the count actually inserted/updated."""
    if not user_id or not raw_tags:
        return 0
    sb = _sb()
    if not sb:
        return 0
    rows: list[dict] = []
    for t in raw_tags:
        ext_id = t.get("id")
        code   = t.get("tag_type_code")
        if not ext_id or not code:
            continue
        rows.append({
            "user_id":       user_id,
            "external_id":   ext_id,
            "tag_type_code": code,
            "comment":       (t.get("comment") or None),
            "start_time":    t.get("start_time"),
            "end_time":      t.get("end_time"),
            "start_day":     t.get("start_day"),
            "end_day":       t.get("end_day"),
        })
    if not rows:
        return 0
    try:
        sb.table("oura_tags").upsert(rows, on_conflict="user_id,external_id").execute()
        return len(rows)
    except Exception:
        return 0


# ── read ───────────────────────────────────────────────────────────────────

def list_tags(user_id: str, days: int = 30) -> list[dict]:
    """Return the user's tags from the last N days, newest start first."""
    sb = _sb()
    if not sb or not user_id:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        res = (
            sb.table("oura_tags")
            .select("id, external_id, tag_type_code, comment, start_time, end_time, start_day, end_day")
            .eq("user_id", user_id)
            .gte("start_day", cutoff)
            .order("start_day", desc=True)
            .order("start_time", desc=True)
            .execute()
        )
        rows = res.data or []
    except Exception:
        return []
    # Decorate each row with display info.
    return [{**r, **{"display": describe(r["tag_type_code"])}} for r in rows]


def today_tags(user_id: str, today_iso: Optional[str] = None) -> list[dict]:
    """Tags logged for the user's local today only."""
    try:
        today = _date.fromisoformat(today_iso) if today_iso else _date.today()
    except Exception:
        today = _date.today()
    all_tags = list_tags(user_id, days=2)   # small window covers timezone edge
    today_str = today.isoformat()
    return [t for t in all_tags if t.get("start_day") == today_str]


# ── correlate ──────────────────────────────────────────────────────────────

def _per_day_metric(rows_by_day: dict, day: str, key: str) -> Optional[float]:
    """Extract a metric from a day's cache row, defensively."""
    row = rows_by_day.get(day) or {}
    val = row.get(key)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def correlate_tags(user_id: str, days: int = 60, min_occurrences: int = 3) -> dict:
    """For each tag type the user has logged at least `min_occurrences`
    times in the window, compare metrics on tag-positive days vs. tag-free
    days. Returns a list of (tag, metric, positive_avg, negative_avg, delta).

    Metrics compared:
      • sleep_total_h
      • sleep_efficiency
      • hrv (avg overnight)
      • rhr (lowest overnight)
      • readiness_score

    No causation claimed — pure observational deltas, like the existing
    symptom correlation engine. The narrative layer presents them as
    'associated with' patterns.
    """
    sb = _sb()
    if not sb or not user_id:
        return {"window_days": days, "items": [], "tag_day_counts": {}}

    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        t_res = (
            sb.table("oura_tags")
            .select("tag_type_code, start_day")
            .eq("user_id", user_id)
            .gte("start_day", cutoff)
            .execute()
        )
        tag_rows = t_res.data or []
    except Exception:
        tag_rows = []

    # Bucket: tag_type_code -> set of days it was logged on
    tag_days: dict[str, set[str]] = {}
    for r in tag_rows:
        code = r.get("tag_type_code")
        day  = r.get("start_day")
        if not code or not day:
            continue
        tag_days.setdefault(code, set()).add(day)

    # Pull metric data from oura_daily_cache for the same window
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

    # Metric extractors
    def get_metrics(day: str) -> dict[str, Optional[float]]:
        sleep = smm.get(day) or {}
        ready = rm.get(day)  or {}
        total_sec = sleep.get("total")
        return {
            "sleep_total_h":     (total_sec / 3600.0) if total_sec else None,
            "sleep_efficiency":  _to_float(sleep.get("efficiency")),
            "hrv":               _to_float(sleep.get("hrv")),
            "rhr":               _to_float(sleep.get("rhr")),
            "readiness_score":   _to_float(ready.get("score")),
        }

    # Build the universe of days we have metrics for
    all_days = set(rm.keys()) | set(smm.keys())
    if not all_days:
        return {"window_days": days, "items": [], "tag_day_counts": {code: len(s) for code, s in tag_days.items()}}

    items: list[dict] = []
    metric_units = {
        "sleep_total_h":    "h",
        "sleep_efficiency": "%",
        "hrv":              "ms",
        "rhr":              "bpm",
        "readiness_score":  "/100",
    }
    # Lower-is-better metrics — we flip the "worse_on_tag" framing here.
    lower_better = {"rhr"}

    for code, days_set in tag_days.items():
        if len(days_set) < min_occurrences:
            continue
        info = describe(code)
        for metric_key, unit in metric_units.items():
            pos_vals = [get_metrics(d)[metric_key] for d in days_set if d in all_days]
            pos_vals = [v for v in pos_vals if v is not None]
            neg_days = all_days - days_set
            neg_vals = [get_metrics(d)[metric_key] for d in neg_days]
            neg_vals = [v for v in neg_vals if v is not None]
            if len(pos_vals) < 2 or len(neg_vals) < 3:
                continue
            pos_avg = sum(pos_vals) / len(pos_vals)
            neg_avg = sum(neg_vals) / len(neg_vals)
            delta   = pos_avg - neg_avg
            if abs(delta) < 0.05:   # filter trivially small deltas
                continue
            pct = (delta / neg_avg * 100) if neg_avg else 0
            worse = (delta < 0) if metric_key not in lower_better else (delta > 0)
            items.append({
                "tag_code":      code,
                "tag_label":     info["label"],
                "tag_emoji":     info["emoji"],
                "metric":        metric_key,
                "metric_label":  metric_key.replace("_", " ").title(),
                "unit":          unit,
                "positive_days": len(pos_vals),
                "negative_days": len(neg_vals),
                "positive_avg":  round(pos_avg, 1),
                "negative_avg":  round(neg_avg, 1),
                "delta":         round(delta, 1),
                "abs_pct":       round(abs(pct), 1),
                "worse_on_tag":  worse,
            })

    # Sort by |delta| as % of baseline so the biggest effects bubble up.
    items.sort(key=lambda i: -i["abs_pct"])
    return {
        "window_days":     days,
        "items":           items[:20],
        "tag_day_counts":  {code: len(s) for code, s in tag_days.items()},
    }


def _to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
