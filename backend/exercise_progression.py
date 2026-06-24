"""
Exercise progression annotator.

For every lifting exercise the user has logged we want a small visual cue on
the workouts list:

  • 🏆 PR              — this session set a lifetime best e1RM for the exercise
  • ▲ +5 lb            — improvement vs. the user's previous session of this lift
  • ▼ −10 lb           — regression vs. last session
  • ✨ New              — first time logging this exercise

The progression badge is the cheapest possible "you're making progress" signal
in the app and the gap David flagged on the Training tab: logged exercises
"just sit there as a list" with no sense of trajectory.

Estimated 1RM uses Epley:  e1RM = weight × (1 + reps/30). It's slightly
optimistic above ~10 reps but the *relative* delta is what we care about
here — comparing two e1RMs computed the same way is fine for trend.

Lookback: 365 days of history per user. One query, in-memory aggregation.
Pure-data; no side effects.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Iterable, Optional

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────────

HISTORY_DAYS = 365
# A delta of |≤ 2 lb of e1RM| is rounding noise — call it "same" so we don't
# show fake "+1 lb" or "−2 lb" badges on essentially identical sessions.
SAME_BAND_LBS = 2.0


# ── helpers ─────────────────────────────────────────────────────────────────

def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _epley_1rm(weight: float, reps: int) -> float:
    """Epley estimated 1RM. Returns 0 for empty or invalid input."""
    if not weight or not reps or weight <= 0 or reps <= 0:
        return 0.0
    return float(weight) * (1.0 + float(reps) / 30.0)


def _best_set_e1rm(sets: list[dict]) -> tuple[float, float, int]:
    """For one exercise's sets in one session, return:
       (max_e1rm, top_weight, top_reps).
    Top is the set with the highest e1RM (heaviest *effective* set, not just
    heaviest absolute weight)."""
    best_e1rm = 0.0
    best_w    = 0.0
    best_r    = 0
    for s in sets or []:
        w = float(s.get("weight_lbs") or 0)
        r = int(s.get("reps") or 0)
        e = _epley_1rm(w, r)
        if e > best_e1rm:
            best_e1rm, best_w, best_r = e, w, r
    return best_e1rm, best_w, best_r


def _ex_key(name: str) -> str:
    """Normalize exercise name for matching across workouts. Lowercase, trim,
    collapse whitespace. We don't strip plurals or punctuation — keep it simple
    so 'Bench Press' and 'bench press' match but 'bench press (close grip)'
    stays its own lift."""
    return " ".join((name or "").strip().lower().split())


# ── core ────────────────────────────────────────────────────────────────────

def _fetch_history(user_id: str) -> list[dict]:
    """Pull HISTORY_DAYS of the user's lifting rows. Narrow projection — only
    what the progression calc needs."""
    sb = _sb()
    if not sb:
        return []
    cutoff = (_date.today() - timedelta(days=HISTORY_DAYS)).isoformat()
    try:
        res = (
            sb.table("training_workouts")
            .select("date, logged_at, exercises, kind, type")
            .eq("user_id", user_id)
            .gte("date", cutoff)
            .order("date", desc=False)
            .order("logged_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _is_lifting_row(row: dict) -> bool:
    """Treat anything whose `kind` is strength (or unset with no cardio marker
    and any sets) as a lifting row. Defensive against legacy rows where kind
    wasn't populated."""
    k = (row.get("kind") or "").lower()
    if k == "strength":
        return True
    if k == "cardio":
        return False
    # Fallback: any exercise with `sets` looks like lifting.
    for ex in row.get("exercises") or []:
        if isinstance(ex, dict) and ex.get("sets"):
            return True
    return False


def _build_timeline(history: list[dict]) -> dict[str, list[dict]]:
    """Per-exercise list of session summaries, oldest → newest. Each entry:
        { workout_date, logged_at, e1rm, top_weight, top_reps, volume }
    Only sessions with at least one valid set are recorded."""
    timeline: dict[str, list[dict]] = {}
    for row in history:
        if not _is_lifting_row(row):
            continue
        wdate = row.get("date") or ""
        logged_at = row.get("logged_at") or wdate
        for ex in row.get("exercises") or []:
            if not isinstance(ex, dict):
                continue
            sets = ex.get("sets") or []
            if not sets:
                continue
            e1rm, top_w, top_r = _best_set_e1rm(sets)
            if e1rm <= 0:
                continue
            volume = sum(
                float(s.get("weight_lbs") or 0) * int(s.get("reps") or 0)
                for s in sets
            )
            key = _ex_key(ex.get("name") or "")
            if not key:
                continue
            timeline.setdefault(key, []).append({
                "workout_date": wdate,
                "logged_at":    logged_at,
                "e1rm":         e1rm,
                "top_weight":   top_w,
                "top_reps":     top_r,
                "volume":       volume,
            })
    # Already ordered by date/logged_at thanks to the query order, but a
    # defensive sort keeps us safe against same-day logging order quirks.
    for k in timeline:
        timeline[k].sort(key=lambda r: (r["workout_date"], r["logged_at"]))
    return timeline


def _progression_for(entry: dict, prior: list[dict]) -> dict:
    """Compute the progression badge payload for one session entry, given the
    list of all prior entries for that exercise (oldest → newest, NOT
    including this one)."""
    e1rm = entry["e1rm"]

    if not prior:
        # First time logging this exercise — encouraging "new" badge.
        return {
            "kind":  "new",
            "label": "✨ New lift",
        }

    # Lifetime PR check — strictly greater than every prior e1rm.
    prior_max = max(p["e1rm"] for p in prior)
    if e1rm > prior_max + SAME_BAND_LBS:
        return {
            "kind":      "pr",
            "label":     "🏆 PR",
            "delta_lbs": round(e1rm - prior_max),
        }

    # Session-over-session: compare to the most recent prior entry.
    last_e1rm = prior[-1]["e1rm"]
    delta = e1rm - last_e1rm
    if delta > SAME_BAND_LBS:
        return {
            "kind":      "up",
            "label":     f"▲ +{round(delta)} lb",
            "delta_lbs": round(delta),
        }
    if delta < -SAME_BAND_LBS:
        return {
            "kind":      "down",
            "label":     f"▼ {round(delta)} lb",
            "delta_lbs": round(delta),
        }
    # Within noise band — no badge.
    return {
        "kind":  "same",
        "label": None,
    }


def annotate_workouts(user_id: str, workouts: list[dict]) -> list[dict]:
    """Return the same workout list with each lifting exercise enriched with a
    `progression` dict.

    Non-lifting exercises (mobility, stretching, cardio) and exercises with no
    sets pass through untouched. Safe to call with an empty workouts list or
    when Supabase is unavailable — the rows just come back unannotated.
    """
    if not user_id or not workouts:
        return workouts

    history = _fetch_history(user_id)
    if not history:
        return workouts

    timeline = _build_timeline(history)

    # Build a fast lookup: (exercise_key, workout_date, logged_at) → index in
    # that exercise's timeline. Lets us slice "everything before this entry"
    # without re-scanning.
    index_lookup: dict[tuple[str, str, str], int] = {}
    for key, entries in timeline.items():
        for i, e in enumerate(entries):
            index_lookup[(key, e["workout_date"], e["logged_at"])] = i

    # Walk the workouts we were asked to annotate.
    for w in workouts:
        if not _is_lifting_row(w):
            continue
        wdate = w.get("date") or ""
        wlogged = w.get("logged_at") or wdate
        exercises = w.get("exercises") or []
        for ex in exercises:
            if not isinstance(ex, dict):
                continue
            sets = ex.get("sets") or []
            if not sets:
                continue
            key = _ex_key(ex.get("name") or "")
            if not key or key not in timeline:
                continue
            entries = timeline[key]
            idx = index_lookup.get((key, wdate, wlogged))
            # Defensive: if the lookup misses (race condition between fetch
            # and annotate, edited row, etc.), fall back to "find latest entry
            # with same workout_date".
            if idx is None:
                for i in range(len(entries) - 1, -1, -1):
                    if entries[i]["workout_date"] == wdate:
                        idx = i
                        break
            if idx is None:
                continue
            this_entry = entries[idx]
            prior      = entries[:idx]
            ex["progression"] = _progression_for(this_entry, prior)
            # Surface the e1RM as a small extra so the UI can show it on
            # hover if we ever want to. Cheap to include.
            ex["e1rm_lbs"] = round(this_entry["e1rm"])
    return workouts


# ── summary endpoint helpers ────────────────────────────────────────────────

def compute_lifetime_prs(user_id: str, limit: int = 10) -> list[dict]:
    """Return the user's current lifetime PR per exercise, sorted by recency
    of the PR. Used by a future 'Your PRs' panel — surfaced now so the
    endpoint is in place.

    Each item: { exercise, e1rm_lbs, top_weight_lbs, top_reps, date }.
    """
    if not user_id:
        return []
    history = _fetch_history(user_id)
    if not history:
        return []
    timeline = _build_timeline(history)
    out: list[dict] = []
    for key, entries in timeline.items():
        if not entries:
            continue
        # Find the entry with the highest e1RM — that's the lifetime PR.
        pr = max(entries, key=lambda e: e["e1rm"])
        out.append({
            "exercise":       key,
            "e1rm_lbs":       round(pr["e1rm"]),
            "top_weight_lbs": round(pr["top_weight"]),
            "top_reps":       pr["top_reps"],
            "date":           pr["workout_date"],
        })
    # Most recently-set PRs first — those are the most motivating to show.
    out.sort(key=lambda r: r["date"], reverse=True)
    return out[:limit]
