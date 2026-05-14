"""
Coach Al's proactive observations.

Where chat.py answers questions on demand and briefing.py writes a daily
synthesis, this module spots high-signal patterns in the user's data and
generates short, Coach-Al-voiced notes that surface inside the chat drawer.

The dashboard calls `generate_and_upsert(user_id)` on each load. The function:
  1. Pulls the user's recent metrics from Supabase
  2. Runs each detector (hrv_drop, prediction_streak, top_insight, ...)
  3. Upserts the results, dedup'd by (user_id, kind, date)

Frontend reads from /api/observations, opens the chat drawer with the freshest
unread observation as Coach Al's opening message.

Adding a new observation type is a one-function change here — no schema work,
since `kind` is just a string and payload is JSONB.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Optional


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb():
    """Return a Supabase client. Lazily imported to match the rest of the backend."""
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


def _today_str() -> str:
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # type: ignore
    return datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()


# ── Detectors ─────────────────────────────────────────────────────────────────
#
# Each detector returns either None (no observation today) or a dict with the
# required fields: { kind, date, message, payload }. The caller upserts these
# with dedup on (user_id, kind, date).
#
# `kind` should be stable across days for the same type of observation so the
# unique constraint can do its job. For streak milestones we encode the
# threshold into the kind (e.g. prediction_streak_5) so different milestones
# don't dedup against each other.


def detect_hrv_drop(smm: dict, today: str) -> Optional[dict]:
    """Today's HRV is significantly below the 7-day rolling average."""
    recent = sorted(smm.keys(), reverse=True)
    if not recent or today not in smm:
        return None
    today_hrv = smm[today].get("hrv")
    if not today_hrv:
        return None
    # Average of the prior 6 days, excluding today.
    prior = [smm[d]["hrv"] for d in recent[1:7] if smm[d].get("hrv")]
    if len(prior) < 3:
        return None
    baseline = sum(prior) / len(prior)
    delta_pct = (today_hrv - baseline) / baseline * 100
    if delta_pct >= -10:
        return None  # not a meaningful drop
    delta_str = f"{abs(round(delta_pct))}%"
    return {
        "kind":    "hrv_drop",
        "date":    today,
        "message": (
            f"Heads up — your HRV today is {today_hrv}ms, about {delta_str} "
            f"below your 7-day average ({round(baseline)}ms). Could be sleep, "
            f"late alcohol, stress, or something coming on. Want to talk through "
            f"what might have driven it?"
        ),
        "payload": {
            "today_hrv":     today_hrv,
            "baseline_hrv":  round(baseline, 1),
            "delta_pct":     round(delta_pct, 1),
        },
    }


def detect_prediction_streak(prediction_accuracy: dict, today: str) -> Optional[dict]:
    """The user has hit a meaningful prediction streak milestone."""
    streak = prediction_accuracy.get("streak") or 0
    milestones = {3, 5, 7, 14, 30, 60, 100}
    if streak not in milestones:
        return None
    # Encode the milestone in kind so 5-day and 7-day milestones are distinct rows.
    flavor = {
        3:   "You read your body well — three nights in a row.",
        5:   "Five-day prediction streak. You're tuned in to your own rhythm.",
        7:   "A full week of accurate forecasts. That's real self-awareness.",
        14:  "Two weeks of nailed predictions. Most people couldn't do this for two days.",
        30:  "Thirty straight. You know yourself.",
        60:  "Sixty in a row — this is genuinely uncommon.",
        100: "One hundred. I'm not even sure what to say. Respect.",
    }
    return {
        "kind":    f"prediction_streak_{streak}",
        "date":    today,
        "message": flavor[streak] + " Want to talk about what's been driving the consistency?",
        "payload": {"streak": streak},
    }


def detect_top_insight(insights: list[dict], today: str) -> Optional[dict]:
    """The strongest cross-source correlation, if it's actually strong (|r| > 0.5)."""
    if not insights:
        return None
    ranked = sorted(insights, key=lambda x: abs(x.get("r") or 0), reverse=True)
    top = ranked[0]
    r = top.get("r") or 0
    if abs(r) < 0.5:
        return None
    title   = top.get("title")   or "Pattern noticed"
    finding = top.get("finding") or ""
    detail  = top.get("detail")  or ""
    return {
        "kind":    f"insight_{top.get('id', 'top')}",
        "date":    today,
        "message": (
            f"Pattern I'm noticing: {finding} "
            f"{('— ' + detail) if detail else ''} "
            f"Want to dig into this together?"
        ).strip(),
        "payload": {"insight": top},
    }


# ── Orchestration ─────────────────────────────────────────────────────────────

def generate_and_upsert(
    user_id: str,
    *,
    smm: dict,
    prediction_accuracy: dict,
    insights: Optional[list[dict]] = None,
    today: Optional[str] = None,
) -> list[dict]:
    """
    Run all detectors and upsert any new observations. Returns the list of
    observations that were either freshly written or already existed for today.

    Best-effort — caller wraps in try/except so a Supabase blip never blocks
    the dashboard render that triggered this.
    """
    today = today or _today_str()
    candidates: list[dict] = []

    for fn, args in (
        (detect_hrv_drop,           (smm, today)),
        (detect_prediction_streak,  (prediction_accuracy, today)),
        (detect_top_insight,        (insights or [], today)),
    ):
        try:
            obs = fn(*args)
            if obs:
                candidates.append(obs)
        except Exception:
            continue

    if not candidates:
        return []

    sb = _sb()
    written: list[dict] = []
    for obs in candidates:
        try:
            row = {
                "user_id":  user_id,
                "kind":     obs["kind"],
                "date":     obs["date"],
                "message":  obs["message"],
                "payload":  obs.get("payload") or {},
            }
            # Upsert with ON CONFLICT DO NOTHING semantics: we only want to
            # insert if (user_id, kind, date) doesn't already exist. The
            # unique constraint handles this; ignore_duplicates=True keeps
            # the existing row's read/dismissed state intact.
            sb.table("coach_observations").upsert(
                row,
                on_conflict="user_id,kind,date",
                ignore_duplicates=True,
            ).execute()
            written.append(obs)
        except Exception:
            continue
    return written


# ── Read-side helpers ─────────────────────────────────────────────────────────

def list_observations(user_id: str, limit: int = 20, include_dismissed: bool = False) -> list[dict]:
    """Return recent observations, unread/active first."""
    sb = _sb()
    q = (
        sb.table("coach_observations")
        .select("id, kind, date, message, payload, read, dismissed, created_at")
        .eq("user_id", user_id)
    )
    if not include_dismissed:
        q = q.eq("dismissed", False)
    res = q.order("read", desc=False).order("created_at", desc=True).limit(limit).execute()
    return res.data or []


def mark_read(user_id: str, observation_id: str) -> dict:
    sb = _sb()
    sb.table("coach_observations").update({"read": True}).eq(
        "id", observation_id
    ).eq("user_id", user_id).execute()
    return {"ok": True, "id": observation_id}


def dismiss(user_id: str, observation_id: str) -> dict:
    sb = _sb()
    sb.table("coach_observations").update({"dismissed": True, "read": True}).eq(
        "id", observation_id
    ).eq("user_id", user_id).execute()
    return {"ok": True, "id": observation_id}


def unread_count(user_id: str) -> int:
    sb = _sb()
    try:
        res = (
            sb.table("coach_observations")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("read", False)
            .eq("dismissed", False)
            .execute()
        )
        return res.count or 0
    except Exception:
        return 0
