"""
Withings integration — OAuth + blood pressure ingest.

The BackNine BP card lets users manually log readings; this module lets a
Withings-cuff owner connect their account once and have all subsequent
readings flow into the same `blood_pressure_log` table automatically. The
Doctor's Report doesn't care about the source — every reading comes through
the same shape.

Withings API quick reference:
- Authorize:  https://account.withings.com/oauth2_user/authorize2
- Token URL:  https://wbsapi.withings.net/v2/oauth2 (POST form-urlencoded)
- Data URL:   https://wbsapi.withings.net/measure (POST form-urlencoded)
- BP scope:   "user.metrics"
- meastypes:  9 = diastolic mmHg, 10 = systolic mmHg, 11 = heart pulse bpm

The "measure" endpoint groups multiple measurements taken at the same
moment into a single "grp" (group). For a BP reading, the cuff sends
systolic, diastolic, and pulse simultaneously, so we collect all three
out of the same group and emit one logical reading.

ENV:
  WITHINGS_CLIENT_ID
  WITHINGS_CLIENT_SECRET
  WITHINGS_REDIRECT_URI (optional override; defaults to the Render callback)

Tokens are stored in the existing `wearable_connections` table with
provider="withings" so they sit alongside the user's Oura connection.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx


WITHINGS_AUTHORIZE = "https://account.withings.com/oauth2_user/authorize2"
WITHINGS_TOKEN     = "https://wbsapi.withings.net/v2/oauth2"
WITHINGS_MEASURE   = "https://wbsapi.withings.net/measure"

# Withings encodes BP measurements with these meastype IDs.
MEASTYPE_DIASTOLIC = 9
MEASTYPE_SYSTOLIC  = 10
MEASTYPE_PULSE     = 11

DEFAULT_REDIRECT_URI = "https://backnine-hu60.onrender.com/auth/withings/callback"


def _client_creds() -> tuple[str, str, str]:
    cid = os.getenv("WITHINGS_CLIENT_ID", "")
    sec = os.getenv("WITHINGS_CLIENT_SECRET", "")
    red = os.getenv("WITHINGS_REDIRECT_URI", DEFAULT_REDIRECT_URI)
    return cid, sec, red


def is_configured() -> bool:
    """Are Withings client credentials present? Used to gate the connect UI
    so we don't show "Connect Withings" before secrets are set."""
    cid, sec, _ = _client_creds()
    return bool(cid and sec)


def build_auth_url(user_id: str) -> str:
    """Build the Withings consent URL. user_id is round-tripped as `state` so
    the callback knows which BackNine account to attach the token to."""
    cid, _, redirect = _client_creds()
    params = {
        "response_type": "code",
        "client_id":     cid,
        "redirect_uri":  redirect,
        "scope":         "user.metrics",
        "state":         user_id,
    }
    return f"{WITHINGS_AUTHORIZE}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Trade an authorization code for access + refresh tokens.

    Withings's OAuth response is wrapped in `{"status": 0, "body": {...}}`
    where status != 0 is an error. We surface the body of a successful
    exchange and raise on errors.
    """
    cid, sec, redirect = _client_creds()
    payload = {
        "action":        "requesttoken",
        "client_id":     cid,
        "client_secret": sec,
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  redirect,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(WITHINGS_TOKEN, data=payload)
        r.raise_for_status()
        data = r.json() or {}
    if data.get("status") != 0:
        raise RuntimeError(f"Withings token exchange failed: {data}")
    return data.get("body") or {}


async def refresh(refresh_token: str) -> dict:
    """Renew an expired access token. Withings access tokens last ~3 hours;
    refresh tokens are long-lived but rotate on use."""
    cid, sec, _ = _client_creds()
    payload = {
        "action":        "requesttoken",
        "client_id":     cid,
        "client_secret": sec,
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(WITHINGS_TOKEN, data=payload)
        r.raise_for_status()
        data = r.json() or {}
    if data.get("status") != 0:
        raise RuntimeError(f"Withings token refresh failed: {data}")
    return data.get("body") or {}


async def fetch_bp_groups(access_token: str, since_ts: Optional[int] = None) -> list[dict]:
    """Fetch BP measurement groups since the given Unix timestamp (default:
    last 90 days). Returns a list of {date, time_of_day, systolic,
    diastolic, pulse, taken_at_iso} dicts ready to insert into
    blood_pressure_log.

    Withings groups one reading (systolic + diastolic + pulse) into a single
    `measuregrp` entry; we pivot that into a single logical BP record.
    """
    if since_ts is None:
        # 90 days ago
        since_ts = int(time.time()) - 90 * 24 * 60 * 60

    payload = {
        "action":     "getmeas",
        "meastypes":  f"{MEASTYPE_SYSTOLIC},{MEASTYPE_DIASTOLIC},{MEASTYPE_PULSE}",
        "category":   1,                # real measurements (not user goals)
        "startdate":  since_ts,
        "enddate":    int(time.time()),
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(WITHINGS_MEASURE, headers=headers, data=payload)
        r.raise_for_status()
        data = r.json() or {}
    if data.get("status") != 0:
        raise RuntimeError(f"Withings measure fetch failed: {data}")

    groups = (data.get("body") or {}).get("measuregrps") or []
    out: list[dict] = []
    for g in groups:
        measures = g.get("measures") or []
        # Withings encodes values as integer * 10^unit (e.g. 1200, unit=-1 → 120.0)
        vals: dict[int, float] = {}
        for m in measures:
            try:
                t = int(m.get("type"))
                v = float(m.get("value")) * (10 ** int(m.get("unit", 0)))
                vals[t] = v
            except Exception:
                continue

        sys_ = vals.get(MEASTYPE_SYSTOLIC)
        dia  = vals.get(MEASTYPE_DIASTOLIC)
        pls  = vals.get(MEASTYPE_PULSE)
        if sys_ is None or dia is None:
            continue  # not a complete BP reading

        # Withings group date is a Unix timestamp on `date` (taken). Use it
        # to derive local date + a coarse morning/midday/evening tag based
        # on the user's local clock. We don't know the user's timezone for
        # certain; assume UTC for the bucket math — the doctor's report
        # treats AM vs PM as a coarse pattern, not a precise hour.
        taken_ts = int(g.get("date", since_ts))
        taken_dt = datetime.fromtimestamp(taken_ts, tz=timezone.utc)
        hour     = taken_dt.hour
        if   hour < 11: tod = "morning"
        elif hour < 16: tod = "midday"
        elif hour < 22: tod = "evening"
        else:           tod = "other"

        out.append({
            "date":         taken_dt.date().isoformat(),
            "time_of_day":  tod,
            "systolic":     int(round(sys_)),
            "diastolic":    int(round(dia)),
            "pulse":        int(round(pls)) if pls is not None else None,
            "taken_at_iso": taken_dt.isoformat(),
            "external_id":  str(g.get("grpid") or taken_ts),
        })
    out.sort(key=lambda r: r["taken_at_iso"])
    return out
