"""
Apple Health integration — receives data POSTed from iOS Shortcuts.

Each user gets a stable API key stored in Supabase (apple_health_keys table).
The Shortcut reads from HealthKit and POSTs a JSON payload to:
  POST /api/apple-health/sync
  Headers: X-AH-Key: <user_api_key>

Payload shape (all fields optional):
{
  "date": "2026-04-15",          # ISO date, defaults to today
  "steps": 8432,
  "sleep_hours": 7.2,
  "active_calories": 512,
  "resting_hr": 58,
  "hrv": 45.3,
  "weight_kg": 82.1,
  "weight_lb": 181.0,            # either unit accepted
  "vo2_max": 48.2,
  "respiratory_rate": 15.0
}
"""

import os
import secrets
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any


# ── Supabase helper ────────────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


# ── API key management ─────────────────────────────────────────────────────────

def get_or_create_key(user_id: str) -> str:
    """Return the existing API key for this user, or generate a new one."""
    sb = _sb()
    res = sb.table("apple_health_keys").select("api_key").eq("user_id", user_id).execute()
    rows = res.data or []
    if rows:
        return rows[0]["api_key"]
    # Generate a new key: ah_ prefix + 32 random hex chars
    new_key = "ah_" + secrets.token_hex(16)
    sb.table("apple_health_keys").insert({
        "user_id": user_id,
        "api_key": new_key,
        "created_at": datetime.utcnow().isoformat(),
    }).execute()
    return new_key


def resolve_user_by_key(api_key: str) -> Optional[str]:
    """Look up user_id from an API key. Returns None if not found."""
    sb = _sb()
    res = (
        sb.table("apple_health_keys")
        .select("user_id")
        .eq("api_key", api_key)
        .execute()
    )
    rows = res.data or []
    return rows[0]["user_id"] if rows else None


# ── Data sync ──────────────────────────────────────────────────────────────────

# Canonical field names stored in Supabase
FIELDS = [
    "steps",
    "sleep_hours",
    "active_calories",
    "resting_hr",
    "hrv",
    "weight_kg",
    "vo2_max",
    "respiratory_rate",
    "body_fat_percentage",
    "lean_body_mass_kg",
    "skeletal_muscle_mass_kg",
    "bmi",
]

# Fields stored as integer in Supabase — must cast to int before insert
INTEGER_FIELDS = {"steps", "active_calories", "resting_hr"}


# Health Auto Export metric name → our field name
HAE_METRIC_MAP = {
    "step_count":                    "steps",
    "steps":                         "steps",
    "resting_heart_rate":            "resting_hr",
    "heart_rate_variability_sdnn":   "hrv",
    "heart_rate_variability":        "hrv",
    "active_energy":                 "active_calories",
    "active_energy_burned":          "active_calories",
    "body_mass":                     "weight_raw",   # unit-dependent
    "respiratory_rate":              "respiratory_rate",
    "vo2_max":                       "vo2_max",
    "sleep_duration":                "sleep_hours",
    "sleep_analysis":                "sleep_hours",
    "sleeping":                      "sleep_hours",
    "asleep":                        "sleep_hours",
    "body_fat_percentage":           "body_fat_percentage",
    "percent_body_fat":              "body_fat_percentage",
    "lean_body_mass":                "lean_body_mass_kg",
    "lean_body_mass_kg":             "lean_body_mass_kg",
    "skeletal_muscle_mass":          "skeletal_muscle_mass_kg",
    "skeletal_muscle_mass_kg":       "skeletal_muscle_mass_kg",
    "body_mass_index":               "bmi",
    "bmi":                           "bmi",
}


def parse_hae_payload(payload: dict) -> dict:
    """
    Convert a Health Auto Export REST payload into our flat dict format.
    HAE format:
      { "data": { "metrics": [ { "name": "step_count", "units": "count",
          "data": [ { "date": "2026-04-15 ...", "qty": 8432 } ] } ] } }
    Returns a flat dict like { "date": "2026-04-15", "steps": 8432, ... }
    """
    result: Dict[str, Any] = {}
    metrics = (payload.get("data") or payload).get("metrics", [])

    for metric in metrics:
        name  = metric.get("name", "").lower().replace(" ", "_")
        units = (metric.get("units") or "").lower()
        data  = metric.get("data") or []
        if not data:
            continue

        # Use the most recent data point
        latest = data[-1]
        qty = latest.get("qty") or latest.get("value")
        if qty is None:
            continue

        # Extract date (HAE dates look like "2026-04-15 00:00:00 -0700")
        raw_date = latest.get("date", "")
        date_part = raw_date[:10] if raw_date else ""
        if date_part and "date" not in result:
            result["date"] = date_part

        field = HAE_METRIC_MAP.get(name)
        if not field:
            continue

        if field == "weight_raw":
            # HAE reports body_mass in the user's preferred unit
            if "lb" in units or "pound" in units:
                result["weight_lb"] = float(qty)
            else:
                result["weight_kg"] = float(qty)
        elif field == "sleep_hours":
            # HAE may send minutes or hours depending on version
            val = float(qty)
            if units in ("min", "minutes") or val > 24:
                val = val / 60
            result["sleep_hours"] = round(val, 2)
        else:
            result[field] = float(qty)

    return result


def sync_day(user_id: str, payload: dict) -> dict:
    """
    Upsert a day's Apple Health data.
    Accepts our flat format OR Health Auto Export format automatically.
    Accepts weight_lb and converts to weight_kg automatically.
    Returns the stored row.
    """
    # Detect Health Auto Export format (has nested "data" or "metrics" key)
    if "data" in payload or "metrics" in payload:
        payload = parse_hae_payload(payload)

    date_str = payload.get("date") or date.today().isoformat()

    # Convert weight_lb → weight_kg if provided
    row: Dict[str, Any] = {
        "user_id": user_id,
        "date": date_str,
        "updated_at": datetime.utcnow().isoformat(),
    }
    for field in FIELDS:
        if field in payload and payload[field] is not None:
            try:
                val = float(payload[field])
                row[field] = int(round(val)) if field in INTEGER_FIELDS else round(val, 2)
            except (TypeError, ValueError):
                pass

    if "weight_lb" in payload and payload["weight_lb"] is not None and "weight_kg" not in row:
        try:
            row["weight_kg"] = round(float(payload["weight_lb"]) * 0.453592, 2)
        except (TypeError, ValueError):
            pass

    sb = _sb()
    sb.table("apple_health_daily").upsert(
        row, on_conflict="user_id,date"
    ).execute()

    return get_day(user_id, date_str) or row


def get_day(user_id: str, date_str: str) -> Optional[dict]:
    sb = _sb()
    res = (
        sb.table("apple_health_daily")
        .select("*")
        .eq("user_id", user_id)
        .eq("date", date_str)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def get_data(user_id: str, days: int = 30) -> List[dict]:
    """Return the most recent `days` rows for this user, newest first."""
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    sb = _sb()
    res = (
        sb.table("apple_health_daily")
        .select("*")
        .eq("user_id", user_id)
        .gte("date", since)
        .order("date", desc=True)
        .execute()
    )
    return res.data or []


def get_summary(user_id: str, days: int = 30) -> dict:
    """
    Return a summary dict used by the dashboard (today + 30-day averages).
    Keys match what the frontend expects.
    """
    rows = get_data(user_id, days)
    if not rows:
        return {"has_data": False}

    today_str = date.today().isoformat()
    today_row = next((r for r in rows if r["date"] == today_str), None) or rows[0]

    def avg(field: str) -> Optional[float]:
        vals = [r[field] for r in rows if r.get(field) is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 1)

    def latest(field: str) -> Optional[float]:
        for r in rows:
            if r.get(field) is not None:
                return r[field]
        return None

    return {
        "has_data": True,
        "as_of": today_row["date"],
        "today": {
            "steps":                    today_row.get("steps"),
            "sleep_hours":              today_row.get("sleep_hours"),
            "active_calories":          today_row.get("active_calories"),
            "resting_hr":               today_row.get("resting_hr"),
            "hrv":                      today_row.get("hrv"),
            "weight_kg":                today_row.get("weight_kg"),
            "vo2_max":                  today_row.get("vo2_max"),
            "respiratory_rate":         today_row.get("respiratory_rate"),
            "body_fat_percentage":      today_row.get("body_fat_percentage"),
            "lean_body_mass_kg":        today_row.get("lean_body_mass_kg"),
            "skeletal_muscle_mass_kg":  today_row.get("skeletal_muscle_mass_kg"),
            "bmi":                      today_row.get("bmi"),
        },
        "averages": {
            "steps":            avg("steps"),
            "sleep_hours":      avg("sleep_hours"),
            "active_calories":  avg("active_calories"),
            "resting_hr":       avg("resting_hr"),
            "hrv":              avg("hrv"),
            "weight_kg":        avg("weight_kg"),
        },
        "latest_weight_kg":             latest("weight_kg"),
        "latest_body_fat_pct":          latest("body_fat_percentage"),
        "latest_lean_mass_kg":          latest("lean_body_mass_kg"),
        "latest_skeletal_muscle_kg":    latest("skeletal_muscle_mass_kg"),
        "latest_bmi":                   latest("bmi"),
        "days_synced": len(rows),
    }
