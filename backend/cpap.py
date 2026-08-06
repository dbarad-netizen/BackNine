"""
CPAP nightly log — capture, retrieve, compute insurance-adherence stats.

Data model matches ResMed myAir's nightly card so users can copy numbers
without translating between scales:
  usage_hours       — hours the machine ran (0-24)
  mask_seal_score   — 0-20 (myAir mask seal component)
  events_per_hour   — AHI (apneas + hypopneas per hour)
  total_score       — 0-100 (myAir nightly total)
  notes             — freeform

Storage: `public.cpap_nightly_log`, unique on (user_id, date).

Insurance compliance rule (Medicare + most private payers):
  >=4 hours of use on >=75% of nights over the last 30 days.
Falling below this is what triggers denial of continued CPAP coverage,
so surfacing it early lets users course-correct before their insurer
pulls the machine. David 2026-08-06.
"""

from __future__ import annotations

import os
import logging
from datetime import date as _date, timedelta
from typing import Optional

log = logging.getLogger(__name__)


# ── Supabase handle (shared pattern with the rest of the backend) ──────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    try:
        return create_client(url, key)
    except Exception:
        log.exception("cpap: supabase client init failed")
        return None


# ── Auto-enable the capability on first data ────────────────────────────

def _ensure_capability_enabled(user_id: str, capability: str) -> None:
    """If the user hasn't turned on the capability toggle yet but has
    just logged data for it, silently flip it on. Keeps the Profile
    settings honest (a card is visible <=> capability is enabled).
    Never fails caller — capability toggles are best-effort UX polish."""
    sb = _sb()
    if not sb:
        return
    try:
        res = (sb.table("user_profiles")
                 .select("enabled_capabilities")
                 .eq("user_id", user_id)
                 .limit(1)
                 .execute())
        rows = res.data or []
        current = (rows[0].get("enabled_capabilities") if rows else None) or []
        if capability in current:
            return
        next_arr = sorted(set(current) | {capability})
        sb.table("user_profiles").update({"enabled_capabilities": next_arr}) \
          .eq("user_id", user_id).execute()
    except Exception:
        log.exception("cpap: auto-enable capability failed for %s", user_id)


# ── Writes ──────────────────────────────────────────────────────────────

def log_nightly(
    user_id:         str,
    date_str:        str,
    usage_hours:     float,
    mask_seal_score: Optional[int]   = None,
    events_per_hour: Optional[float] = None,
    total_score:     Optional[int]   = None,
    notes:           Optional[str]   = None,
) -> dict:
    if not user_id:
        raise ValueError("user_id required")
    try:
        uh = float(usage_hours)
    except (TypeError, ValueError):
        raise ValueError("usage_hours must be a number")
    if uh < 0 or uh > 24:
        raise ValueError("usage_hours must be between 0 and 24")

    row = {
        "user_id":         user_id,
        "date":            date_str,
        "usage_hours":     round(uh, 2),
        "mask_seal_score": int(mask_seal_score) if mask_seal_score is not None else None,
        "events_per_hour": round(float(events_per_hour), 2) if events_per_hour is not None else None,
        "total_score":     int(total_score) if total_score is not None else None,
        "notes":           (notes or "").strip()[:500] or None,
    }
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")

    res = (sb.table("cpap_nightly_log")
             .upsert(row, on_conflict="user_id,date")
             .execute())
    _ensure_capability_enabled(user_id, "cpap")
    return (res.data or [row])[0]


# ── Reads ───────────────────────────────────────────────────────────────

def get_day(user_id: str, date_str: str) -> Optional[dict]:
    if not (user_id and date_str):
        return None
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("cpap_nightly_log")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("date", date_str)
                 .limit(1)
                 .execute())
        return (res.data or [None])[0]
    except Exception:
        return None


def get_range(user_id: str, start_iso: str, end_iso: str) -> list[dict]:
    if not user_id:
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        res = (sb.table("cpap_nightly_log")
                 .select("*")
                 .eq("user_id", user_id)
                 .gte("date", start_iso)
                 .lte("date", end_iso)
                 .order("date", desc=True)
                 .execute())
        return res.data or []
    except Exception:
        return []


# ── Insurance compliance ────────────────────────────────────────────────
#
# The Medicare rule (also adopted by nearly every private payer): the
# patient must use the machine for >=4 hours on >=75% of nights during
# a 30-day rolling window. Falling below either threshold is grounds
# for the insurer to stop paying for the machine and supplies. We
# compute the current window every time the frontend asks so the pill
# on Daily Check-in always reflects the true state.

INSURANCE_MIN_HOURS_PER_NIGHT = 4.0
INSURANCE_MIN_NIGHT_PERCENT   = 0.75
INSURANCE_WINDOW_DAYS         = 30


def adherence_snapshot(user_id: str, today_iso: str) -> dict:
    """Return a small dict summarizing the last 30 nights against the
    Medicare/private-payer rule. Frontend uses this to render the
    Insurance Compliance pill on the CPAP card + a warning banner if
    the user is about to fall below threshold."""
    if not user_id:
        return _empty_snapshot(today_iso)
    try:
        end = _date.fromisoformat(today_iso)
    except Exception:
        end = _date.today()
    start = end - timedelta(days=INSURANCE_WINDOW_DAYS - 1)

    rows = get_range(user_id, start.isoformat(), end.isoformat())
    total_nights   = INSURANCE_WINDOW_DAYS
    logged_nights  = len(rows)
    qualifying     = sum(1 for r in rows
                         if float(r.get("usage_hours") or 0) >= INSURANCE_MIN_HOURS_PER_NIGHT)
    avg_hours      = (sum(float(r.get("usage_hours") or 0) for r in rows) / logged_nights) if logged_nights else 0.0
    pct            = (qualifying / total_nights) if total_nights else 0.0
    compliant      = pct >= INSURANCE_MIN_NIGHT_PERCENT

    # AHI + mask seal running averages — useful for the trend card and
    # for Coach Al to reference without a second query.
    ahi_vals  = [float(r["events_per_hour"]) for r in rows if r.get("events_per_hour") is not None]
    seal_vals = [int(r["mask_seal_score"])   for r in rows if r.get("mask_seal_score")   is not None]
    total_vals = [int(r["total_score"])      for r in rows if r.get("total_score")       is not None]

    return {
        "window_start":    start.isoformat(),
        "window_end":      end.isoformat(),
        "window_days":     total_nights,
        "logged_nights":   logged_nights,
        "qualifying_nights": qualifying,
        "avg_hours":       round(avg_hours, 2),
        "compliance_pct":  round(pct * 100, 1),
        "compliant":       compliant,
        "threshold_pct":   int(INSURANCE_MIN_NIGHT_PERCENT * 100),
        "threshold_hours": INSURANCE_MIN_HOURS_PER_NIGHT,
        "avg_ahi":         round(sum(ahi_vals) / len(ahi_vals), 2)  if ahi_vals  else None,
        "avg_mask_seal":   round(sum(seal_vals) / len(seal_vals), 1) if seal_vals else None,
        "avg_total_score": round(sum(total_vals) / len(total_vals), 1) if total_vals else None,
    }


def _empty_snapshot(today_iso: str) -> dict:
    return {
        "window_start":    today_iso,
        "window_end":      today_iso,
        "window_days":     INSURANCE_WINDOW_DAYS,
        "logged_nights":   0,
        "qualifying_nights": 0,
        "avg_hours":       0.0,
        "compliance_pct":  0.0,
        "compliant":       False,
        "threshold_pct":   int(INSURANCE_MIN_NIGHT_PERCENT * 100),
        "threshold_hours": INSURANCE_MIN_HOURS_PER_NIGHT,
        "avg_ahi":         None,
        "avg_mask_seal":   None,
        "avg_total_score": None,
    }


# ── Capability toggle helpers (also used by the profile endpoint) ─────

def get_enabled_capabilities(user_id: str) -> list[str]:
    if not user_id:
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        res = (sb.table("user_profiles")
                 .select("enabled_capabilities")
                 .eq("user_id", user_id)
                 .limit(1)
                 .execute())
        rows = res.data or []
        return (rows[0].get("enabled_capabilities") if rows else None) or []
    except Exception:
        return []


def set_enabled_capabilities(user_id: str, capabilities: list[str]) -> list[str]:
    """Overwrite the capability list. Idempotent; deduplicates + sorts."""
    if not user_id:
        raise ValueError("user_id required")
    cleaned = sorted({str(c).strip().lower() for c in (capabilities or []) if str(c).strip()})
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")
    sb.table("user_profiles").update({"enabled_capabilities": cleaned}) \
      .eq("user_id", user_id).execute()
    return cleaned
