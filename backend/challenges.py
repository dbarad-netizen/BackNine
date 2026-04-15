"""
Challenges module — friend vs. friend fitness challenges synced via Supabase.
Each BackNine install gets a persistent local user_id (UUID) stored in
~/.backnine/user_id.  That ID is what appears on the leaderboard.
"""

import json
import random
import string
import uuid
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

DATA_DIR    = Path.home() / ".backnine"
USER_ID_FILE = DATA_DIR / "user_id"

CHALLENGE_TYPES = {
    "steps":    {"label": "Daily Steps",       "unit": "steps",   "icon": "👟"},
    "calories": {"label": "Calorie Target",    "unit": "kcal",    "icon": "🔥"},
    "protein":  {"label": "Protein Target",    "unit": "g",       "icon": "💪"},
    "custom":   {"label": "Custom Goal",       "unit": "pts",     "icon": "🎯"},
}


# ── Local user identity ────────────────────────────────────────────────────────

def get_local_user_id() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if USER_ID_FILE.exists():
        uid = USER_ID_FILE.read_text().strip()
        if uid:
            return uid
    uid = str(uuid.uuid4())
    USER_ID_FILE.write_text(uid)
    return uid


def _short_id(length: int = 6) -> str:
    """Generate a human-friendly uppercase challenge code."""
    chars = string.ascii_uppercase + string.digits
    # Remove ambiguous characters
    chars = chars.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(random.choices(chars, k=length))


# ── Supabase helpers ───────────────────────────────────────────────────────────

def _sb():
    """Return Supabase client (imported lazily to avoid circular imports)."""
    import os
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


# ── Challenge CRUD ─────────────────────────────────────────────────────────────

def create_challenge(
    name: str,
    challenge_type: str,
    target: float,
    duration_days: int,
    creator_name: str,
    user_id: Optional[str] = None,
    custom_unit: Optional[str] = None,
) -> dict:
    user_id = user_id or get_local_user_id()
    today      = date.today()
    start_date = today.isoformat()
    end_date   = (today + timedelta(days=duration_days - 1)).isoformat()
    cid        = _short_id()

    type_info = CHALLENGE_TYPES.get(challenge_type, CHALLENGE_TYPES["custom"])
    metric    = custom_unit if (challenge_type == "custom" and custom_unit) else type_info["unit"]

    sb = _sb()
    # Insert challenge
    sb.table("challenges").insert({
        "id": cid, "name": name, "type": challenge_type,
        "metric": metric, "target": target,
        "duration_days": duration_days,
        "start_date": start_date, "end_date": end_date,
        "creator_id": user_id, "creator_name": creator_name,
    }).execute()

    # Auto-join creator
    sb.table("challenge_participants").insert({
        "challenge_id": cid, "user_id": user_id, "display_name": creator_name,
    }).execute()

    return get_challenge(cid, user_id)


def join_challenge(challenge_id: str, display_name: str, user_id: Optional[str] = None) -> dict:
    user_id = user_id or get_local_user_id()
    sb = _sb()
    # Upsert participant (idempotent if already joined)
    sb.table("challenge_participants").upsert({
        "challenge_id": challenge_id.upper(),
        "user_id": user_id,
        "display_name": display_name,
    }, on_conflict="challenge_id,user_id").execute()
    return get_challenge(challenge_id.upper(), user_id)


def get_challenge(challenge_id: str, user_id: Optional[str] = None) -> dict:
    if user_id is None:
        user_id = get_local_user_id()
    sb = _sb()

    # Challenge metadata
    res = sb.table("challenges").select("*").eq("id", challenge_id).single().execute()
    challenge = res.data
    if not challenge:
        raise ValueError(f"Challenge {challenge_id} not found")

    # Participants
    parts = sb.table("challenge_participants").select("*").eq("challenge_id", challenge_id).execute()
    participants = parts.data or []

    # Progress for all participants
    prog = sb.table("challenge_progress").select("*").eq("challenge_id", challenge_id).execute()
    progress_rows = prog.data or []

    today_str = date.today().isoformat()
    start     = date.fromisoformat(challenge["start_date"])
    end_d     = date.fromisoformat(challenge["end_date"])
    total_days = challenge["duration_days"]
    elapsed    = max(0, (date.today() - start).days + 1)
    days_left  = max(0, (end_d - date.today()).days)

    # Build per-participant summary
    participant_summaries = []
    for p in participants:
        uid  = p["user_id"]
        rows = [r for r in progress_rows if r["user_id"] == uid]
        daily = {r["date"]: float(r["value"]) for r in rows}

        total_value   = sum(daily.values())
        days_hit      = sum(1 for v in daily.values() if v >= challenge["target"])
        today_value   = daily.get(today_str, 0.0)
        streak        = _calc_streak(daily, today_str)

        participant_summaries.append({
            "user_id":      uid,
            "display_name": p["display_name"],
            "is_me":        uid == user_id,
            "total_value":  round(total_value, 1),
            "days_hit":     days_hit,
            "today_value":  round(today_value, 1),
            "streak":       streak,
            "daily":        daily,
        })

    # Sort: days_hit desc, then total_value desc
    participant_summaries.sort(key=lambda x: (-x["days_hit"], -x["total_value"]))

    return {
        **challenge,
        "elapsed_days": elapsed,
        "days_left":    days_left,
        "total_days":   total_days,
        "is_active":    date.today() <= end_d,
        "is_mine":      challenge["creator_id"] == user_id,
        "participants": participant_summaries,
        "type_info":    CHALLENGE_TYPES.get(challenge["type"], CHALLENGE_TYPES["custom"]),
    }


def list_my_challenges(user_id: Optional[str] = None) -> List[dict]:
    user_id = user_id or get_local_user_id()
    sb = _sb()
    # Get all challenge_ids the user participates in
    res = sb.table("challenge_participants").select("challenge_id").eq("user_id", user_id).execute()
    ids = [r["challenge_id"] for r in (res.data or [])]
    if not ids:
        return []
    result = []
    for cid in ids:
        try:
            result.append(get_challenge(cid, user_id))
        except Exception:
            pass
    return sorted(result, key=lambda x: x["start_date"], reverse=True)


def log_progress(challenge_id: str, value: float, for_date: Optional[str] = None, user_id: Optional[str] = None) -> dict:
    user_id  = user_id or get_local_user_id()
    date_str = for_date or date.today().isoformat()
    sb = _sb()
    sb.table("challenge_progress").upsert({
        "challenge_id": challenge_id,
        "user_id":      user_id,
        "date":         date_str,
        "value":        value,
        "updated_at":   datetime.now().isoformat(),
    }, on_conflict="challenge_id,user_id,date").execute()
    return get_challenge(challenge_id, user_id)


def _calc_streak(daily: Dict[str, float], today_str: str) -> int:
    """Count consecutive days ending today (or yesterday) where value > 0."""
    streak = 0
    d = date.fromisoformat(today_str)
    while True:
        ds = d.isoformat()
        if daily.get(ds, 0) > 0:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak
