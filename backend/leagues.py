"""
Weekly Leagues — Duolingo-style auto-grouped competition for BackNine.

Every Mon–Sun week, each user is placed into the league at their tier (V1: tier
1 for everyone — no promotion yet). Leagues fill organically as users hit
/api/leagues/current during the week.

Ranking is by ENGAGEMENT POINTS, not steps — so it works for every user, not
just those with a wearable (Apple Health was never wired up, and not everyone
has Oura). Points reward the daily habits we want:

  • Daily check-in        +10  per day
  • Logged a workout      +20  per day with ≥1 workout
  • Logged a meal          +5  per day with ≥1 meal
  • Logged a weigh-in     +10  per day with a weigh-in
  • Steps (tracker bonus)  +1  per 1,000 steps that week (Oura)

This gives even a user with zero friends and no wearable a live, refreshing
race — the cold-start fix for community.

Schema: supabase_leagues.sql (leagues + league_members).

This module is a thin Supabase wrapper. Callers (main.py) handle auth.
"""

import os
from datetime import date, timedelta


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
PTS_CHECKIN   = 10   # per day checked in
PTS_WORKOUT   = 20   # per day with ≥1 workout
PTS_MEAL      = 5    # per day with ≥1 meal logged
PTS_WEIGHIN   = 10   # per day with a weigh-in
PTS_PER_KSTEP = 1    # per 1,000 steps that week (Oura tracker bonus)


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


def _weekly_scores(sb, ids: list[str], start: str, end: str) -> dict[str, int]:
    """Engagement points per user from `start`..`end` (inclusive). Works for
    everyone regardless of wearable; five batched queries total."""
    if not ids:
        return {}

    checkins = _distinct_dates_by_user(sb, "daily_checkins",    ids, start, end)
    workouts = _distinct_dates_by_user(sb, "training_workouts", ids, start, end)
    meals    = _distinct_dates_by_user(sb, "nutrition_meals",   ids, start, end)
    weighins = _distinct_dates_by_user(sb, "nutrition_weight",  ids, start, end)
    steps    = _weekly_steps_total(sb, ids, start, end)

    out: dict[str, int] = {}
    for uid in ids:
        pts = (
            len(checkins.get(uid, set())) * PTS_CHECKIN
            + len(workouts.get(uid, set())) * PTS_WORKOUT
            + len(meals.get(uid, set()))    * PTS_MEAL
            + len(weighins.get(uid, set())) * PTS_WEIGHIN
            + (steps.get(uid, 0) // 1000)   * PTS_PER_KSTEP
        )
        out[uid] = int(pts)
    return out


# ── Main entry point ──────────────────────────────────────────────────────────

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
        return {"league": None, "standings": [], "me_rank": None, "days_left": None, "member_count": 0}

    _ensure_member(sb, league_id, user_id)

    res = sb.table("league_members").select("user_id").eq("league_id", league_id).execute()
    ids = [r["user_id"] for r in (res.data or [])]
    if user_id not in ids:
        ids.append(user_id)

    scores = _weekly_scores(sb, ids, week_start, today_str)
    names = _names_for(sb, ids)

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
    }
