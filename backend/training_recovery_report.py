"""
Training & Recovery Report.

Built for a personal trainer, PT, or athletic coach. Shows the actual
training load the user has put in over the window and how their nervous
system has been responding via Oura's readiness + sleep + HRV signals.

Sections:
  • Weekly volume — strength sessions, cardio minutes, totals per week
  • Recovery trend — readiness, HRV, sleep efficiency per day
  • Load-vs-recovery scatter — did high-volume days bring lower HRV the
    next day? (Coach uses this to dial in recovery prescription)
  • Session list — every workout in the window with date, type, duration,
    and a brief description

We pull workouts from `training_workouts` and recovery data from the Oura
cache. No invasive interpretation — just the data laid out for the coach.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc

from supabase import create_client, Client


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _date_range(end_iso: str, days: int) -> tuple[str, str]:
    try:
        end_d = datetime.strptime(end_iso, "%Y-%m-%d").date()
    except Exception:
        end_d = _date.today()
    days = max(1, min(int(days), 365))
    start_d = end_d - timedelta(days=days - 1)
    return start_d.isoformat(), end_d.isoformat()


def _safe_int_avg(vals: list[int]) -> Optional[int]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return int(round(sum(vals) / len(vals)))


def _safe_avg(vals: list[float]) -> Optional[float]:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 1)


def _trend(series: list[tuple[str, object]]) -> list[dict]:
    out: list[dict] = []
    for d, v in sorted(series):
        if v is None:
            continue
        out.append({"date": d, "value": v})
    return out


def _patient(profile: dict) -> dict:
    age = None
    bd = profile.get("birthdate")
    if bd:
        try:
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            today = _date.today()
            age = today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
        except Exception:
            pass
    return {
        "name":           (profile.get("name") or "").strip() or None,
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
        "health_goals":   profile.get("health_goals") or [],
    }


def _fetch_workouts(user_id: str, start: str, end: str) -> list[dict]:
    """Read training_workouts rows in window. Best-effort — empty list on any
    error so the report still renders the other sections."""
    sb = _sb()
    if not sb:
        return []
    try:
        res = (
            sb.table("training_workouts")
            .select("id, date, type, duration_min, distance_mi, intensity, notes, exercises, source")
            .eq("user_id", user_id)
            .gte("date", start)
            .lte("date", end)
            .order("date", desc=False)
            .limit(500)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _iso_week(date_iso: str) -> str:
    try:
        d = datetime.strptime(date_iso, "%Y-%m-%d").date()
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"
    except Exception:
        return ""


def _weekly_volume(workouts: list[dict]) -> list[dict]:
    """Bucket workouts by ISO week and count strength sessions + cardio min.

    Heuristic: type containing 'cardio', 'run', 'cycle', 'walk', 'swim' is
    cardio; everything else counts as a strength session. Pure best-effort —
    coach can interpret.
    """
    weeks: dict[str, dict] = {}
    cardio_kinds = ("cardio", "run", "cycle", "walk", "swim", "row", "elliptical")
    for w in workouts:
        wk = _iso_week(w.get("date", ""))
        if not wk:
            continue
        slot = weeks.setdefault(wk, {
            "week":            wk,
            "strength_sessions": 0,
            "cardio_sessions":   0,
            "cardio_min":        0,
            "total_sessions":    0,
        })
        t = (w.get("type") or "").lower()
        if any(k in t for k in cardio_kinds):
            slot["cardio_sessions"] += 1
            slot["cardio_min"]      += int(w.get("duration_min") or 0)
        else:
            slot["strength_sessions"] += 1
        slot["total_sessions"] += 1
    return sorted(weeks.values(), key=lambda r: r["week"])


def _recovery_section(rm: dict, smm: dict, start: str, end: str) -> dict:
    """Readiness score, HRV, sleep efficiency, sleep hours per day."""
    readiness_series: list[tuple[str, Optional[int]]] = []
    hrv_series:       list[tuple[str, Optional[int]]] = []
    eff_series:       list[tuple[str, Optional[int]]] = []
    sleep_hr_series:  list[tuple[str, Optional[float]]] = []

    for d, row in rm.items():
        if start <= d <= end:
            readiness_series.append((d, row.get("score")))
    for d, row in smm.items():
        if start <= d <= end:
            hrv_series.append((d, row.get("hrv")))
            eff_series.append((d, row.get("efficiency")))
            total = row.get("total")
            sleep_hr_series.append((d, round(total / 3600, 2) if total else None))

    return {
        "readiness":      {
            "trend":   _trend(readiness_series),
            "average": _safe_int_avg([v for _, v in readiness_series if v is not None]),
        },
        "hrv":            {
            "trend":   _trend(hrv_series),
            "average": _safe_int_avg([v for _, v in hrv_series if v is not None]),
            "unit":    "ms",
        },
        "sleep_efficiency": {
            "trend":   _trend(eff_series),
            "average": _safe_int_avg([v for _, v in eff_series if v is not None]),
            "unit":    "%",
        },
        "sleep_hours": {
            "trend":   _trend(sleep_hr_series),
            "average": _safe_avg([v for _, v in sleep_hr_series if v is not None]),
            "unit":    "hrs",
        },
    }


def build_report(user_id: str, profile: dict, *, days: int = 30, end_iso: Optional[str] = None) -> dict:
    end = end_iso or _date.today().isoformat()
    start, end = _date_range(end, days)

    workouts = _fetch_workouts(user_id, start, end)
    try:
        rm, _, _, smm = oc.get_days(user_id, days=days)
    except Exception:
        rm, smm = {}, {}

    weekly = _weekly_volume(workouts)
    totals = {
        "sessions_total":  sum(w["total_sessions"]    for w in weekly),
        "strength_total":  sum(w["strength_sessions"] for w in weekly),
        "cardio_total":    sum(w["cardio_sessions"]   for w in weekly),
        "cardio_min_total": sum(w["cardio_min"]       for w in weekly),
        "weeks":            len(weekly),
    }
    totals["avg_sessions_per_week"] = (
        round(totals["sessions_total"] / max(totals["weeks"], 1), 1)
        if totals["weeks"] else 0
    )

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "range":        {"start": start, "end": end, "days": days},
        "patient":      _patient(profile),
        "totals":       totals,
        "weekly":       weekly,
        "recovery":     _recovery_section(rm, smm, start, end),
        "workouts":     [
            {
                "date":         w.get("date"),
                "type":         w.get("type"),
                "duration_min": w.get("duration_min"),
                "distance_mi":  w.get("distance_mi"),
                "intensity":    w.get("intensity"),
                "notes":        w.get("notes"),
                "source":       w.get("source") or "manual",
            }
            for w in sorted(workouts, key=lambda r: r.get("date") or "", reverse=True)
        ],
    }
