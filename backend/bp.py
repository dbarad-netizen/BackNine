"""
Blood pressure log — manual + future Apple Health BPM entries.

Tracks per-reading (date, time_of_day, systolic, diastolic, pulse) so the
Doctor's Report PDF can plot the trend AND show the morning-vs-evening
split clinicians care about. Mirrors the weight_log pattern in nutrition.py.

Schema: see supabase migration `create_blood_pressure_log`.
"""

from datetime import date as _date, datetime
from typing import Optional
import os

from supabase import create_client, Client


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


VALID_TIMES = {"morning", "midday", "evening", "other"}


def log_reading(
    user_id: str,
    systolic: int,
    diastolic: int,
    *,
    pulse: Optional[int] = None,
    when: Optional[str] = None,           # ISO YYYY-MM-DD; default = today
    time_of_day: str = "morning",
    notes: Optional[str] = None,
    source: str = "manual",
) -> dict:
    """Insert a single BP reading. Returns the saved row (or {} on failure).

    Defensive validation here mirrors the table's CHECK constraints so a bad
    client gets a friendly error before we hit the DB.
    """
    if not (50 <= int(systolic) <= 300):
        raise ValueError("systolic must be between 50 and 300")
    if not (30 <= int(diastolic) <= 200):
        raise ValueError("diastolic must be between 30 and 200")
    if pulse is not None and not (25 <= int(pulse) <= 250):
        raise ValueError("pulse must be between 25 and 250 if provided")
    if time_of_day not in VALID_TIMES:
        time_of_day = "other"

    sb = _sb()
    if not sb:
        return {}
    when_iso = when or _date.today().isoformat()
    payload = {
        "user_id":     user_id,
        "date":        when_iso,
        "time_of_day": time_of_day,
        "systolic":    int(systolic),
        "diastolic":   int(diastolic),
        "pulse":       int(pulse) if pulse is not None else None,
        "notes":       (notes or "")[:500] or None,
        "source":      source if source in {"manual", "apple_health", "withings"} else "manual",
    }
    try:
        res = sb.table("blood_pressure_log").insert(payload).execute()
        return (res.data or [{}])[0]
    except Exception:
        return {}


def list_readings(user_id: str, days: int = 90, limit: int = 500) -> list[dict]:
    """Return the user's BP readings over the last `days` (newest first).
    `days=0` returns everything (capped at `limit`)."""
    sb = _sb()
    if not sb:
        return []
    try:
        q = (sb.table("blood_pressure_log")
               .select("*")
               .eq("user_id", user_id)
               .order("date", desc=True)
               .order("created_at", desc=True)
               .limit(limit))
        if days > 0:
            cutoff = (datetime.utcnow().date().fromordinal(datetime.utcnow().date().toordinal() - days)).isoformat()
            q = q.gte("date", cutoff)
        res = q.execute()
        return res.data or []
    except Exception:
        return []


def delete_reading(user_id: str, reading_id: str) -> bool:
    """Delete a single reading the user owns. Returns True if any row matched."""
    sb = _sb()
    if not sb:
        return False
    try:
        res = (sb.table("blood_pressure_log")
                 .delete()
                 .eq("user_id", user_id)
                 .eq("id", reading_id)
                 .execute())
        return bool(res.data)
    except Exception:
        return False


def summary(user_id: str, days: int = 30) -> dict:
    """Return summary stats for the report — averages, morning vs evening split,
    and the most recent reading.

    Empty result if no readings in window."""
    rows = list_readings(user_id, days=days)
    if not rows:
        return {"count": 0, "days": days}

    def _avg(vals: list[int]) -> Optional[int]:
        if not vals:
            return None
        return int(round(sum(vals) / len(vals)))

    sys_all = [r["systolic"]  for r in rows if r.get("systolic")  is not None]
    dia_all = [r["diastolic"] for r in rows if r.get("diastolic") is not None]
    sys_morning  = [r["systolic"]  for r in rows if r.get("time_of_day") == "morning" and r.get("systolic")  is not None]
    dia_morning  = [r["diastolic"] for r in rows if r.get("time_of_day") == "morning" and r.get("diastolic") is not None]
    sys_evening  = [r["systolic"]  for r in rows if r.get("time_of_day") == "evening" and r.get("systolic")  is not None]
    dia_evening  = [r["diastolic"] for r in rows if r.get("time_of_day") == "evening" and r.get("diastolic") is not None]

    latest = rows[0]
    return {
        "count":          len(rows),
        "days":           days,
        "average":        {"systolic": _avg(sys_all), "diastolic": _avg(dia_all)},
        "morning":        {"systolic": _avg(sys_morning), "diastolic": _avg(dia_morning), "n": len(sys_morning)},
        "evening":        {"systolic": _avg(sys_evening), "diastolic": _avg(dia_evening), "n": len(sys_evening)},
        "latest":         {
            "date":      latest.get("date"),
            "time":      latest.get("time_of_day"),
            "systolic":  latest.get("systolic"),
            "diastolic": latest.get("diastolic"),
            "pulse":     latest.get("pulse"),
        },
    }
