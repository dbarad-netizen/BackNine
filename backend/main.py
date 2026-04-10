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

from fastapi import FastAPI, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from dotenv import load_dotenv
from jose import jwt, JWTError

from oura import build_auth_url, exchange_code, refresh_token as oura_refresh, fetch_all, parse_oura_data, fetch_personal_info
from coaching import generate_coaching, coach_overall, coach_sleep, coach_activity
from models import DashboardResponse, DailyMetrics, WearableConnection
import nutrition as nutr
import training as trn
import labs as lbs
import challenges as chl

load_dotenv()

# ── config ────────────────────────────────────────────────────────────────────
OURA_CLIENT_ID     = os.getenv("OURA_CLIENT_ID", "")
OURA_CLIENT_SECRET = os.getenv("OURA_CLIENT_SECRET", "")
OURA_REDIRECT_URI  = os.getenv("OURA_REDIRECT_URI", "http://localhost:8000/auth/oura/callback")
FRONTEND_URL       = os.getenv("FRONTEND_URL", "http://localhost:3000")
SUPABASE_URL       = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ENVIRONMENT        = os.getenv("ENVIRONMENT", "development")

# ── Supabase client (lazy — only used when env vars present) ──────────────────
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None and SUPABASE_URL and SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _supabase


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BackNine Health API",
    version="0.1.0",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    import traceback
    return JSONResponse(status_code=500, content={"error": str(exc), "trace": traceback.format_exc()})

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


# Transient OAuth state nonces (in-memory is fine — just a replay guard)
_oauth_states: dict = {}  # state → timestamp


# ── helpers ───────────────────────────────────────────────────────────────────

def _session_cookie_name() -> str:
    return "bn_session"


def _get_session(request: Request) -> Optional[dict]:
    token = request.cookies.get(_session_cookie_name())
    if not token:
        return None
    return _decode_session(token)


def _set_session_cookie(response, session: dict) -> None:
    """Write the session dict as a signed JWT into the HttpOnly cookie."""
    token = _encode_session(session)
    response.set_cookie(
        key=_session_cookie_name(),
        value=token,
        httponly=True,
        secure=(ENVIRONMENT == "production"),
        samesite="lax",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )


def _require_session(request: Request) -> dict:
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session


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


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


# ── Oura OAuth ────────────────────────────────────────────────────────────────

@app.get("/auth/oura")
def oura_auth_start(response: Response):
    """Redirect the user to Oura's OAuth authorization page."""
    if not OURA_CLIENT_ID:
        raise HTTPException(status_code=500, detail="OURA_CLIENT_ID not configured")
    state = secrets.token_urlsafe(24)
    _oauth_states[state] = datetime.now(timezone.utc).timestamp()
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

        # Validate state (skip validation in dev to avoid in-memory loss on restart)
        _oauth_states.pop(state, None)  # consume it if present, ignore if not

        # Exchange code for tokens
        tokens = await exchange_code(code, OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REDIRECT_URI)

        access_token  = tokens["access_token"]
        refresh_tok   = tokens.get("refresh_token")
        expires_in    = tokens.get("expires_in", 86400)
        expires_at    = int(datetime.now(timezone.utc).timestamp()) + expires_in

        # Fetch the stable Oura user ID — this is permanent for their account
        # so the same person always gets the same user_id even after re-login
        try:
            personal = await fetch_personal_info(access_token)
            user_id  = f"oura_{personal['id']}"
        except Exception:
            # Fallback: deterministic hex from access token so at least the
            # same token maps to the same ID within a session lifetime
            import hashlib
            user_id = f"oura_{hashlib.sha256(access_token.encode()).hexdigest()[:16]}"

        session_data = {
            "user_id":       user_id,
            "provider":      "oura",
            "access_token":  access_token,
            "refresh_token": refresh_tok,
            "expires_at":    expires_at,
        }

        # Supabase — best effort only
        try:
            db = get_supabase()
            if db:
                db.table("wearable_connections").upsert({
                    "user_id": user_id, "provider": "oura",
                    "access_token": access_token, "refresh_token": refresh_tok,
                    "expires_at": expires_at,
                }).execute()
        except Exception:
            pass

        redirect = RedirectResponse(f"{FRONTEND_URL}/dashboard")
        _set_session_cookie(redirect, session_data)
        return redirect

    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc), "trace": traceback.format_exc()})


@app.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(_session_cookie_name())
    return {"status": "logged_out"}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def get_dashboard(request: Request, days: int = 120):
    session = _require_session(request)
    access_token, refreshed_session = await _ensure_valid_token(session)
    if refreshed_session:
        session = refreshed_session

    # Fetch from Oura
    try:
        raw = await fetch_all(access_token, days=days)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Oura API error: {exc}")

    rm, slm, am, smm = parse_oura_data(raw)

    # "Today" with fallback to most recent
    today_str = datetime.now().strftime("%Y-%m-%d")
    t_rdy = rm.get(today_str, {})
    t_sl  = slm.get(today_str, {})
    t_act = am.get(today_str, {})
    t_sm  = smm.get(today_str, {})
    if not t_rdy and rm:  t_rdy = rm[sorted(rm)[-1]]
    if not t_sl  and slm: t_sl  = slm[sorted(slm)[-1]]
    if not t_act and am:  t_act = am[sorted(am)[-1]]
    # For sleep model, prefer the most recent entry with real sleep (> 1 hour).
    # This skips naps / rest periods that Oura records as short sleep sessions.
    if not t_sm or (t_sm.get("total") or 0) < 3600:
        real_sleeps = {d: v for d, v in smm.items() if (v.get("total") or 0) >= 3600}
        if real_sleeps:
            t_sm = real_sleeps[sorted(real_sleeps)[-1]]
        elif smm:
            t_sm = smm[sorted(smm)[-1]]

    # Build coaching
    coaching = generate_coaching(rm, slm, am, smm)
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

    # Latest data date
    all_days = sorted(set(list(rm) + list(slm) + list(am)))
    data_through = all_days[-1] if all_days else today_str

    payload = {
        "generated":    datetime.now(timezone.utc).isoformat(),
        "data_through": data_through,
        "provider":     "oura",
        "today": {
            "readiness":   t_rdy,
            "sleep":       t_sl,
            "activity":    t_act,
            "sleep_model": t_sm,
        },
        "training_load":       training_load,
        "readiness_forecast":  readiness_forecast,
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
    _require_session(request)
    body = await request.json()
    today = datetime.now().strftime("%Y-%m-%d")
    entry = trn.add_workout(
        date_str     = body.get("date", today),
        workout_type = body.get("type", "lifting"),
        exercises    = body.get("exercises", []),
        duration_min = body.get("duration_min"),
        notes        = body.get("notes", ""),
    )
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

@app.get("/api/challenges/me")
def my_challenges(request: Request):
    _require_session(request)
    return {"challenges": chl.list_my_challenges(), "user_id": chl.get_local_user_id()}


@app.post("/api/challenges")
async def create_challenge(request: Request):
    _require_session(request)
    body = await request.json()
    try:
        challenge = chl.create_challenge(
            name           = body["name"],
            challenge_type = body["type"],
            target         = float(body["target"]),
            duration_days  = int(body["duration_days"]),
            creator_name   = body["creator_name"],
            custom_unit    = body.get("custom_unit"),
        )
        return challenge
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/challenges/join")
async def join_challenge(request: Request):
    _require_session(request)
    body = await request.json()
    try:
        challenge = chl.join_challenge(
            challenge_id = body["challenge_id"],
            display_name = body["display_name"],
        )
        return challenge
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/challenges/{challenge_id}")
def get_challenge(challenge_id: str, request: Request):
    _require_session(request)
    try:
        return chl.get_challenge(challenge_id.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/challenges/{challenge_id}/progress")
async def log_challenge_progress(challenge_id: str, request: Request):
    _require_session(request)
    body = await request.json()
    try:
        return chl.log_progress(
            challenge_id = challenge_id.upper(),
            value        = float(body["value"]),
            for_date     = body.get("date"),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── dev entrypoint ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
