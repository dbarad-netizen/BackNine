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
    """Fetch the authenticated user's stable Oura user ID and basic info.

    Retries a few times on transient failures: this call decides the user's
    identity at sign-in, so a flaky response must NOT be allowed to fall through
    to a random fallback id (that created phantom accounts / re-onboarding on new
    devices). Better to retry, and let the caller error out than mint a new id.
    """
    import asyncio
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.ouraring.com/v2/usercollection/personal_info",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                r.raise_for_status()
                return r.json()  # contains: id, age, weight, height, biological_sex, email
        except Exception as e:  # noqa: BLE001 — retry any transient error
            last_exc = e
            if attempt < 2:
                await asyncio.sleep(0.6 * (attempt + 1))
    raise last_exc if last_exc else RuntimeError("personal_info failed")

async def fetch_workouts(access_token: str, days: int = 30) -> list[dict]:
    """Fetch the user's Oura-logged workouts for the past N days.

    Each entry: {id, activity, start_datetime, end_datetime, day, intensity,
    calories, distance, average_heart_rate}. Best-effort: returns [] on any
    failure so a flaky endpoint never blocks the dashboard.
    """
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{OURA_API_BASE}/workout?start_date={start}&end_date={end}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            return (r.json() or {}).get("data", []) or []
    except Exception:
        return []


async def fetch_sessions(access_token: str, days: int = 30) -> list[dict]:
    """Fetch the user's Oura-logged sessions for the past N days.

    Each entry: {id, type (meditation/breathing/rest/etc.), start_datetime,
    end_datetime, day, heart_rate}. Best-effort: returns [] on failure.
    """
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{OURA_API_BASE}/session?start_date={start}&end_date={end}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            return (r.json() or {}).get("data", []) or []
    except Exception:
        return []


async def fetch_enhanced_tags(access_token: str, days: int = 30) -> list[dict]:
    """Fetch the user's Oura enhanced_tag entries for the past N days.

    These are the user's contextual lifestyle tags: sauna, ice bath,
    meditation, alcohol, caffeine, late meal, stressful day, travel,
    sleep medication, intimacy, period, etc. Each entry:
      {id, tag_type_code, start_time, end_time, start_day, end_day, comment}

    Best-effort: returns [] on any failure. Oura's tag endpoint is
    relatively stable but newer than the other endpoints, so we don't
    want a flaky tag service to break the dashboard.
    """
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{OURA_API_BASE}/enhanced_tag?start_date={start}&end_date={end}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            return (r.json() or {}).get("data", []) or []
    except Exception:
        return []


async def fetch_naps(access_token: str, days: int = 30) -> list[dict]:
    """Pull just nap-type sleep records (excluded from nightly sleep
    aggregation). These get surfaced as separate activity entries — a
    20-minute nap is wellness data even if it's not 'last night.'

    Each entry: {id, type, day, total_sleep_duration, bedtime_start,
    bedtime_end, efficiency}. Best-effort."""
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{OURA_API_BASE}/sleep?start_date={start}&end_date={end}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            rows = (r.json() or {}).get("data", []) or []
    except Exception:
        return []
    # Filter to just nap-type entries with non-trivial duration (≥5 min)
    return [
        rec for rec in rows
        if rec.get("type") == "nap" and (rec.get("total_sleep_duration") or 0) >= 300
    ]


async def fetch_all(access_token: str, days: int = 120) -> dict:
    """
    Fetch all Oura data endpoints for the past N days.

    Each endpoint is fetched independently.  If a non-critical endpoint fails
    (e.g. sleepDetail) we log it and continue so the rest of the dashboard
    still loads.  The core endpoints (readiness, sleep, activity) raise on
    failure so callers know when we have no useful data at all.
    """
    end   = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {access_token}"}

    # core = failure here means we have nothing useful to show
    core_endpoints = {
        "readiness": f"{OURA_API_BASE}/daily_readiness?start_date={start}&end_date={end}",
        "sleep":     f"{OURA_API_BASE}/daily_sleep?start_date={start}&end_date={end}",
        "activity":  f"{OURA_API_BASE}/daily_activity?start_date={start}&end_date={end}",
    }
    # optional = nice-to-have; silently skip on failure
    optional_endpoints = {
        "sleepDetail":        f"{OURA_API_BASE}/sleep?start_date={start}&end_date={end}",
        "cardiovascularAge":  f"{OURA_API_BASE}/daily_cardiovascular_age?start_date={start}&end_date={end}",
        # Daily SpO2 — overnight oxygen saturation %. Surfaced in the Doctor's
        # Report (consistent low values can hint at sleep apnea / altitude
        # exposure). Some Oura ring generations don't measure SpO2, in which
        # case this endpoint returns an empty data array — handled below.
        "spo2":               f"{OURA_API_BASE}/daily_spo2?start_date={start}&end_date={end}",
    }

    results: dict = {}
    errors:  list = []

    async with httpx.AsyncClient(timeout=30) as client:
        # Fetch core endpoints — any 401/403 bubbles up immediately
        for key, url in core_endpoints.items():
            try:
                r = await client.get(url, headers=headers)
                if r.status_code in (401, 403):
                    raise httpx.HTTPStatusError(
                        f"Oura token invalid or expired ({r.status_code})",
                        request=r.request, response=r,
                    )
                r.raise_for_status()
                results[key] = r.json()
            except Exception as exc:
                errors.append(f"{key}: {exc}")

        # Fetch optional endpoints — log errors but don't fail
        for key, url in optional_endpoints.items():
            try:
                r = await client.get(url, headers=headers)
                r.raise_for_status()
                results[key] = r.json()
            except Exception:
                results[key] = {"data": []}  # empty fallback

    # If ALL core endpoints failed, surface one clear error
    if not results:
        detail = "; ".join(errors) if errors else "Oura API unreachable"
        raise RuntimeError(detail)

    # If some core endpoints failed but others succeeded, keep going with
    # what we have so the dashboard still loads partial data.
    return results

def parse_oura_data(raw: dict) -> tuple[dict, dict, dict, dict]:
    """Parse raw Oura API response into daily metric dicts."""
    rm, slm, am, smm = {}, {}, {}, {}

    # SpO2: map of day -> average overnight oxygen saturation (%). Merged
    # into smm at the end so the Doctor's Report can render it alongside
    # HRV / RHR / breathing rate without re-fetching. Older ring models
    # don't measure SpO2 — `data` will be empty in that case.
    spo2_by_day: dict = {}
    for rec in raw.get("spo2", {}).get("data", []):
        day = rec.get("day", "")
        if not day:
            continue
        agg = rec.get("spo2_percentage") or {}
        # Oura returns either a number directly or a nested {"average": x}
        # depending on API version — handle both shapes.
        if isinstance(agg, dict):
            val = agg.get("average")
        else:
            val = agg
        if val is not None:
            try:
                spo2_by_day[day] = round(float(val), 1)
            except Exception:
                pass

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
            "score":         rec.get("score"),
            "efficiency":    contrib.get("efficiency"),
            # Oura's rolling-window sleep balance contributor (0-100).
            # Higher = better sleep balance / less debt. This is the
            # authoritative Oura signal we now surface as a directional
            # indicator on the Tonight's Sleep card, replacing our
            # competing hours-of-debt calculation that never quite
            # matched Oura's app.
            "sleep_balance": contrib.get("sleep_balance"),
            "total_sleep":   contrib.get("total_sleep"),
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

    # Sleep model (detail — SUM all qualifying sessions per day)
    # Oura splits one night into multiple records whenever the user wakes,
    # syncs the ring, then goes back to sleep. Each piece has a `type`:
    #   • long_sleep — primary night session (always counted)
    #   • late_nap   — back-to-sleep within a few hours of waking from the
    #                  main session. Oura's APP counts this toward your
    #                  nightly total and your sleep need fulfillment. We
    #                  MUST also include it or split-sleep users see
    #                  undercounted totals and inflated debt — that was
    #                  exactly the bug where Oura showed 6h 54m and we
    #                  showed only 5.6h for the same night.
    #   • nap        — intentional daytime nap, NOT part of last night
    #   • rest       — quiet rest period (meditation, reading), not sleep
    #   • deleted    — user deleted this record manually
    _smm_raw: dict = {}  # day → list of qualifying session dicts
    for rec in raw.get("sleepDetail", {}).get("data", []):
        # Only exclude truly non-night types. `late_nap` is now included.
        if rec.get("type") in ("rest", "nap", "deleted"): continue
        total = rec.get("total_sleep_duration") or 0
        if total < 300: continue   # ignore sessions under 5 minutes (true rest blips)
        day = rec.get("day", "")
        if not day: continue
        sleep_need_sec = rec.get("sleep_need", {})
        if isinstance(sleep_need_sec, dict):
            sleep_need_sec = sleep_need_sec.get("long_sleep", 0) or 0
        # Sleep fragmentation signals — used by the Doctor's Report.
        # Oura's app-only Breathing Disturbance Index isn't available in the
        # public API (confirmed via field probe 2026-06-19), so we surface
        # the raw fragmentation signals Oura DOES expose: awake_time,
        # restless_periods, and efficiency. The report classifies nights
        # using efficiency thresholds we control.
        _smm_raw.setdefault(day, []).append({
            "total":         total,
            "deep":          rec.get("deep_sleep_duration") or 0,
            "rem":           rec.get("rem_sleep_duration") or 0,
            "hrv":           rec.get("average_hrv"),
            "rhr":           rec.get("lowest_heart_rate"),
            "avg_hr":        rec.get("average_heart_rate"),
            # average_breath: respiratory rate during sleep (breaths/min).
            "breath":        rec.get("average_breath"),
            "restless":      rec.get("restless_periods"),
            "awake":         rec.get("awake_time"),  # seconds
            "efficiency":    rec.get("efficiency"),
            "bedtime_start": rec.get("bedtime_start"),
            "sleep_need":    sleep_need_sec or None,
        })

    # Aggregate sessions: sum durations, weighted-average HRV, minimum RHR
    for day, sessions in _smm_raw.items():
        total_sleep = sum(s["total"] for s in sessions)
        total_deep  = sum(s["deep"]  for s in sessions)
        total_rem   = sum(s["rem"]   for s in sessions)

        # Weighted HRV average (weight by session length)
        hrv_pairs = [(s["hrv"], s["total"]) for s in sessions if s["hrv"] is not None]
        if hrv_pairs:
            w_sum = sum(w for _, w in hrv_pairs)
            avg_hrv = round(sum(h * w for h, w in hrv_pairs) / w_sum) if w_sum else None
        else:
            avg_hrv = None

        # Lowest RHR across sessions (Oura's value is already the session minimum)
        rhr_vals = [s["rhr"] for s in sessions if s["rhr"] is not None]
        min_rhr  = min(rhr_vals) if rhr_vals else None

        # Weighted breathing rate (same approach as HRV — by session length).
        # Skipped if no breath data on any session.
        breath_pairs = [(s["breath"], s["total"]) for s in sessions if s.get("breath") is not None]
        if breath_pairs:
            bw_sum = sum(w for _, w in breath_pairs)
            avg_breath = round(sum(b * w for b, w in breath_pairs) / bw_sum, 1) if bw_sum else None
        else:
            avg_breath = None

        # Best efficiency from the longest session
        longest = max(sessions, key=lambda s: s["total"])

        # Weighted average heart rate (weight by session length).
        ahr_pairs = [(s["avg_hr"], s["total"]) for s in sessions if s.get("avg_hr") is not None]
        if ahr_pairs:
            ahr_sum = sum(w for _, w in ahr_pairs)
            avg_hr  = round(sum(h * w for h, w in ahr_pairs) / ahr_sum) if ahr_sum else None
        else:
            avg_hr = None

        # Sum restless periods and awake time across the night (split sessions).
        restless_vals = [s["restless"] for s in sessions if s.get("restless") is not None]
        total_restless = sum(restless_vals) if restless_vals else None
        awake_vals = [s["awake"] for s in sessions if s.get("awake") is not None]
        total_awake = sum(awake_vals) if awake_vals else None

        smm[day] = {
            "total":         total_sleep,
            "deep":          total_deep  or None,
            "rem":           total_rem   or None,
            "hrv":           avg_hrv,
            "rhr":           min_rhr,
            "avg_hr":        avg_hr,
            "breath":        avg_breath,
            "restless":      total_restless,
            "awake":         total_awake,
            # SpO2 from the separate daily_spo2 endpoint, merged in by day.
            # None when the ring model doesn't measure it.
            "spo2":          spo2_by_day.get(day),
            "efficiency":    longest["efficiency"],
            "bedtime_start": longest["bedtime_start"],
            "sleep_need":    longest["sleep_need"],
        }

    # Backfill SpO2-only days: if the ring captured SpO2 but the user didn't
    # have a tracked sleep session that day (e.g. ring removed mid-night),
    # still surface the SpO2 reading so the Doctor's Report doesn't drop it.
    for day, val in spo2_by_day.items():
        if day not in smm:
            smm[day] = {"spo2": val}

    return rm, slm, am, smm


def parse_oura_vo2_max(raw: dict) -> float | None:
    """
    Extract the most recent VO2 max estimate from the cardiovascular_age endpoint.
    Returns None if unavailable (not all Oura generations support this).
    """
    records = raw.get("cardiovascularAge", {}).get("data", [])
    if not records:
        return None
    # Data comes back in date order; take the last non-null VO2 max
    for rec in reversed(records):
        v = rec.get("vo2_max")
        if v is not None:
            return float(v)
    return None
