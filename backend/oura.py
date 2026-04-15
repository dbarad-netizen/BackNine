"""
Oura OAuth 2.0 + API client
"""
import httpx
from datetime import datetime, timedelta
from typing import Optional

OURA_AUTH_URL    = "https://cloud.ouraring.com/oauth/authorize"
OURA_TOKEN_URL   = "https://api.ouraring.com/oauth/token"
OURA_API_BASE    = "https://api.ouraring.com/v2/usercollection"
OURA_SCOPES      = "daily heartrate personal session spo2 workout"

def build_auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": OURA_SCOPES,
        "state": state,
    }
    return f"{OURA_AUTH_URL}?{urlencode(params)}"

async def exchange_code(code: str, client_id: str, client_secret: str,
                        redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(OURA_TOKEN_URL, data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  redirect_uri,
            "client_id":     client_id,
            "client_secret": client_secret,
        })
        r.raise_for_status()
        return r.json()

async def refresh_token(refresh_tok: str, client_id: str,
                        client_secret: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(OURA_TOKEN_URL, data={
            "grant_type":    "refresh_token",
            "refresh_token": refresh_tok,
            "client_id":     client_id,
            "client_secret": client_secret,
        })
        r.raise_for_status()
        return r.json()

async def fetch_personal_info(access_token: str) -> dict:
    """Fetch the authenticated user's stable Oura user ID and basic info."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            "https://api.ouraring.com/v2/usercollection/personal_info",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r.raise_for_status()
        return r.json()  # contains: id, age, weight, height, biological_sex, email

async def fetch_all(access_token: str, days: int = 120) -> dict:
    """Fetch all Oura data endpoints for the past N days."""
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}

    endpoints = {
        "readiness":   f"{OURA_API_BASE}/daily_readiness?start_date={start}&end_date={end}",
        "sleep":       f"{OURA_API_BASE}/daily_sleep?start_date={start}&end_date={end}",
        "activity":    f"{OURA_API_BASE}/daily_activity?start_date={start}&end_date={end}",
        "sleepDetail": f"{OURA_API_BASE}/sleep?start_date={start}&end_date={end}",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        results = {}
        for key, url in endpoints.items():
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            results[key] = r.json()

    return results

def parse_oura_data(raw: dict) -> tuple[dict, dict, dict, dict]:
    """Parse raw Oura API response into daily metric dicts."""
    rm, slm, am, smm = {}, {}, {}, {}

    # Readiness
    for rec in raw.get("readiness", {}).get("data", []):
        day = rec.get("day", "")
        if not day: continue
        contrib = rec.get("contributors", {})
        rm[day] = {
            "score":    rec.get("score"),
            "hrv":      contrib.get("hrv_balance"),
            "temp_dev": rec.get("temperature_deviation"),
        }

    # Sleep scores
    for rec in raw.get("sleep", {}).get("data", []):
        day = rec.get("day", "")
        if not day: continue
        contrib = rec.get("contributors", {})
        slm[day] = {
            "score":      rec.get("score"),
            "efficiency": contrib.get("efficiency"),
        }

    # Activity
    for rec in raw.get("activity", {}).get("data", []):
        day = rec.get("day", "")
        if not day: continue
        am[day] = {
            "score":      rec.get("score"),
            "steps":      rec.get("steps"),
            "active_cal": rec.get("active_calories"),
        }

    # Sleep model (detail — keep longest session ≥ 1h per day, skip naps/rest)
    for rec in raw.get("sleepDetail", {}).get("data", []):
        # Exclude known non-main-sleep types; accept anything ≥ 1 hour otherwise
        if rec.get("type") in ("rest", "late_nap"): continue
        total = rec.get("total_sleep_duration") or 0
        if total < 3600: continue   # ignore sessions under 1 hour
        day = rec.get("day", "")
        if not day: continue
        # Keep the longest sleep session for the day
        if day in smm and (smm[day].get("total") or 0) >= total:
            continue
        # sleep_need is in seconds — Oura's personalised nightly target
        sleep_need_sec = rec.get("sleep_need", {})
        if isinstance(sleep_need_sec, dict):
            sleep_need_sec = sleep_need_sec.get("long_sleep", 0) or 0
        smm[day] = {
            "total":         total,
            "deep":          rec.get("deep_sleep_duration"),
            "rem":           rec.get("rem_sleep_duration"),
            "hrv":           rec.get("average_hrv"),
            "rhr":           rec.get("lowest_heart_rate"),
            "efficiency":    rec.get("efficiency"),
            "bedtime_start": rec.get("bedtime_start"),
            "sleep_need":    sleep_need_sec or None,
        }

    return rm, slm, am, smm
