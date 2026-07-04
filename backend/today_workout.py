"""
Today's Workout — Claude-prescribed daily session card.

Answers the question the Training tab was failing to answer: *what should
I do today?*

Reads:
  • Active goal (body composition / VO₂ / HRV / strength) → biases volume
    and intensity recommendations.
  • Last 30 days of workouts → respects what the user has actually been
    doing (don't prescribe Push if they squatted yesterday; suggest a
    recovery day after 4 hard days in a row).
  • Today's Oura readiness + last night's sleep efficiency → if readiness
    is low, lean toward mobility / Zone 2 / rest; if high, OK to go heavy.
  • Optional system template the user is following → the AI walks the
    template's session rotation rather than reinventing programming.

Outputs: a single session with name, type, intensity, duration, exercises,
and a 1-2 sentence "why this today" rationale that turns the card from a
black-box prescription into a coaching moment.

Cached per (user, date) in `today_workout`. Subsequent calls return the
cached row. Status updates (started/skipped/completed) flow back here.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import goals as gl
import system_templates as sys_tmpl

from supabase import create_client, Client


log = logging.getLogger(__name__)


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Data assembly ────────────────────────────────────────────────────────

def _recent_workouts(user_id: str, days: int = 30) -> list[dict]:
    sb = _sb()
    if not sb:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        res = (sb.table("training_workouts")
                 .select("date, type, kind, activity, duration_min, total_volume_lbs, avg_hr")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .order("date", desc=True)
                 .limit(60)
                 .execute())
        return res.data or []
    except Exception:
        return []


def _todays_readiness(user_id: str) -> dict:
    """Today's readiness signal — used to lean the prescription toward easy
    / moderate / heavy."""
    try:
        rm, _slm, _am, smm = oc.get_days(user_id, days=3)
    except Exception:
        return {}
    today = _date.today().isoformat()
    yesterday = (_date.today() - timedelta(days=1)).isoformat()
    out = {}
    # Readiness score (prefer today, fall back to yesterday)
    for d in (today, yesterday):
        rd = rm.get(d) or {}
        if rd.get("score"):
            out["readiness_score"] = rd["score"]
            out["readiness_date"] = d
            break
    # Last night's sleep summary
    for d in (today, yesterday):
        sm = smm.get(d) or {}
        if sm.get("total"):
            out["sleep_hours"]      = round(sm["total"] / 3600, 1)
            out["sleep_efficiency"] = sm.get("efficiency")
            out["hrv"]              = sm.get("hrv")
            out["rhr"]              = sm.get("rhr")
            out["sleep_date"]       = d
            break
    return out


def _user_template_choice(user_id: str) -> Optional[dict]:
    """If the user has 'started' a system-template session recently AND
    has set a preference (TBD — for now we don't persist a "current
    template" choice; future: profile.training_program_id). Returns the
    template dict if known, else None."""
    # Placeholder for future preference lookup. For now we don't have a
    # persisted choice, so we let Claude pick from the library directly
    # using its session names (which the prompt knows about).
    return None


def _last_session_summary(workouts: list[dict]) -> Optional[dict]:
    """Most recent workout — Claude uses this to avoid repeating the same
    body part or to suggest a logical next session in a split."""
    if not workouts:
        return None
    w = workouts[0]
    return {
        "date":     w.get("date"),
        "type":     w.get("type"),
        "kind":     w.get("kind"),
        "duration": w.get("duration_min"),
    }


def _strength_count_in_last(workouts: list[dict], days: int) -> int:
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    return sum(1 for w in workouts
               if (w.get("date") or "") >= cutoff
               and (w.get("kind") or "").lower() != "cardio")


def _cardio_min_in_last(workouts: list[dict], days: int) -> int:
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    return sum(int(w.get("duration_min") or 0) for w in workouts
               if (w.get("date") or "") >= cutoff
               and (w.get("kind") or "").lower() == "cardio")


# ── Claude prompt ────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are the Coach Al training-prescription engine in
BackNine. Each morning, prescribe ONE workout for the user based on
their goal, recent training history, today's readiness, and the
strength program library they have access to.

## COLD-START SAFETY DIRECTIVE — READ FIRST (Fable ADD #6)

This is non-negotiable. Before prescribing anything, check the user's
training history in the context:

  • If `strength_sessions_30d` is 0 AND `recent_workouts` is empty
    (unknown fitness level, no history to build on), you MUST prescribe
    a CONSERVATIVE FIRST SESSION regardless of what the user's stated
    goals suggest. NEVER prescribe a barbell compound lift as the very
    first session for someone with no history — that is a safety and
    liability exposure. A brand-new 56-year-old will read "Barbell
    Deadlift 4×4-6" and either hurt themselves or lose trust in the app.

  • Conservative first-session template:
      - Bodyweight or dumbbell only
      - Movements: goblet squat (light dumbbell), incline push-up,
        bird-dog, glute bridge, dumbbell row (light)
      - Sets/reps: 2×8-12, moderate effort, focus on form
      - session_name: "Getting Started — Foundation Session"
      - intensity: "easy"
      - duration_min: 25-30
      - rationale: MUST include a sentence acknowledging this is their
        first logged session and inviting them to log completion so
        future prescriptions can build on real capability data.

  • If `patient.age` is 50+ AND history is thin (< 3 sessions in 30d),
    default to MODERATE intensity even for known movements, and prefer
    dumbbell / machine over barbell for compound lifts.

  • Never prescribe: barbell deadlift, barbell back squat, or barbell
    bench press as the first session for any user — regardless of age
    — when history is empty. Bodyweight and dumbbell variants only for
    session one.

Now the rest of your operating rules:


Voice:
- Specific. Name the exercises. Suggest sets/reps where helpful.
- Adaptive. If readiness is LOW (<70) or sleep was POOR (<6h or eff <80%),
  lean toward a mobility / Zone 2 / rest day. Don't prescribe heavy
  squats on a 60-readiness day.
- Goal-aware. Body-comp goals → balance strength + cardio. VO₂ → cardio
  emphasis. HRV → recovery focus.
- History-aware. Don't repeat the same body part as yesterday. If user
  trained 4+ days in a row, prescribe rest or mobility.
- Persona. The user is a man 50+ optimizing for longevity and strength
  preservation. Sustainable > maximally hard.

Available system templates (use these session names when prescribing
strength sessions, OR design a custom session if context warrants):
- Full Body — Day A / Day B / Day C
- Upper / Lower — Upper A, Lower A, Upper B, Lower B
- PPL — Push A, Pull A, Legs A, Push B, Pull B, Legs B
- 5/3/1 — Press Day, Deadlift Day, Bench Day, Squat Day
- Tactical Barbell — Cluster A / B / C
- Stronger by Stretching — Strength A (Push), Strength B (Pull),
  Mobility Day, Zone 2 Cardio

Output ONLY a JSON object with this shape:
{
  "session_name":   "Upper A — Push focus",
  "session_type":   "strength|cardio|mobility|rest",
  "intensity":      "easy|moderate|heavy|rest",
  "duration_min":   45,
  "exercises":      [
    { "name": "Bench Press",   "sets": 3, "reps": "5-8" },
    { "name": "Bent-Over Row", "sets": 3, "reps": "8-10" }
  ],
  "rationale":      "1-2 sentences: why this session today, referencing readiness/sleep/recent training."
}

For rest days, use session_type='rest', intensity='rest', duration_min=0,
exercises=[], and explain why in rationale ("Readiness 58 after 4 hard
days — full rest today protects next week's training.").

No code fences. Just the JSON.
"""


def _truncate(payload, max_chars: int = 8000) -> str:
    s = json.dumps(payload, default=str)
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + '..."<truncated>"'


def _parse_json_safe(raw: str) -> Optional[dict]:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except Exception:
        try:
            start = raw.find("{"); end = raw.rfind("}")
            if start != -1 and end > start:
                return json.loads(raw[start:end+1])
        except Exception:
            return None
    return None


def _generate(user_id: str, profile: dict, today_iso: str) -> Optional[dict]:
    """Run Claude over the context. Returns the prescription dict or None
    on failure (caller falls back to a deterministic template rotation)."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None

    workouts  = _recent_workouts(user_id, days=30)
    readiness = _todays_readiness(user_id)
    last_sess = _last_session_summary(workouts)

    # Patient hint
    age = None
    bd = profile.get("birthdate")
    if bd:
        try:
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            t    = _date.today()
            age = t.year - bd_d.year - ((t.month, t.day) < (bd_d.month, bd_d.day))
        except Exception:
            pass

    # Active goal
    active_goal = None
    try:
        full_goal = gl.get_active_goal(user_id, today_iso)
        if full_goal:
            active_goal = {
                "title":  full_goal.get("title"),
                "metric": full_goal.get("metric"),
                "target": full_goal.get("target"),
                "current": full_goal.get("current"),
                "pace":   full_goal.get("pace"),
            }
    except Exception:
        pass

    context = {
        "today":                today_iso,
        "patient":              {"age": age, "biological_sex": profile.get("biological_sex"),
                                 "health_goals": profile.get("health_goals") or []},
        "active_goal":          active_goal,
        "today_readiness":      readiness,
        "last_session":         last_sess,
        "strength_sessions_7d": _strength_count_in_last(workouts, 7),
        "cardio_min_7d":        _cardio_min_in_last(workouts, 7),
        "strength_sessions_30d": _strength_count_in_last(workouts, 30),
        "recent_workouts":      workouts[:14],   # last 14 most recent
    }

    user_msg = (
        "Prescribe today's workout for this user. Output the JSON now.\n\n"
        + _truncate(context)
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text if response.content else ""
        parsed = _parse_json_safe(raw)
        if not parsed or not parsed.get("session_name"):
            log.warning("today_workout: bad Claude response: %s", raw[:200])
            return None
        return {
            "session_name": str(parsed.get("session_name", ""))[:120],
            "session_type": str(parsed.get("session_type", "strength"))[:20],
            "intensity":    str(parsed.get("intensity", "moderate"))[:20],
            "duration_min": int(parsed.get("duration_min") or 45),
            "exercises":    parsed.get("exercises") or [],
            "rationale":    str(parsed.get("rationale", ""))[:600],
            "source":       "claude",
        }
    except Exception as exc:
        log.warning("today_workout: generation failed: %s", exc)
        return None


# ── Fallback (deterministic) ────────────────────────────────────────────

def _fallback_prescription(workouts: list[dict]) -> dict:
    """When Claude isn't available, fall back to a deterministic pick:
    if the user has no history AT ALL, prescribe a conservative
    foundation session (Fable ADD #6 safety); if they trained recently,
    suggest a Zone 2 / mobility day; otherwise pick the first Full-Body
    session as a safe default."""
    today = _date.today().isoformat()
    yesterday = (_date.today() - timedelta(days=1)).isoformat()
    trained_recently = any((w.get("date") or "") in (today, yesterday) for w in workouts[:5])

    # Cold-start guardrail — no logged workouts means no capability data.
    # Never prescribe compound barbell lifts to someone we know nothing
    # about. A conservative foundation session builds baseline data we
    # can prescribe from tomorrow.
    if not workouts:
        return {
            "session_name": "Getting Started — Foundation Session",
            "session_type": "strength",
            "intensity":    "easy",
            "duration_min": 25,
            "exercises":    [
                {"name": "Goblet Squat (light dumbbell)", "sets": 2, "reps": "8-12"},
                {"name": "Incline Push-Up",               "sets": 2, "reps": "8-12"},
                {"name": "Dumbbell Row (light)",          "sets": 2, "reps": "8-12"},
                {"name": "Glute Bridge",                  "sets": 2, "reps": "10-15"},
                {"name": "Bird-Dog",                      "sets": 2, "reps": "8/side"},
            ],
            "rationale":    "First session — foundation movements only. Focus on form, log completion, and tomorrow's prescription will build on what you actually did.",
            "source":       "template_fallback",
        }

    if trained_recently:
        return {
            "session_name": "Mobility & Zone 2",
            "session_type": "mobility",
            "intensity":    "easy",
            "duration_min": 30,
            "exercises":    [
                {"name": "World's Greatest Stretch", "sets": 3, "reps": "5/side"},
                {"name": "Cat-Cow",                   "sets": 3, "reps": "10"},
                {"name": "Zone 2 walk or bike",       "sets": 1, "reps": "20 min @ HR <140"},
            ],
            "rationale":    "You've trained recently — today's a recovery day. 20 min of Zone 2 + mobility keeps you moving without adding stress.",
            "source":       "template_fallback",
        }

    fb = sys_tmpl.get_system_template("full-body-3day")
    if fb and fb.get("sessions"):
        first = fb["sessions"][0]
        return {
            "session_name": first["name"],
            "session_type": "strength",
            "intensity":    "moderate",
            "duration_min": 50,
            "exercises":    [{"name": ex} for ex in first.get("exercises", [])],
            "rationale":    "Full-body session — covers every major movement pattern. Good default when there's no recent training to build on.",
            "source":       "template_fallback",
        }
    return {
        "session_name": "Strength session",
        "session_type": "strength",
        "intensity":    "moderate",
        "duration_min": 45,
        "exercises":    [],
        "rationale":    "Get a full-body strength session in. Aim for compound lifts (squat, press, row).",
        "source":       "template_fallback",
    }


# ── Public API ──────────────────────────────────────────────────────────

def get_or_generate(user_id: str, profile: dict, today_iso: str) -> Optional[dict]:
    """Return today's prescription. If cached, return cached. If not,
    generate via Claude (or fallback) and persist."""
    sb = _sb()
    if not sb:
        return None

    try:
        res = (sb.table("today_workout")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("date", today_iso)
                 .limit(1)
                 .execute())
        if res.data:
            return res.data[0]
    except Exception:
        pass

    pres = _generate(user_id, profile, today_iso)
    if not pres:
        pres = _fallback_prescription(_recent_workouts(user_id, days=30))

    row = {
        "user_id":      user_id,
        "date":         today_iso,
        "session_name": pres.get("session_name"),
        "session_type": pres.get("session_type"),
        "intensity":    pres.get("intensity"),
        "duration_min": pres.get("duration_min"),
        "exercises":    pres.get("exercises") or [],
        "rationale":    pres.get("rationale"),
        "source":       pres.get("source"),
        "status":       "pending",
    }
    try:
        saved = sb.table("today_workout").upsert(row, on_conflict="user_id,date").execute()
        if saved.data:
            return saved.data[0]
    except Exception as exc:
        log.warning("today_workout: persist failed: %s", exc)
    return row


def update_status(user_id: str, date_iso: str, status: str) -> bool:
    """Record the user's action: started / completed / skipped."""
    if status not in {"started", "completed", "skipped"}:
        return False
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table("today_workout").update({
            "status":    status,
            "status_at": datetime.utcnow().isoformat() + "Z",
        }).eq("user_id", user_id).eq("date", date_iso).execute()
        return True
    except Exception:
        return False


def record_feedback(user_id: str, date_iso: str, feedback: str) -> bool:
    if feedback not in {"up", "down"}:
        return False
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table("today_workout").update({
            "feedback": feedback,
        }).eq("user_id", user_id).eq("date", date_iso).execute()
        return True
    except Exception:
        return False


def regenerate(user_id: str, profile: dict, today_iso: str) -> Optional[dict]:
    """Force-regenerate today's prescription (user asked for a different
    suggestion). Deletes the cached row and runs the generator again."""
    sb = _sb()
    if sb:
        try:
            sb.table("today_workout").delete().eq("user_id", user_id).eq("date", today_iso).execute()
        except Exception:
            pass
    return get_or_generate(user_id, profile, today_iso)
