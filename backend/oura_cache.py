"""
Oura data cache — stores parsed daily metrics in Supabase oura_daily_cache.

The webhook handler writes here after receiving a push notification from Oura.
The dashboard reads from here first; only falls back to a live Oura API call
when the cache is stale or empty.

Schema (oura_daily_cache):
  user_id      text
  date         date          PK
  readiness    jsonb         { score, hrv, temp_dev }
  sleep_score  jsonb         { score, efficiency }
  activity     jsonb         { score, steps, active_cal }
  sleep_model  jsonb         { total, deep, rem, hrv, rhr, efficiency, bedtime_start, sleep_need }
  fetched_at   timestamptz
"""

import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


def store_days(user_id: str, rm: dict, slm: dict, am: dict, smm: dict) -> int:
    """
    Upsert all days present in the four parsed-Oura dicts into oura_daily_cache.
    Returns the number of rows written.
    """
    all_dates = set(list(rm) + list(slm) + list(am) + list(smm))
    if not all_dates:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for d in all_dates:
        rows.append({
            "user_id":     user_id,
            "date":        d,
            "readiness":   rm.get(d),
            "sleep_score": slm.get(d),
            "activity":    am.get(d),
            "sleep_model": smm.get(d),
            "fetched_at":  now,
        })

    sb = _sb()
    # Upsert in batches of 100 to stay within request limits
    for i in range(0, len(rows), 100):
        sb.table("oura_daily_cache").upsert(
            rows[i : i + 100], on_conflict="user_id,date"
        ).execute()

    return len(rows)


def get_days(user_id: str, days: int = 120) -> tuple[dict, dict, dict, dict]:
    """
    Return cached Oura data as (rm, slm, am, smm) dicts keyed by YYYY-MM-DD.
    Returns four empty dicts if the cache is empty.
    """
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    sb = _sb()
    res = (
        sb.table("oura_daily_cache")
        .select("date, readiness, sleep_score, activity, sleep_model")
        .eq("user_id", user_id)
        .gte("date", since)
        .execute()
    )
    rows = res.data or []

    rm, slm, am, smm = {}, {}, {}, {}
    for row in rows:
        d = str(row["date"])
        if row.get("readiness"):   rm[d]  = row["readiness"]
        if row.get("sleep_score"): slm[d] = row["sleep_score"]
        if row.get("activity"):    am[d]  = row["activity"]
        if row.get("sleep_model"): smm[d] = row["sleep_model"]

    return rm, slm, am, smm


def is_fresh(user_id: str, max_age_hours: float = 2.0) -> bool:
    """
    Returns True if the most recent cache row was written within max_age_hours.
    Used by the dashboard to decide whether to skip the live Oura API call.
    """
    try:
        sb = _sb()
        res = (
            sb.table("oura_daily_cache")
            .select("fetched_at")
            .eq("user_id", user_id)
            .order("fetched_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        raw = rows[0]["fetched_at"]
        # Supabase returns e.g. "2026-04-17T08:00:00+00:00" or with Z suffix
        fetched = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - fetched).total_seconds() / 3600
        return age_hours < max_age_hours
    except Exception:
        return False
