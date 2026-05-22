"""
Achievements / badges for BackNine.

A code-defined catalog of badges the user unlocks from data the app already
tracks. On each evaluation we gather the user's stats once, check every badge,
persist any newly-earned ones (so they stay earned forever), and report which
were just unlocked so the UI can celebrate.

Schema: supabase_user_badges.sql.
"""

import os
from datetime import date, timedelta

import friends as frd
import groups as grp
import training as trn
import nutrition as nutr
import longevity_history as lonh
import oura_cache as oc


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


def _et_today() -> str:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    from datetime import datetime
    return datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()


# ── Catalog ───────────────────────────────────────────────────────────────────
# Each badge: id, name, emoji, category, description, xp, check(stats)->bool,
# optional progress(stats)->{current,target} for tiered/locked motivation.
#
# `xp` powers the level system (see LEVELS below). Harder badges are worth more,
# so chasing the next badge visibly moves your level bar — the engagement hook.
BADGES = [
    {"id": "first_checkin", "name": "First Step", "emoji": "👋", "category": "Consistency", "xp": 10,
     "description": "Logged your first daily check-in.",
     "check": lambda s: s["checkins"] >= 1},
    {"id": "streak_3", "name": "On a Roll", "emoji": "🔥", "category": "Consistency", "xp": 25,
     "description": "Opened BackNine 3 days in a row.",
     "check": lambda s: s["streak"] >= 3,
     "progress": lambda s: {"current": min(s["streak"], 3), "target": 3}},
    {"id": "streak_7", "name": "Week Warrior", "emoji": "🗓️", "category": "Consistency", "xp": 50,
     "description": "Kept a 7-day streak going.",
     "check": lambda s: s["streak"] >= 7,
     "progress": lambda s: {"current": min(s["streak"], 7), "target": 7}},
    {"id": "streak_30", "name": "Unstoppable", "emoji": "🏆", "category": "Consistency", "xp": 150,
     "description": "A full 30-day streak.",
     "check": lambda s: s["streak"] >= 30,
     "progress": lambda s: {"current": min(s["streak"], 30), "target": 30}},

    {"id": "first_workout", "name": "First Rep", "emoji": "🏋️", "category": "Training", "xp": 10,
     "description": "Logged your first workout.",
     "check": lambda s: s["workouts"] >= 1},
    {"id": "workouts_10", "name": "Getting Strong", "emoji": "💪", "category": "Training", "xp": 50,
     "description": "Logged 10 workouts.",
     "check": lambda s: s["workouts"] >= 10,
     "progress": lambda s: {"current": min(s["workouts"], 10), "target": 10}},
    {"id": "workouts_50", "name": "Iron Habit", "emoji": "🦾", "category": "Training", "xp": 150,
     "description": "Logged 50 workouts.",
     "check": lambda s: s["workouts"] >= 50,
     "progress": lambda s: {"current": min(s["workouts"], 50), "target": 50}},

    {"id": "first_weighin", "name": "Stepping On", "emoji": "⚖️", "category": "Body", "xp": 10,
     "description": "Logged your first weigh-in.",
     "check": lambda s: s["weighins"] >= 1},

    {"id": "longevity_fair", "name": "Vitality: Fair", "emoji": "🌱", "category": "Health", "xp": 40,
     "description": "Reached a Fair Longevity Score (55+).",
     "check": lambda s: (s["longevity"] or 0) >= 55},
    {"id": "longevity_good", "name": "Vitality: Good", "emoji": "🌿", "category": "Health", "xp": 75,
     "description": "Reached a Good Longevity Score (70+).",
     "check": lambda s: (s["longevity"] or 0) >= 70},
    {"id": "longevity_excellent", "name": "Vitality: Excellent", "emoji": "🌳", "category": "Health", "xp": 150,
     "description": "Reached an Excellent Longevity Score (85+).",
     "check": lambda s: (s["longevity"] or 0) >= 85},

    {"id": "steps_10k", "name": "10K Club", "emoji": "👟", "category": "Activity", "xp": 40,
     "description": "Hit 10,000 steps in a day.",
     "check": lambda s: s["best_steps"] >= 10000,
     "progress": lambda s: {"current": min(s["best_steps"], 10000), "target": 10000}},

    {"id": "sleep_8", "name": "Well Rested", "emoji": "😴", "category": "Recovery", "xp": 25,
     "description": "Slept 8+ hours in a night.",
     "check": lambda s: s["best_sleep_h"] >= 8},
    {"id": "rhr_sub60", "name": "Steady Heart", "emoji": "❤️", "category": "Recovery", "xp": 40,
     "description": "Resting heart rate under 60 bpm.",
     "check": lambda s: 0 < (s["min_rhr"] or 0) < 60},

    {"id": "first_friend", "name": "Not Alone", "emoji": "🤝", "category": "Community", "xp": 25,
     "description": "Connected your first friend.",
     "check": lambda s: s["friends"] >= 1},
    {"id": "joined_group", "name": "Squad Up", "emoji": "👥", "category": "Community", "xp": 25,
     "description": "Joined or created a group.",
     "check": lambda s: s["groups"] >= 1},

    {"id": "goal_set", "name": "Goal Setter", "emoji": "🎯", "category": "Goals", "xp": 25,
     "description": "Set your first Coach Al goal.",
     "check": lambda s: s["goals_created"] >= 1},
    {"id": "goal_done", "name": "Finisher", "emoji": "🥇", "category": "Goals", "xp": 75,
     "description": "Completed a goal.",
     "check": lambda s: s["goals_completed"] >= 1},
]


# ── Levels ──────────────────────────────────────────────────────────────────
# Cumulative XP thresholds → level title. Total catalog XP is ~965, so Legend is
# a real summit. The card shows progress to the next level so every badge earned
# visibly advances you.
LEVELS = [
    (0,   "Rookie"),
    (50,  "Getting Started"),
    (125, "Regular"),
    (225, "Committed"),
    (350, "Contender"),
    (500, "Athlete"),
    (680, "Veteran"),
    (850, "Legend"),
]


def _level_info(xp: int) -> dict:
    """Resolve total XP to a level, title, and progress toward the next level."""
    idx = 0
    for i, (thr, _) in enumerate(LEVELS):
        if xp >= thr:
            idx = i
        else:
            break
    thr, title = LEVELS[idx]
    if idx + 1 < len(LEVELS):
        next_thr, next_title = LEVELS[idx + 1]
        span = next_thr - thr
        into = xp - thr
        pct = round(100 * into / span) if span > 0 else 100
        return {
            "level": idx + 1, "title": title, "xp": xp,
            "xp_into_level": into, "xp_for_next": max(0, next_thr - xp),
            "next_title": next_title, "pct": min(100, max(0, pct)), "is_max": False,
        }
    return {
        "level": idx + 1, "title": title, "xp": xp,
        "xp_into_level": xp - thr, "xp_for_next": 0,
        "next_title": None, "pct": 100, "is_max": True,
    }


# ── Stats gathering ───────────────────────────────────────────────────────────

def _streak(sb, user_id: str, today: str) -> int:
    """Consecutive days with a daily_briefings row, ending today (or yesterday
    if today hasn't been opened yet) — same definition as the app streak pill."""
    try:
        res = (
            sb.table("daily_briefings")
            .select("date")
            .eq("user_id", user_id)
            .order("date", desc=True)
            .limit(90)
            .execute()
        )
        dates = {str(r["date"]) for r in (res.data or [])}
    except Exception:
        return 0
    d = date.fromisoformat(today)
    if d.isoformat() not in dates:
        d = d - timedelta(days=1)
    streak = 0
    while d.isoformat() in dates:
        streak += 1
        d -= timedelta(days=1)
    return streak


def _gather_stats(user_id: str) -> dict:
    sb = _sb()
    today = _et_today()
    s = {
        "streak": 0, "checkins": 0, "workouts": 0, "weighins": 0, "longevity": None,
        "best_steps": 0, "best_sleep_h": 0.0, "min_rhr": 0,
        "friends": 0, "groups": 0, "goals_created": 0, "goals_completed": 0,
    }

    s["streak"] = _streak(sb, user_id, today)

    try:
        r = sb.table("daily_checkins").select("date", count="exact").eq("user_id", user_id).execute()
        s["checkins"] = r.count or 0
    except Exception:
        pass

    try:
        s["workouts"] = len(trn.get_workouts(user_id, days=3650) or [])
    except Exception:
        pass

    try:
        s["weighins"] = len(nutr.get_weight_entries(user_id) or [])
    except Exception:
        pass

    try:
        h = lonh.get_history(user_id, days=14)
        s["longevity"] = h[-1]["score"] if h else None
    except Exception:
        pass

    try:
        _rm, _slm, am, smm = oc.get_days(user_id, days=90)
        steps_vals = [am[d].get("steps") or 0 for d in am]
        s["best_steps"] = max(steps_vals) if steps_vals else 0
        sleep_vals = [smm[d].get("total") or 0 for d in smm]
        s["best_sleep_h"] = round(max(sleep_vals) / 3600, 1) if sleep_vals else 0.0
        rhr_vals = [smm[d]["rhr"] for d in smm if smm[d].get("rhr")]
        s["min_rhr"] = min(rhr_vals) if rhr_vals else 0
    except Exception:
        pass

    try:
        s["friends"] = len(frd.list_friends(user_id) or [])
    except Exception:
        pass

    try:
        s["groups"] = len(grp.list_groups(user_id) or [])
    except Exception:
        pass

    try:
        rows = sb.table("user_goals").select("status").eq("user_id", user_id).execute().data or []
        s["goals_created"] = len(rows)
        s["goals_completed"] = sum(1 for g in rows if g.get("status") == "completed")
    except Exception:
        pass

    return s


# ── Evaluate ──────────────────────────────────────────────────────────────────

def evaluate(user_id: str) -> dict:
    """Evaluate all badges, persist newly-earned ones, return the full catalog
    with earned status + which were just unlocked."""
    sb = _sb()
    stats = _gather_stats(user_id)

    try:
        earned_rows = sb.table("user_badges").select("badge_id, earned_at").eq("user_id", user_id).execute().data or []
    except Exception:
        earned_rows = []
    earned_map = {r["badge_id"]: r.get("earned_at") for r in earned_rows}

    to_insert = []
    newly = []
    out = []
    for b in BADGES:
        try:
            now_earned = bool(b["check"](stats))
        except Exception:
            now_earned = False
        already = b["id"] in earned_map
        if now_earned and not already:
            to_insert.append({"user_id": user_id, "badge_id": b["id"]})
            newly.append(b["id"])
        prog = None
        if "progress" in b:
            try:
                prog = b["progress"](stats)
            except Exception:
                prog = None
        out.append({
            "id":          b["id"],
            "name":        b["name"],
            "emoji":       b["emoji"],
            "category":    b["category"],
            "description": b["description"],
            "xp":          b.get("xp", 0),
            "earned":      already or now_earned,
            "earned_at":   earned_map.get(b["id"]),
            "progress":    prog,
        })

    if to_insert:
        try:
            sb.table("user_badges").upsert(to_insert, on_conflict="user_id,badge_id").execute()
        except Exception:
            pass

    earned_xp = sum(x["xp"] for x in out if x["earned"])
    newly_xp  = sum(x["xp"] for x in out if x["id"] in newly)

    return {
        "badges":         out,
        "earned_count":   sum(1 for x in out if x["earned"]),
        "total":          len(BADGES),
        "newly_unlocked": newly,
        "xp":             earned_xp,
        "newly_xp":       newly_xp,
        "level":          _level_info(earned_xp),
    }
