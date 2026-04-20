"""
Readiness prediction tracking — stores daily forecasts and compares to actuals.

Flow:
  1. Each time the dashboard loads, today's forecast (for tomorrow) is saved.
  2. On load, any past predictions missing an actual_score get filled from Oura data.
  3. The accuracy history is returned to the frontend for gamification display.
"""

import os
from datetime import date, timedelta
from typing import Optional


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


def save_prediction(user_id: str, target_date: str, predicted_score: int) -> None:
    """
    Upsert tomorrow's prediction. Called every time the dashboard loads.
    target_date is the date the prediction is FOR (i.e. tomorrow).
    """
    try:
        _sb().table("readiness_predictions").upsert(
            {
                "user_id":         user_id,
                "target_date":     target_date,
                "predicted_score": predicted_score,
            },
            on_conflict="user_id,target_date",
            # Don't overwrite actual_score if it's already been filled in
            ignore_duplicates=False,
        ).execute()
    except Exception:
        pass  # Never crash the dashboard over a prediction write


def fill_actuals(user_id: str, readiness_map: dict) -> None:
    """
    For any prediction whose target_date has passed and actual_score is still
    null, fill it in from the Oura readiness map.
    Called on every dashboard load.
    """
    try:
        sb  = _sb()
        res = (
            sb.table("readiness_predictions")
            .select("id, target_date, actual_score")
            .eq("user_id", user_id)
            .is_("actual_score", "null")
            .lte("target_date", date.today().isoformat())
            .execute()
        )
        rows = res.data or []
        for row in rows:
            actual = (readiness_map.get(str(row["target_date"])) or {}).get("score")
            if actual is not None:
                sb.table("readiness_predictions").update(
                    {"actual_score": int(actual)}
                ).eq("id", row["id"]).execute()
    except Exception:
        pass


def get_history(user_id: str, days: int = 60) -> list[dict]:
    """
    Return the last `days` predictions (newest first), both pending and resolved.
    Each row: { target_date, predicted_score, actual_score | None }
    """
    try:
        since = (date.today() - timedelta(days=days)).isoformat()
        res = (
            _sb().table("readiness_predictions")
            .select("target_date, predicted_score, actual_score")
            .eq("user_id", user_id)
            .gte("target_date", since)
            .order("target_date", desc=True)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


# How many points off counts as a "hit"
HIT_THRESHOLD = 7


def compute_accuracy(history: list[dict]) -> dict:
    """
    Given the prediction history, compute:
      - resolved: list of dicts with {date, predicted, actual, hit, diff}
      - accuracy_pct: % of resolved predictions within HIT_THRESHOLD points
      - streak: current consecutive hit streak (most recent resolved first)
      - best_streak: longest hit streak ever
      - total_resolved: number of predictions with actual scores
    """
    resolved = []
    for row in history:
        if row.get("actual_score") is None:
            continue
        predicted = row["predicted_score"]
        actual    = row["actual_score"]
        diff      = actual - predicted
        hit       = abs(diff) <= HIT_THRESHOLD
        resolved.append({
            "date":      str(row["target_date"]),
            "predicted": predicted,
            "actual":    actual,
            "diff":      diff,
            "hit":       hit,
        })

    # resolved is newest-first from get_history; keep that order for streak calc
    total     = len(resolved)
    hits      = sum(1 for r in resolved if r["hit"])
    accuracy  = round(hits / total * 100) if total else None

    # Current streak = consecutive hits from the most recent resolved day
    streak = 0
    for r in resolved:
        if r["hit"]:
            streak += 1
        else:
            break

    # Best streak
    best = cur = 0
    for r in resolved:
        if r["hit"]:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0

    return {
        "resolved":       resolved,
        "accuracy_pct":   accuracy,
        "streak":         streak,
        "best_streak":    best,
        "total_resolved": total,
        "hit_threshold":  HIT_THRESHOLD,
    }
