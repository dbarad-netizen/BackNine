"""
device_readings — unified ingestion + resolver for biometric data.

Every wearable / app integration writes to one table (public.device_readings)
through `upsert_reading`. The resolver `get_reading` and series getter
`get_series` pick the best source per metric per day, eliminating the
hand-rolled "prefer AH for steps, fall back to Oura" branches scattered
through the dashboard.

Why this exists: every new integration (Fitbit, Withings, Whoop, Garmin)
otherwise needs to be wired into the dashboard with its own special case.
With this module, a new integration is just a writer — the read path is
already source-aware.

Source preference is encoded per metric (PREFERENCE_BY_METRIC) so the
resolver reflects domain knowledge: Whoop dominates HRV, Withings owns
weight, Apple Health is best for steps (live throughout the day), etc.
Edit those tables here rather than the call sites.
"""

import os
from datetime import date, timedelta
from typing import Any, Dict, List, Optional


# ── Source preference ───────────────────────────────────────────────────────
# Per-metric ranking of which source we trust more when multiple sources have
# a reading for the same day. Lower index = higher trust. Anything not listed
# falls to the bottom (manual is always last). When adding a new integration,
# slot it into each list at the rank that matches its accuracy for that metric.

PREFERENCE_BY_METRIC: Dict[str, List[str]] = {
    # Steps — Apple Health wins because it pulls from the iPhone all day and
    # is the most "live" source. Oura/Fitbit catch up overnight; Whoop barely
    # tracks steps so it's last.
    "steps":                  ["apple_health", "fitbit",       "garmin",       "oura",         "whoop",        "manual"],
    # Sleep — Whoop's algo is widely considered top-tier, Oura close behind,
    # Apple Health is broadly OK from the Watch.
    "sleep_hours":            ["whoop",        "oura",         "apple_health", "fitbit",       "garmin",       "manual"],
    # HRV — same ranking as sleep; these devices measure it overnight.
    "hrv":                    ["whoop",        "oura",         "apple_health", "fitbit",       "garmin",       "manual"],
    # Resting HR — Oura's nightly average is rock-solid; Whoop next.
    "resting_hr":             ["oura",         "whoop",        "apple_health", "fitbit",       "garmin",       "manual"],
    # Weight — connected smart scales beat phone-typed entries. Withings is
    # the consumer leader; InBody for gym scans; Apple Health if synced from
    # a connected scale.
    "weight_kg":              ["withings",     "inbody",       "apple_health", "fitbit",       "manual"],
    "body_fat_pct":           ["inbody",       "withings",     "apple_health", "fitbit",       "manual"],
    "lean_body_mass_kg":      ["inbody",       "withings",     "apple_health", "manual"],
    "skeletal_muscle_mass_kg":["inbody",       "withings",     "apple_health", "manual"],
    # Active calories — Whoop's strain model is best for daily burn; Apple
    # Health excellent if Watch worn all day.
    "active_calories":        ["whoop",        "apple_health", "fitbit",       "garmin",       "oura",         "manual"],
    # VO2 max — Apple Watch + Garmin are the two consumer leaders; Oura/Whoop
    # estimate but less accurately.
    "vo2_max":                ["garmin",       "apple_health", "whoop",        "oura",         "manual"],
    # Respiratory rate — Oura and Whoop measure overnight; Apple Health
    # surfaces it from the Watch.
    "respiratory_rate":       ["oura",         "whoop",        "apple_health", "fitbit",       "manual"],
    # SpO2 — Apple Health (from the Watch) is the most widely available;
    # Garmin / Fitbit next.
    "spo2":                   ["apple_health", "garmin",       "fitbit",       "oura",         "manual"],
    # Blood pressure — Withings BPM is the most accurate consumer device.
    "blood_pressure_systolic":  ["withings", "apple_health", "manual"],
    "blood_pressure_diastolic": ["withings", "apple_health", "manual"],
}

# Default rank when a source isn't in the preference list for a metric — push
# it ahead of manual but behind all explicitly-ranked sources.
_DEFAULT_RANK = 100
_MANUAL_RANK  = 1000


def _rank_for(source: str, metric: str) -> int:
    pref = PREFERENCE_BY_METRIC.get(metric, [])
    try:
        return pref.index(source)
    except ValueError:
        return _MANUAL_RANK if source == "manual" else _DEFAULT_RANK


# ── Supabase client (lazy, service-role) ────────────────────────────────────
_supabase = None


def _sb():
    global _supabase
    if _supabase is None:
        try:
            from supabase import create_client
        except ImportError as e:
            raise RuntimeError("supabase client not installed") from e
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
        _supabase = create_client(url, key)
    return _supabase


# ── Writer ──────────────────────────────────────────────────────────────────

def upsert_reading(
    user_id:    str,
    source:     str,
    metric:     str,
    date_str:   str,
    value:      Optional[float],
    unit:       Optional[str] = None,
    metadata:   Optional[Dict[str, Any]] = None,
) -> None:
    """Write one (user, source, metric, date) reading.

    A None or NaN `value` is treated as "no data" and silently skipped — that
    way integrations can call `upsert_reading` unconditionally for every
    metric they pull and we don't have to gate each call site.
    """
    if value is None:
        return
    try:
        v = float(value)
    except (TypeError, ValueError):
        return
    if v != v:                                  # NaN
        return
    if not user_id or not source or not metric or not date_str:
        return
    try:
        sb = _sb()
        sb.table("device_readings").upsert({
            "user_id":   user_id,
            "source":    source,
            "metric":    metric,
            "date":      date_str,
            "value":     v,
            "unit":      unit,
            "metadata":  metadata or {},
            "updated_at": "now()",
        }, on_conflict="user_id,source,metric,date").execute()
    except Exception:
        # Never break the calling integration over a dual-write failure during
        # the transition period. Errors will show up in Render logs but the
        # canonical write to the source-specific table is what matters.
        pass


def upsert_many(
    user_id:  str,
    source:   str,
    date_str: str,
    values:   Dict[str, Any],
    units:    Optional[Dict[str, str]] = None,
) -> None:
    """Convenience: write multiple metrics for one (user, source, date) in one
    call. `values` maps metric -> raw value; `units` maps metric -> unit.
    Skips any None / NaN values.
    """
    units = units or {}
    for metric, value in (values or {}).items():
        upsert_reading(user_id, source, metric, date_str, value, units.get(metric))


# ── Resolver ────────────────────────────────────────────────────────────────

def get_reading(user_id: str, metric: str, date_str: str) -> Optional[dict]:
    """Best-source reading for one (user, metric, date). Returns
    {value, source, unit, recorded_at} or None if no source has data."""
    if not user_id or not metric or not date_str:
        return None
    try:
        sb = _sb()
        res = (sb.table("device_readings")
                 .select("source,value,unit,recorded_at")
                 .eq("user_id", user_id)
                 .eq("metric", metric)
                 .eq("date", date_str)
                 .execute())
        rows = res.data or []
    except Exception:
        return None
    if not rows:
        return None
    # Pick the row with the lowest preference rank for this metric.
    rows.sort(key=lambda r: _rank_for(r.get("source", ""), metric))
    winner = rows[0]
    return {
        "value":       winner.get("value"),
        "source":      winner.get("source"),
        "unit":        winner.get("unit"),
        "recorded_at": winner.get("recorded_at"),
    }


def get_series(
    user_id:   str,
    metric:    str,
    start_str: str,
    end_str:   str,
) -> List[dict]:
    """Best-source time series for a date range, inclusive. Returns one entry
    per day in the range — days with no data get value=None so the caller can
    draw gaps in a sparkline.
    """
    if not user_id or not metric or not start_str or not end_str:
        return []
    try:
        sb = _sb()
        res = (sb.table("device_readings")
                 .select("source,value,unit,date")
                 .eq("user_id", user_id)
                 .eq("metric", metric)
                 .gte("date", start_str)
                 .lte("date", end_str)
                 .execute())
        rows = res.data or []
    except Exception:
        rows = []

    # Group by date, pick winner per day.
    by_date: Dict[str, List[dict]] = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)

    try:
        start_d = date.fromisoformat(start_str)
        end_d   = date.fromisoformat(end_str)
    except ValueError:
        return []

    out: List[dict] = []
    d = start_d
    while d <= end_d:
        iso = d.isoformat()
        candidates = by_date.get(iso, [])
        if candidates:
            candidates.sort(key=lambda r: _rank_for(r.get("source", ""), metric))
            w = candidates[0]
            out.append({"date": iso, "value": w.get("value"), "source": w.get("source")})
        else:
            out.append({"date": iso, "value": None, "source": None})
        d += timedelta(days=1)
    return out


def latest_reading(user_id: str, metric: str, lookback_days: int = 14) -> Optional[dict]:
    """Best-source most-recent reading for a metric, walking back up to
    `lookback_days` days. Useful for `latest_weight`, `latest_vo2_max` etc.
    Returns {date, value, source} or None.
    """
    if not user_id or not metric:
        return None
    today = date.today()
    series = get_series(
        user_id, metric,
        (today - timedelta(days=max(0, lookback_days))).isoformat(),
        today.isoformat(),
    )
    for row in reversed(series):
        if row.get("value") is not None:
            return row
    return None
