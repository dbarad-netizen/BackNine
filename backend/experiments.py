"""
Proven For You — n-of-1 experiment loop.

David 2026-07-23 (Fable competitive brief 2026-07-05): Aveil's "What Works
For You" ledger is the single best idea to borrow in the competitive set.
BackNine's Daily Insight card already proposes 1-week experiments; we
just don't close the loop. This module does.

Loop:
    1. User taps "Test for a week" on a Daily Insight.
    2. commit_experiment() creates a row, snapshots the user's 7-day
       baseline for the relevant metric, and sets test_end_date to
       today + 7 days.
    3. finalize_due_experiments() runs nightly. For every active
       experiment whose test window closed yesterday, it recomputes
       the same metric over the test window, compares delta vs. the
       baseline standard deviation (light Cohen's d), classifies the
       result, and marks the experiment completed.
    4. get_ledger() returns the permanent "Proven for you" list, ready
       for the profile surface and share-card generation.

Design principles:
  • Never fabricate a delta. If either window has < 4 datapoints or
    is entirely null, mark status = 'insufficient_data' and skip
    the ledger entirely.
  • Baseline stddev is the significance yardstick — half a stddev is
    "notable," a full stddev is "meaningful," anything less is noise.
    This is deliberately conservative; the ledger is a trust artifact
    and inflating it destroys the moat.
  • Metric-direction awareness: for RHR / sleep debt / weight-loss-goal
    users, lower is better. `_METRIC_DIRECTION` encodes this so
    "better" always means "moved in the desired direction," not just
    "went up."

Public API:
    commit_experiment(user_id, hypothesis, action, metric_type, insight_id?)
    finalize_experiment(experiment_id)
    finalize_due_experiments()      → int count finalized
    get_active(user_id)              → list of active dicts
    get_ledger(user_id, limit=50)    → list of completed dicts
    abandon_experiment(user_id, experiment_id)
    save_user_note(user_id, experiment_id, note)
"""

from __future__ import annotations

import logging
import os
import statistics
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional


log = logging.getLogger(__name__)


# ── Metric config ────────────────────────────────────────────────────────
#
# Direction: "higher_is_better" = a positive delta is a win.
#            "lower_is_better"  = a negative delta is a win.
# The finalize step uses this to classify "better" vs "worse" instead of
# just reporting the raw delta sign.

_HIGHER_BETTER = "higher_is_better"
_LOWER_BETTER  = "lower_is_better"

_METRIC_DIRECTION: dict[str, str] = {
    "sleep_score":     _HIGHER_BETTER,
    "sleep_hours":     _HIGHER_BETTER,
    "hrv_ms":          _HIGHER_BETTER,
    "rhr_bpm":         _LOWER_BETTER,
    "weight_lb":       _LOWER_BETTER,  # assumption: our persona is loss-oriented; revisit for muscle-gain flows
    "bp_systolic":     _LOWER_BETTER,
    "bp_diastolic":    _LOWER_BETTER,
    "steps":           _HIGHER_BETTER,
    "energy_score":    _HIGHER_BETTER,
    "mood_score":      _HIGHER_BETTER,
    "readiness_score": _HIGHER_BETTER,
    "activity_score":  _HIGHER_BETTER,
    "protein_g":       _HIGHER_BETTER,
    "calories":        _LOWER_BETTER,  # again, weight-loss default; muscle-gain flow overrides
}

# Display label per metric — used in headline generation on the ledger.
_METRIC_LABEL: dict[str, str] = {
    "sleep_score":     "Sleep score",
    "sleep_hours":     "Sleep hours",
    "hrv_ms":          "HRV",
    "rhr_bpm":         "Resting HR",
    "weight_lb":       "Weight",
    "bp_systolic":     "Systolic BP",
    "bp_diastolic":    "Diastolic BP",
    "steps":           "Steps",
    "energy_score":    "Energy",
    "mood_score":      "Mood",
    "readiness_score": "Readiness",
    "activity_score":  "Activity",
    "protein_g":       "Protein (g)",
    "calories":        "Calories",
}

_METRIC_UNIT: dict[str, str] = {
    "sleep_score":     "",
    "sleep_hours":     " h",
    "hrv_ms":          " ms",
    "rhr_bpm":         " bpm",
    "weight_lb":       " lb",
    "bp_systolic":     " mmHg",
    "bp_diastolic":    " mmHg",
    "steps":           "",
    "energy_score":    "",
    "mood_score":      "",
    "readiness_score": "",
    "activity_score":  "",
    "protein_g":       " g",
    "calories":        " kcal",
}


# ── Supabase helper ──────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("Supabase env not set")
    return create_client(url, key)


# ── Metric series fetch ──────────────────────────────────────────────────
#
# Each dispatcher returns a list of floats — one datapoint per day in the
# window — dropping missing days. We keep the list flat because our stats
# (mean, stddev) don't care about which date each value came from once
# we've decided both windows are dense enough.

def _series_apple_health_daily(sb, user_id: str, col: str, start_d: _date, end_d: _date) -> list[float]:
    res = (sb.table("apple_health_daily")
             .select(f"date, {col}")
             .eq("user_id", user_id)
             .gte("date", start_d.isoformat())
             .lte("date", end_d.isoformat())
             .execute())
    return [float(r[col]) for r in (res.data or []) if r.get(col) is not None]


def _series_oura_score(sb, user_id: str, key: str, start_d: _date, end_d: _date) -> list[float]:
    """Extract .score from a jsonb column on oura_daily_cache."""
    res = (sb.table("oura_daily_cache")
             .select(f"date, {key}")
             .eq("user_id", user_id)
             .gte("date", start_d.isoformat())
             .lte("date", end_d.isoformat())
             .execute())
    out: list[float] = []
    for r in (res.data or []):
        payload = r.get(key)
        if isinstance(payload, dict):
            v = payload.get("score")
            if isinstance(v, (int, float)):
                out.append(float(v))
    return out


def _series_oura_sleep_model_field(sb, user_id: str, field: str, start_d: _date, end_d: _date) -> list[float]:
    """Extract a field (e.g. 'hrv', 'hr_lowest') from oura_daily_cache.sleep_model jsonb."""
    res = (sb.table("oura_daily_cache")
             .select("date, sleep_model")
             .eq("user_id", user_id)
             .gte("date", start_d.isoformat())
             .lte("date", end_d.isoformat())
             .execute())
    out: list[float] = []
    for r in (res.data or []):
        model = r.get("sleep_model") or {}
        if isinstance(model, dict):
            v = model.get(field)
            if isinstance(v, (int, float)):
                out.append(float(v))
    return out


def _series_bp(sb, user_id: str, which: str, start_d: _date, end_d: _date) -> list[float]:
    """`which` = 'systolic' or 'diastolic'. Averages within a day so a
    user who logs morning + evening on the same date contributes one
    datapoint, not two."""
    res = (sb.table("blood_pressure_log")
             .select(f"date, {which}")
             .eq("user_id", user_id)
             .gte("date", start_d.isoformat())
             .lte("date", end_d.isoformat())
             .execute())
    by_day: dict[str, list[float]] = {}
    for r in (res.data or []):
        v = r.get(which)
        d = r.get("date")
        if v is not None and d is not None:
            by_day.setdefault(d, []).append(float(v))
    return [sum(v)/len(v) for v in by_day.values() if v]


def _series_weight_lb(sb, user_id: str, start_d: _date, end_d: _date) -> list[float]:
    """Prefer nutrition_weight (users log their own scale); fall back to
    apple_health_daily.weight_kg (Withings, Apple Watch scale sync).
    If both are present, use nutrition_weight — it's the intentional log."""
    res = (sb.table("nutrition_weight")
             .select("date, weight_lbs")
             .eq("user_id", user_id)
             .gte("date", start_d.isoformat())
             .lte("date", end_d.isoformat())
             .execute())
    got = {r["date"]: float(r["weight_lbs"]) for r in (res.data or []) if r.get("weight_lbs") is not None}
    if len(got) < (end_d - start_d).days // 2:
        # Sparse — top up with AH
        res2 = (sb.table("apple_health_daily")
                  .select("date, weight_kg")
                  .eq("user_id", user_id)
                  .gte("date", start_d.isoformat())
                  .lte("date", end_d.isoformat())
                  .execute())
        for r in (res2.data or []):
            d = r.get("date")
            kg = r.get("weight_kg")
            if d and d not in got and kg is not None:
                got[d] = float(kg) * 2.20462
    return list(got.values())


def _metric_series(user_id: str, metric_type: str, start_d: _date, end_d: _date) -> list[float]:
    """Dispatch table. Returns list of floats or [] if data missing."""
    sb = _sb()
    if metric_type == "sleep_score":
        s = _series_oura_score(sb, user_id, "sleep_score", start_d, end_d)
        if s: return s
        # Aveil-parity fallback: nothing today — Apple Health doesn't have
        # a "score" concept, so no fallback series available.
        return []
    if metric_type == "sleep_hours":
        return _series_apple_health_daily(sb, user_id, "sleep_hours", start_d, end_d)
    if metric_type == "hrv_ms":
        s = _series_oura_sleep_model_field(sb, user_id, "hrv", start_d, end_d)
        if s: return s
        return _series_apple_health_daily(sb, user_id, "hrv", start_d, end_d)
    if metric_type == "rhr_bpm":
        s = _series_oura_sleep_model_field(sb, user_id, "hr_lowest", start_d, end_d)
        if s: return s
        return _series_apple_health_daily(sb, user_id, "resting_hr", start_d, end_d)
    if metric_type == "weight_lb":
        return _series_weight_lb(sb, user_id, start_d, end_d)
    if metric_type == "bp_systolic":
        return _series_bp(sb, user_id, "systolic", start_d, end_d)
    if metric_type == "bp_diastolic":
        return _series_bp(sb, user_id, "diastolic", start_d, end_d)
    if metric_type == "steps":
        return _series_apple_health_daily(sb, user_id, "steps", start_d, end_d)
    if metric_type == "readiness_score":
        return _series_oura_score(sb, user_id, "readiness", start_d, end_d)
    if metric_type == "activity_score":
        return _series_oura_score(sb, user_id, "activity", start_d, end_d)
    # energy_score / mood_score / protein_g / calories: not implemented
    # in Phase 1. They're in the enum so we can accept commits and
    # gracefully return insufficient_data at finalize time. Users get
    # a clear "not enough data" outcome instead of a silent skip.
    return []


# ── Statistics ───────────────────────────────────────────────────────────

def _stats(series: list[float]) -> tuple[int, Optional[float], Optional[float]]:
    """Return (n, mean, stddev). stddev is None when n < 2."""
    n = len(series)
    if n == 0:
        return 0, None, None
    mean = sum(series) / n
    if n < 2:
        return n, mean, None
    stddev = statistics.stdev(series)
    return n, mean, stddev


def _classify(delta: float, baseline_stddev: Optional[float], direction: str) -> tuple[str, str]:
    """Return (direction_label, significance_label).
    - direction_label: 'better' | 'worse' | 'no_change'
    - significance_label: 'noise' | 'notable' | 'meaningful'"""
    if baseline_stddev is None or baseline_stddev == 0:
        # Fall back to raw magnitude — anything > 5% of baseline mean
        # would be nice but without a proper stddev we can't gauge.
        # Report as no_change/noise to avoid overclaiming.
        return "no_change", "noise"
    abs_d = abs(delta)
    if abs_d < 0.5 * baseline_stddev:
        sig = "noise"
    elif abs_d < 1.0 * baseline_stddev:
        sig = "notable"
    else:
        sig = "meaningful"

    # Direction: does the delta match the "better" direction for this metric?
    if direction == _HIGHER_BETTER:
        better = delta > 0
    else:
        better = delta < 0
    if sig == "noise":
        direction_label = "no_change"
    elif better:
        direction_label = "better"
    else:
        direction_label = "worse"
    return direction_label, sig


# ── Public write API ─────────────────────────────────────────────────────

def commit_experiment(
    user_id:     str,
    hypothesis:  str,
    action:      str,
    metric_type: str,
    insight_id:  Optional[str] = None,
    test_days:   int = 7,
    today:       Optional[_date] = None,
) -> dict:
    """Create an active experiment and snapshot its 7-day baseline.
    Raises ValueError on bad input; returns the created row dict."""
    if not user_id:
        raise ValueError("user_id required")
    if metric_type not in _METRIC_DIRECTION:
        raise ValueError(f"unknown metric_type: {metric_type}")
    hypothesis = (hypothesis or "").strip()[:400]
    action     = (action or "").strip()[:400]
    if not hypothesis or not action:
        raise ValueError("hypothesis and action required")

    t = today or _date.today()
    baseline_start = t - timedelta(days=7)
    baseline_end   = t - timedelta(days=1)
    test_start     = t
    test_end       = t + timedelta(days=test_days - 1)

    series = _metric_series(user_id, metric_type, baseline_start, baseline_end)
    n, mean, stddev = _stats(series)

    row = {
        "user_id":             user_id,
        "insight_id":          insight_id,
        "hypothesis":          hypothesis,
        "action":              action,
        "metric_type":         metric_type,
        "baseline_start_date": baseline_start.isoformat(),
        "baseline_end_date":   baseline_end.isoformat(),
        "test_start_date":     test_start.isoformat(),
        "test_end_date":       test_end.isoformat(),
        "baseline_avg":        round(mean, 2) if mean is not None else None,
        "baseline_stddev":     round(stddev, 3) if stddev is not None else None,
        "baseline_n":          n,
        "status":              "active",
    }
    sb = _sb()
    res = sb.table("experiments").insert(row).execute()
    return (res.data or [row])[0]


def finalize_experiment(experiment_id: str) -> dict:
    """Compute the test-window stats + delta + classification and mark
    the experiment completed. Returns the updated row."""
    sb = _sb()
    got = (sb.table("experiments")
             .select("*")
             .eq("id", experiment_id)
             .single()
             .execute())
    row = got.data
    if not row:
        raise ValueError(f"experiment not found: {experiment_id}")
    if row["status"] != "active":
        return row  # Already finalized/abandoned — idempotent

    user_id     = row["user_id"]
    metric_type = row["metric_type"]
    test_start  = _date.fromisoformat(row["test_start_date"])
    test_end    = _date.fromisoformat(row["test_end_date"])
    baseline_stddev = float(row["baseline_stddev"]) if row.get("baseline_stddev") is not None else None
    baseline_avg    = float(row["baseline_avg"])    if row.get("baseline_avg")    is not None else None

    series = _metric_series(user_id, metric_type, test_start, test_end)
    n, mean, _stddev = _stats(series)

    now_iso = datetime.now(timezone.utc).isoformat()

    # Guardrails for insufficient data — the ledger is a trust artifact,
    # never publish a "meaningful" flag without both windows solid.
    if (row.get("baseline_n") or 0) < 4 or n < 4 or baseline_avg is None or mean is None:
        upd = {
            "test_n":       n,
            "test_avg":     round(mean, 2) if mean is not None else None,
            "status":       "insufficient_data",
            "completed_at": now_iso,
        }
        sb.table("experiments").update(upd).eq("id", experiment_id).execute()
        row.update(upd)
        return row

    delta = mean - baseline_avg
    direction = _METRIC_DIRECTION[metric_type]
    dir_label, sig_label = _classify(delta, baseline_stddev, direction)

    upd = {
        "test_n":       n,
        "test_avg":     round(mean, 2),
        "delta":        round(delta, 2),
        "direction":    dir_label,
        "significance": sig_label,
        "status":       "completed",
        "completed_at": now_iso,
    }
    sb.table("experiments").update(upd).eq("id", experiment_id).execute()
    row.update(upd)
    return row


def finalize_due_experiments(user_id: Optional[str] = None, today: Optional[_date] = None) -> int:
    """Finalize every active experiment whose test window closed on or
    before yesterday. Optional user_id filter — pass it for opportunistic
    per-user finalization (called from /api/experiments/active read
    path) to avoid scanning the whole active-experiment table on every
    request. Pass None for a batch sweep across all users.
    Returns the count of experiments finalized (any status)."""
    t = today or _date.today()
    cutoff = (t - timedelta(days=1)).isoformat()
    sb = _sb()
    q = (sb.table("experiments")
           .select("id")
           .eq("status", "active")
           .lte("test_end_date", cutoff))
    if user_id:
        q = q.eq("user_id", user_id)
    due = q.execute()
    ids = [r["id"] for r in (due.data or [])]
    n = 0
    for eid in ids:
        try:
            finalize_experiment(eid)
            n += 1
        except Exception:
            log.exception("finalize_experiment failed for %s", eid)
    return n


def abandon_experiment(user_id: str, experiment_id: str) -> None:
    sb = _sb()
    now_iso = datetime.now(timezone.utc).isoformat()
    (sb.table("experiments")
       .update({"status": "abandoned", "completed_at": now_iso})
       .eq("id", experiment_id)
       .eq("user_id", user_id)   # RLS backup — belt & suspenders
       .execute())


def save_user_note(user_id: str, experiment_id: str, note: str) -> None:
    sb = _sb()
    (sb.table("experiments")
       .update({"user_note": (note or "").strip()[:400]})
       .eq("id", experiment_id)
       .eq("user_id", user_id)
       .execute())


# ── Public read API ──────────────────────────────────────────────────────

def _hydrate(row: dict) -> dict:
    """Attach display helpers: metric_label, unit, progress_pct for
    active experiments, headline for completed ones."""
    metric = row.get("metric_type") or ""
    row["metric_label"] = _METRIC_LABEL.get(metric, metric)
    row["unit"]         = _METRIC_UNIT.get(metric, "")
    row["direction_bias"] = _METRIC_DIRECTION.get(metric, _HIGHER_BETTER)

    if row.get("status") == "active":
        # Days elapsed / total. For UI progress bar + "day 3 of 7" copy.
        try:
            ts = _date.fromisoformat(row["test_start_date"])
            te = _date.fromisoformat(row["test_end_date"])
            total  = (te - ts).days + 1
            passed = min(total, max(0, (_date.today() - ts).days + 1))
            row["day_index"]    = passed
            row["day_total"]    = total
            row["progress_pct"] = round(100 * passed / total)
        except Exception:
            row["day_index"] = row["day_total"] = row["progress_pct"] = None

    if row.get("status") == "completed":
        # Ledger headline: "HRV +4.2 ms · notable"
        d   = row.get("delta")
        sig = row.get("significance")
        dir_ = row.get("direction")
        if d is not None:
            sign = "+" if d >= 0 else ""
            row["headline"] = (
                f"{row['metric_label']} {sign}{d}{row['unit']} · "
                f"{sig or ''}"
            ).strip(" ·")
            row["proven"] = (dir_ == "better" and sig in ("notable", "meaningful"))
        else:
            row["headline"] = f"{row['metric_label']} — no clear signal"
            row["proven"]   = False
    return row


def get_active(user_id: str) -> list[dict]:
    sb = _sb()
    res = (sb.table("experiments")
             .select("*")
             .eq("user_id", user_id)
             .eq("status", "active")
             .order("created_at", desc=True)
             .execute())
    return [_hydrate(r) for r in (res.data or [])]


def get_ledger(user_id: str, limit: int = 50) -> list[dict]:
    """Return completed experiments in reverse-chronological order.
    Insufficient-data / abandoned experiments are NOT included — the
    ledger is the trust artifact; only clean results go there."""
    sb = _sb()
    res = (sb.table("experiments")
             .select("*")
             .eq("user_id", user_id)
             .eq("status", "completed")
             .order("completed_at", desc=True)
             .limit(limit)
             .execute())
    return [_hydrate(r) for r in (res.data or [])]


def get_history(user_id: str, limit: int = 100) -> list[dict]:
    """All experiments — active + completed + abandoned + insufficient.
    Used for the "your experiments" full history view."""
    sb = _sb()
    res = (sb.table("experiments")
             .select("*")
             .eq("user_id", user_id)
             .order("created_at", desc=True)
             .limit(limit)
             .execute())
    return [_hydrate(r) for r in (res.data or [])]


# ── Insight → experiment linkage helper ──────────────────────────────────
#
# Called by the Daily Insight card to compute what metric_type this
# insight's action is testing. Guardrail: if we can't confidently pick
# a metric, return None and the UI hides the Test-for-a-week button
# instead of committing a garbage experiment.

_CATEGORY_TO_METRIC: dict[str, str] = {
    "sleep":     "sleep_score",
    "recovery":  "hrv_ms",
    "cardio":    "rhr_bpm",
    "training":  "readiness_score",
    "nutrition": "weight_lb",     # loose — nutrition insights often target weight, sometimes protein
}


def suggest_metric_for_insight(category: str, action: str) -> Optional[str]:
    """Best-effort mapping from insight category + action text to a
    trackable metric. Bias toward None over guessing wrong."""
    cat = (category or "").lower()
    txt = (action or "").lower()

    # Explicit mentions win — override the category default.
    if "hrv" in txt:            return "hrv_ms"
    if "resting" in txt and "heart" in txt: return "rhr_bpm"
    if "rhr" in txt:            return "rhr_bpm"
    if "sleep score" in txt:    return "sleep_score"
    if "sleep" in txt and ("hour" in txt or "hrs" in txt or "duration" in txt):
        return "sleep_hours"
    if "blood pressure" in txt or " bp " in txt or "systolic" in txt:
        return "bp_systolic"
    if "weight" in txt:         return "weight_lb"
    if "step" in txt:           return "steps"
    if "readiness" in txt:      return "readiness_score"

    # Fall through to category default.
    return _CATEGORY_TO_METRIC.get(cat)
