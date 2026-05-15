"""
BackNine Health API — FastAPI backend
Routes:
  GET  /health
  GET  /auth/oura                    → redirect to Oura OAuth
  GET  /auth/oura/callback           → exchange code, store tokens
  POST /auth/logout
  GET  /api/dashboard                → full dashboard payload
  GET  /api/wearables                → list connected wearables
  DELETE /api/wearables/{provider}   → disconnect a wearable
"""
import os, secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import FastAPI, HTTPException, Depends, Request, Response, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse, PlainTextResponse
from dotenv import load_dotenv
from jose import jwt, JWTError

from oura import build_auth_url, exchange_code, refresh_token as oura_refresh, fetch_all, parse_oura_data, parse_oura_vo2_max, fetch_personal_info
from coaching import generate_coaching, coach_overall, coach_sleep, coach_activity
from models import DashboardResponse, DailyMetrics, WearableConnection
import nutrition as nutr
import training as trn
import labs as lbs
import challenges as chl
import apple_health as ah
import oura_cache as oc
import insights as ins
import progress as prog
import predictions as prd
import longevity as lon
import chat as ch
import briefing as brf
import friends as frd
import observations as obs

load_dotenv()

# ── config ────────────────────────────────────────────────────────────────────
OURA_CLIENT_ID      = os.getenv("OURA_CLIENT_ID", "")
OURA_CLIENT_SECRET  = os.getenv("OURA_CLIENT_SECRET", "")
OURA_REDIRECT_URI   = os.getenv("OURA_REDIRECT_URI", "http://localhost:8000/auth/oura/callback")
FRONTEND_URL        = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL         = os.getenv("BACKEND_URL", "https://backnine-api.onrender.com")
SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ENVIRONMENT         = os.getenv("ENVIRONMENT", "development")
# Random token you generate once and set in Render env vars.
# Oura uses it to verify your webhook endpoint during subscription setup.
OURA_WEBHOOK_TOKEN  = os.getenv("OURA_WEBHOOK_TOKEN", "")
# Supabase JWT secret — from Supabase dashboard → Settings → API → JWT Secret
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
# Protect the /admin/* routes — set any strong secret in Render env vars.
ADMIN_KEY           = os.getenv("ADMIN_KEY", "")

# ── Supabase client (lazy — only used when env vars present) ──────────────────
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None and SUPABASE_URL and SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _supabase


def _get_profile(user_id: str) -> dict:
    """Return the user's profile row, or {} if not found."""
    try:
        db = get_supabase()
        if not db:
            return {}
        res = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
        return res.data[0] if res.data else {}
    except Exception:
        return {}


# ── Daily streak (derived from daily_briefings) ───────────────────────────────
#
# A row in daily_briefings exists for every day the user has opened BackNine
# (the briefing endpoint writes one on first dashboard load each day). Counting
# consecutive dates from today backwards gives us the user's app-open streak
# for free — no new table required.

def _compute_app_streak(user_id: str, today_str: str) -> int:
    """Return the user's consecutive-days-opened streak ending today.

    A day is 'opened' if there's a daily_briefings row for that date. We walk
    backwards from `today_str` until we hit the first gap; that gap's count
    is the streak. If the user hasn't opened today yet (no briefing row),
    the streak still includes yesterday and back, since today is in progress.
    """
    db = get_supabase()
    if not db:
        return 0
    try:
        # Fetch dates from the last ~100 days (more than enough to bound
        # any sane streak, while capping the read).
        cutoff = (datetime.strptime(today_str, "%Y-%m-%d") - timedelta(days=100)).strftime("%Y-%m-%d")
        res = (
            db.table("daily_briefings")
            .select("date")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .order("date", desc=True)
            .execute()
        )
    except Exception:
        return 0
    dates = {str(r["date"]) for r in (res.data or [])}
    if not dates:
        return 0
    streak = 0
    # Walk from today backwards. If today isn't in the set, start from yesterday
    # so an in-progress day doesn't reset the streak.
    cursor = datetime.strptime(today_str, "%Y-%m-%d").date()
    if cursor.isoformat() not in dates:
        cursor -= timedelta(days=1)
    while cursor.isoformat() in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


# ── Daily check-in (mood / energy) ────────────────────────────────────────────

ALLOWED_MOODS = {"great", "okay", "tired", "off"}


def _get_checkin(user_id: str, date_str: str) -> Optional[dict]:
    """Return the user's check-in for a specific date, or None."""
    db = get_supabase()
    if not db:
        return None
    try:
        res = (
            db.table("daily_checkins")
            .select("mood, created_at, date")
            .eq("user_id", user_id)
            .eq("date", date_str)
            .limit(1)
            .execute()
        )
        return (res.data or [None])[0]
    except Exception:
        return None


@app.get("/api/checkin/today")
def get_checkin_today(request: Request):
    """Return today's mood if logged, plus yesterday's for context display."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today = datetime.now(tz=ZoneInfo("America/New_York")).date()
    yesterday = today - timedelta(days=1)
    return {
        "today":     _get_checkin(user_id, today.isoformat()),
        "yesterday": _get_checkin(user_id, yesterday.isoformat()),
    }


@app.post("/api/checkin")
async def save_checkin(request: Request):
    """Upsert today's mood. Body: { mood }. mood ∈ great|okay|tired|off."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    mood = (body.get("mood") or "").strip().lower()
    if mood not in ALLOWED_MOODS:
        raise HTTPException(
            status_code=400,
            detail=f"mood must be one of {sorted(ALLOWED_MOODS)}",
        )
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_str = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()
    db = get_supabase()
    if not db:
        raise HTTPException(status_code=503, detail="storage unavailable")
    try:
        db.table("daily_checkins").upsert(
            {"user_id": user_id, "date": today_str, "mood": mood},
            on_conflict="user_id,date",
        ).execute()
        return {"ok": True, "mood": mood, "date": today_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_oura_anchor(user_id: str, rm: dict, slm: dict, am: dict, smm: dict) -> tuple[str, dict, dict, dict, dict]:
    """Resolve a timezone-safe Oura anchor and pull today's row from each stream.

    Returns (anchor, t_rdy, t_sl, t_act, t_sm). Mirrors the dashboard endpoint's
    canonical anchor logic — fixes the chat + briefing endpoints which were
    naively using datetime.now() (server UTC, off by a day after 8 PM ET) and
    pulling smm at the wrong key. See CONTEXT.md "Timezone-safe today".

    The sleep model row (t_sm) falls back through:
      1. smm[anchor]                — direct hit
      2. smm[anchor - 1 day]        — bedtime-date keying (Oura quirk)
      3. Apple Health for that date — Oura session not yet synced
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    all_oura_dates = sorted(set(list(rm) + list(slm) + list(am)))
    oura_today = all_oura_dates[-1] if all_oura_dates else today_str
    oura_yesterday = (
        datetime.strptime(oura_today, "%Y-%m-%d") - timedelta(days=1)
    ).strftime("%Y-%m-%d")

    def _scored(d: str, mapping: dict) -> bool:
        s = mapping.get(d, {}).get("score")
        return bool(s and s > 0)

    if _scored(oura_today, slm):
        anchor = oura_today
    elif _scored(oura_yesterday, slm):
        anchor = oura_yesterday
    elif slm:
        scored = [d for d in sorted(slm, reverse=True) if slm[d].get("score")]
        anchor = scored[0] if scored else sorted(slm)[-1]
    else:
        anchor = oura_today

    t_rdy = rm.get(anchor, {})
    t_sl  = slm.get(anchor, {})
    t_act = am.get(anchor, {})

    # smm lookup — direct anchor first, Apple Health as fallback. We deliberately
    # do NOT fall back to smm[anchor - 1 day]: Oura's /sleep endpoint keys
    # sessions by wake date in its `day` field (verified empirically), so a
    # missing smm[anchor] means Oura's session detail for last night hasn't
    # synced yet — not that the data is offset to the prior day. Reading
    # anchor-1 would surface a session from two nights ago and let Coach Al
    # confidently report stale numbers. Better to leave sleep empty so the
    # prompt honestly omits it.
    t_sm = smm.get(anchor, {}) or {}
    if not t_sm.get("total"):
        try:
            ah_day = ah.get_day(user_id, anchor)
            if ah_day and (ah_day.get("sleep_hours") or ah_day.get("hrv")):
                sh  = ah_day.get("sleep_hours") or 0
                sdh = ah_day.get("sleep_deep_hours") or 0
                srh = ah_day.get("sleep_rem_hours") or 0
                t_sm = {
                    "total":      int(sh  * 3600) if sh  else None,
                    "deep":       int(sdh * 3600) if sdh else None,
                    "rem":        int(srh * 3600) if srh else None,
                    "hrv":        ah_day.get("hrv"),
                    "rhr":        ah_day.get("resting_hr"),
                    "_source":    "apple_health",
                }
        except Exception:
            pass

    return anchor, t_rdy, t_sl, t_act, t_sm


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BackNine Health API",
    version="0.1.0",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
        "https://back-nine-six.vercel.app",
        "https://back-nine-d28t.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    import traceback
    return JSONResponse(status_code=500, content={"error": str(exc), "trace": traceback.format_exc()})

@app.get("/debug-sb")
def debug_supabase():
    """Temporary: test Supabase connection and return diagnostic info."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return {
        "url_set":      bool(url),
        "url_prefix":   url[:30] if url else None,
        "key_set":      bool(key),
        "key_prefix":   key[:20] if key else None,
        "key_suffix":   key[-10:] if key else None,
        "key_length":   len(key) if key else 0,
    }

# ── JWT session helpers ───────────────────────────────────────────────────────
# Sessions are encoded as signed JWTs stored in an HttpOnly cookie.
# No server-side store — survives backend restarts automatically.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-change-me-in-production")
JWT_ALGO   = "HS256"


def _encode_session(session: dict) -> str:
    return jwt.encode(session, JWT_SECRET, algorithm=JWT_ALGO)


def _decode_session(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except JWTError:
        return None


def _verify_supabase_jwt(token: str) -> Optional[dict]:
    """
    Verify a JWT issued by Supabase Auth.
    Returns the claims dict (including sub = user UUID) or None if invalid.
    """
    if not SUPABASE_JWT_SECRET:
        return None
    try:
        claims = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=[JWT_ALGO],
            audience="authenticated",
        )
        return claims
    except JWTError:
        return None


# Transient OAuth state nonces (in-memory is fine — just a replay guard)
_oauth_states: dict = {}  # state → timestamp


# ── helpers ───────────────────────────────────────────────────────────────────

def _session_cookie_name() -> str:
    return "bn_session"


def _get_session(request: Request) -> Optional[dict]:
    # Check cookie first
    token = request.cookies.get(_session_cookie_name())
    if token:
        return _decode_session(token)
    # Fall back to Authorization header (cross-origin: Netlify → Render)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return _decode_session(auth[7:])
    return None


def _set_session_cookie(response, session: dict) -> None:
    """Write the session dict as a signed JWT into the HttpOnly cookie."""
    token = _encode_session(session)
    response.set_cookie(
        key=_session_cookie_name(),
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )


def _require_session(request: Request) -> dict:
    # 1. Cookie-based session (existing Oura OAuth flow)
    token = request.cookies.get(_session_cookie_name())
    if token:
        decoded = _decode_session(token)
        if decoded and decoded.get("user_id"):
            return decoded

    # 2. Authorization: Bearer header
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        bearer = auth[7:]
        # Try our own JWT first (existing Oura sessions sent as Bearer)
        decoded = _decode_session(bearer)
        if decoded and decoded.get("user_id"):
            return decoded
        # Try Supabase JWT (email/Google sign-in)
        claims = _verify_supabase_jwt(bearer)
        if claims and claims.get("sub"):
            return {
                "user_id":  claims["sub"],   # Supabase UUID
                "provider": "supabase",
                "email":    claims.get("email"),
                "access_token": None,        # no Oura token yet
            }

    raise HTTPException(status_code=401, detail="Not authenticated")


async def _ensure_valid_token(session: dict) -> Tuple[str, Optional[dict]]:
    """Return (access_token, updated_session_or_None).
    updated_session is set when tokens were refreshed so the caller can
    write a fresh JWT cookie back to the client.
    """
    expires_at = session.get("expires_at", 0)
    if expires_at and datetime.now(timezone.utc).timestamp() > expires_at - 60:
        # Token is expired or about to expire — refresh
        rt = session.get("refresh_token")
        if not rt:
            raise HTTPException(status_code=401, detail="Session expired — please reconnect Oura")
        tokens = await oura_refresh(rt, OURA_CLIENT_ID, OURA_CLIENT_SECRET)
        session = dict(session)  # make a copy so we can mutate
        session["access_token"]  = tokens["access_token"]
        session["refresh_token"] = tokens.get("refresh_token", rt)
        session["expires_at"]    = int(datetime.now(timezone.utc).timestamp()) + tokens.get("expires_in", 86400)
        # Persist to Supabase if available
        db = get_supabase()
        if db and session.get("user_id"):
            db.table("wearable_connections").update({
                "access_token":  session["access_token"],
                "refresh_token": session["refresh_token"],
                "expires_at":    session["expires_at"],
            }).eq("user_id", session["user_id"]).eq("provider", "oura").execute()
        return session["access_token"], session  # signal: cookie needs refresh
    return session["access_token"], None


def _build_trend(rm, slm, am, smm, days=30) -> list[dict]:
    now = datetime.now()
    cutoff = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    all_days = sorted(set(list(rm) + list(slm) + list(am)))
    result = []
    for day in all_days:
        if day < cutoff:
            continue
        s   = smm.get(day, {})
        rdy = rm.get(day, {})
        sl  = slm.get(day, {})
        act = am.get(day, {})
        tot = s.get("total")
        result.append({
            "date":       day,
            "readiness":  rdy.get("score"),
            "sleep":      sl.get("score"),
            "activity":   act.get("score"),
            "hrv":        s.get("hrv"),
            "rhr":        s.get("rhr"),
            "steps":      act.get("steps"),
            "total_hrs":  round(tot / 3600, 1) if tot else None,
            "temp_dev":   rdy.get("temp_dev"),
            "deep_min":   round(s.get("deep", 0) / 60) if s.get("deep") else None,
            "rem_min":    round(s.get("rem",  0) / 60) if s.get("rem")  else None,
            "efficiency": s.get("efficiency"),
            "active_cal": act.get("active_cal"),
        })
    return result


# ── Webhook background task ───────────────────────────────────────────────────

async def _refresh_oura_cache_for_user(oura_user_id: str) -> None:
    """
    Called in the background when Oura fires a webhook event.
    Looks up the user's stored tokens, refreshes them if expired,
    fetches the last 3 days of data, and writes to oura_daily_cache.
    """
    backnine_uid = f"oura_{oura_user_id}"
    db = get_supabase()
    if not db:
        return

    try:
        res = (
            db.table("wearable_connections")
            .select("access_token, refresh_token, expires_at")
            .eq("user_id", backnine_uid)
            .eq("provider", "oura")
            .execute()
        )
        rows = res.data or []
        if not rows:
            return
        conn = rows[0]
        access_token = conn["access_token"]
        refresh_tok  = conn.get("refresh_token")
        expires_at   = conn.get("expires_at", 0)

        # Refresh token if expired
        if expires_at and datetime.now(timezone.utc).timestamp() > expires_at - 60:
            if not refresh_tok:
                return
            tokens = await oura_refresh(refresh_tok, OURA_CLIENT_ID, OURA_CLIENT_SECRET)
            access_token = tokens["access_token"]
            new_refresh  = tokens.get("refresh_token", refresh_tok)
            new_expires  = int(datetime.now(timezone.utc).timestamp()) + tokens.get("expires_in", 86400)
            db.table("wearable_connections").update({
                "access_token":  access_token,
                "refresh_token": new_refresh,
                "expires_at":    new_expires,
            }).eq("user_id", backnine_uid).eq("provider", "oura").execute()

        # Fetch the last 3 days (catches any delayed processing on Oura's end)
        raw = await fetch_all(access_token, days=3)
        rm, slm, am, smm = parse_oura_data(raw)
        oc.store_days(backnine_uid, rm, slm, am, smm)

    except Exception:
        pass  # webhook handler already returned 200; swallow silently


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


# ── Oura OAuth ────────────────────────────────────────────────────────────────

@app.get("/auth/oura")
def oura_auth_start(response: Response, link_user_id: str = None):
    """
    Redirect the user to Oura's OAuth authorization page.
    If link_user_id is provided (Supabase UUID), the resulting Oura tokens
    will be stored under that user_id instead of generating a new oura_xxx id.
    """
    if not OURA_CLIENT_ID:
        raise HTTPException(status_code=500, detail="OURA_CLIENT_ID not configured")
    state = secrets.token_urlsafe(24)
    _oauth_states[state] = {
        "ts":             datetime.now(timezone.utc).timestamp(),
        "link_user_id":   link_user_id,   # None for fresh Oura-only logins
    }
    url = build_auth_url(OURA_CLIENT_ID, OURA_REDIRECT_URI, state)
    return RedirectResponse(url)


@app.get("/auth/oura/callback")
async def oura_auth_callback(
    request: Request,
    code: str = None,
    state: str = None,
    error: str = None,
    iss: str = None,
):
    """Handle the OAuth callback from Oura."""
    import traceback
    try:
        if error:
            return RedirectResponse(f"{FRONTEND_URL}/connect?error={error}")

        if not code or not state:
            return JSONResponse({"error": "missing code or state", "params": dict(request.query_params)})

        # Consume state nonce
        state_data    = _oauth_states.pop(state, {})
        link_user_id  = state_data.get("link_user_id") if isinstance(state_data, dict) else None

        # Exchange code for tokens
        tokens = await exchange_code(code, OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REDIRECT_URI)

        access_token  = tokens["access_token"]
        refresh_tok   = tokens.get("refresh_token")
        expires_in    = tokens.get("expires_in", 86400)
        expires_at    = int(datetime.now(timezone.utc).timestamp()) + expires_in

        # Determine user_id:
        # • If linking to an existing Supabase account, use that UUID and
        #   store the Oura personal ID so we can resolve it later.
        # • If signing in with Oura directly, look up whether this Oura account
        #   was previously linked to a Supabase UUID (via oura_user_id column).
        #   If found, use the Supabase UUID so ALL data (meals, weight, labs,
        #   challenges, etc.) stays under one identity across devices.
        # • Otherwise fall back to oura_<oura_user_id> (legacy).
        try:
            personal = await fetch_personal_info(access_token)
            oura_pid = personal["id"]          # Oura's own numeric user ID
            oura_native_id = f"oura_{oura_pid}"
        except Exception:
            import hashlib
            oura_pid = None
            oura_native_id = f"oura_{hashlib.sha256(access_token.encode()).hexdigest()[:16]}"

        if link_user_id:
            # User is connecting Oura from a Supabase account — use the Supabase UUID
            user_id = link_user_id
        elif oura_pid:
            # Direct Oura sign-in — check if this Oura account is already linked
            # to a Supabase UUID via the oura_user_id column in wearable_connections
            db = get_supabase()
            canonical_id = None
            if db:
                try:
                    res = (
                        db.table("wearable_connections")
                        .select("user_id")
                        .eq("oura_user_id", oura_pid)
                        .eq("provider", "oura")
                        .execute()
                    )
                    for row in (res.data or []):
                        uid = row["user_id"]
                        if not uid.startswith("oura_"):
                            canonical_id = uid  # Found the Supabase UUID
                            break
                except Exception:
                    pass
            user_id = canonical_id or oura_native_id
        else:
            user_id = oura_native_id

        session_data = {
            "user_id":       user_id,
            "provider":      "oura",
            "access_token":  access_token,
            "refresh_token": refresh_tok,
            "expires_at":    expires_at,
        }

        # Supabase — best effort only
        # Store oura_user_id so that direct Oura sign-ins on other devices
        # can resolve back to this user's canonical Supabase UUID.
        try:
            db = get_supabase()
            if db:
                row = {
                    "user_id":      user_id,
                    "provider":     "oura",
                    "access_token": access_token,
                    "refresh_token": refresh_tok,
                    "expires_at":   expires_at,
                }
                if oura_pid:
                    row["oura_user_id"] = str(oura_pid)
                db.table("wearable_connections").upsert(row).execute()
        except Exception:
            pass

        # Pass token in URL for cross-origin compatibility (Netlify + Render)
        jwt_token = _encode_session(session_data)
        redirect = RedirectResponse(f"{FRONTEND_URL}/dashboard?token={jwt_token}")
        _set_session_cookie(redirect, session_data)  # also set cookie as fallback
        return redirect

    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc), "trace": traceback.format_exc()})


@app.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(_session_cookie_name())
    return {"status": "logged_out"}


# ── Oura Webhooks ─────────────────────────────────────────────────────────────

@app.get("/webhooks/oura")
def oura_webhook_verify(challenge: str = None, verification_token: str = None):
    """
    Oura calls this GET with ?challenge=xxx when registering a subscription
    to confirm the endpoint is live. Echo the challenge back as JSON.
    """
    if challenge:
        return {"challenge": challenge}
    # Fallback: some Oura versions send verification_token instead
    if verification_token:
        return {"verification_token": verification_token}
    raise HTTPException(status_code=400, detail="No challenge or verification_token provided")


@app.post("/webhooks/oura")
async def oura_webhook_event(request: Request, background_tasks: BackgroundTasks):
    """
    Oura POSTs here when new health data is ready for any user of the app.
    We respond 200 immediately and refresh that user's cache in the background.

    Payload shape:
      { "event_type": "create",
        "data_type":  "daily_readiness",
        "object_id":  "...",
        "user_id":    "<oura-user-id>",
        "event_timestamp": "2026-04-17T..." }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    oura_user_id = body.get("user_id")
    if oura_user_id:
        background_tasks.add_task(_refresh_oura_cache_for_user, oura_user_id)

    return {"status": "ok"}


# ── Admin — webhook management ────────────────────────────────────────────────

def _check_admin(request: Request) -> None:
    if not ADMIN_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_KEY not configured")
    if request.headers.get("X-Admin-Key", "") != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@app.post("/admin/oura/register-webhook")
async def register_oura_webhook(request: Request):
    """
    One-time call to register BackNine's webhook subscriptions with Oura.
    Run once after deploying; Oura will then push events for all users.

    Call with:  curl -X POST https://<backend>/admin/oura/register-webhook \\
                     -H "X-Admin-Key: <ADMIN_KEY>"
    """
    _check_admin(request)
    if not OURA_WEBHOOK_TOKEN:
        raise HTTPException(status_code=500, detail="OURA_WEBHOOK_TOKEN not configured")

    import httpx
    callback_url = f"{BACKEND_URL}/webhooks/oura"

    # Subscribe to the four data types that matter for BackNine
    data_types = ["daily_readiness", "daily_sleep", "daily_activity", "sleep"]
    results = []

    async with httpx.AsyncClient(timeout=15) as client:
        for dt in data_types:
            r = await client.post(
                "https://api.ouraring.com/v2/webhook/subscription",
                headers={
                    "x-client-id":     OURA_CLIENT_ID,
                    "x-client-secret": OURA_CLIENT_SECRET,
                    "Content-Type":    "application/json",
                },
                json={
                    "callback_url":       callback_url,
                    "event_type":         "create",
                    "data_type":          dt,
                    "verification_token": OURA_WEBHOOK_TOKEN,
                },
            )
            results.append({
                "data_type": dt,
                "status":    r.status_code,
                "response":  r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text,
            })

    return {"callback_url": callback_url, "subscriptions": results}


@app.get("/admin/oura/webhook-subscriptions")
async def list_oura_webhook_subscriptions(request: Request):
    """List all active Oura webhook subscriptions for this app."""
    _check_admin(request)

    import httpx

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            "https://api.ouraring.com/v2/webhook/subscription",
            headers={
                "x-client-id":     OURA_CLIENT_ID,
                "x-client-secret": OURA_CLIENT_SECRET,
            },
        )
        return r.json()


@app.delete("/admin/oura/webhook-subscriptions/{subscription_id}")
async def delete_oura_webhook_subscription(subscription_id: str, request: Request):
    """Delete a specific Oura webhook subscription (useful for re-registering)."""
    _check_admin(request)

    import httpx

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(
            f"https://api.ouraring.com/v2/webhook/subscription/{subscription_id}",
            headers={
                "x-client-id":     OURA_CLIENT_ID,
                "x-client-secret": OURA_CLIENT_SECRET,
            },
        )
        return {"status": r.status_code}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def get_dashboard(request: Request, days: int = 120):
    session = _require_session(request)
    user_id = session["user_id"]

    # ── Resolve Oura access token ─────────────────────────────────────────────
    # Supabase-auth users may not have Oura in their session cookie — look it
    # up from wearable_connections instead.
    if not session.get("access_token"):
        db = get_supabase()
        if db:
            try:
                res = (
                    db.table("wearable_connections")
                    .select("access_token, refresh_token, expires_at")
                    .eq("user_id", user_id)
                    .eq("provider", "oura")
                    .execute()
                )
                rows = res.data or []
                if rows:
                    session = {**session, **rows[0]}
            except Exception:
                pass

    if not session.get("access_token"):
        # User is authenticated but hasn't connected Oura yet
        return {
            "generated": datetime.now(timezone.utc).isoformat(),
            "has_oura":  False,
            "provider":  session.get("provider", "supabase"),
        }

    access_token, refreshed_session = await _ensure_valid_token(session)
    if refreshed_session:
        session = refreshed_session

    # ── Try cache first ───────────────────────────────────────────────────────
    # Webhooks keep the cache warm; only call Oura live when the cache is stale.
    rm, slm, am, smm = {}, {}, {}, {}
    oura_vo2_max: float | None = None
    cache_hit = False
    try:
        if oc.is_fresh(user_id, max_age_hours=0.5):
            rm, slm, am, smm = oc.get_days(user_id, days=days)
            if rm or slm or am or smm:
                cache_hit = True
    except Exception:
        pass  # fall through to live fetch

    # Even when the cache is fresh, bypass it if today's session detail is
    # missing — Oura processes scores quickly but session detail takes longer.
    # Re-fetching live catches the moment Oura finishes processing.
    if cache_hit:
        today_str_check = datetime.now().strftime("%Y-%m-%d")
        if slm.get(today_str_check) and not smm.get(today_str_check):
            cache_hit = False  # force live fetch to try to get today's session

    if not cache_hit:
        try:
            raw = await fetch_all(access_token, days=days)
            rm, slm, am, smm = parse_oura_data(raw)
            oura_vo2_max = parse_oura_vo2_max(raw)
            # Populate the cache so the next load is instant
            try:
                oc.store_days(user_id, rm, slm, am, smm)
            except Exception:
                pass
        except Exception as exc:
            exc_str = str(exc).lower()
            if "401" in exc_str or "403" in exc_str or "token" in exc_str or "expired" in exc_str:
                raise HTTPException(
                    status_code=401,
                    detail="Oura token expired — please reconnect your Oura Ring.",
                )
            if not (rm or slm or am or smm):
                raise HTTPException(status_code=502, detail=f"Oura API error: {exc}")

    # ── "Today" — anchor to the most recent available data ───────────────────
    # Oura sleep scores can lag — prefer today, then yesterday, then most recent.
    # All data sources (readiness, sleep, activity) use the same anchor date
    # so coach cards never mix data from different days.
    from datetime import timedelta
    today_str     = datetime.now().strftime("%Y-%m-%d")  # server UTC clock — for cache/AH fetch only
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    # TIMEZONE-SAFE "today": use the most recent date in Oura data, not the server clock.
    # The Render server runs in UTC. After ~8 PM Eastern (midnight UTC) the server's
    # calendar date rolls forward by one day, making server "yesterday" = user's "today".
    # Oura records dates in the user's local time, so the max Oura date is always correct.
    all_oura_dates = sorted(set(list(rm) + list(slm) + list(am)))
    oura_today     = all_oura_dates[-1] if all_oura_dates else today_str
    oura_yesterday = (
        datetime.strptime(oura_today, "%Y-%m-%d") - timedelta(days=1)
    ).strftime("%Y-%m-%d")

    # Anchor: prefer the most recent date where the sleep score is ready.
    # Oura publishes daily_sleep with score=null for several hours after waking;
    # anchor to yesterday (where everything is complete) until today's score arrives.
    def _scored(d: str, mapping: dict) -> bool:
        # score=0 means ring not worn — treat as no data, not a valid score.
        s = mapping.get(d, {}).get("score")
        return bool(s and s > 0)

    if _scored(oura_today, slm):
        anchor = oura_today
    elif _scored(oura_yesterday, slm):
        anchor = oura_yesterday
    elif slm:
        scored_dates = [d for d in sorted(slm, reverse=True) if slm[d].get("score")]
        anchor = scored_dates[0] if scored_dates else sorted(slm)[-1]
    else:
        anchor = oura_today

    t_sl  = slm.get(anchor, {})
    # Readiness and activity are processed faster than sleep — if the anchor date
    # is missing either (rare edge case), fall back to their own most-recent scored day.
    def _scored_row(mapping: dict, preferred: str) -> dict:
        # score=0 means ring not worn — skip it and find a genuinely scored day.
        row = mapping.get(preferred) or {}
        s = row.get("score")
        if s and s > 0:
            return row
        for d in sorted(mapping, reverse=True):
            s2 = mapping[d].get("score")
            if s2 and s2 > 0:
                return mapping[d]
        return row
    t_rdy = _scored_row(rm, anchor)
    t_act = _scored_row(am, anchor)

    # ── Live activity metrics (today's steps / active calories from Apple Health) ──
    # Oura's activity summary closes at midnight — t_act.steps/active_cal are
    # from the anchor date (usually yesterday).  Apple Health accumulates live
    # data from iPhone/Watch throughout the day (synced via Health Auto Export
    # every 5 min), so it has today's running total.
    #
    # Strategy: keep t_act intact (Oura data for anchor date) for coaching and
    # "Yesterday's Performance" display.  Send a separate activity_live dict
    # with today's AH data so the frontend can show a "Today so far" section.
    # Use oura_today (timezone-safe) for AH fetch — today_str is server UTC and
    # can be one day ahead of the user's local date after 8 PM ET, causing the
    # AH lookup to request a date that doesn't exist yet in the user's data.
    try:
        ah_live = ah.get_day(user_id, oura_today)
    except Exception:
        ah_live = None

    # "Yesterday's Performance" — always one day before the anchor.
    # When anchor = today, this is calendar-yesterday (the common case).
    # When anchor = yesterday (sleep not yet processed for today), we show the
    # day-before-yesterday so the card is never redundant with the main rings.
    anchor_prev_str = (
        datetime.strptime(anchor, "%Y-%m-%d") - timedelta(days=1)
    ).strftime("%Y-%m-%d")
    yesterday_activity = am.get(anchor_prev_str, {})

    # "Today So Far" = live AH data + today's Oura activity score if Oura
    # has already closed today's ring (available by mid-morning most days).
    # Use oura_today (timezone-safe) instead of server's today_str to avoid UTC drift.
    today_oura_act = am.get(oura_today, {})
    activity_live = {
        "date":       oura_today,
        "steps":      (ah_live or {}).get("steps"),
        "active_cal": (ah_live or {}).get("active_calories"),
        "score":      today_oura_act.get("score") or None,  # None if not yet available
    }
    # Full today Oura activity (for Today's Performance card — steps/cal even without AH)
    today_activity = today_oura_act
    t_act_coach = t_act  # Oura-sourced; used for coach_activity() message

    # Oura sleep sessions and daily scores both use WAKE date.
    # When today's session hasn't been processed yet (smm[anchor] missing),
    # fall back to Apple Health data — the Oura app syncs to AH immediately,
    # so AH has the data hours before Oura's public API does.
    t_sm = smm.get(anchor, {})
    if not t_sm:
        try:
            ah_day = ah.get_day(user_id, anchor)
            if ah_day and (ah_day.get("sleep_hours") or ah_day.get("hrv")):
                sh  = ah_day.get("sleep_hours") or 0
                sdh = ah_day.get("sleep_deep_hours") or 0
                srh = ah_day.get("sleep_rem_hours") or 0
                t_sm = {
                    "total":         int(sh  * 3600) if sh  else None,
                    "deep":          int(sdh * 3600) if sdh else None,
                    "rem":           int(srh * 3600) if srh else None,
                    "hrv":           ah_day.get("hrv"),
                    "rhr":           ah_day.get("resting_hr"),
                    "efficiency":    None,
                    "bedtime_start": None,
                    "sleep_need":    None,
                    "_source":       "apple_health",
                }
        except Exception:
            pass

    # Build coaching — pass oura_today so it uses the correct timezone-safe date
    coaching = generate_coaching(rm, slm, am, smm, oura_today=oura_today)
    coaches  = {
        "overall":  coach_overall(t_rdy, t_sm),
        "sleep":    coach_sleep(t_sl, t_sm),
        "activity": coach_activity(t_act),
    }

    # Trend (last 30 days)
    trend = _build_trend(rm, slm, am, smm, days=30)

    # ── Training Load (ACWR) ──────────────────────────────────────────────────
    # Acute:Chronic Workload Ratio using active calories as load proxy.
    # Zones: <0.8 under-trained | 0.8–1.3 optimal | 1.3–1.5 caution | >1.5 high risk
    all_days_sorted = sorted(set(list(rm) + list(am)))
    today_dt = datetime.now().date()

    def _load_window(n_days):
        vals = []
        for d in all_days_sorted:
            try:
                dd = datetime.strptime(d, "%Y-%m-%d").date()
            except ValueError:
                continue
            if 0 <= (today_dt - dd).days < n_days:
                v = am.get(d, {}).get("active_cal")
                if v is not None:
                    vals.append(v)
        return sum(vals) / len(vals) if vals else None

    acute  = _load_window(7)   # 7-day avg load
    chronic = _load_window(28) # 28-day avg load
    acwr = round(acute / chronic, 2) if acute and chronic and chronic > 0 else None

    if acwr is None:
        load_zone, load_label, load_color = "unknown", "Not enough data", "#6b7280"
    elif acwr < 0.8:
        load_zone, load_label, load_color = "low",      "Under-trained",  "#3b82f6"
    elif acwr <= 1.3:
        load_zone, load_label, load_color = "optimal",  "Optimal load",   "#22c55e"
    elif acwr <= 1.5:
        load_zone, load_label, load_color = "caution",  "High load",      "#f59e0b"
    else:
        load_zone, load_label, load_color = "danger",   "Overreaching",   "#ef4444"

    training_load = {
        "acwr":         acwr,
        "acute_avg":    round(acute)  if acute  else None,
        "chronic_avg":  round(chronic) if chronic else None,
        "zone":         load_zone,
        "label":        load_label,
        "color":        load_color,
        "acute_days":   7,
        "chronic_days": 28,
    }

    # ── Readiness Forecast ────────────────────────────────────────────────────
    # Predict tomorrow's readiness from recent trend, HRV trajectory, sleep debt.
    recent_rdy = [rm[d]["score"] for d in sorted(rm)[-5:] if rm[d].get("score") is not None]
    recent_hrv = [smm[d]["hrv"]  for d in sorted(smm)[-5:] if smm.get(d, {}).get("hrv") is not None]

    base = sum(recent_rdy[-3:]) / len(recent_rdy[-3:]) if recent_rdy else 70

    # HRV trend adjustment
    hrv_adj = 0
    if len(recent_hrv) >= 2:
        hrv_delta = recent_hrv[-1] - recent_hrv[0]
        hrv_adj = max(-6, min(6, round(hrv_delta * 0.5)))

    # Sleep debt adjustment (7-day)
    TARGET_SLEEP = 7.5 * 3600
    recent_totals = [smm[d].get("total") for d in sorted(smm)[-7:] if smm.get(d, {}).get("total")]
    sleep_debt_s  = sum(max(0, TARGET_SLEEP - (t or 0)) for t in recent_totals)
    sleep_debt_h  = sleep_debt_s / 3600
    sleep_adj = 3 if sleep_debt_h < 2 else (-3 if sleep_debt_h < 8 else -7)

    forecast_score = int(max(30, min(100, round(base + hrv_adj + sleep_adj))))
    if forecast_score >= 85:
        fc_label, fc_color = "Prime day ahead",    "#22c55e"
    elif forecast_score >= 70:
        fc_label, fc_color = "Good recovery",      "#84cc16"
    elif forecast_score >= 55:
        fc_label, fc_color = "Moderate readiness", "#f59e0b"
    else:
        fc_label, fc_color = "Rest recommended",   "#ef4444"

    readiness_forecast = {
        "score":      forecast_score,
        "label":      fc_label,
        "color":      fc_color,
        "hrv_adj":    hrv_adj,
        "sleep_adj":  sleep_adj,
        "base":       round(base),
    }

    # ── Longevity Score ───────────────────────────────────────────────────────
    try:
        _profile = _get_profile(user_id)
        _ah_sum  = ah.get_summary(user_id, days=30)

        # Body fat: most recent manual weight log (BackNine Body & Weight card)
        # wins over Apple Health. Same precedence model as VO2 max — when a user
        # logs a fresh measurement in BackNine, that's a deliberate action and
        # should immediately update the Longevity Score instead of being shadowed
        # by an older AH reading from a scale sync.
        _we_body_fat: Optional[float] = None
        try:
            _we = nutr.get_weight_entries(user_id)
            _we_with_bf = [e for e in reversed(_we) if e.get("body_fat_pct") is not None]
            _we_body_fat = _we_with_bf[0]["body_fat_pct"] if _we_with_bf else None
        except Exception:
            _we_body_fat = None

        _ah_body_fat = (
            _we_body_fat
            or _ah_sum.get("today", {}).get("body_fat_percentage")
            or _ah_sum.get("latest_body_fat_pct")
        )

        # VO2 Max: manual profile entry → Apple Health → Oura cardiovascular_age.
        # Manual override wins so the "edit" button on the Longevity card actually
        # takes effect. Users typically edit because they have better data than
        # what the automatic estimates produced (Cooper test, Apple Watch trust,
        # etc.). To revert to automatic, the user clears the profile field.
        _vo2 = (_profile.get("vo2_max")
                or _ah_sum.get("today", {}).get("vo2_max")
                or oura_vo2_max)

        _lon_metrics = {
            "hrv":                 t_sm.get("hrv"),
            "rhr":                 t_sm.get("rhr"),
            "vo2_max":             _vo2,
            "body_fat_percentage": _ah_body_fat,
            # 7-day averages for sleep and steps
            "sleep_hours": (lambda v: v if v else None)(
                next((d.get("total_hrs") for d in sorted(
                    [{"d": d, "total_hrs": (
                        sum(t_sm2.get("total", 0) or 0 for t_sm2 in [smm.get(d2, {}) for d2 in [d]])
                        / 3600
                    )} for d in sorted(smm, reverse=True)[:7]], key=lambda x: x["d"]
                ) if d.get("total_hrs", 0) > 0), None)
            ),
            "steps": (lambda vals: round(sum(vals) / len(vals)) if vals else None)(
                [am[d]["steps"] for d in sorted(am, reverse=True)[:7] if am[d].get("steps")]
            ),
        }
        longevity_score = lon.compute(_lon_metrics, _profile)
    except Exception:
        longevity_score = {"score": None, "grade": None, "components": {}}

    # ── Prediction tracking ───────────────────────────────────────────────────
    # Save today's forecast as tomorrow's prediction, fill in any past actuals,
    # then compute accuracy history for the gamification card.
    # Use oura_today (Oura-anchored local date) not server UTC — avoids saving
    # for the wrong date after 8 PM ET when the UTC clock rolls forward.
    oura_tomorrow_str = (
        datetime.strptime(oura_today, "%Y-%m-%d") + timedelta(days=1)
    ).strftime("%Y-%m-%d")
    prd.save_prediction(user_id, oura_tomorrow_str, forecast_score)
    prd.fill_actuals(user_id, rm)
    pred_history = prd.get_history(user_id, days=60)
    pred_accuracy = prd.compute_accuracy(pred_history)

    # Latest data date
    all_days = sorted(set(list(rm) + list(slm) + list(am)))
    data_through = all_days[-1] if all_days else today_str

    payload = {
        "generated":    datetime.now(timezone.utc).isoformat(),
        "data_through": data_through,
        "provider":     "oura",
        "today": {
            "date":               anchor,             # Oura data anchor (often yesterday)
            "calendar_today":     oura_today,         # Timezone-safe "today" from Oura data
            "readiness":          t_rdy,
            "sleep":              t_sl,
            "activity":           t_act,              # Oura activity for anchor (coach card)
            "yesterday_activity": yesterday_activity, # Day before anchor's Oura activity
            "activity_live":      activity_live,      # AH live + today's Oura score
            "today_activity":     today_activity,     # Full Oura activity for oura_today
            "sleep_model":        t_sm,
        },
        "training_load":       training_load,
        "readiness_forecast":  readiness_forecast,
        "prediction_accuracy": pred_accuracy,
        "longevity_score":     longevity_score,
        "trend":    trend,
        "coaches":  coaches,
        "coaching": coaching,
    }

    # If tokens were just refreshed, write the new JWT cookie in the response
    if refreshed_session:
        resp = JSONResponse(payload)
        _set_session_cookie(resp, refreshed_session)
        return resp

    return payload


# ── Wearables ─────────────────────────────────────────────────────────────────

@app.get("/api/wearables")
def list_wearables(request: Request):
    session = _require_session(request)
    return {
        "connected": [
            {
                "provider": session["provider"],
                "connected_at": None,
            }
        ],
        "available": [
            {"provider": "oura",        "name": "Oura Ring",     "status": "connected" if session["provider"] == "oura" else "available"},
            {"provider": "apple_health","name": "Apple Health",  "status": "coming_soon"},
            {"provider": "garmin",      "name": "Garmin",        "status": "coming_soon"},
            {"provider": "whoop",       "name": "WHOOP",         "status": "coming_soon"},
            {"provider": "fitbit",      "name": "Fitbit",        "status": "coming_soon"},
        ],
    }


@app.delete("/api/wearables/{provider}")
def disconnect_wearable(provider: str, request: Request, response: Response):
    session = _require_session(request)
    if session.get("provider") != provider:
        raise HTTPException(status_code=404, detail="Wearable not connected")
    response.delete_cookie(_session_cookie_name())
    db = get_supabase()
    if db and session.get("user_id"):
        db.table("wearable_connections").delete().eq("user_id", session["user_id"]).eq("provider", provider).execute()
    return {"status": "disconnected"}


# ── Nutrition ─────────────────────────────────────────────────────────────────

@app.get("/api/nutrition/foods/search")
def search_foods(request: Request, q: str = ""):
    _require_session(request)
    return {"results": nutr.search_foods(q)}


@app.get("/api/nutrition/today")
def get_today_nutrition(request: Request):
    session  = _require_session(request)
    uid      = session["user_id"]
    today    = datetime.now().strftime("%Y-%m-%d")
    meals    = nutr.get_meals(today, uid)
    settings = nutr.get_settings(uid)
    totals = {
        "calories": sum(m["calories"] for m in meals),
        "protein":  round(sum(m["protein"] for m in meals), 1),
        "carbs":    round(sum(m["carbs"]   for m in meals), 1),
        "fat":      round(sum(m["fat"]     for m in meals), 1),
    }
    return {"date": today, "meals": meals, "totals": totals, "settings": settings}


@app.post("/api/nutrition/meals")
async def log_meal(request: Request):
    session = _require_session(request)
    uid     = session["user_id"]
    body    = await request.json()
    today   = datetime.now().strftime("%Y-%m-%d")
    entry   = nutr.add_meal(
        body.get("date", today),
        body["name"],
        body["calories"],
        body["protein"],
        body["carbs"],
        body["fat"],
        body.get("meal_type", "meal"),
        user_id=uid,
    )
    return entry


@app.delete("/api/nutrition/meals/{meal_id}")
def remove_meal(meal_id: str, request: Request, date: str = None):
    session = _require_session(request)
    uid     = session["user_id"]
    today   = date or datetime.now().strftime("%Y-%m-%d")
    ok = nutr.delete_meal(today, meal_id, uid)
    if not ok:
        raise HTTPException(status_code=404, detail="Meal not found")
    return {"status": "deleted"}


@app.get("/api/nutrition/weight")
def get_weight(request: Request):
    session = _require_session(request)
    return {"entries": nutr.get_weight_entries(session["user_id"])}


@app.post("/api/nutrition/weight")
async def log_weight(request: Request):
    session = _require_session(request)
    uid     = session["user_id"]
    body    = await request.json()
    today   = datetime.now().strftime("%Y-%m-%d")
    entry   = nutr.add_weight_entry(
        date_str                 = body.get("date", today),
        weight_lbs               = body["weight_lbs"],
        body_fat_pct             = body.get("body_fat_pct"),
        muscle_mass_lbs          = body.get("muscle_mass_lbs"),
        lean_mass_lbs            = body.get("lean_mass_lbs"),
        trunk_muscle_lbs         = body.get("trunk_muscle_lbs"),
        right_arm_muscle_lbs     = body.get("right_arm_muscle_lbs"),
        left_arm_muscle_lbs      = body.get("left_arm_muscle_lbs"),
        right_leg_muscle_lbs     = body.get("right_leg_muscle_lbs"),
        left_leg_muscle_lbs      = body.get("left_leg_muscle_lbs"),
        trunk_fat_lbs            = body.get("trunk_fat_lbs"),
        right_arm_fat_lbs        = body.get("right_arm_fat_lbs"),
        left_arm_fat_lbs         = body.get("left_arm_fat_lbs"),
        right_leg_fat_lbs        = body.get("right_leg_fat_lbs"),
        left_leg_fat_lbs         = body.get("left_leg_fat_lbs"),
        total_body_water_lbs     = body.get("total_body_water_lbs"),
        intracellular_water_lbs  = body.get("intracellular_water_lbs"),
        extracellular_water_lbs  = body.get("extracellular_water_lbs"),
        ecw_ratio                = body.get("ecw_ratio"),
        visceral_fat_level       = body.get("visceral_fat_level"),
        bone_mineral_content_lbs = body.get("bone_mineral_content_lbs"),
        bmr_kcal                 = body.get("bmr_kcal"),
        inbody_score             = body.get("inbody_score"),
        user_id                  = uid,
    )
    # Activity feed event — best-effort
    try:
        frd.record_event(
            uid,
            "weight_logged",
            {
                "weight_lbs":   body.get("weight_lbs"),
                "body_fat_pct": body.get("body_fat_pct"),
            },
            user_name=_display_name_for(uid),
        )
    except Exception:
        pass
    return entry


@app.delete("/api/nutrition/weight/{entry_id}")
def remove_weight(entry_id: str, request: Request):
    session = _require_session(request)
    ok = nutr.delete_weight_entry(entry_id, session["user_id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted"}


@app.get("/api/nutrition/settings")
def get_nutrition_settings(request: Request):
    session = _require_session(request)
    return nutr.get_settings(session["user_id"])


@app.post("/api/nutrition/settings")
async def update_nutrition_settings(request: Request):
    session = _require_session(request)
    body    = await request.json()
    return nutr.save_settings(body, session["user_id"])


@app.get("/api/nutrition/summary")
async def get_nutrition_summary(request: Request):
    session = _require_session(request)
    uid     = session["user_id"]
    access_token, _ = await _ensure_valid_token(session)
    # Fetch active calories from Oura for context
    try:
        raw = await fetch_all(access_token, days=14)
        _, _, am, _ = parse_oura_data(raw)
        active_cals = {d: am[d].get("active_cal", 0) for d in am if am[d].get("active_cal")}
    except Exception:
        active_cals = {}
    return nutr.weekly_summary(active_cals, uid)


# ── Training ──────────────────────────────────────────────────────────────────

@app.get("/api/training/exercises/search")
def search_exercises(request: Request, q: str = ""):
    _require_session(request)
    return {"results": trn.search_exercises(q)}


@app.get("/api/training/workouts")
def get_workouts(request: Request, days: int = 30):
    _require_session(request)
    return {"workouts": trn.get_workouts(days)}


@app.post("/api/training/workouts")
async def log_workout(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    today = datetime.now().strftime("%Y-%m-%d")
    entry = trn.add_workout(
        date_str     = body.get("date", today),
        workout_type = body.get("type", "lifting"),
        exercises    = body.get("exercises", []),
        duration_min = body.get("duration_min"),
        notes        = body.get("notes", ""),
    )
    # Activity feed event — best-effort, never blocks the response
    try:
        frd.record_event(
            user_id,
            "workout_logged",
            {
                "type":         body.get("type", "lifting"),
                "duration_min": body.get("duration_min"),
                "name":         f"a {body.get('type', 'lifting')} workout",
            },
            user_name=_display_name_for(user_id),
        )
    except Exception:
        pass
    return entry


@app.delete("/api/training/workouts/{workout_id}")
def remove_workout(workout_id: str, request: Request):
    _require_session(request)
    ok = trn.delete_workout(workout_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workout not found")
    return {"status": "deleted"}


@app.get("/api/training/recommendation")
async def get_training_recommendation(request: Request):
    session = _require_session(request)
    access_token, _ = await _ensure_valid_token(session)
    # Pull today's readiness & HRV from Oura
    readiness_score = 70
    hrv = None
    try:
        raw = await fetch_all(access_token, days=7)
        rm, _, _, smm = parse_oura_data(raw)
        today_str = datetime.now().strftime("%Y-%m-%d")
        rdy = rm.get(today_str) or (rm[sorted(rm)[-1]] if rm else {})
        sm  = smm.get(today_str) or (smm[sorted(smm)[-1]] if smm else {})
        readiness_score = rdy.get("score", 70) or 70
        hrv = sm.get("hrv")
    except Exception:
        pass
    recent = trn.get_workouts(days=7)
    return trn.daily_recommendation(readiness_score, hrv, recent)


@app.post("/api/training/stretch-routine")
async def get_stretch_routine(request: Request):
    _require_session(request)
    body = await request.json()
    muscle_groups    = body.get("muscle_groups", [])
    duration_target  = body.get("duration_min", 10)
    return trn.generate_stretch_routine(muscle_groups, duration_target)


@app.get("/api/training/weekly-plan")
def get_weekly_plan(request: Request):
    _require_session(request)
    settings = trn.get_settings()
    return trn.generate_weekly_plan(settings)


@app.get("/api/training/settings")
def get_training_settings(request: Request):
    _require_session(request)
    return trn.get_settings()


@app.post("/api/training/settings")
async def update_training_settings(request: Request):
    _require_session(request)
    body = await request.json()
    return trn.save_settings(body)


# ── Labs ──────────────────────────────────────────────────────────────────────

@app.get("/api/labs")
def get_labs(request: Request):
    session = _require_session(request)
    entries = lbs.get_entries(session["user_id"])
    # Attach scoring to each entry
    return {"entries": [{"scored": lbs.score_entry(e), **e} for e in entries]}


@app.post("/api/labs")
async def log_lab(request: Request):
    session  = _require_session(request)
    uid      = session["user_id"]
    body     = await request.json()
    today    = datetime.now().strftime("%Y-%m-%d")
    notes    = body.pop("notes", "")
    date_str = body.pop("date", today)
    body.pop("id",        None)
    body.pop("logged_at", None)
    body.pop("scored",    None)
    entry = lbs.add_entry(date_str, body, notes, uid)
    return {**entry, "scored": lbs.score_entry(entry)}


@app.delete("/api/labs/{entry_id}")
def remove_lab(entry_id: str, request: Request):
    session = _require_session(request)
    ok = lbs.delete_entry(entry_id, session["user_id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Lab entry not found")
    return {"status": "deleted"}


@app.get("/api/labs/reference-ranges")
def get_reference_ranges(request: Request):
    _require_session(request)
    return {"ranges": lbs.REFERENCE_RANGES, "groups": lbs.LAB_GROUPS}


@app.post("/api/labs/import-pdf")
async def import_lab_pdf(request: Request, file: UploadFile = File(...)):
    _require_session(request)
    contents = await file.read()
    date_str, extracted = lbs.parse_pdf(contents)
    return {
        "date":      date_str or datetime.now().strftime("%Y-%m-%d"),
        "extracted": extracted,   # {marker_key: float}
        "count":     len(extracted),
    }


# ── Challenges ────────────────────────────────────────────────────────────────

def _auto_sync_oura_steps(user_id: str, challenges: list) -> None:
    """
    For any active 'steps' challenge the user participates in, pull their
    daily step counts from the Oura cache and upsert into challenge_progress.
    Only fills days where Oura has data — leaves gaps for manual entry.
    Runs silently; never raises so it can't break the challenges endpoint.
    """
    try:
        steps_challenges = [
            c for c in challenges
            if c.get("type") == "steps" and c.get("is_active")
        ]
        if not steps_challenges:
            return

        # Pull up to 90 days of Oura cached data
        rm, slm, am, smm = oc.get_days(user_id, days=90)
        if not am:
            return

        for challenge in steps_challenges:
            cid        = challenge["id"]
            start_str  = challenge["start_date"]
            end_str    = challenge["end_date"]

            # Walk every date in the challenge window that Oura has steps for
            from datetime import date as _date, timedelta as _td
            from zoneinfo import ZoneInfo as _ZI
            from datetime import datetime as _dt
            cur = _date.fromisoformat(start_str)
            end = _date.fromisoformat(end_str)
            today_d = _dt.now(tz=_ZI("America/New_York")).date()

            while cur <= min(end, today_d):
                ds = cur.isoformat()
                steps = am.get(ds, {}).get("steps")
                if steps and steps > 0:
                    # Only write if Oura has a real value — don't overwrite manual entries
                    # with 0, and don't invent data for days Oura didn't record
                    try:
                        chl.log_progress(cid, float(steps), for_date=ds, user_id=user_id)
                    except Exception:
                        pass
                cur += _td(days=1)
    except Exception:
        pass  # Never surface errors from auto-sync


@app.get("/api/challenges/me")
def my_challenges(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    challenges = chl.list_my_challenges(user_id=user_id)
    # Auto-populate steps challenges from Oura cache before returning
    _auto_sync_oura_steps(user_id, challenges)
    # Re-fetch so the returned data reflects the auto-filled values
    challenges = chl.list_my_challenges(user_id=user_id)
    return {"challenges": challenges, "user_id": user_id}


@app.post("/api/challenges")
async def create_challenge(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    try:
        challenge = chl.create_challenge(
            name           = body["name"],
            challenge_type = body["type"],
            target         = float(body["target"]),
            duration_days  = int(body["duration_days"]),
            creator_name   = body["creator_name"],
            user_id        = user_id,
            custom_unit    = body.get("custom_unit"),
        )
        # Immediately backfill Oura steps for the full challenge window
        _auto_sync_oura_steps(user_id, [challenge])
        return chl.get_challenge(challenge["id"], user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/challenges/join")
async def join_challenge(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    try:
        challenge = chl.join_challenge(
            challenge_id = body["challenge_id"],
            display_name = body["display_name"],
            user_id      = user_id,
        )
        # Backfill any Oura steps already recorded during this challenge window
        _auto_sync_oura_steps(user_id, [challenge])
        # Activity feed event — best-effort
        try:
            frd.record_event(
                user_id,
                "challenge_joined",
                {
                    "challenge_id":   challenge.get("id"),
                    "challenge_name": challenge.get("name"),
                },
                user_name=body.get("display_name") or _display_name_for(user_id),
            )
        except Exception:
            pass
        return chl.get_challenge(challenge["id"], user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/challenges/{challenge_id}")
def get_challenge(challenge_id: str, request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        challenge = chl.get_challenge(challenge_id.upper(), user_id=user_id)
        # Auto-fill steps from Oura before returning
        _auto_sync_oura_steps(user_id, [challenge])
        return chl.get_challenge(challenge_id.upper(), user_id=user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/challenges/{challenge_id}/progress")
async def log_challenge_progress(challenge_id: str, request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    try:
        return chl.log_progress(
            challenge_id = challenge_id.upper(),
            value        = float(body["value"]),
            for_date     = body.get("date"),
            user_id      = user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/challenges/{challenge_id}/messages")
def get_challenge_messages(challenge_id: str, request: Request):
    _require_session(request)
    return {"messages": chl.get_messages(challenge_id.upper())}


@app.post("/api/challenges/{challenge_id}/messages")
async def post_challenge_message(challenge_id: str, request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    try:
        msg = chl.post_message(
            challenge_id  = challenge_id.upper(),
            user_id       = user_id,
            display_name  = str(body.get("display_name", "")).strip() or "Anonymous",
            text          = str(body.get("text", "")),
        )
        return msg
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Current user ─────────────────────────────────────────────────────────────

@app.get("/api/me")
def get_me(request: Request):
    """Return the current user's identity and connected wearables."""
    session = _require_session(request)
    user_id = session["user_id"]
    has_oura = bool(session.get("access_token"))
    if not has_oura:
        db = get_supabase()
        if db:
            try:
                res = (
                    db.table("wearable_connections")
                    .select("provider")
                    .eq("user_id", user_id)
                    .execute()
                )
                providers = [r["provider"] for r in (res.data or [])]
                has_oura = "oura" in providers
            except Exception:
                pass
    return {
        "user_id":  user_id,
        "email":    session.get("email"),
        "provider": session.get("provider", "oura"),
        "has_oura": has_oura,
    }


# ── Progress ──────────────────────────────────────────────────────────────────

@app.get("/api/progress")
def get_progress(request: Request):
    """
    Return 30-day vs previous-30-day progress for all available metrics.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return prog.get_progress(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Insights ──────────────────────────────────────────────────────────────────

@app.get("/api/insights")
def get_insights(request: Request, days: int = 60):
    """
    Return cross-source correlation insights for the current user.
    Requires a few weeks of overlapping data across Oura + nutrition + Apple Health.
    Runs with an 8-second wall-clock timeout so slow Supabase queries never
    leave the spinner running indefinitely.
    """
    import concurrent.futures
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(ins.get_insights, user_id, days)
            try:
                results = future.result(timeout=8)
            except concurrent.futures.TimeoutError:
                # Return empty list — frontend will show "not enough data" state
                return {"insights": [], "days_analyzed": days}
        return {"insights": results, "days_analyzed": days}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Profile ───────────────────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile(request: Request):
    session = _require_session(request)
    return _get_profile(session["user_id"])


@app.post("/api/profile")
async def save_profile(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    allowed = {"name", "age", "biological_sex", "height_cm", "health_goals", "vo2_max"}
    data = {k: v for k, v in body.items() if k in allowed}
    data["user_id"] = user_id
    try:
        db = get_supabase()
        db.table("user_profiles").upsert(data, on_conflict="user_id").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # If the display name was provided, fan it out to the denormalized name
    # columns on friendships and activity_events so existing data reflects
    # the user's chosen identity instead of "BackNine user". Best-effort —
    # the profile save itself already succeeded by this point.
    new_name = data.get("name")
    if new_name and isinstance(new_name, str) and new_name.strip():
        new_name = new_name.strip()
        try:
            db.table("friendships").update({"user_a_name": new_name}).eq("user_id_a", user_id).execute()
        except Exception:
            pass
        try:
            db.table("friendships").update({"user_b_name": new_name}).eq("user_id_b", user_id).execute()
        except Exception:
            pass
        try:
            db.table("activity_events").update({"user_name": new_name}).eq("user_id", user_id).execute()
        except Exception:
            pass

    return {"ok": True}


# ── Chat ───────────────────────────────────────────────────────────────────────

# Number of recent turns to send to Claude as conversation context.
# Matches the historic in-memory cap so token costs are predictable.
CHAT_HISTORY_LIMIT = 20


def _load_chat_history(user_id: str, limit: int = CHAT_HISTORY_LIMIT) -> list[dict]:
    """Load the most recent N chat turns for the user, oldest-first."""
    db = get_supabase()
    if not db:
        return []
    try:
        res = (
            db.table("chat_messages")
            .select("role, content")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = res.data or []
        # rows are newest-first; reverse for chronological order
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    except Exception:
        return []


def _save_chat_turn(user_id: str, role: str, content: str) -> None:
    """Persist a single chat turn. Best-effort — never raises."""
    db = get_supabase()
    if not db:
        return
    try:
        db.table("chat_messages").insert({
            "user_id": user_id,
            "role":    role,
            "content": content,
        }).execute()
    except Exception:
        pass


@app.get("/api/chat/history")
def get_chat_history(request: Request, limit: int = 50):
    """Return the user's recent chat turns, oldest-first (chronological)."""
    session = _require_session(request)
    user_id = session["user_id"]
    limit = max(1, min(limit, 200))
    return {"messages": _load_chat_history(user_id, limit=limit)}


@app.delete("/api/chat/history")
def clear_chat_history(request: Request):
    """Wipe all of the user's chat history. Used by 'clear conversation'."""
    session = _require_session(request)
    user_id = session["user_id"]
    db = get_supabase()
    if not db:
        return {"cleared": 0}
    try:
        db.table("chat_messages").delete().eq("user_id", user_id).execute()
        return {"cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat")
async def health_chat(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    # The backend is now the source of truth for conversation history.
    # We load the most recent turns from the DB and ignore any client-supplied
    # `history` field (kept here only for response shape compatibility).
    history = _load_chat_history(user_id)

    # Build health context from cached Oura data
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=30)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    # Timezone-safe anchor + smm with bedtime/AH fallbacks. Without this we
    # were reading server-UTC dates and missing the bedtime-keyed sleep row,
    # which is how the briefing ended up showing 5.8h when Oura had 8h+.
    _anchor, t_rdy, t_sl, t_act, t_sm = _resolve_oura_anchor(user_id, rm, slm, am, smm)

    # 7-day averages
    recent_days = sorted(smm.keys(), reverse=True)[:7]
    hrv_vals  = [smm[d]["hrv"]   for d in recent_days if smm[d].get("hrv")]
    sleep_vals = [smm[d]["total"] for d in recent_days if smm[d].get("total")]
    rdy_vals  = [rm[d]["score"]  for d in sorted(rm.keys(), reverse=True)[:7] if rm.get(d, {}).get("score")]

    hrv_avg = round(sum(hrv_vals) / len(hrv_vals)) if hrv_vals else None
    hrv_prev = (sum(hrv_vals[len(hrv_vals)//2:]) / max(1, len(hrv_vals[len(hrv_vals)//2:]))) if len(hrv_vals) >= 4 else None
    hrv_direction = (
        "rising" if hrv_avg and hrv_prev and hrv_avg > hrv_prev + 1
        else "falling" if hrv_avg and hrv_prev and hrv_avg < hrv_prev - 1
        else "stable"
    )

    # AH data for extra context
    try:
        ah_sum = ah.get_summary(user_id, days=30)
        ah_recent = ah_sum.get("most_recent", {})
    except Exception:
        ah_recent = {}

    health_context = {
        "today": {
            "readiness_score":     t_rdy.get("score"),
            "sleep_score":         t_sl.get("score"),
            "hrv":                 t_sm.get("hrv"),
            "rhr":                 t_sm.get("rhr"),
            "activity_score":      t_act.get("score"),
            "steps":               t_act.get("steps"),
            "sleep_hours":         round(t_sm["total"] / 3600, 1) if t_sm.get("total") else None,
            "body_fat_percentage": ah_recent.get("body_fat_percentage"),
            "vo2_max":             ah_recent.get("vo2_max"),
        },
        "seven_day": {
            "hrv_avg":       hrv_avg,
            "hrv_direction": hrv_direction,
            "sleep_avg":     round(sum(sleep_vals) / len(sleep_vals) / 3600, 1) if sleep_vals else None,
            "readiness_avg": round(sum(rdy_vals) / len(rdy_vals)) if rdy_vals else None,
        },
        "coaching": {
            "short_term": "; ".join(
                f"{i.get('icon','')} {i.get('label','')}: {i.get('text','')}"
                for i in (generate_coaching(rm, slm, am, smm).get("short") or [])
            ),
        },
    }

    profile = _get_profile(user_id)

    try:
        reply = ch.chat(message, health_context, profile, history)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Persist both turns. Save the user message FIRST so order_by created_at
    # preserves the natural sequence even with millisecond-fast inserts.
    _save_chat_turn(user_id, "user",      message)
    _save_chat_turn(user_id, "assistant", reply)
    return {"reply": reply}


# ── Morning Briefing ──────────────────────────────────────────────────────────

@app.get("/api/briefing/today")
async def get_morning_briefing(request: Request, refresh: bool = False):
    """Return today's Coach Al morning briefing for the current user.

    Cache strategy: one row per (user_id, date) in public.daily_briefings.
    First call of the day generates the narrative via Claude Haiku and saves it;
    subsequent calls return the cached row. Pass ?refresh=1 to force a regenerate
    (rate-limit responsibly client-side; this costs an Anthropic call).
    """
    session = _require_session(request)
    user_id = session["user_id"]

    # Timezone-safe "today" — same convention as challenges.py so cache keys
    # don't roll over at midnight UTC for ET-based users.
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_str = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()

    db = get_supabase()

    # Cache hit?
    if db and not refresh:
        try:
            cached = (
                db.table("daily_briefings")
                .select("narrative, prediction_streak, prediction_accuracy, generated_at")
                .eq("user_id", user_id)
                .eq("date", today_str)
                .execute()
            )
            if cached.data:
                row = cached.data[0]
                return {
                    "date":                today_str,
                    "narrative":           row["narrative"],
                    "prediction_streak":   row.get("prediction_streak"),
                    "prediction_accuracy": row.get("prediction_accuracy"),
                    "generated_at":        row.get("generated_at"),
                    "cached":              True,
                    "app_streak":          _compute_app_streak(user_id, today_str),
                }
        except Exception:
            pass  # fall through to regenerate

    # Build health context — same shape as /api/chat
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=30)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    # Timezone-safe anchor + smm with bedtime/AH fallbacks (see helper docstring).
    # The naive `datetime.now()` approach was reading server UTC and missing the
    # bedtime-keyed sleep row — that was the source of the 5.8h-when-Oura-says-8h
    # bug in the briefing.
    _anchor, t_rdy, t_sl, t_act, t_sm = _resolve_oura_anchor(user_id, rm, slm, am, smm)

    recent_days = sorted(smm.keys(), reverse=True)[:7]
    hrv_vals   = [smm[d]["hrv"]   for d in recent_days if smm[d].get("hrv")]
    sleep_vals = [smm[d]["total"] for d in recent_days if smm[d].get("total")]
    rdy_vals   = [rm[d]["score"]  for d in sorted(rm.keys(), reverse=True)[:7] if rm.get(d, {}).get("score")]

    hrv_avg  = round(sum(hrv_vals) / len(hrv_vals)) if hrv_vals else None
    hrv_prev = (sum(hrv_vals[len(hrv_vals)//2:]) / max(1, len(hrv_vals[len(hrv_vals)//2:]))) if len(hrv_vals) >= 4 else None
    hrv_direction = (
        "rising"  if hrv_avg and hrv_prev and hrv_avg > hrv_prev + 1
        else "falling" if hrv_avg and hrv_prev and hrv_avg < hrv_prev - 1
        else "stable"
    )

    try:
        ah_sum = ah.get_summary(user_id, days=30)
        ah_today = (ah_sum.get("today") or {})
    except Exception:
        ah_today = {}

    # Short-term coaching items as a one-line summary
    try:
        short_items = generate_coaching(rm, slm, am, smm).get("short") or []
        short_text = "; ".join(
            f"{i.get('icon','')} {i.get('label','')}: {i.get('text','')}"
            for i in short_items
        )
    except Exception:
        short_text = ""

    health_context = {
        "today": {
            "readiness_score":     t_rdy.get("score"),
            "sleep_score":         t_sl.get("score"),
            "hrv":                 t_sm.get("hrv"),
            "rhr":                 t_sm.get("rhr"),
            "activity_score":      t_act.get("score"),
            "steps":               t_act.get("steps"),
            "sleep_hours":         round(t_sm["total"] / 3600, 1) if t_sm.get("total") else None,
            "body_fat_percentage": ah_today.get("body_fat_percentage"),
            "vo2_max":             ah_today.get("vo2_max"),
        },
        "seven_day": {
            "hrv_avg":       hrv_avg,
            "hrv_direction": hrv_direction,
            "sleep_avg":     round(sum(sleep_vals) / len(sleep_vals) / 3600, 1) if sleep_vals else None,
            "readiness_avg": round(sum(rdy_vals) / len(rdy_vals)) if rdy_vals else None,
        },
        "coaching": {"short_term": short_text},
    }

    # Prediction status — used both for the prompt AND returned to the client
    try:
        history  = prd.get_history(user_id, days=60)
        accuracy = prd.compute_accuracy(history)
        resolved = accuracy.get("resolved") or []
        last_resolved = resolved[0] if resolved else None
        prediction_status = {
            "streak":         accuracy.get("streak"),
            "accuracy_pct":   accuracy.get("accuracy_pct"),
            "last_predicted": last_resolved.get("predicted") if last_resolved else None,
            "last_actual":    last_resolved.get("actual")    if last_resolved else None,
        }
    except Exception:
        prediction_status = {"streak": 0, "accuracy_pct": None, "last_predicted": None, "last_actual": None}

    # Proactive observations — runs once per dashboard load (dedup'd by date).
    # Best-effort: a failure here must never block the briefing.
    try:
        accuracy_block = {"streak": prediction_status.get("streak", 0)}
        obs.generate_and_upsert(
            user_id,
            smm=smm,
            prediction_accuracy=accuracy_block,
            insights=[],
            today=today_str,
        )
    except Exception:
        pass

    profile = _get_profile(user_id)

    # Daily milestone events for the Pulse feed — only positive wins broadcast
    # to friends. Dedup'd by (user_id, kind, anchor_date) via payload.date so
    # each milestone fires at most once per day. Bad news (HRV drops, poor
    # sleep) stays private in coach_observations above.
    #
    # Backfill: when we run for a user, we replay the last 7 days of their
    # data through the detector to catch milestones that should have fired
    # but didn't (e.g., the milestone code didn't exist yet, or the user
    # didn't open the dashboard that day). Backfilled events are timestamped
    # on the actual anchor date so the feed reads chronologically.
    try:
        m_anchor, _m_rdy, _m_sl, _m_act, _m_sm = _resolve_oura_anchor(user_id, rm, slm, am, smm)
        frd.generate_milestones_with_backfill(
            user_id,
            (profile or {}).get("name") or "Friend",
            rm=rm, slm=slm, am=am, smm=smm,
            today=m_anchor,
            backfill_days=7,
            prediction_streak=prediction_status.get("streak"),
        )
    except Exception:
        pass

    # ── Friend milestone backfill ───────────────────────────────────────────
    # Pulse goes from empty to alive: every time the current user opens their
    # dashboard, we also run the milestone detector across each of their
    # friends' cached Oura data. The friend doesn't need to log in for their
    # great-sleep / HRV-rebound / personal-best events to surface in our user's
    # feed — they're already in oura_daily_cache (webhooks keep it warm).
    #
    # Cost is bounded: small friend count × 7-day window × cheap dedup query.
    # All best-effort; one slow friend lookup can't block the briefing response.
    try:
        my_friends = frd.list_friends(user_id)
    except Exception:
        my_friends = []
    for friend in my_friends:
        try:
            f_uid  = friend.get("user_id")
            f_name = friend.get("name") or "Friend"
            if not f_uid:
                continue
            f_rm, f_slm, f_am, f_smm = oc.get_days(f_uid, days=10)
            f_anchor, _, _, _, _ = _resolve_oura_anchor(f_uid, f_rm, f_slm, f_am, f_smm)
            frd.generate_milestones_with_backfill(
                f_uid,
                f_name,
                rm=f_rm, slm=f_slm, am=f_am, smm=f_smm,
                today=f_anchor,
                backfill_days=7,
                prediction_streak=None,  # we don't track other users' streaks here
            )
        except Exception:
            continue

    # Pull yesterday's mood check-in (if any) so Coach Al can reference how
    # the user actually felt yesterday vs what their watch said.
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    _y = (datetime.strptime(today_str, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
    yesterday_checkin = _get_checkin(user_id, _y)
    yesterday_mood = (yesterday_checkin or {}).get("mood")

    # Generate the narrative
    try:
        narrative = brf.generate(
            health_context,
            profile,
            prediction_status,
            yesterday_mood=yesterday_mood,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"briefing generation failed: {e}")

    # Save to cache (best-effort — never crash the dashboard over a write)
    if db:
        try:
            db.table("daily_briefings").upsert(
                {
                    "user_id":             user_id,
                    "date":                today_str,
                    "narrative":           narrative,
                    "prediction_streak":   prediction_status.get("streak"),
                    "prediction_accuracy": prediction_status.get("accuracy_pct"),
                },
                on_conflict="user_id,date",
            ).execute()
        except Exception:
            pass

    return {
        "date":                today_str,
        "narrative":           narrative,
        "prediction_streak":   prediction_status.get("streak"),
        "prediction_accuracy": prediction_status.get("accuracy_pct"),
        "generated_at":        None,
        "cached":              False,
        "app_streak":          _compute_app_streak(user_id, today_str),
    }


# ── Friends ───────────────────────────────────────────────────────────────────

def _display_name_for(user_id: str) -> str:
    """Pull the user's display name from their profile, falling back to a default.

    The fallback used to be "BackNine user", which surfaced awkwardly in friend
    lists and the Pulse feed when a user hadn't filled in their profile yet.
    "Friend" reads more naturally; read paths (list_friends, list_friend_events)
    also live-join against user_profiles so a name set later surfaces immediately.
    """
    try:
        prof = _get_profile(user_id)
        return (prof.get("name") or "").strip() or "Friend"
    except Exception:
        return "Friend"


@app.post("/api/friends/invite")
async def create_friend_invite(request: Request):
    """Generate a one-time invite code for the current user to share."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return frd.create_invite(user_id, _display_name_for(user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not create invite: {e}")


@app.post("/api/friends/accept")
async def accept_friend_invite(request: Request):
    """Accept an invite by code. Body: { code }."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    try:
        return frd.accept_invite(code, user_id, _display_name_for(user_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not accept invite: {e}")


@app.get("/api/friends")
def list_friends(request: Request):
    """List the current user's accepted friendships."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return {"friends": frd.list_friends(user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/friends/{friend_user_id}")
def remove_friend(friend_user_id: str, request: Request):
    """Soft-remove an existing friendship (sets deleted_at; recoverable)."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return frd.remove_friend(user_id, friend_user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/friends/restore/{friend_user_id}")
def restore_friend(friend_user_id: str, request: Request):
    """Restore a soft-deleted friendship by clearing deleted_at.

    Useful when the auto-restore-on-re-accept path isn't available (e.g.,
    your friend can't re-invite right now). Idempotent — restoring an
    already-active friendship is a no-op.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return frd.restore_friend(user_id, friend_user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/friends/events")
def list_friend_events(request: Request, limit: int = 30):
    """Recent activity events from the user's friends + themselves."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return {"events": frd.list_friend_events(user_id, limit=min(max(limit, 1), 100))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Coach Al observations ─────────────────────────────────────────────────────

@app.get("/api/observations")
def list_observations(request: Request, limit: int = 20, include_dismissed: bool = False):
    """Return the user's recent Coach Al observations (unread first)."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        items = obs.list_observations(user_id, limit=min(max(limit, 1), 100), include_dismissed=include_dismissed)
        unread = obs.unread_count(user_id)
        return {"observations": items, "unread_count": unread}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/observations/{observation_id}/read")
def mark_observation_read(observation_id: str, request: Request):
    """Mark a single observation as read."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return obs.mark_read(user_id, observation_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/observations/{observation_id}/dismiss")
def dismiss_observation(observation_id: str, request: Request):
    """Dismiss an observation so it won't be shown again."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return obs.dismiss(user_id, observation_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/friends/events/{event_id}/react")
async def react_to_event(event_id: str, request: Request):
    """Toggle a reaction on a friend's activity event. Body: { emoji }."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    emoji = (body.get("emoji") or "").strip()
    if not emoji:
        raise HTTPException(status_code=400, detail="emoji is required")
    try:
        return frd.toggle_reaction(user_id, event_id, emoji)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/friends/events/{event_id}/comments")
def list_event_comments(event_id: str, request: Request):
    """Recent comments on a Pulse event (oldest-first)."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return {"comments": frd.list_event_comments(event_id, user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/friends/events/{event_id}/comments")
async def post_event_comment(event_id: str, request: Request):
    """Post a comment on a Pulse event. Body: { text }."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return frd.post_event_comment(
            event_id,
            user_id,
            _display_name_for(user_id),
            text,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Apple Health ──────────────────────────────────────────────────────────────

@app.get("/api/apple-health/key")
async def get_apple_health_key(request: Request):
    """Return (or create) the user's Apple Health API key."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        key = ah.get_or_create_key(user_id)
        return {"api_key": key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/apple-health/sync")
async def apple_health_sync(request: Request):
    """
    Receive a JSON payload from iOS Shortcut.
    Auth: X-AH-Key header (the per-user static API key).
    No session cookie needed — Shortcuts can't handle cookies.
    """
    api_key = request.headers.get("X-AH-Key", "")
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-AH-Key header")

    user_id = ah.resolve_user_by_key(api_key)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        stored = ah.sync_day(user_id, body)
        return {"ok": True, "stored": stored}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/apple-health/data")
async def get_apple_health_data(request: Request, days: int = 30):
    """Return recent Apple Health data for the current user."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return ah.get_summary(user_id, days=days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug/sleep")
async def debug_sleep(request: Request):
    """
    Returns raw parsed sleep data so we can diagnose date mismatches.
    Shows the last 5 days of smm, slm, and what anchor/t_sm resolve to.
    """
    session = _require_session(request)
    user_id = session["user_id"]

    # Resolve Oura token (same logic as dashboard)
    if not session.get("access_token"):
        db = get_supabase()
        if db:
            try:
                res = (db.table("wearable_connections")
                    .select("access_token, refresh_token, expires_at")
                    .eq("user_id", user_id).eq("provider", "oura").execute())
                rows = res.data or []
                if rows:
                    session = {**session, **rows[0]}
            except Exception:
                pass

    if not session.get("access_token"):
        raise HTTPException(status_code=400, detail="No Oura token found for this user")

    access_token, _ = await _ensure_valid_token(session)

    raw = await fetch_all(access_token, days=7)
    rm, slm, am, smm = parse_oura_data(raw)

    today_str     = datetime.now().strftime("%Y-%m-%d")
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    if slm.get(today_str):
        anchor = today_str
    elif slm.get(yesterday_str):
        anchor = yesterday_str
    elif slm:
        anchor = sorted(slm)[-1]
    else:
        anchor = today_str

    anchor_bedtime = (datetime.strptime(anchor, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    t_sm = smm.get(anchor, {})

    def fmt_hrs(s):
        if not s:
            return None
        total = s.get("total")
        return round(total / 3600, 2) if total else None

    return {
        "today":           today_str,
        "anchor":          anchor,
        "anchor_bedtime":  anchor_bedtime,
        "smm_keys":        sorted(smm.keys()),
        "slm_keys":        sorted(slm.keys()),
        "smm_anchor":      smm.get(anchor),
        "smm_anchor_prev": smm.get(anchor_bedtime),
        "t_sm_resolved":   t_sm,
        "t_sm_hours":      fmt_hrs(t_sm),
        "last5_smm": {
            d: {**smm[d], "hours": fmt_hrs(smm[d])}
            for d in sorted(smm.keys())[-5:]
        },
        "last5_slm": {
            d: slm[d] for d in sorted(slm.keys())[-5:]
        },
        "raw_sleep_sessions": raw.get("sleepDetail", {}).get("data", [])[-5:],
    }


# ── dev entrypoint ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
