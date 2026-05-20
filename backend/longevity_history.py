"""
Longevity Score history for BackNine.

The dashboard computes a fresh composite Longevity Score on every load but
never stored it, so there was no way to see how it tracks over time. This
module persists one row per (user_id, date) in public.longevity_history and
can reconstruct a real trend from existing Oura data.

Two population paths:
  • record()   — called on each dashboard load to snapshot today's
                 authoritative score (overwrites any backfilled estimate
                 for the same date).
  • backfill() — recomputes ~90 days of daily scores from oura_daily_cache:
                 per-day HRV/RHR, trailing 7-day sleep & step averages, and
                 the user's latest VO2 max / body-fat carried back as
                 constants (those move slowly, so a flat line is honest).

Everything here is best-effort: callers wrap in try/except so a history
failure never breaks the dashboard.
"""

import os
from datetime import date, datetime, timedelta
from typing import Optional

import longevity as lon


# ── Supabase ────────────────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


# ── Write ───────────────────────────────────────────────────────────────────

def record(user_id: str, date_str: str, score: dict) -> None:
    """Upsert a single day's Longevity Score. No-op if the score is empty."""
    if not user_id or not date_str or not score:
        return
    if score.get("score") is None:
        return
    sb = _sb()
    sb.table("longevity_history").upsert({
        "user_id":              user_id,
        "date":                 date_str,
        "score":                score.get("score"),
        "grade":                score.get("grade"),
        "biological_age_delta": score.get("biological_age_delta"),
        "components":           score.get("components") or {},
        "computed_at":          datetime.utcnow().isoformat(),
    }, on_conflict="user_id,date").execute()


# ── Read ────────────────────────────────────────────────────────────────────

def get_history(user_id: str, days: int = 90) -> list[dict]:
    """Return [{date, score, grade, biological_age_delta}] ascending by date."""
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    sb = _sb()
    res = (
        sb.table("longevity_history")
        .select("date, score, grade, biological_age_delta")
        .eq("user_id", user_id)
        .gte("date", since)
        .order("date", desc=False)
        .execute()
    )
    out = []
    for r in (res.data or []):
        if r.get("score") is None:
            continue
        out.append({
            "date":                 str(r["date"]),
            "score":                r["score"],
            "grade":                r.get("grade"),
            "biological_age_delta": r.get("biological_age_delta"),
        })
    return out


def _row_count(user_id: str) -> int:
    sb = _sb()
    res = (
        sb.table("longevity_history")
        .select("date", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    return res.count or 0


# ── Backfill from oura_daily_cache ──────────────────────────────────────────

def _load_cache(user_id: str, since: str) -> dict:
    """Return { date_str: {sleep_model, activity} } from oura_daily_cache."""
    sb = _sb()
    res = (
        sb.table("oura_daily_cache")
        .select("date, sleep_model, activity")
        .eq("user_id", user_id)
        .gte("date", since)
        .execute()
    )
    out = {}
    for r in (res.data or []):
        out[str(r["date"])] = {
            "sleep_model": r.get("sleep_model") or {},
            "activity":    r.get("activity")    or {},
        }
    return out


def _trailing_avg(values_by_date: dict, end_date: str, key: str, window: int = 7):
    """Average of `key` over the `window` days ending at end_date (inclusive)."""
    end = date.fromisoformat(end_date)
    vals = []
    for i in range(window):
        d = (end - timedelta(days=i)).isoformat()
        row = values_by_date.get(d)
        if not row:
            continue
        v = row.get(key)
        if v:
            vals.append(v)
    return (sum(vals) / len(vals)) if vals else None


def backfill(
    user_id: str,
    profile: dict,
    vo2_max: Optional[float] = None,
    body_fat: Optional[float] = None,
    days: int = 90,
) -> int:
    """
    Reconstruct daily Longevity Scores from oura_daily_cache and upsert them.

    Only days that have an HRV reading (i.e. a real sleep night) get a point,
    so the trend reflects actual recovery rather than carried-back constants.
    Returns the number of rows written.
    """
    # Pull a 7-day lookback beyond the window so trailing averages on the
    # earliest backfilled days still have data to draw from.
    since = (date.today() - timedelta(days=days + 7)).isoformat()
    cache = _load_cache(user_id, since)
    if not cache:
        return 0

    # Build per-date sleep (total seconds) and steps maps for trailing averages.
    sleep_by_date = {
        d: {"total": (c["sleep_model"] or {}).get("total")}
        for d, c in cache.items()
    }
    steps_by_date = {
        d: {"steps": (c["activity"] or {}).get("steps")}
        for d, c in cache.items()
    }

    cutoff = (date.today() - timedelta(days=days - 1)).isoformat()
    rows = []
    for d in sorted(cache):
        if d < cutoff:
            continue
        sm = cache[d]["sleep_model"] or {}
        hrv = sm.get("hrv")
        if hrv is None:
            continue  # no real night → skip

        sleep_total_avg = _trailing_avg(sleep_by_date, d, "total")
        sleep_hours = (sleep_total_avg / 3600) if sleep_total_avg else None
        steps_avg = _trailing_avg(steps_by_date, d, "steps")

        metrics = {
            "hrv":                 hrv,
            "rhr":                 sm.get("rhr"),
            "vo2_max":             vo2_max,
            "body_fat_percentage": body_fat,
            "sleep_hours":         round(sleep_hours, 2) if sleep_hours else None,
            "steps":               round(steps_avg) if steps_avg else None,
        }
        score = lon.compute(metrics, profile)
        if score.get("score") is None:
            continue

        rows.append({
            "user_id":              user_id,
            "date":                 d,
            "score":                score.get("score"),
            "grade":                score.get("grade"),
            "biological_age_delta": score.get("biological_age_delta"),
            "components":           score.get("components") or {},
            "computed_at":          datetime.utcnow().isoformat(),
        })

    if not rows:
        return 0

    sb = _sb()
    sb.table("longevity_history").upsert(rows, on_conflict="user_id,date").execute()
    return len(rows)


def ensure_history(
    user_id: str,
    anchor_date: str,
    score: dict,
    profile: dict,
    vo2_max: Optional[float] = None,
    body_fat: Optional[float] = None,
    days: int = 90,
) -> None:
    """
    Convenience for the dashboard endpoint: record today's authoritative score,
    then run a one-time backfill if the user has little/no history yet.

    Best-effort — never raises.
    """
    # Backfill first (when history is sparse) so the authoritative live score
    # below always wins for today's date rather than being overwritten by the
    # carried-back estimate. Once a user has a real series this is a no-op
    # (one cheap COUNT per load).
    try:
        if _row_count(user_id) < 14:
            backfill(user_id, profile, vo2_max, body_fat, days=days)
    except Exception:
        pass
    try:
        record(user_id, anchor_date, score)
    except Exception:
        pass
