"""
Coach Al goals/programs for BackNine.

A single active forward-looking goal per user, with a multi-week plan Coach Al
generates (goal_coach.py) and live progress computed from the data the app
already tracks. Progress is a unified formula that works in either direction
(raise VO2 max OR lower body fat): pct = (current - baseline)/(target - baseline).

Schema: supabase_user_goals.sql.
"""

import os
from datetime import date, datetime, timezone, timedelta
from typing import Optional

import goal_coach
import longevity_history as lonh
import nutrition as nutr
import training as trn
import apple_health as ah
import oura_cache as oc


# Supported goal metrics. higher_better is informational; progress uses the
# unified baseline→target formula so direction is inferred from the target.
METRICS = {
    "longevity_score": {"label": "Longevity Score",  "unit": "",            "higher_better": True},
    "body_fat":        {"label": "Body Fat",         "unit": "%",           "higher_better": False},
    "weight":          {"label": "Weight",           "unit": " lbs",        "higher_better": False},
    "vo2_max":         {"label": "VO2 Max",          "unit": " ml/kg/min",  "higher_better": True},
    "resting_hr":      {"label": "Resting HR",       "unit": " bpm",        "higher_better": False},
    "training_freq":   {"label": "Workouts / week",  "unit": "/wk",         "higher_better": True},
    "sleep_hours":     {"label": "Sleep",            "unit": " h",          "higher_better": True},
}


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    return create_client(url, key)


def _profile(sb, user_id: str) -> dict:
    try:
        r = sb.table("user_profiles").select("*").eq("user_id", user_id).execute()
        return (r.data or [{}])[0]
    except Exception:
        return {}


# ── Current value readers ─────────────────────────────────────────────────────

def current_value(user_id: str, metric: str) -> Optional[float]:
    """Read the user's current value for a metric from existing data sources."""
    sb = _sb()

    if metric == "longevity_score":
        try:
            hist = lonh.get_history(user_id, days=5)
            return float(hist[-1]["score"]) if hist else None
        except Exception:
            return None

    if metric in ("body_fat", "weight"):
        try:
            entries = nutr.get_weight_entries(user_id)
            for e in reversed(entries or []):
                if metric == "body_fat" and e.get("body_fat_pct") is not None:
                    return float(e["body_fat_pct"])
                if metric == "weight" and e.get("weight_lbs") is not None:
                    return float(e["weight_lbs"])
        except Exception:
            pass
        try:
            s = ah.get_summary(user_id, days=30)
            if metric == "body_fat":
                v = s.get("latest_body_fat_pct")
                return float(v) if v is not None else None
            wkg = s.get("latest_weight_kg")
            return round(float(wkg) * 2.20462, 1) if wkg else None
        except Exception:
            return None

    if metric == "vo2_max":
        p = _profile(sb, user_id)
        if p.get("vo2_max"):
            try:
                return float(p["vo2_max"])
            except Exception:
                pass
        try:
            s = ah.get_summary(user_id, days=30)
            v = (s.get("today") or {}).get("vo2_max")
            return float(v) if v else None
        except Exception:
            return None

    if metric in ("resting_hr", "sleep_hours"):
        try:
            _rm, _slm, _am, smm = oc.get_days(user_id, days=10)
            recent = sorted(smm.keys(), reverse=True)[:7]
            if metric == "resting_hr":
                vals = [smm[d]["rhr"] for d in recent if smm.get(d, {}).get("rhr")]
                if vals:
                    return round(sum(vals) / len(vals), 1)
            else:
                vals = [smm[d]["total"] for d in recent if smm.get(d, {}).get("total")]
                if vals:
                    return round(sum(vals) / len(vals) / 3600, 1)
        except Exception:
            pass
        try:
            s = ah.get_summary(user_id, days=30)
            avgs = s.get("averages") or {}
            return avgs.get("resting_hr") if metric == "resting_hr" else avgs.get("sleep_hours")
        except Exception:
            return None

    if metric == "training_freq":
        try:
            return float(len(trn.get_workouts(user_id, days=7)))
        except Exception:
            return 0.0

    return None


def metrics_snapshot(user_id: str) -> list[dict]:
    """Current value for every supported metric — powers the goal-create form."""
    out = []
    for m, meta in METRICS.items():
        out.append({
            "metric":        m,
            "label":         meta["label"],
            "unit":          meta["unit"],
            "higher_better": meta["higher_better"],
            "current":       current_value(user_id, m),
        })
    return out


# ── Progress ──────────────────────────────────────────────────────────────────

def _progress_pct(baseline, current, target) -> Optional[int]:
    if baseline is None or current is None or target is None:
        return None
    try:
        denom = float(target) - float(baseline)
        if denom == 0:
            return 100
        pct = (float(current) - float(baseline)) / denom * 100
        return max(0, min(100, round(pct)))
    except Exception:
        return None


def _pace(
    metric_label: str,
    baseline: Optional[float],
    current: Optional[float],
    progress_pct: Optional[int],
    start: date,
    end: date,
    today: date,
    this_week: Optional[dict],
) -> dict:
    """Deterministic pace read: how far the metric has moved vs. how much of the
    timeline has elapsed.

    expected_pct is the share of the window that's gone by (a linear pace
    assumption). delta_pct = progress_pct - expected_pct: positive means ahead
    of schedule, negative means behind. Returns a small dict the UI and Coach Al
    can both render. `tone` is one of win | good | warn | neutral.
    """
    label = (metric_label or "this metric").strip()
    if baseline is None or current is None or progress_pct is None:
        return {
            "status": "no_data", "label": "Tracking",
            "message": f"Log your {label.lower()} so I can track your pace toward the target.",
            "tone": "neutral", "expected_pct": None, "delta_pct": None,
        }

    total_days = max(1, (end - start).days)
    elapsed = max(0, (today - start).days)
    expected = max(0, min(100, round(elapsed / total_days * 100)))
    delta = int(progress_pct) - expected  # > 0 ahead of schedule

    focus = ""
    if isinstance(this_week, dict) and this_week.get("focus"):
        focus = f" This week, lean into {str(this_week['focus']).rstrip('.').lower()}."

    if progress_pct >= 100:
        return {"status": "reached", "label": "Target reached", "tone": "win",
                "expected_pct": expected, "delta_pct": delta,
                "message": "You've reached your target — mark it complete or set a tougher one. 🎉"}
    if expected < 8:
        return {"status": "starting", "label": "Just getting started", "tone": "neutral",
                "expected_pct": expected, "delta_pct": delta,
                "message": "Early days — stay consistent and the numbers will follow." + focus}
    if delta >= 25:
        return {"status": "well_ahead", "label": "Well ahead of pace", "tone": "win",
                "expected_pct": expected, "delta_pct": delta,
                "message": "You're well ahead of schedule — whatever you're doing, keep it up."}
    if delta >= 10:
        return {"status": "ahead", "label": "Ahead of pace", "tone": "win",
                "expected_pct": expected, "delta_pct": delta,
                "message": "You're ahead of pace. Hold this rhythm and you'll beat the deadline."}
    if delta > -10:
        return {"status": "on_track", "label": "On track", "tone": "good",
                "expected_pct": expected, "delta_pct": delta,
                "message": "Right on pace for your target — steady as you go." + focus}
    if delta > -25:
        return {"status": "slightly_behind", "label": "A little behind pace", "tone": "warn",
                "expected_pct": expected, "delta_pct": delta,
                "message": "A touch behind, but very catchable." + focus}
    return {"status": "behind", "label": "Behind pace", "tone": "warn",
            "expected_pct": expected, "delta_pct": delta,
            "message": "Behind schedule — let's tighten things up." + focus}


def _enrich(goal_row: dict, today_str: str, current: Optional[float]) -> dict:
    meta = METRICS.get(goal_row["metric"], {"label": goal_row["metric"], "unit": ""})
    start = date.fromisoformat(str(goal_row["start_date"]))
    end = date.fromisoformat(str(goal_row["end_date"]))
    today = date.fromisoformat(today_str)
    total_weeks = goal_row.get("duration_weeks") or max(1, round((end - start).days / 7))
    week_num = min(total_weeks, max(1, (today - start).days // 7 + 1))
    days_left = max(0, (end - today).days)
    plan = goal_row.get("plan") or {}
    weeks = plan.get("weeks") or []
    this_week = next((w for w in weeks if w.get("week") == week_num), (weeks[week_num - 1] if 0 < week_num <= len(weeks) else None))
    progress_pct = _progress_pct(goal_row.get("baseline"), current, goal_row["target"])

    return {
        "id":            goal_row["id"],
        "metric":        goal_row["metric"],
        "label":         meta["label"],
        "unit":          meta["unit"],
        "baseline":      goal_row.get("baseline"),
        "current":       current,
        "target":        goal_row["target"],
        "progress_pct":  progress_pct,
        "week":          week_num,
        "total_weeks":   total_weeks,
        "days_left":     days_left,
        "status":        goal_row.get("status", "active"),
        "start_date":    str(goal_row["start_date"]),
        "end_date":      str(goal_row["end_date"]),
        "headline":      plan.get("headline"),
        "overview":      plan.get("overview"),
        "weeks":         weeks,
        "this_week":     this_week,
        "pace":          _pace(meta["label"], goal_row.get("baseline"), current, progress_pct, start, end, today, this_week),
    }


def get_active_goal(user_id: str, today_str: str) -> Optional[dict]:
    sb = _sb()
    res = (
        sb.table("user_goals")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    row = (res.data or [None])[0]
    if not row:
        return None
    cur = current_value(user_id, row["metric"])
    return _enrich(row, today_str, cur)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

def create_goal(user_id: str, metric: str, target: float, duration_weeks: int, today_str: str) -> dict:
    if metric not in METRICS:
        raise ValueError("Unknown goal metric")
    duration_weeks = max(2, min(16, int(duration_weeks)))
    target = float(target)

    sb = _sb()
    baseline = current_value(user_id, metric)
    profile = _profile(sb, user_id)
    meta = METRICS[metric]

    plan = goal_coach.generate_plan(meta["label"], meta["unit"], baseline, target, duration_weeks, profile)

    start = date.fromisoformat(today_str)
    end = start + timedelta(weeks=duration_weeks)

    # Single active goal — archive any existing active one.
    try:
        sb.table("user_goals").update({"status": "replaced"}) \
            .eq("user_id", user_id).eq("status", "active").execute()
    except Exception:
        pass

    res = sb.table("user_goals").insert({
        "user_id":        user_id,
        "metric":         metric,
        "baseline":       baseline,
        "target":         target,
        "start_date":     start.isoformat(),
        "end_date":       end.isoformat(),
        "duration_weeks": duration_weeks,
        "plan":           plan,
        "status":         "active",
    }).execute()
    row = (res.data or [{}])[0]
    return _enrich(row, today_str, baseline)


def set_status(user_id: str, goal_id: str, status: str) -> bool:
    if status not in ("completed", "abandoned"):
        raise ValueError("Invalid status")
    sb = _sb()
    try:
        res = (
            sb.table("user_goals")
            .update({"status": status})
            .eq("user_id", user_id)
            .eq("id", goal_id)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False
