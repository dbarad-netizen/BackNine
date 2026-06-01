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

from oura import build_auth_url, exchange_code, refresh_token as oura_refresh, fetch_all, fetch_workouts as oura_fetch_workouts, fetch_sessions as oura_fetch_sessions, parse_oura_data, parse_oura_vo2_max, fetch_personal_info
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
import longevity_history as lonh
import chat as ch
import briefing as brf
import weekly_insight as wins
import friends as frd
import leagues as lg
import groups as grp
import goals as gl
import achievements as ach
import gear_reviews as gr
import gear_ai as gai
import gear_demand as gd
import nutrition_ai as nai
import training_ai as tai
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


def _age_from_birthdate(birthdate) -> Optional[int]:
    """Compute current age (years) from an ISO birthdate string/date."""
    try:
        from datetime import date as _date
        b = _date.fromisoformat(str(birthdate)[:10])
        t = _date.today()
        age = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
        return age if 0 <= age <= 130 else None
    except Exception:
        return None


def _get_profile(user_id: str) -> dict:
    """Return the user's profile row, or {} if not found.

    If a birthdate is set, age is derived from it (always current) and written
    onto the profile's `age` field — so every consumer (longevity score, chat,
    briefing) keeps reading `age` but never sees a stale number. Falls back to
    the stored `age` for users who haven't entered a birthday.
    """
    try:
        db = get_supabase()
        if not db:
            return {}
        res = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
        prof = res.data[0] if res.data else {}
        bd = prof.get("birthdate")
        if bd:
            derived = _age_from_birthdate(bd)
            if derived is not None:
                prof["age"] = derived
        return prof
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

ALLOWED_MOODS = {"great", "good", "okay", "tired", "off"}


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


# NOTE: The @app.get / @app.post route registrations for /api/checkin/today
# and /api/checkin live further down in this file (after `app = FastAPI(...)`
# is created). Don't move them back up here — decorators run at import time,
# and using `app` before it's defined will NameError and prevent the backend
# from booting on Render.


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
    # Fall back to Authorization header (cross-origin: Vercel → Render)
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
    db = get_supabase()
    if not db:
        return

    try:
        # Oura's webhook sends ITS OWN user id (the personal id). We persist a
        # mapping + tokens in `oura_connections` (oura_user_id PK → BackNine
        # user_id + tokens). Reading it here is what makes webhooks actually land
        # — the old code read the empty, UUID-typed `wearable_connections` table
        # and silently no-op'd, so the cache only ever updated via the slow poll.
        res = (
            db.table("oura_connections")
            .select("user_id, access_token, refresh_token, expires_at")
            .eq("oura_user_id", str(oura_user_id))
            .execute()
        )
        rows = res.data or []
        if not rows:
            return
        conn = rows[0]
        backnine_uid = conn["user_id"]
        access_token = conn["access_token"]
        refresh_tok  = conn.get("refresh_token")
        expires_at   = conn.get("expires_at", 0)
        if not access_token:
            return  # mapping seeded but no tokens yet — fills on the user's next sign-in

        # Refresh token if expired
        if expires_at and datetime.now(timezone.utc).timestamp() > expires_at - 60:
            if not refresh_tok:
                return
            tokens = await oura_refresh(refresh_tok, OURA_CLIENT_ID, OURA_CLIENT_SECRET)
            access_token = tokens["access_token"]
            new_refresh  = tokens.get("refresh_token", refresh_tok)
            new_expires  = int(datetime.now(timezone.utc).timestamp()) + tokens.get("expires_in", 86400)
            db.table("oura_connections").update({
                "access_token":  access_token,
                "refresh_token": new_refresh,
                "expires_at":    new_expires,
            }).eq("oura_user_id", str(oura_user_id)).execute()

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


def _resolve_oura_user(oura_pid: str) -> Optional[str]:
    """Return the BackNine user_id already mapped to this Oura personal id, if any.

    Lets a returning user (especially one who later linked a Supabase account)
    resolve to their existing identity instead of a fresh oura_<pid>. Returns
    None for a brand-new Oura account."""
    db = get_supabase()
    if not db:
        return None
    try:
        res = (
            db.table("oura_connections")
            .select("user_id")
            .eq("oura_user_id", str(oura_pid))
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0]["user_id"] if rows else None
    except Exception:
        return None


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
            oura_pid = str(personal["id"])     # Oura's stable personal user ID
        except Exception:
            oura_pid = None

        if link_user_id:
            # User is connecting Oura from a Supabase account — use the Supabase UUID
            user_id = link_user_id
        elif oura_pid:
            # Direct Oura sign-in. Identity is deterministic — oura_<pid> — and
            # stable across devices because oura_pid is constant per Oura account.
            # If this account is already mapped to a canonical id (e.g. a later
            # Supabase link) in oura_connections, reuse it so all data stays under
            # one identity.
            user_id = _resolve_oura_user(oura_pid) or f"oura_{oura_pid}"
        else:
            # personal_info failed (after retries) and this isn't a Supabase link.
            # Do NOT mint a random hash-of-token fallback id — that gave the user a
            # brand-new account on every new browser and forced re-onboarding.
            # Bounce them back to retry instead of silently fragmenting their data.
            return RedirectResponse(f"{FRONTEND_URL}/?error=oura_verify_failed")

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

        # Persist the canonical Oura connection (oura_user_id → user_id + tokens).
        # This is the table the webhook handler reads to refresh the cache on push,
        # AND the stable mapping that lets a returning user resolve to the same
        # BackNine id on any device. Keyed on oura_user_id (the Oura personal id).
        if oura_pid:
            try:
                db = get_supabase()
                if db:
                    db.table("oura_connections").upsert({
                        "oura_user_id":  oura_pid,
                        "user_id":       user_id,
                        "access_token":  access_token,
                        "refresh_token": refresh_tok,
                        "expires_at":    expires_at,
                        "updated_at":    datetime.now(timezone.utc).isoformat(),
                    }).execute()
            except Exception:
                pass

        # Pass token in URL for cross-origin compatibility (Vercel + Render)
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


# Owner identification for in-app admin views (e.g. the gear demand panel).
# Admin if the signed-in email is in ADMIN_EMAILS, or the user_id is in
# ADMIN_USER_IDS. Defaults to the project owner so it works out of the box.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "dbarad@yahoo.com").split(",")
    if e.strip()
}
ADMIN_USER_IDS = {
    i.strip()
    for i in os.getenv("ADMIN_USER_IDS", "").split(",")
    if i.strip()
}


def _is_admin(session: dict) -> bool:
    email = (session.get("email") or "").strip().lower()
    if email and email in ADMIN_EMAILS:
        return True
    if str(session.get("user_id") or "") in ADMIN_USER_IDS:
        return True
    return False


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

def _empty_dashboard_payload(session: dict) -> dict:
    """Complete dashboard shape with empty/null values, for authenticated users
    who haven't connected Oura. Every key the frontend destructures is present
    so the dashboard renders its empty states rather than throwing on a missing
    `today` / `coaches` / `trend`.

    Includes `has_apple_health` + `apple_health` keys so the frontend can render
    Apple Health metrics for non-Oura users when they're syncing via the iOS
    Shortcut. The dashboard endpoint overlays real AH data into these keys when
    present; defaults here keep them safely null.
    """
    _empty_coach = {"color": "#111827", "border": "#d1d5db", "icon": "", "title": "", "msg": ""}
    return {
        "generated":         datetime.now(timezone.utc).isoformat(),
        "data_through":      None,
        "provider":          session.get("provider", "supabase"),
        "has_oura":          False,
        "has_apple_health":  False,
        "apple_health":      None,
        "today": {
            "date":               None,
            "calendar_today":     None,
            "readiness":          {},
            "sleep":              {},
            "activity":           {},
            "yesterday_activity": {},
            "activity_live":      None,
            "today_activity":     {},
            "sleep_model":        {},
        },
        "training_load": {
            "acwr": None, "acute_avg": None, "chronic_avg": None,
            "zone": "unknown", "label": "Not enough data", "color": "#6b7280",
            "acute_days": 7, "chronic_days": 28,
        },
        "readiness_forecast": {
            "score": 0, "label": "—", "color": "#6b7280",
            "hrv_adj": 0, "sleep_adj": 0, "base": 0,
        },
        "prediction_accuracy": None,
        "longevity_score":     {"score": None, "grade": None, "components": {}},
        "trend":    [],
        "coaches":  {"overall": _empty_coach, "sleep": _empty_coach, "activity": _empty_coach},
        "coaching": {"short": [], "mid": [], "long": [], "meta": {}},
    }


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
        # User is authenticated but hasn't connected Oura yet. Build the empty
        # payload baseline, then overlay Apple Health data if they're syncing it.
        # Without this, non-Oura users (e.g. email signups using Health Auto
        # Export) saw a totally blank dashboard even though their HealthKit
        # numbers were landing in the DB.
        payload = _empty_dashboard_payload(session)
        try:
            ah_sum = ah.get_summary(user_id, days=30)
        except Exception:
            ah_sum = {"has_data": False}
        if ah_sum.get("has_data"):
            payload["has_apple_health"] = True
            payload["data_through"]     = ah_sum.get("as_of")
            payload["apple_health"]     = {
                "as_of":   ah_sum.get("as_of"),
                "today":   ah_sum.get("today") or {},
                "averages": ah_sum.get("averages") or {},
                "days_synced": ah_sum.get("days_synced"),
            }
            # Last-sync time helps users trust the freshness of these numbers.
            try:
                db_sb = get_supabase()
                if db_sb:
                    last_res = (
                        db_sb.table("apple_health_daily")
                        .select("updated_at")
                        .eq("user_id", user_id)
                        .order("updated_at", desc=True)
                        .limit(1)
                        .execute()
                    )
                    if last_res.data:
                        payload["apple_health"]["last_sync_at"] = last_res.data[0].get("updated_at")
            except Exception:
                pass
        return payload

    access_token, refreshed_session = await _ensure_valid_token(session)
    if refreshed_session:
        session = refreshed_session

    # ── Load cache as a baseline, then refresh live if stale ──────────────────
    # We ALWAYS read the cache first so it can serve as a fallback. A live fetch
    # only *replaces* the cache when it returns real data — a transient empty or
    # sparse Oura response must never blank the dashboard or overwrite good
    # cached data. (That was the cause of "my Oura data vanished mid-day": a
    # stale cache + an empty live fetch wiped the rings and corrupted the cache,
    # while the morning's cached briefing kept showing the real numbers.)
    rm, slm, am, smm = {}, {}, {}, {}
    oura_vo2_max: float | None = None
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=days)
    except Exception:
        pass
    have_cache = bool(rm or slm or am or smm)

    fresh = False
    try:
        fresh = oc.is_fresh(user_id, max_age_hours=0.5)
    except Exception:
        pass
    # Only trust the cache if it's both fresh AND actually has data — a fresh but
    # empty cache row should still trigger a live fetch.
    cache_hit = fresh and have_cache

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
            live_rm, live_slm, live_am, live_smm = parse_oura_data(raw)
            # Only adopt live data when it actually came back with something;
            # otherwise keep whatever the cache gave us above.
            if live_rm or live_slm or live_am or live_smm:
                rm, slm, am, smm = live_rm, live_slm, live_am, live_smm
                oura_vo2_max = parse_oura_vo2_max(raw)
                # Only overwrite the cache with non-empty live data.
                try:
                    oc.store_days(user_id, rm, slm, am, smm)
                except Exception:
                    pass

            # Import Oura-logged workouts (runs, walks, cycling, etc.) and
            # sessions (sauna, meditation, breathing) as training_workouts rows.
            # Idempotent via the (user_id, source, external_id) unique index, so
            # re-running on every cache miss is harmless. Best-effort: a flaky
            # call here must never block the dashboard.
            try:
                _ow = await oura_fetch_workouts(access_token, days=30)
                _os = await oura_fetch_sessions(access_token, days=30)
                if _ow or _os:
                    trn.import_oura_events(user_id, _ow, _os)
            except Exception:
                pass
        except Exception as exc:
            exc_str = str(exc).lower()
            if "401" in exc_str or "403" in exc_str or "token" in exc_str or "expired" in exc_str:
                # Genuine auth failure with no cached data → prompt reconnect.
                # If we DO have cache, fall through and serve it rather than
                # blocking the whole dashboard on a transient auth blip.
                if not have_cache:
                    raise HTTPException(
                        status_code=401,
                        detail="Oura token expired — please reconnect your Oura Ring.",
                    )
            elif not (rm or slm or am or smm):
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
            # True 7-day average of the most recent nights that have sleep data.
            # (The previous expression accidentally returned a single night — the
            # earliest in the window — which is why the Longevity sleep average
            # read ~8.3h instead of the real ~6.8h.)
            "sleep_hours": (lambda vals: round(sum(vals) / len(vals), 1) if vals else None)(
                [smm[d]["total"] / 3600 for d in sorted(smm, reverse=True)[:7]
                 if smm.get(d, {}).get("total")]
            ),
            "steps": (lambda vals: round(sum(vals) / len(vals)) if vals else None)(
                [am[d]["steps"] for d in sorted(am, reverse=True)[:7] if am[d].get("steps")]
            ),
        }
        longevity_score = lon.compute(_lon_metrics, _profile)

        # Persist today's score for the trend line, and (once) backfill history
        # from the Oura cache so the user sees a real curve immediately.
        # Keyed on the Oura anchor date so the live point lines up with the
        # backfilled series. Best-effort — never breaks the dashboard.
        lonh.ensure_history(
            user_id, anchor, longevity_score, _profile,
            vo2_max=_vo2, body_fat=_ah_body_fat,
        )
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


# ── Longevity Score history ─────────────────────────────────────────────────

@app.get("/api/longevity/history")
def get_longevity_history(request: Request, days: int = 90):
    """Return the user's Longevity Score trend plus convenience deltas.

    Shape:
      {
        "history": [{date, score, grade, biological_age_delta}, ...],  # asc
        "summary": {current, delta_7d, delta_30d, count, first_date}
      }
    """
    session = _require_session(request)
    user_id = session["user_id"]

    try:
        history = lonh.get_history(user_id, days=days)
    except Exception:
        history = []

    summary = {
        "current":    None,
        "delta_7d":   None,
        "delta_30d":  None,
        "count":      len(history),
        "first_date": history[0]["date"] if history else None,
    }

    if history:
        current = history[-1]["score"]
        summary["current"] = current

        def _score_near(days_ago: int):
            """Score from the point closest to `days_ago` days before the latest."""
            target = datetime.strptime(history[-1]["date"], "%Y-%m-%d").date() - timedelta(days=days_ago)
            best = None
            best_gap = None
            for h in history[:-1]:
                d = datetime.strptime(h["date"], "%Y-%m-%d").date()
                gap = abs((d - target).days)
                # Only count points at/older than the target window so we compare
                # against the past, not a day just before today.
                if d <= target + timedelta(days=2) and (best_gap is None or gap < best_gap):
                    best, best_gap = h["score"], gap
            return best

        s7  = _score_near(7)
        s30 = _score_near(30)
        if s7 is not None:
            summary["delta_7d"] = current - s7
        if s30 is not None:
            summary["delta_30d"] = current - s30

    return {"history": history, "summary": summary}


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
            {"provider": "apple_health","name": "Apple Health",  "status": "available"},
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


def _valid_ymd(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


@app.get("/api/nutrition/today")
def get_today_nutrition(request: Request, date: Optional[str] = None):
    session  = _require_session(request)
    uid      = session["user_id"]
    # Prefer the caller's local date (the client knows the user's timezone).
    # Falling back to server time would use UTC and roll over too early/late,
    # which made evening meals reappear as "today" the next morning.
    today    = date if (date and _valid_ymd(date)) else datetime.now().strftime("%Y-%m-%d")
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


@app.post("/api/nutrition/meals/batch")
async def log_meals_batch(request: Request):
    """Log several food items at once (from AI parse, recents, etc.)."""
    session = _require_session(request)
    uid     = session["user_id"]
    body    = await request.json()
    today   = datetime.now().strftime("%Y-%m-%d")
    date_str = body.get("date", today)
    out = []
    for m in (body.get("meals") or []):
        name = (m.get("name") or "").strip()
        if not name:
            continue
        out.append(nutr.add_meal(
            date_str, name,
            m.get("calories") or 0, m.get("protein") or 0,
            m.get("carbs") or 0, m.get("fat") or 0,
            "meal", user_id=uid,
        ))
    return {"meals": out}


@app.get("/api/nutrition/recent")
def get_recent_foods(request: Request):
    """Distinct recently-logged foods for one-tap re-logging."""
    session = _require_session(request)
    return {"foods": nutr.recent_foods(session["user_id"])}


@app.post("/api/nutrition/parse-text")
async def parse_meal_text(request: Request):
    """Turn a free-text meal description into draft food items via Claude."""
    _require_session(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return {"items": nai.parse_text(text)}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not parse meal: {e}")


@app.post("/api/nutrition/parse-photo")
async def parse_meal_photo(request: Request):
    """Turn a meal photo into draft food items via Claude vision.
    Body: { image: <base64 string>, media_type: "image/jpeg" }."""
    _require_session(request)
    body = await request.json()
    image = body.get("image") or ""
    media_type = body.get("media_type") or "image/jpeg"
    if not image:
        raise HTTPException(status_code=400, detail="image is required")
    try:
        return {"items": nai.parse_photo(image, media_type)}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not read photo: {e}")


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
async def get_nutrition_summary(request: Request, date: Optional[str] = None):
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
    today_str = date if (date and _valid_ymd(date)) else None
    return nutr.weekly_summary(active_cals, uid, today_str=today_str)


# ── Training ──────────────────────────────────────────────────────────────────

@app.get("/api/training/exercises/search")
def search_exercises(request: Request, q: str = ""):
    _require_session(request)
    return {"results": trn.search_exercises(q)}


@app.get("/api/training/workouts")
def get_workouts(request: Request, days: int = 30):
    session = _require_session(request)
    return {"workouts": trn.get_workouts(session["user_id"], days)}


@app.post("/api/training/workouts")
async def log_workout(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    today = datetime.now().strftime("%Y-%m-%d")
    entry = trn.add_workout(
        user_id      = user_id,
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
    session = _require_session(request)
    ok = trn.delete_workout(session["user_id"], workout_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workout not found")
    return {"status": "deleted"}


@app.get("/api/training/templates")
def list_training_templates(request: Request):
    session = _require_session(request)
    return {"templates": trn.get_templates(session["user_id"])}


@app.post("/api/training/parse-workout")
async def parse_workout(request: Request):
    """Turn a free-text workout description into structured exercises via Claude."""
    _require_session(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return tai.parse_workout(text)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not parse workout: {e}")


@app.post("/api/training/templates")
async def save_training_template(request: Request):
    session = _require_session(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return trn.add_template(
        session["user_id"],
        name,
        body.get("type", "lifting"),
        body.get("exercises", []),
    )


@app.delete("/api/training/templates/{template_id}")
def remove_training_template(template_id: str, request: Request):
    session = _require_session(request)
    ok = trn.delete_template(session["user_id"], template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Routine not found")
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
    recent = trn.get_workouts(session["user_id"], days=7)
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
    session = _require_session(request)
    settings = trn.get_settings(session["user_id"])
    return trn.generate_weekly_plan(settings)


@app.get("/api/training/settings")
def get_training_settings(request: Request):
    session = _require_session(request)
    return trn.get_settings(session["user_id"])


@app.post("/api/training/settings")
async def update_training_settings(request: Request):
    session = _require_session(request)
    body = await request.json()
    return trn.save_settings(session["user_id"], body)


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
    # Flag which ones the user has archived (ended competitions tucked away).
    archived = set(_get_profile(user_id).get("archived_challenges") or [])
    for c in challenges:
        c["archived"] = c.get("id") in archived
    return {"challenges": challenges, "user_id": user_id}


@app.post("/api/challenges/{challenge_id}/archive")
async def archive_challenge(challenge_id: str, request: Request):
    """Archive (or restore) a competition from the user's Compete list."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    archived = bool(body.get("archived", True))
    cid = challenge_id.upper()
    db = get_supabase()
    if not db:
        return {"ok": False, "archived_challenges": []}
    arr = list(_get_profile(user_id).get("archived_challenges") or [])
    if archived and cid not in arr:
        arr.append(cid)
    elif not archived:
        arr = [x for x in arr if x != cid]
    try:
        db.table("user_profiles").upsert(
            {"user_id": user_id, "archived_challenges": arr},
            on_conflict="user_id",
        ).execute()
        return {"ok": True, "archived_challenges": arr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

    # Onboarding status — null onboarded_at means the user hasn't been
    # through the first-time flow yet.
    profile = _get_profile(user_id)
    needs_onboarding = not bool(profile.get("onboarded_at"))

    return {
        "user_id":          user_id,
        "email":            session.get("email"),
        "provider":         session.get("provider", "oura"),
        "has_oura":         has_oura,
        "needs_onboarding": needs_onboarding,
    }


@app.post("/api/me/complete-onboarding")
def complete_onboarding(request: Request):
    """Mark the user's onboarding as complete (sets onboarded_at = now)."""
    session = _require_session(request)
    user_id = session["user_id"]
    db = get_supabase()
    if not db:
        return {"ok": False}
    try:
        db.table("user_profiles").upsert(
            {
                "user_id":      user_id,
                "onboarded_at": datetime.now(tz=timezone.utc).isoformat(),
            },
            on_conflict="user_id",
        ).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Gear (Picked For You dismissals) ──────────────────────────────────────────

@app.get("/api/gear/dismissed")
def get_dismissed_gear(request: Request):
    """Return gear item IDs the user has removed from their Scorecard picks."""
    session = _require_session(request)
    profile = _get_profile(session["user_id"])
    return {"dismissed": profile.get("dismissed_gear") or []}


@app.post("/api/gear/dismiss")
async def dismiss_gear(request: Request):
    """Hide a gear item from the user's Scorecard picks (it stays in the shop)."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    db = get_supabase()
    if not db:
        return {"ok": False, "dismissed": []}
    profile = _get_profile(user_id)
    dismissed = profile.get("dismissed_gear") or []
    if item_id not in dismissed:
        dismissed.append(item_id)
    try:
        db.table("user_profiles").upsert(
            {"user_id": user_id, "dismissed_gear": dismissed},
            on_conflict="user_id",
        ).execute()
        return {"ok": True, "dismissed": dismissed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Gear reviews (communal) ───────────────────────────────────────────────────

@app.get("/api/gear/reviews/summary")
def gear_reviews_summary(request: Request):
    """Aggregate {item_id: {avg, count}} for all gear items — powers the shop grid."""
    _require_session(request)
    try:
        return {"summary": gr.summary()}
    except Exception:
        return {"summary": {}}


@app.get("/api/gear/{item_id}/reviews")
def list_gear_reviews(item_id: str, request: Request):
    session = _require_session(request)
    try:
        return {"reviews": gr.list_reviews(item_id, session["user_id"])}
    except Exception:
        return {"reviews": []}


@app.post("/api/gear/{item_id}/reviews")
async def post_gear_review(item_id: str, request: Request):
    session = _require_session(request)
    body = await request.json()
    try:
        return gr.upsert_review(session["user_id"], item_id, body.get("rating"), body.get("text") or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/gear/{item_id}/reviews")
def delete_gear_review(item_id: str, request: Request):
    session = _require_session(request)
    gr.delete_review(session["user_id"], item_id)
    return {"status": "deleted"}


@app.post("/api/gear/ask")
async def ask_gear_finder(request: Request):
    """Coach Al gear finder — recommend catalog items for the user's goal and,
    when the catalog falls short, give honest 'what to look for' guidance.
    The frontend sends the catalog so there's a single source of truth."""
    session = _require_session(request)
    body = await request.json()
    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    catalog = body.get("catalog") or []
    if not isinstance(catalog, list):
        catalog = []
    context = (body.get("context") or "").strip()[:500]
    try:
        result = gai.find_gear(query, catalog, context)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not run gear finder: {e}")

    # Log the search as a demand signal (best-effort — never breaks the finder).
    gd.log_search(
        session["user_id"],
        query,
        had_match=bool(result.get("picks")),
        pick_ids=[p.get("id") for p in result.get("picks", [])],
        suggestion_titles=[s.get("title") for s in result.get("suggestions", [])],
    )
    return result


@app.get("/api/gear/demand")
def gear_demand(request: Request):
    """Owner-only: aggregated 'what people are searching for' to guide catalog
    expansion. Gated to admin users (see _is_admin)."""
    session = _require_session(request)
    if not _is_admin(session):
        raise HTTPException(status_code=403, detail="Not authorized")
    return gd.top_demand()


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


def _insight_stat(d: dict) -> dict:
    """Compact evidence chip for the Weekly Insight card from a raw insight dict."""
    return {
        "title":         d.get("title"),
        "magnitude":     d.get("magnitude"),
        "unit":          d.get("unit"),
        "direction":     d.get("direction"),
        "n":             d.get("n"),
        "r":             d.get("r"),
        "group_a_label": d.get("group_a_label"),
        "group_a_avg":   d.get("group_a_avg"),
        "group_b_label": d.get("group_b_label"),
        "group_b_avg":   d.get("group_b_avg"),
    }


@app.get("/api/insight/weekly")
def get_weekly_insight(request: Request, refresh: bool = False):
    """Coach Al's Weekly Insight — the strongest data pattern this week + an experiment.

    Cache strategy: one row per (user_id, week_start) in public.weekly_insights,
    where week_start is the Monday (ET) of the current week. First call of the
    week runs the correlation engine, picks the strongest pattern, and generates
    a narrative via Claude Haiku; later calls return the cached row. ?refresh=1
    forces a regenerate (costs one Anthropic call).
    """
    import concurrent.futures

    session = _require_session(request)
    user_id = session["user_id"]

    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_et   = datetime.now(tz=ZoneInfo("America/New_York")).date()
    week_start = (today_et - timedelta(days=today_et.weekday())).isoformat()  # Monday

    db = get_supabase()

    # Cache hit?
    if db and not refresh:
        try:
            cached = (
                db.table("weekly_insights")
                .select("headline, narrative, experiment, insight_id, source, generated_at")
                .eq("user_id", user_id)
                .eq("week_start", week_start)
                .execute()
            )
            if cached.data:
                row = cached.data[0]
                return {
                    "week_start":   week_start,
                    "headline":     row["headline"],
                    "narrative":    row["narrative"],
                    "experiment":   row.get("experiment") or "",
                    "insight_id":   row.get("insight_id"),
                    "stat":         _insight_stat(row.get("source") or {}),
                    "generated_at": row.get("generated_at"),
                    "cached":       True,
                    "has_data":     True,
                }
        except Exception:
            pass  # fall through to regenerate

    # Find the strongest pattern (engine already ranks by effect size).
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(ins.get_insights, user_id, 60)
            try:
                candidates = future.result(timeout=8)
            except concurrent.futures.TimeoutError:
                candidates = []
    except Exception:
        candidates = []

    if not candidates:
        # No-data / not-enough-data: friendly placeholder, no Claude call.
        return {
            "week_start": week_start,
            "headline":   "Your first weekly insight is on the way",
            "narrative":  (
                "Once you've logged a few weeks across sleep, activity, and nutrition, "
                "I'll surface the single strongest pattern in your data each week — "
                "and an experiment to test it. Keep logging and check back."
            ),
            "experiment": "",
            "insight_id": None,
            "stat":       None,
            "generated_at": None,
            "cached":     False,
            "has_data":   False,
        }

    strongest = candidates[0]
    profile = _get_profile(user_id)

    try:
        gen = wins.generate(strongest, profile)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"weekly insight generation failed: {e}")

    # Save to cache (best-effort).
    if db:
        try:
            db.table("weekly_insights").upsert(
                {
                    "user_id":    user_id,
                    "week_start": week_start,
                    "insight_id": strongest.get("id"),
                    "headline":   gen["headline"],
                    "narrative":  gen["narrative"],
                    "experiment": gen.get("experiment") or "",
                    "source":     strongest,
                },
                on_conflict="user_id,week_start",
            ).execute()
        except Exception:
            pass

    return {
        "week_start":   week_start,
        "headline":     gen["headline"],
        "narrative":    gen["narrative"],
        "experiment":   gen.get("experiment") or "",
        "insight_id":   strongest.get("id"),
        "stat":         _insight_stat(strongest),
        "generated_at": None,
        "cached":       False,
        "has_data":     True,
    }


# ── Profile ───────────────────────────────────────────────────────────────────

@app.get("/api/profile")
def get_profile(request: Request):
    session = _require_session(request)
    return _get_profile(session["user_id"])


def _sanitize_supplements(raw) -> list[dict]:
    """Normalize the supplements payload into a clean list of {name,dose,timing,notes}.

    Drops entries without a name, trims fields, caps the list at 30 items so a
    bad client can't dump a megabyte of JSON into a profile row.
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw[:30]:
        if not isinstance(item, dict):
            continue
        name = (str(item.get("name") or "")).strip()[:80]
        if not name:
            continue
        out.append({
            "name":   name,
            "dose":   (str(item.get("dose")   or "")).strip()[:40],
            "timing": (str(item.get("timing") or "")).strip()[:40],
            "notes":  (str(item.get("notes")  or "")).strip()[:200],
        })
    return out


@app.post("/api/profile")
async def save_profile(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    allowed = {"name", "age", "biological_sex", "height_cm", "health_goals", "vo2_max", "birthdate", "supplements"}
    data = {k: v for k, v in body.items() if k in allowed}
    # Empty birthdate string clears it (Postgres date column rejects "").
    if "birthdate" in data and not data["birthdate"]:
        data["birthdate"] = None
    # Sanitize supplements server-side so the DB only ever holds clean shapes.
    if "supplements" in data:
        data["supplements"] = _sanitize_supplements(data["supplements"])
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


# ── Daily check-in (mood / energy) endpoints ──────────────────────────────────
# Helpers (_get_checkin, ALLOWED_MOODS) are defined near the top of the file
# above _resolve_oura_anchor; only the route registrations live here so the
# `app` instance is in scope by the time the decorators execute.

@app.get("/api/checkin/today")
def get_checkin_today(request: Request, date: Optional[str] = None):
    """Return today's mood if logged, plus yesterday's for context display.

    `date` is the client's LOCAL date (YYYY-MM-DD); we honor it so the mood
    persists for the user's whole day instead of rolling at server-ET midnight.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    if date and _valid_ymd(date):
        today = datetime.strptime(date, "%Y-%m-%d").date()
    else:
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
    date_in = (body.get("date") or "").strip()
    if date_in and _valid_ymd(date_in):
        today_str = date_in
    else:
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

    # Device-local "today" (sent by the client) so today's macros anchor to the
    # user's date, not the server's UTC date. Falls back to ET if absent.
    today_local = body.get("date") or _et_today()

    # Make chat aware of the user's active goal so "how am I doing?" lands in
    # context. Best-effort — never block a chat reply on it.
    try:
        health_context["active_goal"] = gl.get_active_goal(user_id, today_local)
    except Exception:
        health_context["active_goal"] = None

    # Nutrition (today's macros vs targets) + body composition (logged weigh-ins)
    # so Coach Al can answer "how are my macros?" / "how's my weight trending?".
    # Best-effort. We also prefer the user's LOGGED body-fat over Apple Health's,
    # since the manual InBody reading is what they entered and trust.
    try:
        _snap = nutr.coach_snapshot(user_id, today_local)
        health_context["nutrition"] = _snap.get("nutrition")
        health_context["body"] = _snap.get("body")
        _bf = (_snap.get("body") or {}).get("body_fat_pct")
        if _bf is not None:
            health_context["today"]["body_fat_percentage"] = _bf
    except Exception:
        health_context["nutrition"] = None
        health_context["body"] = None

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
async def get_morning_briefing(request: Request, refresh: bool = False, date: Optional[str] = None, allow_no_sleep: bool = False):
    """Return today's Coach Al morning briefing for the current user.

    Cache strategy: one row per (user_id, date) in public.daily_briefings.
    First call of the day generates the narrative via Claude Haiku and saves it;
    subsequent calls return the cached row. Pass ?refresh=1 to force a regenerate
    (rate-limit responsibly client-side; this costs an Anthropic call).
    """
    session = _require_session(request)
    user_id = session["user_id"]

    # "Today" follows the user's device (the client passes its LOCAL date), so the
    # cache key and the app-streak count match the day the user is actually living
    # — not the server's ET/UTC clock. Falls back to ET when no date is supplied.
    if date and _valid_ymd(date):
        today_str = date
    else:
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
                    "has_data":            True,
                    "sleep_status":        "ok",
                }
        except Exception:
            pass  # fall through to regenerate

    # Build health context — same shape as /api/chat
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=30)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    # Last night's sleep is keyed to the wake date = the user's LOCAL today. If
    # it's not in our cache yet, try a live pull — Oura may have just finished
    # processing — so we don't fall back to an older night.
    if not (smm.get(today_str, {}) or {}).get("total"):
        try:
            access_token, _ = await _ensure_valid_token(session)
            raw = await fetch_all(access_token, days=14)
            l_rm, l_slm, l_am, l_smm = parse_oura_data(raw)
            if l_rm or l_slm or l_am or l_smm:
                rm, slm, am, smm = l_rm, l_slm, l_am, l_smm
                try:
                    oc.store_days(user_id, rm, slm, am, smm)
                except Exception:
                    pass
        except Exception:
            pass

    # Anchor STRICTLY to last night (wake date = local today). We never substitute
    # an older night as "today" — that mislabels stale data and is exactly what
    # made the briefing quote 5.3h when last night was 6h44m. Apple Health fills
    # in the sleep model when Oura hasn't synced but AH has.
    t_rdy = rm.get(today_str, {}) or {}
    t_sl  = slm.get(today_str, {}) or {}
    t_act = am.get(today_str, {}) or {}
    t_sm  = smm.get(today_str, {}) or {}
    if not t_sm.get("total"):
        try:
            ah_day = ah.get_day(user_id, today_str)
            if ah_day and (ah_day.get("sleep_hours") or ah_day.get("hrv")):
                sh  = ah_day.get("sleep_hours") or 0
                sdh = ah_day.get("sleep_deep_hours") or 0
                srh = ah_day.get("sleep_rem_hours") or 0
                t_sm = {
                    "total":   int(sh  * 3600) if sh  else None,
                    "deep":    int(sdh * 3600) if sdh else None,
                    "rem":     int(srh * 3600) if srh else None,
                    "hrv":     ah_day.get("hrv"),
                    "rhr":     ah_day.get("resting_hr"),
                    "_source": "apple_health",
                }
        except Exception:
            pass

    # Activity for the BRIEFING narrative is YESTERDAY's completed day, not
    # today's intra-day total. Oura's sleep score and readiness are last-night
    # keyed (complete by morning), but activity is calendar-day keyed and just
    # starts accumulating — first thing in the morning today's activity_score
    # is near-zero, which felt 'off' next to the synced sleep/readiness numbers.
    # Yesterday is the right "what your body did" frame for a morning recap.
    try:
        _yest = (datetime.strptime(today_str, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
    except Exception:
        _yest = today_str
    y_act = am.get(_yest, {}) or {}
    # Apple Health fallback for yesterday's activity — so AH-only users (no Oura)
    # still get their step count in the morning briefing instead of a silent
    # blank. Oura provides an activity score; AH provides only raw quantities,
    # so activity_score stays None and the prompt naturally omits it.
    if not y_act.get("steps"):
        try:
            ah_y = ah.get_day(user_id, _yest)
            if ah_y and ah_y.get("steps"):
                y_act = {
                    **y_act,
                    "steps": ah_y.get("steps"),
                    "active_cal": ah_y.get("active_calories"),
                }
        except Exception:
            pass

    # Only hold for "syncing" when TODAY has essentially no signal yet. Readiness
    # and the sleep SCORE usually land before the detailed sleep session (duration
    # /HRV), so if we have any of today's numbers we write a real briefing now and
    # simply omit whatever hasn't synced — far better than a barren "syncing" wall.
    # We still never quote an OLDER night, because everything here is anchored to
    # today_str. "Syncing" is reserved for the genuine "nothing for today" case
    # (e.g. opened minutes after waking before Oura processed anything) for a user
    # who normally syncs. `allow_no_sleep` is the manual override.
    today_has_signal = bool(
        t_rdy.get("score") or t_sl.get("score") or t_act.get("score") or t_sm.get("total")
    )
    _recent_keys = sorted(set(list(rm.keys()) + list(smm.keys())), reverse=True)[:4]
    recent_signal = any((rm.get(d, {}).get("score") or smm.get(d, {}).get("total")) for d in _recent_keys)
    if recent_signal and not today_has_signal and not allow_no_sleep:
        return {
            "date":                today_str,
            "narrative":           "",
            "sleep_status":        "pending",
            "prediction_streak":   None,
            "prediction_accuracy": None,
            "generated_at":        None,
            "cached":              False,
            "app_streak":          _compute_app_streak(user_id, today_str),
            "has_data":            True,
        }

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
            # Activity = YESTERDAY's complete day (see note above where y_act is set).
            "activity_score":      y_act.get("score"),
            "steps":               y_act.get("steps"),
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

    # No-data short-circuit: if there's nothing meaningful in today's metrics
    # OR the 7-day context, skip the Claude call and return a friendly static
    # welcome. Avoids an awkward AI "I have no data" note and saves the API
    # call for brand-new / manual-only users.
    _today_metrics = health_context.get("today") or {}
    _seven = health_context.get("seven_day") or {}
    _has_any_data = any(v is not None for v in _today_metrics.values()) or \
                    any(v is not None for v in (_seven.get("hrv_avg"), _seven.get("sleep_avg"), _seven.get("readiness_avg")))
    if not _has_any_data:
        welcome = (
            "Welcome to BackNine! Once you connect a tracker or log your first "
            "workout or weigh-in, I'll open every day with a briefing tailored to "
            "your numbers right here.\n\n"
            "In the meantime — tap below to chat with me about your goals, or head "
            "to the Metrics tab to set up Apple Health."
        )
        return {
            "date":                today_str,
            "narrative":           welcome,
            "prediction_streak":   None,
            "prediction_accuracy": None,
            "generated_at":        None,
            "cached":              False,
            "app_streak":          _compute_app_streak(user_id, today_str),
            "has_data":            False,
            "sleep_status":        "ok",
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

    # Active goal pace — lets Coach Al nudge toward the user's committed goal
    # ("ahead of pace", "a little behind") right in the morning note. Best-effort;
    # uses the device-local date so week/days-left line up with the goal card.
    try:
        _ag = gl.get_active_goal(user_id, today_str)
        health_context["active_goal"] = _ag if (_ag and _ag.get("pace")) else None
    except Exception:
        health_context["active_goal"] = None

    # Nutrition recap + body composition for the briefing, mirroring chat. We pull
    # YESTERDAY's macros (the just-completed day — today's log is empty in the
    # morning) plus the latest logged weigh-in/trend. Best-effort; also prefer the
    # user's logged body-fat over Apple Health for consistency.
    try:
        _yest = (datetime.strptime(today_str, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
        _nsnap = nutr.coach_snapshot(user_id, _yest)
        health_context["nutrition"] = _nsnap.get("nutrition")
        health_context["body"] = _nsnap.get("body")
        _bf = (_nsnap.get("body") or {}).get("body_fat_pct")
        if _bf is not None and health_context.get("today"):
            health_context["today"]["body_fat_percentage"] = _bf
    except Exception:
        health_context["nutrition"] = None
        health_context["body"] = None

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

    # Save to cache (best-effort — never crash the dashboard over a write).
    # Cache once today has real signal (or for no-wearable users). A briefing
    # forced out with allow_no_sleep while today is still empty is NOT cached, so
    # the next open regenerates the real one once data lands. (Coach Al can be
    # re-run any time via Regenerate to fold in sleep detail that synced later.)
    if db and (today_has_signal or not recent_signal):
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
        # Stamp the live-generated briefing so the UI can show "from 7:14am" —
        # was None before, which left the user guessing how stale the numbers were.
        "generated_at":        datetime.now(timezone.utc).isoformat(),
        "cached":              False,
        "app_streak":          _compute_app_streak(user_id, today_str),
        "has_data":            True,
        "sleep_status":        "ok",
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
    """Accept a friend code by pasting it. Body: { code }.

    Handles BOTH code types — a one-time invite code or a reusable referral
    (share-card) code — so any code we hand out works here, any time."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    try:
        return frd.accept_any_code(code, user_id, _display_name_for(user_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not accept code: {e}")


@app.get("/api/friends/referral")
def get_friend_referral(request: Request):
    """Return the current user's stable, reusable referral code for share cards."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return frd.get_or_create_referral(user_id, _display_name_for(user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not create referral: {e}")


@app.post("/api/friends/referral/accept")
async def accept_friend_referral(request: Request):
    """Auto-connect via a reusable referral code from a shared card. Body: { code }."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    try:
        result = frd.accept_referral(code, user_id, _display_name_for(user_id))
        return {"ok": True, **(result if isinstance(result, dict) else {})}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not accept referral: {e}")


# ── Weekly Leagues ────────────────────────────────────────────────────────────

@app.get("/api/leagues/current")
def get_current_league(request: Request):
    """Join (or fetch) this week's league for the current user and return live
    standings ranked by weekly step count. Soft-fails to an empty payload so a
    league hiccup never breaks the Scorecard."""
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_et = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()
    try:
        return lg.get_current_league(user_id, today_et)
    except Exception:
        return {"league": None, "standings": [], "me_rank": None, "days_left": None, "member_count": 0}


# ── Groups (Crews) ────────────────────────────────────────────────────────────

@app.get("/api/groups")
def list_user_groups(request: Request):
    session = _require_session(request)
    try:
        return {"groups": grp.list_groups(session["user_id"])}
    except Exception:
        return {"groups": []}


@app.post("/api/groups")
async def create_user_group(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    try:
        return grp.create_group(user_id, name, _display_name_for(user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not create group: {e}")


@app.post("/api/groups/join")
async def join_user_group(request: Request):
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    try:
        return grp.join_group(code, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not join group: {e}")


@app.post("/api/groups/{group_id}/leave")
def leave_user_group(group_id: str, request: Request):
    session = _require_session(request)
    grp.leave_group(session["user_id"], group_id)
    return {"status": "left"}


@app.get("/api/groups/{group_id}/messages")
def get_group_messages(group_id: str, request: Request):
    session = _require_session(request)
    try:
        return {"messages": grp.list_messages(session["user_id"], group_id)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/messages")
async def post_group_message(group_id: str, request: Request):
    session = _require_session(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return grp.post_message(session["user_id"], group_id, text)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/groups/{group_id}/standings")
def get_group_standings(group_id: str, request: Request):
    session = _require_session(request)
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_et = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()
    try:
        return grp.get_standings(session["user_id"], group_id, today_et)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/goal")
async def set_group_goal(group_id: str, request: Request):
    session = _require_session(request)
    body = await request.json()
    try:
        return grp.set_goal(session["user_id"], group_id, body.get("goal"))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Goals (Coach Al program) ──────────────────────────────────────────────────

def _et_today() -> str:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    return datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()


@app.get("/api/goals/active")
def get_active_goal(request: Request):
    session = _require_session(request)
    try:
        return {"goal": gl.get_active_goal(session["user_id"], _et_today())}
    except Exception:
        return {"goal": None}


@app.get("/api/goals/metrics")
def get_goal_metrics(request: Request):
    session = _require_session(request)
    try:
        return {"metrics": gl.metrics_snapshot(session["user_id"])}
    except Exception:
        return {"metrics": []}


@app.post("/api/goals")
async def create_goal(request: Request):
    session = _require_session(request)
    body = await request.json()
    metric = (body.get("metric") or "").strip()
    target = body.get("target")
    duration_weeks = body.get("duration_weeks") or 6
    if not metric or target is None:
        raise HTTPException(status_code=400, detail="metric and target are required")
    try:
        return gl.create_goal(session["user_id"], metric, float(target), int(duration_weeks), _et_today())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"could not create goal: {e}")


@app.post("/api/goals/{goal_id}/complete")
def complete_goal(goal_id: str, request: Request):
    session = _require_session(request)
    gl.set_status(session["user_id"], goal_id, "completed")
    return {"status": "completed"}


@app.delete("/api/goals/{goal_id}")
def abandon_goal(goal_id: str, request: Request):
    session = _require_session(request)
    gl.set_status(session["user_id"], goal_id, "abandoned")
    return {"status": "abandoned"}


# ── Achievements / badges ─────────────────────────────────────────────────────

@app.get("/api/achievements")
def get_achievements(request: Request):
    session = _require_session(request)
    try:
        return ach.evaluate(session["user_id"], _display_name_for(session["user_id"]))
    except Exception:
        return {"badges": [], "earned_count": 0, "total": 0, "newly_unlocked": []}


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


@app.get("/api/friends/leaderboard")
def friend_leaderboard(request: Request, metric: Optional[str] = None):
    """Daily multi-metric leaderboard: self + each friend with all three
    metric values (steps, sleep score, activity score) plus per-metric leader
    flags. The `metric` query param is accepted for backwards compatibility
    but the response now contains every metric so the UI can render all three
    in one card without re-querying.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    # `metric` is kept for backward compat / future per-metric sort needs,
    # but the response always includes all three metric values per entry.
    _ = (metric or "").lower()

    def _value_for(uid: str, metric: str) -> tuple[Optional[float], str]:
        """Resolve the metric value for a user. Returns (value, anchor_date).

        Robust to today's data not being in the cache yet. For each metric we
        try today's anchor first, then walk backwards through the last 7 days
        looking for a real value. This is what keeps the leaderboard from
        going dark first thing in the morning before Oura/AH have synced.

        Steps prefer Apple Health (live throughout the day); sleep and
        activity scores come from Oura since AH doesn't compute those.
        """
        try:
            rm, slm, am, smm = oc.get_days(uid, days=8)
        except Exception:
            return None, ""
        anchor, t_rdy, t_sl, t_act, t_sm = _resolve_oura_anchor(uid, rm, slm, am, smm)

        def _walk_back(days_to_check: int = 7):
            """Yield (date_str) from anchor walking backwards."""
            try:
                cursor = datetime.strptime(anchor, "%Y-%m-%d").date()
            except Exception:
                return
            for i in range(days_to_check):
                yield (cursor - timedelta(days=i)).isoformat()

        if metric == "steps":
            # Walk-back logic: for TODAY (idx 0), trust what the sources have
            # even if it's 0 — otherwise mid-day, when today is still partial,
            # we silently fell through to yesterday's bigger number and the user
            # was looking at yesterday without knowing it. For PRIOR days, keep
            # the original "only non-zero" rule so we don't surface a stale 0.
            days = list(_walk_back())
            for idx, d in enumerate(days):
                ah_steps = None
                try:
                    ah_day = ah.get_day(uid, d)
                    if ah_day is not None and "steps" in ah_day:
                        ah_steps = ah_day.get("steps")
                except Exception:
                    pass
                am_day = am.get(d) or {}
                oura_steps = am_day.get("steps")
                if idx == 0:
                    # Today: take whatever is recorded, even 0.
                    if ah_steps is not None:
                        return float(ah_steps), d
                    if oura_steps is not None:
                        return float(oura_steps), d
                    continue  # genuinely no record for today → fall back to walking
                # Prior days: only count if non-zero (existing behavior).
                if ah_steps:
                    return float(ah_steps), d
                if oura_steps:
                    return float(oura_steps), d
            return None, anchor

        if metric == "sleep":
            for d in _walk_back():
                sl_day = slm.get(d) or {}
                score = sl_day.get("score")
                # score=0 means ring not worn — skip
                if score and score > 0:
                    return float(score), d
            return None, anchor

        if metric == "activity":
            for d in _walk_back():
                a_day = am.get(d) or {}
                score = a_day.get("score")
                if score and score > 0:
                    return float(score), d
            return None, anchor

        return None, anchor

    # Pull today's taunt set up-front so the UI knows which preset (if any)
    # the user already sent to each friend today.
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_str = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()
    taunts_today = frd.taunts_sent_today(user_id, today_str)  # {target_user_id: kind}

    def _per_day_values(uid: str, days: int = 7) -> dict[str, dict]:
        """Return {date_str: {steps, sleep, activity}} for the last N days.
        Used for the head-to-head tally — single fetch per user, then iterate.
        """
        try:
            rm, slm, am, smm = oc.get_days(uid, days=days + 2)
        except Exception:
            return {}
        try:
            from zoneinfo import ZoneInfo
        except ImportError:
            from backports.zoneinfo import ZoneInfo  # type: ignore
        today = datetime.now(tz=ZoneInfo("America/New_York")).date()
        out: dict[str, dict] = {}
        for i in range(days):
            d = (today - timedelta(days=i)).isoformat()
            # AH-first for steps
            steps = None
            try:
                ah_day = ah.get_day(uid, d)
                if ah_day and ah_day.get("steps"):
                    steps = float(ah_day["steps"])
            except Exception:
                pass
            if steps is None:
                am_day = am.get(d) or {}
                if am_day.get("steps"):
                    steps = float(am_day["steps"])
            sleep_score = (slm.get(d) or {}).get("score")
            act_score   = (am.get(d)  or {}).get("score")
            out[d] = {
                "steps":    steps,
                "sleep":    float(sleep_score) if sleep_score and sleep_score > 0 else None,
                "activity": float(act_score)   if act_score and act_score > 0   else None,
            }
        return out

    def _head_to_head(me_days: dict[str, dict], friend_days: dict[str, dict]) -> dict:
        """Tally weekly W/L/T for each metric — me vs friend.
        Only counts days where BOTH have data. A 'tie' is identical values.
        """
        result = {"steps": {"w": 0, "l": 0, "t": 0},
                  "sleep": {"w": 0, "l": 0, "t": 0},
                  "activity": {"w": 0, "l": 0, "t": 0}}
        for d, my in me_days.items():
            theirs = friend_days.get(d)
            if not theirs:
                continue
            for m in ("steps", "sleep", "activity"):
                mv = my.get(m)
                tv = theirs.get(m)
                if mv is None or tv is None:
                    continue
                if mv > tv:   result[m]["w"] += 1
                elif mv < tv: result[m]["l"] += 1
                else:         result[m]["t"] += 1
        return result

    # Cache the current user's 7-day data once — each friend pairing uses it.
    me_days_cache = _per_day_values(user_id)

    def _entry_for(uid: str, name: str, is_me: bool) -> dict:
        steps_v, steps_a    = _value_for(uid, "steps")
        sleep_v, sleep_a    = _value_for(uid, "sleep")
        act_v,   act_a      = _value_for(uid, "activity")
        h2h = None
        if not is_me:
            try:
                friend_days = _per_day_values(uid)
                h2h = _head_to_head(me_days_cache, friend_days)
            except Exception:
                h2h = None
        return {
            "user_id":  uid,
            "name":     name,
            "is_me":    is_me,
            # Per-metric value + anchor
            "steps":    {"value": steps_v, "anchor": steps_a},
            "sleep":    {"value": sleep_v, "anchor": sleep_a},
            "activity": {"value": act_v,   "anchor": act_a},
            # Weekly engagement points — the inclusive metric everyone earns
            # (check-in, workouts, meals, weigh-ins + step bonus). Non-wearable
            # users still rank here instead of showing all-zero.
            "points":   int(points_map.get(uid, 0)),
            # Achievement level for the status chip (None until they've earned XP).
            "level":    (levels_map.get(uid) or {}).get("level"),
            # If you've taunted this friend today, surface which kind (else None).
            "taunt_sent":   None if is_me else taunts_today.get(uid),
            # 7-day head-to-head tally vs the current user (null for self).
            "head_to_head": h2h,
        }

    try:
        friends = frd.list_friends(user_id)
    except Exception:
        friends = []

    # Weekly engagement points for everyone in one batched pass (works for
    # non-wearable users too). _entry_for reads points_map from this scope.
    all_uids = [user_id] + [f["user_id"] for f in friends]
    try:
        points_map = lg.weekly_points(all_uids, today_str)
    except Exception:
        points_map = {}
    # Achievement level per member — shown as a status chip on each row.
    try:
        levels_map = ach.levels_for(all_uids)
    except Exception:
        levels_map = {}

    entries: list[dict] = [_entry_for(user_id, _display_name_for(user_id), True)]
    for f in friends:
        entries.append(_entry_for(f["user_id"], f.get("name") or "Friend", False))

    # Per-metric leader: id of the entry with the highest non-null value.
    def _leader_id(metric_key: str) -> Optional[str]:
        scored = [e for e in entries if (e[metric_key].get("value") or 0) > 0]
        if not scored:
            return None
        winner = max(scored, key=lambda e: e[metric_key]["value"])
        return winner["user_id"]

    leaders = {
        "steps":    _leader_id("steps"),
        "sleep":    _leader_id("sleep"),
        "activity": _leader_id("activity"),
    }

    # Default sort: weekly engagement points desc (the inclusive ranking),
    # then steps as a tiebreaker. Frontend can re-sort.
    entries.sort(key=lambda e: (
        -(e.get("points") or 0),
        -(e["steps"].get("value") or 0),
    ))

    return {
        "entries": entries,
        "leaders": leaders,
        "date":    today_str,
    }


@app.post("/api/friends/cheer/{friend_user_id}")
async def cheer_friend(friend_user_id: str, request: Request):
    """Send a taunt to a friend. Body: { kind?: "cheer"|"catch_me"|"race_me"|"slow_today" }.
    Defaults to cheer for backwards compatibility. Dedup is one taunt per
    (you, target, today) total — pick one kind per day per friend.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    if user_id == friend_user_id:
        raise HTTPException(status_code=400, detail="cannot taunt yourself")

    # Parse optional body for the kind. Tolerate empty bodies (old clients).
    try:
        body = await request.json()
    except Exception:
        body = {}
    kind = (body.get("kind") or "cheer").lower()

    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    today_str = datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()

    # Resolve names for nicer event payloads.
    me_name = _display_name_for(user_id)
    try:
        friends = frd.list_friends(user_id)
    except Exception:
        friends = []
    target_name = "Friend"
    for f in friends:
        if f["user_id"] == friend_user_id:
            target_name = f.get("name") or "Friend"
            break

    row = frd.send_taunt(user_id, friend_user_id, me_name, target_name, today_str, kind=kind)
    return {"ok": bool(row), "cheered_user_id": friend_user_id, "kind": kind, "event": row}


# ── Notification inbox ───────────────────────────────────────────────────────
# Aggregates "things that happened involving you" from four sources:
#   1. DMs received (dm_messages where recipient_id = me)
#   2. Taunts received (activity_events with payload.target_user_id = me)
#   3. Comments on your events (event_comments on activity_events you authored)
#   4. Reactions on your events (event_reactions on your activity_events)
#
# Unread state is derived from user_profiles.notifications_last_read_at —
# anything created after that timestamp counts as unread. POST to mark-read
# sets the timestamp to now.

@app.get("/api/notifications")
def list_notifications(request: Request, limit: int = 40):
    """Return recent social events involving the current user, plus unread count."""
    session = _require_session(request)
    user_id = session["user_id"]
    db = get_supabase()
    if not db:
        return {"notifications": [], "unread_count": 0}

    # Resolve last_read_at; default to epoch if never set.
    try:
        prof_res = (
            db.table("user_profiles")
            .select("notifications_last_read_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        last_read = (prof_res.data or [{}])[0].get("notifications_last_read_at")
    except Exception:
        last_read = None
    last_read = last_read or "1970-01-01T00:00:00+00:00"

    items: list[dict] = []
    cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=14)).isoformat()
    limit  = min(max(limit, 1), 100)

    # 1. DMs received
    try:
        dms = (
            db.table("dm_messages")
            .select("id, sender_id, text, created_at")
            .eq("recipient_id", user_id)
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        sender_ids = list({r["sender_id"] for r in (dms.data or [])})
        sender_names = frd._names_for(db, sender_ids) if sender_ids else {}
        for r in (dms.data or []):
            items.append({
                "id":         f"dm-{r['id']}",
                "kind":       "dm",
                "actor_id":   r["sender_id"],
                "actor_name": sender_names.get(r["sender_id"]) or "Friend",
                "preview":    (r.get("text") or "")[:120],
                "created_at": r["created_at"],
            })
    except Exception:
        pass

    # 2. Taunts received (cheer event_type with target_user_id = me)
    try:
        taunts = (
            db.table("activity_events")
            .select("id, user_id, user_name, payload, created_at")
            .eq("event_type", "cheer")
            .filter("payload->>target_user_id", "eq", user_id)
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        for r in (taunts.data or []):
            p = r.get("payload") or {}
            kind = p.get("kind") or "cheer"
            items.append({
                "id":         f"taunt-{r['id']}",
                "kind":       f"taunt:{kind}",
                "actor_id":   r["user_id"],
                "actor_name": r.get("user_name") or "Friend",
                "preview":    "",
                "created_at": r["created_at"],
            })
    except Exception:
        pass

    # 3. Comments on your events
    try:
        # First find your events
        my_events = (
            db.table("activity_events")
            .select("id")
            .eq("user_id", user_id)
            .gte("created_at", cutoff)
            .execute()
        )
        my_event_ids = [r["id"] for r in (my_events.data or [])]
        if my_event_ids:
            cmts = (
                db.table("event_comments")
                .select("id, event_id, user_id, user_name, text, created_at")
                .in_("event_id", my_event_ids)
                .neq("user_id", user_id)
                .gte("created_at", cutoff)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            commenter_ids = list({r["user_id"] for r in (cmts.data or [])})
            commenter_names = frd._names_for(db, commenter_ids) if commenter_ids else {}
            for r in (cmts.data or []):
                items.append({
                    "id":         f"comment-{r['id']}",
                    "kind":       "comment",
                    "actor_id":   r["user_id"],
                    "actor_name": commenter_names.get(r["user_id"]) or r.get("user_name") or "Friend",
                    "preview":    (r.get("text") or "")[:120],
                    "event_id":   r.get("event_id"),
                    "created_at": r["created_at"],
                })

            # 4. Reactions on your events
            reacts = (
                db.table("event_reactions")
                .select("id, event_id, user_id, emoji, created_at")
                .in_("event_id", my_event_ids)
                .neq("user_id", user_id)
                .gte("created_at", cutoff)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            reactor_ids = list({r["user_id"] for r in (reacts.data or [])})
            reactor_names = frd._names_for(db, reactor_ids) if reactor_ids else {}
            for r in (reacts.data or []):
                items.append({
                    "id":         f"react-{r['id']}",
                    "kind":       "reaction",
                    "actor_id":   r["user_id"],
                    "actor_name": reactor_names.get(r["user_id"]) or "Friend",
                    "preview":    r.get("emoji") or "",
                    "event_id":   r.get("event_id"),
                    "created_at": r["created_at"],
                })
    except Exception:
        pass

    # Sort by created_at desc and cap
    items.sort(key=lambda x: x["created_at"], reverse=True)
    items = items[:limit]

    # Mark unread state per item
    unread_count = 0
    for it in items:
        it["unread"] = it["created_at"] > last_read
        if it["unread"]:
            unread_count += 1

    return {"notifications": items, "unread_count": unread_count}


@app.post("/api/notifications/mark-read")
def mark_notifications_read(request: Request):
    """Set the user's notifications_last_read_at to now."""
    session = _require_session(request)
    user_id = session["user_id"]
    db = get_supabase()
    if not db:
        return {"ok": False}
    try:
        db.table("user_profiles").upsert(
            {
                "user_id":                     user_id,
                "notifications_last_read_at":  datetime.now(tz=timezone.utc).isoformat(),
            },
            on_conflict="user_id",
        ).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/friends/dm/{friend_user_id}")
def get_dm_thread(friend_user_id: str, request: Request, limit: int = 100):
    """Return the DM thread between you and a specific friend, oldest first.
    Only the two participants can read — enforced inside frd.list_dm via
    the friendship check.
    """
    session = _require_session(request)
    user_id = session["user_id"]
    try:
        return {"messages": frd.list_dm(user_id, friend_user_id, limit=min(max(limit, 1), 200))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/friends/dm/{friend_user_id}")
async def post_dm(friend_user_id: str, request: Request):
    """Send a DM to a friend. Body: { text }."""
    session = _require_session(request)
    user_id = session["user_id"]
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return frd.send_dm(user_id, friend_user_id, text)
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
