"""
Clinical escalation rules — threshold-based flags that surface across
every AI surface AND get auto-pinned to the top of the Doctor Handoff.

Fable Round 2 called this out as the P0 pattern: the app was sitting
on 17 BP readings averaging 151/95 on a user already prescribed
antihypertensives, and no surface said the one required sentence:
"your evening readings are averaging above guideline while on BP meds
— bring this to your doctor."

We're not practicing medicine here. We're doing what a responsible
health-adjacent product does: when readings cross a well-established
guideline threshold in a sustained way, we prompt the user to talk to
their prescribing physician. Nothing more, nothing less.

Public API:
  assess(user_id, profile) → list[FlagDict]
      One row per active flag. Each flag carries:
        {
          id:          str,     # stable key, e.g. "bp_stage2_sustained"
          severity:    str,     # "info" | "watch" | "urgent"
          domain:      str,     # "bp" | "cardio" | "sleep"
          title:       str,     # one-line label for cards / one-pagers
          message:     str,     # full sentence for the doctor handoff
          data:        dict,    # values that drove the flag (avg, n, window)
          bring_to_dr: bool,    # explicit "talk to your doctor" line
        }

  chat_context_block(flags) → str
      Formatted for injection into an AI system prompt. Empty when the
      flag list is empty.

  handoff_pin(flags) → dict|None
      The single most severe flag reshaped for the Handoff's "PIN" slot.
"""

from __future__ import annotations

import logging
from datetime import date as _date, timedelta
from typing import Optional


log = logging.getLogger(__name__)


# ── Guideline thresholds ────────────────────────────────────────────────
# ACC/AHA 2017 blood pressure staging. Sustained = averaged over N days,
# with at least MIN_READINGS in the window. We require >= 7 readings so
# a single bad-morning cluster can't trigger the flag.
BP_STAGE1_SYS,   BP_STAGE1_DIA   = 130, 80
BP_STAGE2_SYS,   BP_STAGE2_DIA   = 140, 90
BP_CRISIS_SYS,   BP_CRISIS_DIA   = 180, 120
BP_WINDOW_DAYS   = 14
BP_MIN_READINGS  = 7

# RHR — sustained ≥ 80 bpm with rising trend suggests worth mentioning.
# Not a clinical threshold, but a coaching one. Framed as "watch".
RHR_ELEVATED     = 80
RHR_WINDOW_DAYS  = 14
RHR_MIN_NIGHTS   = 7


# ── Data plumbing ───────────────────────────────────────────────────────

def _sb():
    import os
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _bp_window(user_id: str, days: int) -> list[dict]:
    try:
        import bp as bp_mod
        return bp_mod.list_readings(user_id, days=days) or []
    except Exception:
        return []


def _oura_rhr_window(user_id: str, days: int) -> list[float]:
    try:
        import oura_cache as oc
        _, _, _, smm = oc.get_days(user_id, days=days)
        vals = []
        cutoff = (_date.today() - timedelta(days=days)).isoformat()
        for d, row in (smm or {}).items():
            if d < cutoff:
                continue
            rhr = row.get("rhr") if isinstance(row, dict) else None
            if rhr is not None:
                try:
                    vals.append(float(rhr))
                except (TypeError, ValueError):
                    continue
        return vals
    except Exception:
        return []


def _mean(vals: list[float]) -> Optional[float]:
    if not vals:
        return None
    return sum(vals) / len(vals)


# ── Flag builders ───────────────────────────────────────────────────────

def _bp_flag(user_id: str, on_bp_meds: bool) -> Optional[dict]:
    """The core Fable-Round-2 rule: sustained BP ≥140/90 → escalate."""
    readings = _bp_window(user_id, BP_WINDOW_DAYS)
    if len(readings) < BP_MIN_READINGS:
        return None
    sys_vals = [float(r["systolic"])  for r in readings if r.get("systolic")]
    dia_vals = [float(r["diastolic"]) for r in readings if r.get("diastolic")]
    if not sys_vals or not dia_vals:
        return None
    sys_avg = _mean(sys_vals)
    dia_avg = _mean(dia_vals)
    if sys_avg is None or dia_avg is None:
        return None

    # Crisis / stage 2 / stage 1 tiers
    crisis = sys_avg >= BP_CRISIS_SYS or dia_avg >= BP_CRISIS_DIA
    stage2 = sys_avg >= BP_STAGE2_SYS or dia_avg >= BP_STAGE2_DIA
    stage1 = sys_avg >= BP_STAGE1_SYS or dia_avg >= BP_STAGE1_DIA
    if not (crisis or stage2 or stage1):
        return None

    meds_line = " while on BP medication" if on_bp_meds else ""

    if crisis:
        severity = "urgent"
        title    = f"BP averaging {round(sys_avg)}/{round(dia_avg)} — hypertensive-crisis range"
        message  = (
            f"Over the last {BP_WINDOW_DAYS} days ({len(readings)} readings), "
            f"average BP is {round(sys_avg)}/{round(dia_avg)} — in the "
            f"hypertensive-crisis range (≥180/120){meds_line}. This warrants "
            f"talking with your prescribing physician promptly."
        )
    elif stage2:
        severity = "urgent"
        title    = f"BP averaging {round(sys_avg)}/{round(dia_avg)} — Stage 2 range"
        message  = (
            f"Over the last {BP_WINDOW_DAYS} days ({len(readings)} readings), "
            f"average BP is {round(sys_avg)}/{round(dia_avg)} — above the "
            f"140/90 Stage 2 guideline threshold{meds_line}. Bring this to your doctor."
        )
    else:  # stage1
        severity = "watch"
        title    = f"BP averaging {round(sys_avg)}/{round(dia_avg)} — Stage 1 range"
        message  = (
            f"Over the last {BP_WINDOW_DAYS} days ({len(readings)} readings), "
            f"average BP is {round(sys_avg)}/{round(dia_avg)} — in the "
            f"Stage 1 hypertension range (130-139 / 80-89){meds_line}. "
            f"Worth mentioning at your next visit."
        )

    return {
        "id":          f"bp_{'crisis' if crisis else 'stage2' if stage2 else 'stage1'}_sustained",
        "severity":    severity,
        "domain":      "bp",
        "title":       title,
        "message":     message,
        "data":        {
            "systolic_avg":  round(sys_avg),
            "diastolic_avg": round(dia_avg),
            "n_readings":    len(readings),
            "window_days":   BP_WINDOW_DAYS,
            "on_bp_meds":    on_bp_meds,
        },
        "bring_to_dr": True,
    }


def _rhr_flag(user_id: str) -> Optional[dict]:
    """Elevated sustained RHR — not a clinical trigger, but a coaching
    one. Frames as 'watch', never as 'urgent' or 'bring to doctor'."""
    vals = _oura_rhr_window(user_id, RHR_WINDOW_DAYS)
    if len(vals) < RHR_MIN_NIGHTS:
        return None
    avg = _mean(vals)
    if avg is None or avg < RHR_ELEVATED:
        return None
    return {
        "id":          "rhr_elevated_sustained",
        "severity":    "watch",
        "domain":      "cardio",
        "title":       f"Resting HR averaging {round(avg)} bpm",
        "message":     (
            f"Over the last {RHR_WINDOW_DAYS} nights, average resting "
            f"heart rate has been {round(avg)} bpm — worth watching. "
            f"Sustained elevated RHR often reflects accumulated stress, "
            f"under-recovery, or an illness starting."
        ),
        "data":        {"rhr_avg": round(avg), "nights": len(vals),
                        "window_days": RHR_WINDOW_DAYS},
        "bring_to_dr": False,
    }


# ── Public API ──────────────────────────────────────────────────────────

def _on_bp_meds(profile: dict) -> bool:
    """Cheap heuristic — does the user's medication list contain any
    common antihypertensive class? Used only to *strengthen* the flag
    message ("while on BP medication"). We do NOT gate the flag on
    this — a user not on meds still deserves the escalation, and a
    typo like 'lozartan' shouldn't silently drop the qualifier."""
    if not isinstance(profile, dict):
        return False
    meds = profile.get("medications") or []
    if not isinstance(meds, list):
        return False
    known = (
        "losartan", "valsartan", "irbesartan", "candesartan", "olmesartan",
        "telmisartan", "lisinopril", "enalapril", "ramipril", "benazepril",
        "amlodipine", "nifedipine", "felodipine", "diltiazem", "verapamil",
        "metoprolol", "atenolol", "bisoprolol", "carvedilol", "propranolol",
        "labetalol", "nebivolol",
        "hydrochlorothiazide", "hctz", "chlorthalidone", "furosemide",
        "spironolactone", "eplerenone", "indapamide",
        "doxazosin", "prazosin", "terazosin",
        "clonidine", "methyldopa", "hydralazine",
    )
    for item in meds:
        name = ""
        if isinstance(item, dict):
            name = str(item.get("name") or "").lower()
        elif isinstance(item, str):
            name = item.lower()
        for k in known:
            if k in name:
                return True
    return False


def assess(user_id: str, profile: Optional[dict] = None) -> list[dict]:
    """Assemble the active flag list for this user. Empty when no
    thresholds are breached. Safe to call on every AI surface — reads
    are cheap and cached upstream."""
    if not user_id:
        return []
    profile  = profile or {}
    on_meds  = _on_bp_meds(profile)
    flags: list[dict] = []
    bp = _bp_flag(user_id, on_meds)
    if bp:
        flags.append(bp)
    rhr = _rhr_flag(user_id)
    if rhr:
        flags.append(rhr)
    return flags


_SEVERITY_RANK = {"urgent": 3, "watch": 2, "info": 1}


def chat_context_block(flags: list[dict]) -> str:
    """Preformatted context block for injection into any AI system
    prompt. Empty string when there are no flags — callers can safely
    concatenate unconditionally."""
    if not flags:
        return ""
    flags = sorted(flags, key=lambda f: -_SEVERITY_RANK.get(f.get("severity", "info"), 0))
    lines = [
        "\n=== CLINICAL ESCALATION FLAGS — SURFACE THESE HONESTLY ===",
        "The user has readings that crossed clinical guideline thresholds.",
        "If asked about them (or about the domain they're in), you MUST:",
        "  1. Acknowledge the flag with the specific numbers.",
        "  2. If the flag is `urgent` or `bring_to_dr: true`, say plainly:",
        "     'this is worth bringing to your doctor'. Do NOT minimize.",
        "  3. NEVER contradict the flag or explain it away with a lifestyle",
        "     experiment (carb timing, hydration, etc.) as the primary framing.",
        "     Lifestyle context can accompany the escalation, never replace it.",
        "  4. Do NOT diagnose or recommend medication changes.",
        "",
        "Active flags:",
    ]
    for f in flags:
        sev = f.get("severity", "info").upper()
        lines.append(f"  • [{sev}] {f.get('title', '')}")
        lines.append(f"    {f.get('message', '')}")
    return "\n".join(lines) + "\n"


def handoff_pin(flags: list[dict]) -> Optional[dict]:
    """The single most-severe flag, reshaped for the Doctor Handoff's
    top-of-page pin. Returns None when there are no flags."""
    if not flags:
        return None
    top = sorted(flags, key=lambda f: -_SEVERITY_RANK.get(f.get("severity", "info"), 0))[0]
    return {
        "severity": top.get("severity"),
        "title":    top.get("title"),
        "message":  top.get("message"),
        "domain":   top.get("domain"),
    }


__all__ = ["assess", "chat_context_block", "handoff_pin"]
