"""
Daily Insight Card — the synthesis layer.

Once a day, Claude reads the user's 14-day cross-domain data (Oura sleep
metrics + Apple Health activity + BP + weight + body fat + workouts +
nutrition daily totals + active goal + recent mood check-ins) and
surfaces ONE pattern with ONE action.

The point isn't "you slept 6.2 hours last night" — the morning briefing
already covers that. The point is *"your HRV averages 51 on days you
train mornings vs 42 after 4pm — consider morning workouts this week."*
That's the synthesis layer that distinguishes BackNine from a glorified
Oura dashboard.

Cached per user per day in `daily_insights`. Regenerated daily; if a user
hits the dashboard twice in one day we return the cached row instead of
spending Claude tokens again.

Feedback (👍/👎/dismiss) is persisted and rolled into the prompt for
future generations so we learn what flavors of insight a user values.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import nutrition as nut
import apple_health as ah
import bp as bp_mod
import goals as gl

from supabase import create_client, Client


log = logging.getLogger(__name__)


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Data assembly ────────────────────────────────────────────────────────

def _assemble_window(user_id: str, days: int = 14) -> dict:
    """Pull every signal we have for the last `days` days into one compact
    dict that fits comfortably in a Claude prompt. We intentionally
    pre-aggregate where helpful (weekly volume, 14-day averages) rather
    than dumping every raw row — keeps token cost down and makes Claude's
    job easier."""
    end_d   = _date.today()
    start_d = end_d - timedelta(days=days - 1)
    start, end = start_d.isoformat(), end_d.isoformat()

    # Oura signals (sleep model contains hrv, rhr, breath, total, awake, eff)
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=days + 1)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    # Build per-day cross-domain rows. We only keep days that have ANY
    # data so the prompt isn't padded with empty rows.
    daily_rows: list[dict] = []
    for offset in range(days):
        d = (end_d - timedelta(days=offset)).isoformat()
        row = {"date": d}

        sm = smm.get(d) or {}
        if sm.get("total"):
            row["sleep_hours"] = round(sm["total"] / 3600, 2)
        if sm.get("hrv")        is not None: row["hrv"] = sm["hrv"]
        if sm.get("rhr")        is not None: row["rhr"] = sm["rhr"]
        if sm.get("breath")     is not None: row["breath"] = sm["breath"]
        if sm.get("efficiency") is not None: row["sleep_eff"] = sm["efficiency"]
        if sm.get("awake")      is not None: row["waso_min"] = round(sm["awake"] / 60, 1)
        if sm.get("spo2")       is not None: row["spo2"] = sm["spo2"]

        rd = rm.get(d) or {}
        if rd.get("score") is not None:
            row["readiness"] = rd["score"]

        # Steps prefer Apple Health (live throughout the day) else Oura
        try:
            ah_day = ah.get_day(user_id, d)
        except Exception:
            ah_day = None
        steps = None
        if ah_day and ah_day.get("steps") is not None:
            steps = ah_day["steps"]
        elif (am.get(d) or {}).get("steps") is not None:
            steps = am[d]["steps"]
        if steps is not None:
            row["steps"] = int(steps)

        daily_rows.append(row)

    # BP readings + 30-day BP summary
    try:
        bp_sum = bp_mod.summary(user_id, days=30)
        recent_bp = bp_mod.list_readings(user_id, days=days, limit=20)
    except Exception:
        bp_sum, recent_bp = {}, []

    # Weight + body comp
    try:
        we = nut.get_weight_entries(user_id) or []
    except Exception:
        we = []
    we_recent = [
        {"date": w.get("date"), "weight_lbs": w.get("weight_lbs"), "body_fat_pct": w.get("body_fat_pct")}
        for w in we[-10:] if w.get("date") and w.get("date") >= start
    ]

    # Workouts in window
    sb = _sb()
    workouts: list[dict] = []
    if sb:
        try:
            res = (sb.table("training_workouts")
                     .select("date, type, kind, duration_min")
                     .eq("user_id", user_id)
                     .gte("date", start)
                     .lte("date", end)
                     .order("date", desc=True)
                     .limit(60)
                     .execute())
            workouts = [{"date": r.get("date"), "type": r.get("type"),
                         "kind": r.get("kind"), "duration_min": r.get("duration_min")}
                        for r in (res.data or [])]
        except Exception:
            pass

    # Nutrition daily totals
    nutrition_rows: list[dict] = []
    if sb:
        try:
            res = (sb.table("nutrition_meals")
                     .select("date, calories, protein, carbs, fat")
                     .eq("user_id", user_id)
                     .gte("date", start)
                     .lte("date", end)
                     .execute())
            by_day: dict[str, dict] = {}
            for r in (res.data or []):
                d = r.get("date")
                if not d:
                    continue
                slot = by_day.setdefault(d, {"date": d, "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0})
                slot["calories"]  += int(r.get("calories") or 0)
                slot["protein_g"] += int(float(r.get("protein") or 0))
                slot["carbs_g"]   += int(float(r.get("carbs")   or 0))
                slot["fat_g"]     += int(float(r.get("fat")     or 0))
            nutrition_rows = sorted(by_day.values(), key=lambda r: r["date"], reverse=True)
        except Exception:
            pass

    # Mood check-ins
    mood_rows: list[dict] = []
    if sb:
        try:
            res = (sb.table("daily_checkins")
                     .select("date, mood, note")
                     .eq("user_id", user_id)
                     .gte("date", start)
                     .lte("date", end)
                     .order("date", desc=True)
                     .limit(30)
                     .execute())
            mood_rows = res.data or []
        except Exception:
            pass

    # Active goal + pace
    active_goal = None
    try:
        full_goal = gl.get_active_goal(user_id, end)
        if full_goal:
            active_goal = {
                "title":        full_goal.get("title"),
                "metric":       full_goal.get("metric"),
                "baseline":     full_goal.get("baseline"),
                "target":       full_goal.get("target"),
                "current":      full_goal.get("current"),
                "progress_pct": full_goal.get("progress_pct"),
                "pace":         full_goal.get("pace"),
            }
    except Exception:
        pass

    return {
        "range":           {"start": start, "end": end, "days": days},
        "daily":           [r for r in daily_rows if len(r) > 1],  # drop empty rows
        "bp_summary":      bp_sum,
        "recent_bp":       recent_bp[:10],
        "weight_recent":   we_recent,
        "workouts":        workouts,
        "nutrition_daily": nutrition_rows,
        "mood":            mood_rows,
        "active_goal":     active_goal,
    }


# ── Claude prompt ────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are the Insight engine inside BackNine — a personal
longevity dashboard. Your job is to read a user's 14-day cross-domain
health data and surface ONE specific, useful pattern they probably
haven't noticed.

This is NOT a daily-summary. The morning briefing already does that.
This is the "so what?" layer — what does the data ACTUALLY suggest about
how this person's body is working right now?

Voice and constraints:
- 1 SPECIFIC pattern, supported by numbers from the data.
- 1 SPECIFIC action — something to try this week. Not "sleep more."
  Better: "Push bedtime to 10:30pm tonight" or "Try training before 11am
  for the next 5 sessions."
- Pattern must be FALSIFIABLE — the user could check it themselves.
- No diagnosis, no Rx advice, no medical claims.
- Plain English, conversational, under-40-words pattern + under-20-words
  action.
- Confidence: 'high' if the pattern has >7 days of supporting evidence and
  a clear directional signal; 'medium' if 4–7 days; 'low' if shaky.
- Pick the MOST useful insight from the available data — strength is
  often in cross-domain patterns (e.g. sleep × HRV, training × HRV, BP ×
  sleep, body fat × calories). One signal alone is usually less
  interesting.
- If the data is too sparse to find anything meaningful, return
  confidence='low' and a pattern that acknowledges that ("Not enough
  days of data yet to spot a real pattern — keep logging").
- Headline: 4–8 words, scannable, eyebrow-style.
- Category: one of sleep | training | nutrition | cardio | recovery | general

Output ONLY a JSON object with this shape:
{
  "headline":   "Short eyebrow",
  "pattern":    "1–2 sentences naming the pattern with specific numbers from the data.",
  "action":     "1 sentence — one specific thing to try this week.",
  "evidence":   "Short numeric summary, e.g. 'HRV 51 on morning-train days (n=4) vs 42 on evening (n=3)'.",
  "confidence": "low|medium|high",
  "category":   "sleep|training|nutrition|cardio|recovery|general"
}
No code fences, no explanation, just the JSON.
"""


def _truncate_for_prompt(window: dict, max_chars: int = 12000) -> str:
    s = json.dumps(window, default=str)
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
            start = raw.find("{")
            end   = raw.rfind("}")
            if start != -1 and end > start:
                return json.loads(raw[start : end + 1])
        except Exception:
            return None
    return None


def _generate_insight(window: dict, profile: dict, prior_feedback: list[dict]) -> Optional[dict]:
    """Run Claude Haiku over the data window. Returns dict with headline /
    pattern / action / evidence / confidence / category, or None on
    failure."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        log.warning("daily_insight: ANTHROPIC_API_KEY not set; skipping")
        return None
    try:
        import anthropic
    except ImportError:
        log.warning("daily_insight: anthropic package not available")
        return None

    age = None
    bd = (profile or {}).get("birthdate")
    if bd:
        try:
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            today = _date.today()
            age = today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
        except Exception:
            pass

    patient_hint = ""
    if age or profile.get("biological_sex"):
        parts = []
        if age: parts.append(f"age {age}")
        if profile.get("biological_sex"): parts.append(str(profile["biological_sex"]))
        patient_hint = f"Patient: {', '.join(parts)}.\n"

    feedback_hint = ""
    if prior_feedback:
        up_cats   = [f.get("category") for f in prior_feedback if f.get("feedback") == "up"   and f.get("category")]
        down_cats = [f.get("category") for f in prior_feedback if f.get("feedback") == "down" and f.get("category")]
        if up_cats or down_cats:
            feedback_hint = (
                "User feedback history (use to bias selection): "
                f"liked categories: {up_cats[:5] or 'none'}; "
                f"disliked categories: {down_cats[:5] or 'none'}.\n"
            )

    user_msg = (
        patient_hint
        + feedback_hint
        + "Cross-domain 14-day data (JSON):\n"
        + _truncate_for_prompt(window)
        + "\n\nFind ONE pattern + ONE action. Output the JSON now."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text if response.content else ""
        parsed = _parse_json_safe(raw)
        if not parsed:
            log.warning("daily_insight: couldn't parse Claude response: %s", raw[:200])
            return None
        # Validate required fields
        for k in ("headline", "pattern", "action", "confidence", "category"):
            if not parsed.get(k):
                log.warning("daily_insight: missing field %s in %s", k, parsed)
                return None
        return parsed
    except Exception as exc:
        log.warning("daily_insight: generation failed: %s", exc)
        return None


# ── Persistence + public API ─────────────────────────────────────────────

def get_or_generate(user_id: str, profile: dict, today_iso: str) -> Optional[dict]:
    """Return today's insight for the user. If it doesn't exist yet,
    generate, persist, and return. Best-effort — None on any failure so
    the Scorecard renders cleanly without the card.

    Idempotent: subsequent calls in the same day return the cached row
    (no extra Claude spend)."""
    sb = _sb()
    if not sb:
        return None

    # Cache lookup
    try:
        res = (sb.table("daily_insights")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("date", today_iso)
                 .limit(1)
                 .execute())
        if res.data:
            return res.data[0]
    except Exception:
        pass

    # Past feedback for prompt biasing
    prior_feedback: list[dict] = []
    try:
        fb = (sb.table("daily_insights")
                .select("category, feedback")
                .eq("user_id", user_id)
                .not_.is_("feedback", "null")
                .order("generated_at", desc=True)
                .limit(20)
                .execute())
        prior_feedback = fb.data or []
    except Exception:
        pass

    # Build window + generate
    window = _assemble_window(user_id, days=14)
    insight = _generate_insight(window, profile, prior_feedback)
    if not insight:
        return None

    # Persist
    row = {
        "user_id":    user_id,
        "date":       today_iso,
        "headline":   str(insight.get("headline") or "")[:200],
        "pattern":    str(insight.get("pattern")  or "")[:800],
        "action":     str(insight.get("action")   or "")[:400],
        "evidence":   str(insight.get("evidence") or "")[:400],
        "confidence": str(insight.get("confidence") or "medium")[:20],
        "category":   str(insight.get("category")   or "general")[:30],
    }
    try:
        saved = sb.table("daily_insights").upsert(row, on_conflict="user_id,date").execute()
        if saved.data:
            return saved.data[0]
    except Exception as exc:
        log.warning("daily_insight: persist failed: %s", exc)
    # Return the in-memory row even if persist failed so the card still
    # renders this session.
    return row


def list_recent(user_id: str, days: int = 90, category: Optional[str] = None) -> list[dict]:
    """Return past daily insights for the user (newest first), optionally
    filtered by category. Used by the Insights Feed page."""
    sb = _sb()
    if not sb:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        q = (sb.table("daily_insights")
               .select("*")
               .eq("user_id", user_id)
               .gte("date", cutoff)
               .order("date", desc=True)
               .limit(180))
        if category:
            q = q.eq("category", category)
        res = q.execute()
        return res.data or []
    except Exception:
        return []


def record_feedback(user_id: str, date_iso: str, feedback: str) -> bool:
    """User flagged the insight as 👍 / 👎 / dismissed. Persisted so future
    generations can bias toward what this user finds useful."""
    if feedback not in {"up", "down", "dismissed"}:
        return False
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table("daily_insights").update({
            "feedback":    feedback,
            "feedback_at": datetime.utcnow().isoformat() + "Z",
        }).eq("user_id", user_id).eq("date", date_iso).execute()
        return True
    except Exception:
        return False
