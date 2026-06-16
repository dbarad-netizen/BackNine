"""
Weekly Leagues — Duolingo-style auto-grouped competition for BackNine.

Every Mon–Sun week, each user is placed into the league at their tier (V1: tier
1 for everyone — no promotion yet). Leagues fill organically as users hit
/api/leagues/current during the week.

Ranking is by ENGAGEMENT POINTS, not steps — so it works for every user, not
just those with a wearable (Apple Health was never wired up, and not everyone
has Oura). Points reward the daily habits we want:

  • Daily check-in        +10  per day
  • Logged a workout      +20  for the first workout each day
                          +5   for the 2nd and 3rd workouts that day (cap)
                              → max 30 pts/day, 4th+ workouts don't score
  • Logged a meal          +5  per day with ≥1 meal
  • Logged a weigh-in      +5  per day with a weigh-in
  • Goal pace             +15  if active goal AND on/ahead of pace this week
                          +5   if active goal but behind pace (trying credit)
                              → one shot per week, requires goal to have
                              been active ≥4 of 7 days (activation guard)
  • Steps (tracker bonus)  +1  per 1,000 steps that week (Oura)

The workout tier rewards people who actually train hard (lifting + cardio
on the same day) without letting someone game the league by logging
"walk to the kitchen" eight times. The goal-pace bonus pulls the league
toward OUTCOMES not just activity — derived from the existing pace calc,
no self-reporting involved.

This gives even a user with zero friends and no wearable a live, refreshing
race — the cold-start fix for community.

Schema: supabase_leagues.sql (leagues + league_members).

This module is a thin Supabase wrapper. Callers (main.py) handle auth.
"""

import os
from datetime import date, timedelta

import goals as gl


TIER_NAMES = {1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum", 5: "Diamond", 6: "Legend"}


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


# ── League + membership upserts ───────────────────────────────────────────────

def _get_or_create_league(sb, tier: int, week_start: str, week_end: str) -> dict:
    res = sb.table("leagues").select("*").eq("tier", tier).eq("week_start", week_start).execute()
    if res.data:
        return res.data[0]
    try:
        ins = sb.table("leagues").insert({
            "tier": tier, "week_start": week_start, "week_end": week_end,
        }).execute()
        if ins.data:
            return ins.data[0]
    except Exception:
        pass  # likely a race — another request created it; refetch below
    res2 = sb.table("leagues").select("*").eq("tier", tier).eq("week_start", week_start).execute()
    return (res2.data or [{}])[0]


def _ensure_member(sb, league_id: str, user_id: str) -> None:
    res = sb.table("league_members").select("id").eq("league_id", league_id).eq("user_id", user_id).execute()
    if res.data:
        return
    try:
        sb.table("league_members").insert({"league_id": league_id, "user_id": user_id}).execute()
    except Exception:
        pass  # unique violation on race is fine


# ── Names + scoring ───────────────────────────────────────────────────────────

def _names_for(sb, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    try:
        res = sb.table("user_profiles").select("user_id, name").in_("user_id", ids).execute()
        return {r["user_id"]: ((r.get("name") or "").strip() or "Friend") for r in (res.data or [])}
    except Exception:
        return {}


# Engagement point values (see module docstring).
PTS_CHECKIN          = 10   # per day checked in
PTS_WORKOUT_FIRST    = 20   # first workout of the day
PTS_WORKOUT_EXTRA    = 5    # 2nd and 3rd workout the same day
WORKOUT_DAILY_CAP    = 3    # 4th+ workouts that day don't score
PTS_MEAL             = 5    # per day with ≥1 meal logged
PTS_WEIGHIN          = 5    # per day with a weigh-in (lowered from 10 — weigh-ins are
                            # quick to do; keeping scoring fair vs higher-effort actions
                            # like a workout or meal log)
PTS_PER_KSTEP        = 1    # per 1,000 steps that week (Oura tracker bonus)
PTS_GOAL_PACE_ON     = 15   # active goal on or ahead of pace (the win bucket)
PTS_GOAL_PACE_TRY    = 5    # active goal but behind / just-starting (trying credit)
GOAL_ACTIVATION_DAYS = 4    # goal must have been active ≥4/7 days this week

# Single source of truth for scoring categories. `map_key` is the key in the
# `_weekly_maps` dict; `key` is the public id used by the frontend grid. Order
# here is the column order shown in the "How scoring works" panel.
#
# Workouts use a TIERED formula: first/day = PTS_WORKOUT_FIRST, additional
# workouts that day (up to cap) = PTS_WORKOUT_EXTRA each. The category row
# carries a `tier` payload the frontend uses to render the rule clearly.
#
# Goal pace doesn't multiply count × per — it's a one-shot per-week bonus
# whose value depends on the user's pace status. The `tier` payload here is
# repurposed to carry the "trying" amount so the frontend can render the
# full rule ("+15 on pace · +5 behind"). The `per` is the on-pace number.
CATEGORIES = [
    {"key": "checkin",   "map_key": "checkins",  "label": "Daily check-in", "icon": "✅", "per": PTS_CHECKIN,        "per_unit": "day"},
    {"key": "workout",   "map_key": "workouts",  "label": "Workouts",       "icon": "💪", "per": PTS_WORKOUT_FIRST,  "per_unit": "first/day",
     "tier": {"extra_per": PTS_WORKOUT_EXTRA, "max_per_day": WORKOUT_DAILY_CAP}},
    {"key": "meal",      "map_key": "meals",     "label": "Log a meal",     "icon": "🍳", "per": PTS_MEAL,           "per_unit": "day"},
    {"key": "weighin",   "map_key": "weighins",  "label": "Log a weigh-in", "icon": "⚖️", "per": PTS_WEIGHIN,        "per_unit": "day"},
    {"key": "goal_pace", "map_key": "goal_pace", "label": "Goal pace",      "icon": "🎯", "per": PTS_GOAL_PACE_ON,   "per_unit": "week",
     "tier": {"behind_pts": PTS_GOAL_PACE_TRY}},
    {"key": "steps",     "map_key": "steps",     "label": "Steps (Oura)",   "icon": "👟", "per": PTS_PER_KSTEP,      "per_unit": "1k steps"},
]

# Column metadata for the frontend (no internal map_key). Include `tier` when
# the category has a tiered-points payload (currently just workouts) so the
# "How scoring works" panel can render the full rule.
def _meta_for(c: dict) -> dict:
    out = {k: c[k] for k in ("key", "label", "icon", "per", "per_unit")}
    if "tier" in c:
        out["tier"] = c["tier"]
    return out

CATEGORY_META = [_meta_for(c) for c in CATEGORIES]


def _distinct_dates_by_user(sb, table: str, ids: list[str], start: str, end: str) -> dict[str, set]:
    """Map user_id -> set of distinct dates with ≥1 row in `table` over the week."""
    out: dict[str, set] = {}
    try:
        res = (
            sb.table(table)
            .select("user_id, date")
            .in_("user_id", ids)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        for r in (res.data or []):
            out.setdefault(r["user_id"], set()).add(str(r["date"]))
    except Exception:
        pass
    return out


def _workout_counts_by_user_date(sb, ids: list[str], start: str, end: str) -> dict[str, dict[str, int]]:
    """Map user_id -> {date: workout_count} over the week.

    Used instead of `_distinct_dates_by_user("training_workouts", …)` so the
    tiered points formula can give credit for the 2nd/3rd workout the same
    day. We still cap at WORKOUT_DAILY_CAP downstream.
    """
    out: dict[str, dict[str, int]] = {}
    try:
        res = (
            sb.table("training_workouts")
            .select("user_id, date")
            .in_("user_id", ids)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        for r in (res.data or []):
            uid = r["user_id"]
            d = str(r["date"])
            out.setdefault(uid, {})[d] = out.setdefault(uid, {}).get(d, 0) + 1
    except Exception:
        pass
    return out


def _workout_points_for(per_date_counts: dict[str, int]) -> int:
    """Apply the tiered workout formula: first workout/day = PTS_WORKOUT_FIRST,
    next (WORKOUT_DAILY_CAP - 1) extras = PTS_WORKOUT_EXTRA each, 4th+ = 0."""
    total = 0
    for _date, n in (per_date_counts or {}).items():
        if n <= 0:
            continue
        total += PTS_WORKOUT_FIRST
        extras = min(n - 1, WORKOUT_DAILY_CAP - 1)
        if extras > 0:
            total += extras * PTS_WORKOUT_EXTRA
    return total


def _workout_scoring_sessions(per_date_counts: dict[str, int]) -> int:
    """How many workouts actually scored this week — capped at the daily limit.
    Shown as the "count" in the breakdown grid so users see why their points
    moved (e.g. 4 sessions this week = 1 day of 2 + 1 day of 1 + 1 day of 1)."""
    return sum(min(n, WORKOUT_DAILY_CAP) for n in (per_date_counts or {}).values() if n > 0)


def _weekly_steps_total(sb, ids: list[str], start: str, end: str) -> dict[str, int]:
    """Total Oura steps per user over the week (tracker bonus only — Apple
    Health is not wired up, so non-tracker users simply skip this bonus)."""
    totals: dict[str, int] = {}
    try:
        res = (
            sb.table("oura_daily_cache")
            .select("user_id, date, activity")
            .in_("user_id", ids)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        for r in (res.data or []):
            uid = r["user_id"]
            steps = ((r.get("activity") or {}).get("steps")) or 0
            totals[uid] = totals.get(uid, 0) + int(steps or 0)
    except Exception:
        pass
    return totals


def _weekly_maps(sb, ids: list[str], start: str, end: str, today_iso: str = "") -> dict[str, dict]:
    """Raw per-user activity maps used for scoring (six batched reads now).
    Workouts map is {user_id: {date: count}} so the tiered formula can credit
    multi-workout days; other habits stay distinct-dates. Goal pace is a
    pre-computed {user_id: pts} map (5 or 15) keyed on the week's pace status.

    `today_iso` is the device-local "today" used for the goal-pace calc — pace
    is computed *as of today*, not as of `end` (which could be in the future
    if it's still mid-week). Falls back to `end` for callers that haven't
    been updated yet."""
    return {
        "checkins":  _distinct_dates_by_user(sb, "daily_checkins",   ids, start, end),
        "workouts":  _workout_counts_by_user_date(sb,                 ids, start, end),
        "meals":     _distinct_dates_by_user(sb, "nutrition_meals",  ids, start, end),
        "weighins":  _distinct_dates_by_user(sb, "nutrition_weight", ids, start, end),
        "steps":     _weekly_steps_total(sb,                          ids, start, end),
        "goal_pace": gl.pace_points_for_users(
            ids, start, today_iso or end, min_active_days=GOAL_ACTIVATION_DAYS,
        ),
    }


def _counts_by_cat(maps: dict, uid: str) -> dict[str, int]:
    """How many scoring units the user earned in each category this week.
    Habits = distinct days; steps = whole-thousands; workouts = total scoring
    sessions across the week (capped per day) so the breakdown grid surfaces
    the multi-workout days correctly. Goal pace = 1 if the user got the
    bonus this week (any value > 0), else 0 — surfaces as a binary mark in
    the grid rather than a misleading number."""
    out: dict[str, int] = {}
    for c in CATEGORIES:
        key = c["key"]
        if key == "workout":
            out[key] = _workout_scoring_sessions(maps.get("workouts", {}).get(uid, {}))
        elif key == "steps":
            out[key] = int(maps.get("steps", {}).get(uid, 0)) // 1000
        elif key == "goal_pace":
            out[key] = 1 if (maps.get("goal_pace", {}).get(uid, 0) > 0) else 0
        else:
            out[key] = len(maps.get(c["map_key"], {}).get(uid, set()))
    return out


def _points_by_cat(maps: dict, uid: str) -> dict[str, int]:
    """Points earned in each category — used for the per-member comparison grid.
    Workouts get the tiered formula; goal pace is precomputed in the map
    (5 or 15 directly); everything else is count × per."""
    counts = _counts_by_cat(maps, uid)
    out: dict[str, int] = {}
    for c in CATEGORIES:
        key = c["key"]
        if key == "workout":
            out[key] = _workout_points_for(maps.get("workouts", {}).get(uid, {}))
        elif key == "goal_pace":
            out[key] = int(maps.get("goal_pace", {}).get(uid, 0))
        else:
            out[key] = counts[key] * c["per"]
    return out


def _score_from_maps(maps: dict, uid: str) -> int:
    return int(sum(_points_by_cat(maps, uid).values()))


def _breakdown_from_maps(maps: dict, uid: str) -> dict:
    """Per-category point breakdown for one user — same numbers that sum to the
    user's league score, so the 'How scoring works' panel always reconciles.
    Workouts + goal_pace bypass count×per math (tiered + status-based)."""
    counts = _counts_by_cat(maps, uid)
    pts    = _points_by_cat(maps, uid)
    items = []
    for c in CATEGORIES:
        key = c["key"]
        item = {**{k: c[k] for k in ("key", "label", "icon", "per", "per_unit")},
                "count": counts[key], "points": pts[key]}
        if "tier" in c:
            item["tier"] = c["tier"]
        items.append(item)
    return {"items": items, "total": sum(i["points"] for i in items)}


def _weekly_scores(sb, ids: list[str], start: str, end: str, today_iso: str = "") -> dict[str, int]:
    """Engagement points per user from `start`..`end` (inclusive). Works for
    everyone regardless of wearable; six batched reads now. `today_iso` is
    used for the goal-pace calc (defaults to `end` if not supplied)."""
    if not ids:
        return {}
    maps = _weekly_maps(sb, ids, start, end, today_iso=today_iso or end)
    return {uid: _score_from_maps(maps, uid) for uid in ids}


# ── Main entry point ──────────────────────────────────────────────────────────

def weekly_points(user_ids: list[str], today_str: str) -> dict[str, int]:
    """Engagement points for each user for the current Mon–Sun week.

    Public helper so other surfaces (e.g. the friend leaderboard) can rank by
    the same inclusive metric Leagues use.
    """
    if not user_ids:
        return {}
    today = date.fromisoformat(today_str)
    monday = today - timedelta(days=today.weekday())
    try:
        return _weekly_scores(_sb(), list(user_ids), monday.isoformat(), today_str, today_iso=today_str)
    except Exception:
        return {}


def get_current_league(user_id: str, today_str: str, tier: int = 1) -> dict:
    """Join (or fetch) the user's current-week league and return live standings."""
    sb = _sb()
    today = date.fromisoformat(today_str)
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    week_start, week_end = monday.isoformat(), sunday.isoformat()

    league = _get_or_create_league(sb, tier, week_start, week_end)
    league_id = league.get("id")
    if not league_id:
        return {"league": None, "standings": [], "me_rank": None, "days_left": None, "member_count": 0, "my_breakdown": None, "categories": CATEGORY_META}

    _ensure_member(sb, league_id, user_id)

    res = sb.table("league_members").select("user_id").eq("league_id", league_id).execute()
    ids = [r["user_id"] for r in (res.data or [])]
    if user_id not in ids:
        ids.append(user_id)

    maps = _weekly_maps(sb, ids, week_start, today_str, today_iso=today_str)
    scores = {uid: _score_from_maps(maps, uid) for uid in ids}
    my_breakdown = _breakdown_from_maps(maps, user_id)
    names = _names_for(sb, ids)
    # Achievement level per member — a status chip next to each name.
    try:
        import achievements as _ach
        levels = _ach.levels_for(ids)
    except Exception:
        levels = {}

    # Refresh cached scores (best-effort) so other surfaces can read them cheaply.
    for uid in ids:
        try:
            sb.table("league_members").update({"weekly_score": scores.get(uid, 0)}) \
                .eq("league_id", league_id).eq("user_id", uid).execute()
        except Exception:
            pass

    standings = [
        {
            "user_id": uid,
            "name":    names.get(uid, "Friend"),
            "score":   scores.get(uid, 0),
            "is_me":   uid == user_id,
            "level":   (levels.get(uid) or {}).get("level"),
            "points_by_cat": _points_by_cat(maps, uid),
        }
        for uid in ids
    ]
    standings.sort(key=lambda s: (-s["score"], s["name"].lower()))
    for i, s in enumerate(standings):
        s["rank"] = i + 1

    me_rank = next((s["rank"] for s in standings if s["is_me"]), None)
    days_left = max(0, (sunday - today).days)

    return {
        "league": {
            "tier":       tier,
            "tier_name":  TIER_NAMES.get(tier, "Bronze"),
            "week_start": week_start,
            "week_end":   week_end,
        },
        "standings":    standings,
        "me_rank":      me_rank,
        "days_left":    days_left,
        "member_count": len(standings),
        "my_breakdown": my_breakdown,
        "categories":   CATEGORY_META,
    }
