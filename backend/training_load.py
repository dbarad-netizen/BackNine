"""
Training-load aggregator.

Two related lenses on the user's recent training:

  • weekly_volume: 12 ISO-weeks of strength sessions, cardio minutes, and
    lifting volume. Powers the weekly-volume sparkline card on the Training
    tab — answers "am I trending up or down on training load?"
  • deload_recommendation: a small rules-driven trigger that surfaces a
    "consider a deload" prompt when recent volume is climbing while Oura
    readiness / HRV are sliding. Conservative on purpose — only fires when
    BOTH a load spike AND a recovery dip are present.

Both lenses share the same underlying training_workouts pull, so we expose
one combined endpoint and let the frontend pick what to render.

The math is rough on purpose. We're not trying to write a periodization
engine — we're trying to give a 50+ year-old guy who isn't paying a coach a
sensible visual nudge when his data says "you've been redlining".
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────────

# Number of weeks of training to bucket into the sparkline.
WEEKS_BACK = 12

# Deload triggers: BOTH must be true.
#   • Volume in the last 7d is at least this much higher than the prior
#     7-day average of the preceding 4 weeks.
VOLUME_SPIKE_PCT     = 0.25
#   • Average Oura HRV in the last 7d is at least this much lower than
#     the prior 14-day average.
HRV_DIP_PCT          = 0.08
# Need at least this many sessions in the last 7d to call it a spike (avoids
# a one-off heavy day after a long break tripping the trigger).
MIN_RECENT_SESSIONS  = 3


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _iso_week(date_iso: str) -> tuple[int, int]:
    try:
        d = datetime.strptime(date_iso, "%Y-%m-%d").date()
        y, w, _ = d.isocalendar()
        return (y, w)
    except Exception:
        return (0, 0)


def _week_label(y: int, w: int) -> str:
    """Short label like 'Jun 17' (Monday of that ISO week) for the sparkline
    x-axis. Lighter than 'W23-2026' for a tiny card."""
    if y == 0:
        return ""
    try:
        jan4 = _date(y, 1, 4)
        # Monday of week 1 contains jan4.
        week_start = jan4 + timedelta(days=-jan4.isoweekday() + 1 + (w - 1) * 7)
        return week_start.strftime("%b %-d")
    except Exception:
        return ""


def _fetch_workouts(user_id: str, days: int) -> list[dict]:
    sb = _sb()
    if not sb:
        return []
    cutoff = (_date.today() - timedelta(days=days)).isoformat()
    try:
        res = (
            sb.table("training_workouts")
            .select("date, kind, type, duration_min, total_volume_lbs, muscle_groups")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .order("date", desc=False)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _weekly_volume(workouts: list[dict]) -> list[dict]:
    """Bucket workouts into the last WEEKS_BACK ISO weeks. Returns the
    full window padded with zeros so the sparkline always has WEEKS_BACK
    bars (no jagged drop-offs in weeks the user didn't train)."""
    today = _date.today()
    today_yw = today.isocalendar()[:2]

    # Build the ordered list of (year, week) we want to render, oldest first.
    week_list: list[tuple[int, int]] = []
    cur = today
    for i in range(WEEKS_BACK):
        d = today - timedelta(weeks=WEEKS_BACK - 1 - i)
        week_list.append(d.isocalendar()[:2])
        cur = d

    # De-dupe while preserving order (consecutive entries from isocalendar
    # can repeat at year boundaries — shouldn't here, but defensive).
    seen: set[tuple[int, int]] = set()
    ordered: list[tuple[int, int]] = []
    for yw in week_list:
        if yw not in seen:
            seen.add(yw)
            ordered.append(yw)

    buckets: dict[tuple[int, int], dict] = {
        yw: {"week": _week_label(*yw), "strength_sessions": 0,
             "cardio_sessions": 0, "cardio_min": 0, "volume_lbs": 0,
             "is_current": yw == today_yw}
        for yw in ordered
    }

    for w in workouts:
        yw = _iso_week(w.get("date") or "")
        if yw not in buckets:
            continue
        slot = buckets[yw]
        kind = (w.get("kind") or "").lower()
        if kind == "cardio":
            slot["cardio_sessions"] += 1
            slot["cardio_min"]      += int(w.get("duration_min") or 0)
        else:
            slot["strength_sessions"] += 1
            slot["volume_lbs"]        += int(w.get("total_volume_lbs") or 0)

    return [buckets[yw] for yw in ordered]


def _volume_change_pct(weekly: list[dict]) -> Optional[float]:
    """Last 7d strength session count vs. avg of the prior 4 weeks.
    Returns fractional change (e.g. 0.30 = +30%) or None if insufficient
    history."""
    if len(weekly) < 5:
        return None
    recent = weekly[-1]["strength_sessions"]
    prior  = weekly[-5:-1]  # 4 weeks before the current week
    prior_avg = sum(w["strength_sessions"] for w in prior) / 4.0
    if prior_avg <= 0:
        # If you weren't training and now you are, that's not a deload signal
        # — that's a comeback. Skip.
        return None
    return (recent - prior_avg) / prior_avg


def _hrv_change_pct(smm: dict) -> Optional[float]:
    """Avg HRV of the last 7d vs. the prior 14d. Returns fractional change
    (negative = dipped). None if not enough Oura history."""
    today = _date.today()
    recent_vals: list[int] = []
    prior_vals:  list[int] = []
    for offset in range(0, 7):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d)
        if row and row.get("hrv") is not None:
            recent_vals.append(int(row["hrv"]))
    for offset in range(7, 21):
        d = (today - timedelta(days=offset)).isoformat()
        row = smm.get(d)
        if row and row.get("hrv") is not None:
            prior_vals.append(int(row["hrv"]))
    if len(recent_vals) < 4 or len(prior_vals) < 7:
        return None
    recent_avg = sum(recent_vals) / len(recent_vals)
    prior_avg  = sum(prior_vals)  / len(prior_vals)
    if prior_avg <= 0:
        return None
    return (recent_avg - prior_avg) / prior_avg


def _deload_recommendation(weekly: list[dict], smm: dict) -> dict:
    """Rules-driven 'consider a deload' trigger. Conservative — fires only
    when load is up AND recovery is down. Default response when neither
    signal trips is a tame 'all clear'."""
    recent = weekly[-1]["strength_sessions"] if weekly else 0
    vol_change = _volume_change_pct(weekly)
    hrv_change = _hrv_change_pct(smm)

    triggered = (
        recent >= MIN_RECENT_SESSIONS
        and vol_change is not None
        and vol_change >= VOLUME_SPIKE_PCT
        and hrv_change is not None
        and hrv_change <= -HRV_DIP_PCT
    )

    reason_parts: list[str] = []
    if vol_change is not None and vol_change >= VOLUME_SPIKE_PCT:
        reason_parts.append(f"strength volume up {round(vol_change * 100)}% vs. prior 4-week avg")
    if hrv_change is not None and hrv_change <= -HRV_DIP_PCT:
        reason_parts.append(f"HRV down {round(abs(hrv_change) * 100)}% over the last 7 days")

    return {
        "triggered":            bool(triggered),
        "reason":               "; ".join(reason_parts) if reason_parts else None,
        "volume_change_pct":    round(vol_change * 100, 1) if vol_change is not None else None,
        "hrv_change_pct":       round(hrv_change * 100, 1) if hrv_change is not None else None,
        "recent_sessions":      recent,
        "suggestion":           (
            "Drop your top set weight by 10-15% this week, or take an extra "
            "rest day and reassess on Monday. Light cardio and mobility are fine."
            if triggered else None
        ),
    }


# ── muscle group balance ────────────────────────────────────────────────────

# Canonical muscle group buckets so we don't render a chaotic 30-group list.
# Maps incoming raw labels (from EXERCISES.primary) to display buckets.
#
# IMPORTANT: every distinct label that the EXERCISES catalog in training.py
# can emit MUST appear here, otherwise that exercise silently produces no
# muscle-group credit. This was the original bug — labels like front_delts,
# side_delts, rear_delts, upper_chest, brachialis, etc. existed in the
# catalog but never mapped into a display bucket, so OHPs, lateral raises,
# rear delt flies, and incline presses all looked invisible to the heatmap.
MUSCLE_BUCKETS: dict[str, str] = {
    # ── chest ──
    "chest":             "chest",
    "pectorals":         "chest",
    "pecs":              "chest",
    "upper_chest":       "chest",
    "lower_chest":       "chest",
    # ── back ──
    "back":              "back",
    "lats":              "back",
    "traps":             "back",
    "rhomboids":         "back",
    "upper_back":        "back",
    "mid_back":          "back",
    # ── shoulders ──
    "shoulders":         "shoulders",
    "deltoids":          "shoulders",
    "delts":             "shoulders",
    "front_delts":       "shoulders",
    "side_delts":        "shoulders",
    "rear_delts":        "shoulders",
    "external_rotators": "shoulders",
    "rotator_cuff":      "shoulders",
    # ── arms ──
    "biceps":            "arms",
    "triceps":           "arms",
    "forearms":          "arms",
    "brachialis":        "arms",
    "brachioradialis":   "arms",
    # ── core ──
    "abs":               "core",
    "obliques":          "core",
    "core":              "core",
    "lower_back":        "core",   # contested — bucket as "core" since it's posterior chain stabilizer
    "transverse_abdominis": "core",
    # ── legs ──
    "quads":             "legs",
    "quadriceps":        "legs",
    "hamstrings":        "legs",
    "glutes":            "legs",
    "calves":            "legs",
    "adductors":         "legs",
    "abductors":         "legs",
    "hip_flexors":       "legs",
    "hips":              "legs",
}
DISPLAY_GROUPS = ["chest", "back", "legs", "shoulders", "arms", "core"]

# Keyword → muscle-bucket map used to infer credit from a workout's notes,
# activity, type, or exercise name when the structured muscle_groups column
# is empty. Lets "upper body lifting", "push day", "bench press", etc. all
# light up the heatmap even when nothing matched the EXERCISES catalog.
# Match is substring-based so "incline bench" picks up via "bench".
NOTE_KEYWORD_TO_BUCKET: list[tuple[str, str]] = [
    # Chest cues
    ("chest", "chest"), ("pec", "chest"), ("bench", "chest"), ("push up", "chest"),
    ("pushup", "chest"), ("fly", "chest"), ("dip", "chest"),
    # Back cues
    ("back", "back"), ("lat ", "back"), ("lats", "back"), ("row", "back"),
    ("pull-up", "back"), ("pullup", "back"), ("pull up", "back"),
    ("chin-up", "back"), ("chinup", "back"), ("chin up", "back"),
    ("pulldown", "back"), ("deadlift", "back"), ("shrug", "back"),
    # Shoulders cues
    ("shoulder", "shoulders"), ("delt", "shoulders"), ("ohp", "shoulders"),
    ("overhead press", "shoulders"), ("military press", "shoulders"),
    ("lateral raise", "shoulders"), ("face pull", "shoulders"),
    ("upright row", "shoulders"),
    # Arms cues
    ("arm", "arms"), ("curl", "arms"), ("tricep", "arms"), ("bicep", "arms"),
    ("pushdown", "arms"), ("hammer", "arms"), ("kickback", "arms"),
    # Core cues
    ("core", "core"), ("abs ", "core"), ("ab ", "core"), ("crunch", "core"),
    ("plank", "core"), ("sit-up", "core"), ("situp", "core"),
    ("leg raise", "core"), ("rollout", "core"), ("hollow", "core"),
    # Legs cues
    ("leg", "legs"), ("squat", "legs"), ("lunge", "legs"), ("glute", "legs"),
    ("quad", "legs"), ("hamstring", "legs"), ("calf", "legs"), ("calves", "legs"),
    ("hip thrust", "legs"), ("hip ", "legs"), ("step up", "legs"),
    ("split squat", "legs"), ("rdl", "legs"),
]
# Composite cues that map to multiple buckets at once. Picked up first so
# the per-bucket loop doesn't double-credit (we apply them as a set union).
COMPOSITE_NOTE_KEYWORDS: list[tuple[str, list[str]]] = [
    ("upper body",  ["chest", "back", "shoulders", "arms"]),
    ("upper-body",  ["chest", "back", "shoulders", "arms"]),
    ("lower body",  ["legs", "core"]),
    ("lower-body",  ["legs", "core"]),
    ("full body",   ["chest", "back", "shoulders", "arms", "legs", "core"]),
    ("full-body",   ["chest", "back", "shoulders", "arms", "legs", "core"]),
    ("total body",  ["chest", "back", "shoulders", "arms", "legs", "core"]),
    ("push day",    ["chest", "shoulders", "arms"]),
    ("push ",       ["chest", "shoulders", "arms"]),
    ("pull day",    ["back", "arms"]),
    ("leg day",     ["legs"]),
    ("ppl",         ["chest", "back", "legs", "shoulders", "arms"]),
    ("crossfit",    ["chest", "back", "shoulders", "arms", "legs", "core"]),
    ("hiit",        ["legs", "core", "shoulders"]),
]


def _infer_buckets_from_text(text: str) -> set[str]:
    """Scan free text (workout notes, type label, activity, exercise name
    list) for muscle-group cues. Used as a fallback so freeform sessions
    like 'upper body lifting' or 'push day' still credit the heatmap."""
    if not text:
        return set()
    t = text.lower()
    hit: set[str] = set()
    # Composite cues first ("upper body" implies four buckets at once).
    for kw, buckets in COMPOSITE_NOTE_KEYWORDS:
        if kw in t:
            hit.update(buckets)
    # Single-bucket keywords.
    for kw, bucket in NOTE_KEYWORD_TO_BUCKET:
        if kw in t:
            hit.add(bucket)
    return hit


def _muscle_balance_7d(workouts: list[dict]) -> dict:
    """Count how many of the last 7 days each canonical muscle group was hit
    in. Returns per-group session count plus an 'imbalance_note' if one of
    the major lifts has zero coverage."""
    today = _date.today()
    cutoff = today - timedelta(days=6)  # inclusive 7-day window
    counts: dict[str, int] = {g: 0 for g in DISPLAY_GROUPS}
    sessions_by_day: dict[str, set[str]] = {}  # day -> set of bucketed groups

    for w in workouts:
        try:
            d = datetime.strptime(w.get("date") or "", "%Y-%m-%d").date()
        except Exception:
            continue
        if d < cutoff or d > today:
            continue
        # Cardio sessions don't count toward strength muscle-group coverage.
        if (w.get("kind") or "").lower() == "cardio":
            continue
        raw_groups = w.get("muscle_groups") or []
        bucketed: set[str] = set()
        for g in raw_groups:
            key = (g or "").lower().replace(" ", "_")
            mapped = MUSCLE_BUCKETS.get(key)
            if mapped:
                bucketed.add(mapped)

        # Fallback / augmentation pass: scan the workout's notes, type
        # label, and any exercise names for keyword cues. This fixes two
        # gaps:
        #   1) Quick freeform sessions ("upper body lifting" with no
        #      itemized exercises) had empty muscle_groups and never
        #      credited the heatmap at all.
        #   2) Stored muscle_groups may include labels (front_delts,
        #      brachialis, etc.) that we now bucket — but it also lets
        #      old rows logged before this fix get retroactive credit
        #      based on their notes and exercise names.
        text_bits: list[str] = []
        if w.get("notes"):    text_bits.append(str(w["notes"]))
        if w.get("type"):     text_bits.append(str(w["type"]))
        if w.get("activity"): text_bits.append(str(w["activity"]))
        for ex in (w.get("exercises") or []):
            if isinstance(ex, dict) and ex.get("name"):
                text_bits.append(str(ex["name"]))
        inferred = _infer_buckets_from_text(" ".join(text_bits))
        if inferred:
            bucketed.update(inferred)

        slot = sessions_by_day.setdefault(d.isoformat(), set())
        slot.update(bucketed)

    # Count days each bucket appeared (so two chest exercises in one session
    # still count as one "chest day").
    for day_groups in sessions_by_day.values():
        for g in day_groups:
            counts[g] += 1

    # Imbalance note — surfaces the most glaring gap so the user sees one
    # crisp callout instead of a sea of zeros. Picks legs first because
    # leg-skipping is the classic 50+ longevity hazard.
    imbalance_note: Optional[str] = None
    if counts["legs"] == 0 and (counts["chest"] >= 2 or counts["shoulders"] >= 2):
        imbalance_note = "You've trained upper body but no legs this week. Even one squat / split-squat session protects bone density and ground-reaction force as you age."
    elif counts["back"] == 0 and counts["chest"] >= 2:
        imbalance_note = "Chest is getting work but back is at zero. A pull day this week keeps your posture and shoulder joint balanced."
    elif counts["core"] == 0 and sum(counts.values()) >= 3:
        imbalance_note = "No dedicated core work yet — a 10-minute plank/dead-bug finish at the end of any session covers the gap."

    return {
        "window_days":     7,
        "groups":          [{"name": g, "session_days": counts[g]} for g in DISPLAY_GROUPS],
        "imbalance_note":  imbalance_note,
        "total_strength_sessions": len(sessions_by_day),
    }


# ── public API ─────────────────────────────────────────────────────────────

def build_payload(user_id: str) -> dict:
    """One call → everything the Training tab's new load/balance cards need.

    Returns:
        {
          "weekly_volume":          [...],   # 12 weeks padded
          "deload_recommendation":  {...},
          "muscle_balance":         {...},
        }
    Safe to call when Supabase / Oura are unavailable — empty / null sections
    just degrade gracefully so the frontend can skip rendering them.
    """
    # Pull a generous window so all three lenses have enough history.
    workouts = _fetch_workouts(user_id, days=WEEKS_BACK * 7 + 21)
    weekly = _weekly_volume(workouts)

    smm: dict = {}
    try:
        _, _, _, smm = oc.get_days(user_id, days=30)
    except Exception:
        smm = {}
    deload = _deload_recommendation(weekly, smm)
    balance = _muscle_balance_7d(workouts)

    return {
        "weekly_volume":         weekly,
        "deload_recommendation": deload,
        "muscle_balance":        balance,
    }
