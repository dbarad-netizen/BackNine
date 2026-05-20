"""
Weekly Leagues — Duolingo-style auto-grouped competition for BackNine.

Every Mon–Sun week, each user is placed into the league at their tier (V1: tier
1 for everyone — no promotion yet). Leagues fill organically as users hit
/api/leagues/current during the week; ranking is by total steps summed across
the week. This gives even a user with zero friends a live, refreshing race —
the cold-start fix for community.

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


def _weekly_steps(sb, ids: list[str], start: str, end: str) -> dict[str, int]:
    """Total steps per user from `start`..`end` (inclusive). Prefers Apple Health
    steps for a given day, falling back to Oura — same precedence as the
    friend leaderboard. Two batched queries regardless of member count."""
    if not ids:
        return {}

    oura: dict[str, dict[str, int]] = {}
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
            oura.setdefault(uid, {})[str(r["date"])] = int(steps or 0)
    except Exception:
        pass

    ah: dict[str, dict[str, int]] = {}
    try:
        res2 = (
            sb.table("apple_health_daily")
            .select("user_id, date, steps")
            .in_("user_id", ids)
            .gte("date", start)
            .lte("date", end)
            .execute()
        )
        for r in (res2.data or []):
            uid = r["user_id"]
            ah.setdefault(uid, {})[str(r["date"])] = int(r.get("steps") or 0)
    except Exception:
        pass

    totals: dict[str, int] = {}
    for uid in ids:
        days = set(list(oura.get(uid, {}).keys()) + list(ah.get(uid, {}).keys()))
        tot = 0
        for d in days:
            a = ah.get(uid, {}).get(d)
            o = oura.get(uid, {}).get(d)
            tot += (a if a else (o or 0))
        totals[uid] = int(tot)
    return totals


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

    scores = _weekly_steps(sb, ids, week_start, today_str)
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
