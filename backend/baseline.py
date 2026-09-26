"""
baseline.py — baseline resets (David 2026-09-26).

The problem: David started CPAP on Aug 3. Untreated apnea inflates
wearable HRV (RMSSD counts the bradycardia/tachycardia swings around
each event as "variability"), so his pre-CPAP HRV of 50–65 ms was
artifact and his post-CPAP 30–35 ms is the real, age-typical baseline.
Oura scores readiness against its OWN trailing baseline, so it grades
the true David against the inflated David and calls him "less ready."
Add amlodipine (late July) — a dihydropyridine CCB with a well-known
modest resting-HR increase — and the sensor's story is confidently wrong.

The fix: a user-set `baseline_reset_date` (+ reason) on the profile.
Everything that compares "you vs your own history" starts the history
there: BackNine readiness (replaces Oura's readiness number on the
Scorecard when a reset is set), Coach Al's context, and a Doctor
Handoff note. Bio Age is unaffected — it scores against population
norms, not personal history.

A sensor that can't know you started CPAP will be wrong. BackNine can
know. That's the whole reason it exists over the Oura app.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import apple_health as ah


def reset_info(profile: Optional[dict]) -> Optional[dict]:
    """{"date": "YYYY-MM-DD", "reason": str} or None."""
    p = profile or {}
    d = p.get("baseline_reset_date")
    if not d:
        return None
    return {"date": str(d)[:10], "reason": (p.get("baseline_reset_reason") or "").strip()}


def backnine_readiness(smm: dict, anchor: str, reset_date: str) -> Optional[dict]:
    """Readiness computed by BackNine from Oura's own HRV/RHR, against a
    baseline that starts at reset_date. Reuses the Apple Health ring
    estimator (75 ± 60·HRV/RHR delta vs own 14-day baseline, clamped
    35–98) — same math, honest source label.

    Returns {"score", "baseline_days", "hrv_baseline", "rhr_baseline"}
    or None when fewer than 5 post-reset nights exist (not enough of a
    baseline to be honest about)."""
    rows = []
    for d, s in (smm or {}).items():
        if d < reset_date or d > anchor:
            continue
        if not isinstance(s, dict) or (s.get("hrv") is None and s.get("rhr") is None):
            continue
        rows.append({"date": d, "hrv": s.get("hrv"), "resting_hr": s.get("rhr")})
    rows.sort(key=lambda r: r["date"], reverse=True)
    if not rows or rows[0]["date"] != anchor or len(rows) < 5:
        return None
    est = ah.estimate_ring_scores(rows)
    score = (est.get("readiness") or {}).get("score")
    if score is None:
        return None
    base = rows[1:15]
    hrvs = [float(r["hrv"]) for r in base if r.get("hrv") is not None]
    rhrs = [float(r["resting_hr"]) for r in base if r.get("resting_hr") is not None]
    return {
        "score":         int(score),
        "baseline_days": len(base),
        "hrv_baseline":  round(sum(hrvs) / len(hrvs), 1) if hrvs else None,
        "rhr_baseline":  round(sum(rhrs) / len(rhrs), 1) if rhrs else None,
    }


def pre_post_shift(smm: dict, reset_date: str, window_days: int = 28) -> Optional[dict]:
    """Average HRV/RHR in the window before vs after the reset. Used by
    the Coach Al context block and the Doctor Handoff note."""
    try:
        rd = date.fromisoformat(reset_date)
    except Exception:
        return None
    lo = (rd - timedelta(days=window_days)).isoformat()
    hi = (rd + timedelta(days=window_days)).isoformat()
    pre_h, pre_r, post_h, post_r = [], [], [], []
    for d, s in (smm or {}).items():
        if not isinstance(s, dict):
            continue
        h, r = s.get("hrv"), s.get("rhr")
        if lo <= d < reset_date:
            if h is not None: pre_h.append(float(h))
            if r is not None: pre_r.append(float(r))
        elif reset_date <= d <= hi:
            if h is not None: post_h.append(float(h))
            if r is not None: post_r.append(float(r))
    if len(pre_h) < 5 or len(post_h) < 5:
        return None
    m = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
    return {
        "pre_hrv": m(pre_h), "post_hrv": m(post_h),
        "pre_rhr": m(pre_r), "post_rhr": m(post_r),
        "pre_nights": len(pre_h), "post_nights": len(post_h),
        "window_days": window_days,
    }


def _has_med(profile: Optional[dict], needle: str) -> bool:
    for m in ((profile or {}).get("medications") or []):
        if isinstance(m, dict) and needle in (m.get("name") or "").lower():
            return True
    return False


def context_block(profile: Optional[dict], smm: dict) -> str:
    """Prompt block for Coach Al (briefing + chat). Empty when no reset."""
    info = reset_info(profile)
    if not info:
        return ""
    lines = [f"\n=== BASELINE RESET — {info['date']}" + (f" ({info['reason']})" if info['reason'] else "") + " ==="]
    lines.append(
        "The user's personal baselines (HRV, resting HR, readiness) restart on "
        "this date. Comparisons against ANY earlier period are invalid and must "
        "not be made. 'Vs your baseline' means vs the period since this date only."
    )
    shift = pre_post_shift(smm, info["date"])
    if shift:
        lines.append(
            f"Measured shift ({shift['window_days']}d before vs after): HRV "
            f"{shift['pre_hrv']} → {shift['post_hrv']} ms; resting HR "
            f"{shift['pre_rhr']} → {shift['post_rhr']} bpm."
        )
    if "cpap" in (info["reason"] or "").lower():
        lines.append(
            "Interpretation rule: untreated sleep apnea INFLATES wearable HRV "
            "(the heart-rate swings around each apnea event read as variability). "
            "A drop in HRV after starting CPAP is the artifact leaving, not "
            "recovery declining. Never frame the post-CPAP HRV as 'lower' or "
            "'worse' than before — the earlier numbers were not a real baseline. "
            "The CPAP machine's own event count (AHI) is the measure of whether "
            "apnea is controlled; a wearable cannot see that."
        )
    if _has_med(profile, "amlodipine"):
        lines.append(
            "The user's medication list includes amlodipine. A modest resting-HR "
            "increase is a recognized, common effect of dihydropyridine calcium-"
            "channel blockers. If resting HR rose after it was added, say the rise "
            "is 'consistent with' that medication — never advise starting, "
            "stopping, or changing any dose; that is the doctor's call."
        )
    lines.append(
        "The Scorecard shows a BackNine-computed readiness (baseline since the "
        "reset date) in place of the manufacturer's. Refer to readiness as "
        "'your readiness' — do not name Oura's number or explain the substitution."
    )
    return "\n".join(lines)


def handoff_lines(profile: Optional[dict], smm: dict) -> list[str]:
    """Clinician-facing note for the Doctor Handoff. Empty when no reset."""
    info = reset_info(profile)
    if not info:
        return []
    out = [f"Baseline reset {info['date']}" + (f" — {info['reason']}" if info["reason"] else "") + "."]
    shift = pre_post_shift(smm, info["date"])
    if shift:
        out.append(
            f"Wearable nighttime HRV {shift['pre_hrv']} → {shift['post_hrv']} ms and resting HR "
            f"{shift['pre_rhr']} → {shift['post_rhr']} bpm ({shift['window_days']}-day means before/after; "
            f"{shift['pre_nights']}/{shift['post_nights']} nights)."
        )
    if "cpap" in (info["reason"] or "").lower():
        out.append("Pre-CPAP HRV likely inflated by apnea-related heart-rate cycling; post-CPAP values are the working baseline.")
    if _has_med(profile, "amlodipine"):
        out.append("Resting-HR rise is consistent with amlodipine (added in the same period); patient has not changed any dose.")
    return out
