"""
Medication → lab-effect correlation.

Why: David 2026-08-11. He switched amlodipine → HCTZ + losartan in March;
by August his eGFR fell 65 → 55 and creatinine rose 1.29 → 1.48. That's
a textbook hemodynamic effect of thiazide + ARB — NOT kidney damage —
but a naive reading of the labs (including our own Bio Age) treats it as
pathological aging. Coach Al should recognize the pharmacology and
reframe: "this shift is consistent with your medication change; ask your
doctor to recheck in 8-12 weeks" instead of "your kidneys are aging."

This module:
  1. DRUG_EFFECTS — reference dict of the ~20 most common longevity-
     relevant drugs and their KNOWN, EXPECTED lab effects.
  2. detect_lab_shifts(user_id) — compares the two most recent lab
     draws and returns markers that shifted meaningfully.
  3. attribute_shifts(shifts, medications) — cross-references shifted
     markers against the user's current meds; returns attribution
     notes for Coach Al / Doctor Handoff.

Safety framing: everything this module produces is "consistent with"
language + a follow-up suggestion — never "caused by," never "don't
worry about it." The user's doctor makes the call; we make sure the
question gets asked with the right context.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Optional

log = logging.getLogger(__name__)


# ── Drug effects reference ──────────────────────────────────────────────
#
# Keyed by lowercase generic name. `aliases` catch brand names and common
# misspellings users type into their profile. Effects list the markers
# (canonical lab keys from labs.REFERENCE_RANGES) the drug commonly
# moves, the direction, and the mechanism in plain English.
#
# Sources: standard pharmacology references (UpToDate-class knowledge).
# This is deliberately a curated shortlist of high-prevalence drugs for
# a 50+ audience — not a pharmacopoeia.

DRUG_EFFECTS: dict = {
    "hydrochlorothiazide": {
        "aliases": ["hctz", "hydrochlorothiazide", "hydrochlorathiazide",
                    "hydrochlorthiazide", "microzide"],
        "class": "thiazide diuretic",
        "effects": {
            "creatinine": {"direction": "up", "mechanism":
                "mild volume contraction reduces renal perfusion — a hemodynamic effect, not kidney damage"},
            "egfr": {"direction": "down", "mechanism":
                "follows creatinine — hemodynamic, typically stabilizes within 8-12 weeks"},
            "bun": {"direction": "up", "mechanism": "volume contraction"},
            "potassium": {"direction": "down", "mechanism":
                "urinary potassium wasting — watch for levels below 3.5"},
            "sodium": {"direction": "down", "mechanism":
                "hyponatremia risk, especially in older adults"},
            "glucose": {"direction": "up", "mechanism":
                "mild impairment of insulin release at higher doses"},
            "uric_acid": {"direction": "up", "mechanism":
                "reduced urate excretion — gout risk in susceptible people"},
            "calcium": {"direction": "up", "mechanism": "reduced urinary calcium excretion"},
        },
        "recheck_weeks": "8-12",
    },
    "losartan": {
        "aliases": ["losartan", "cozaar"],
        "class": "ARB (angiotensin receptor blocker)",
        "effects": {
            "creatinine": {"direction": "up", "mechanism":
                "reduced glomerular pressure — expected and usually renoprotective long-term"},
            "egfr": {"direction": "down", "mechanism":
                "up to ~15% initial decline is expected; more than 30% warrants review"},
            "potassium": {"direction": "up", "mechanism":
                "reduced aldosterone — additive risk with potassium supplements"},
            "uric_acid": {"direction": "down", "mechanism":
                "unique among ARBs — mild uricosuric effect"},
        },
        "recheck_weeks": "2-4",
    },
    "lisinopril": {
        "aliases": ["lisinopril", "zestril", "prinivil"],
        "class": "ACE inhibitor",
        "effects": {
            "creatinine": {"direction": "up", "mechanism": "reduced glomerular pressure — expected"},
            "egfr": {"direction": "down", "mechanism": "expected initial decline, renoprotective long-term"},
            "potassium": {"direction": "up", "mechanism": "reduced aldosterone"},
        },
        "recheck_weeks": "2-4",
    },
    "amlodipine": {
        "aliases": ["amlodipine", "amlodopine", "norvasc"],
        "class": "calcium channel blocker",
        "effects": {},   # notably lab-neutral — which is why STOPPING it doesn't explain lab shifts
        "recheck_weeks": None,
    },
    "chlorthalidone": {
        "aliases": ["chlorthalidone", "thalitone"],
        "class": "thiazide-like diuretic",
        "effects": {
            "creatinine": {"direction": "up", "mechanism": "volume contraction — hemodynamic"},
            "egfr": {"direction": "down", "mechanism": "follows creatinine"},
            "potassium": {"direction": "down", "mechanism": "urinary wasting — more potent than HCTZ"},
            "sodium": {"direction": "down", "mechanism": "hyponatremia risk"},
            "glucose": {"direction": "up", "mechanism": "mild"},
            "uric_acid": {"direction": "up", "mechanism": "reduced excretion"},
        },
        "recheck_weeks": "8-12",
    },
    "metformin": {
        "aliases": ["metformin", "glucophage"],
        "class": "biguanide",
        "effects": {
            "glucose": {"direction": "down", "mechanism": "reduced hepatic glucose output"},
            "hba1c": {"direction": "down", "mechanism": "typically 1-1.5% reduction"},
            "vitamin_b12": {"direction": "down", "mechanism":
                "impaired B12 absorption with long-term use — check annually"},
        },
        "recheck_weeks": "12",
    },
    "rosuvastatin": {
        "aliases": ["rosuvastatin", "crestor"],
        "class": "statin",
        "effects": {
            "ldl": {"direction": "down", "mechanism": "HMG-CoA reductase inhibition — 45-55% reduction typical"},
            "total_cholesterol": {"direction": "down", "mechanism": "follows LDL"},
            "triglycerides": {"direction": "down", "mechanism": "modest reduction"},
            "hdl": {"direction": "up", "mechanism": "mild increase"},
            "alt": {"direction": "up", "mechanism": "transaminase elevation in a small minority — usually transient"},
            "ast": {"direction": "up", "mechanism": "as ALT"},
            "glucose": {"direction": "up", "mechanism": "small diabetogenic effect, outweighed by CV benefit"},
            "hba1c": {"direction": "up", "mechanism": "small (~0.1%)"},
        },
        "recheck_weeks": "6-12",
    },
    "atorvastatin": {
        "aliases": ["atorvastatin", "lipitor"],
        "class": "statin",
        "effects": {
            "ldl": {"direction": "down", "mechanism": "40-50% reduction typical"},
            "total_cholesterol": {"direction": "down", "mechanism": "follows LDL"},
            "triglycerides": {"direction": "down", "mechanism": "modest"},
            "alt": {"direction": "up", "mechanism": "transaminase elevation possible"},
            "ast": {"direction": "up", "mechanism": "as ALT"},
            "glucose": {"direction": "up", "mechanism": "small"},
        },
        "recheck_weeks": "6-12",
    },
    "semaglutide": {
        "aliases": ["semaglutide", "ozempic", "wegovy", "rybelsus"],
        "class": "GLP-1 receptor agonist",
        "effects": {
            "glucose": {"direction": "down", "mechanism": "glucose-dependent insulin secretion"},
            "hba1c": {"direction": "down", "mechanism": "typically 1-1.5%"},
            "triglycerides": {"direction": "down", "mechanism": "weight-loss mediated"},
            "ldl": {"direction": "down", "mechanism": "modest, weight-loss mediated"},
        },
        "recheck_weeks": "12",
    },
    "empagliflozin": {
        "aliases": ["empagliflozin", "jardiance"],
        "class": "SGLT2 inhibitor",
        "effects": {
            "glucose": {"direction": "down", "mechanism": "urinary glucose excretion"},
            "hba1c": {"direction": "down", "mechanism": "0.5-1%"},
            "creatinine": {"direction": "up", "mechanism": "initial hemodynamic dip in eGFR, protective long-term"},
            "egfr": {"direction": "down", "mechanism": "initial dip expected, then stabilizes above prior trajectory"},
            "hematocrit": {"direction": "up", "mechanism": "mild hemoconcentration"},
        },
        "recheck_weeks": "4-12",
    },
    "levothyroxine": {
        "aliases": ["levothyroxine", "synthroid", "levoxyl"],
        "class": "thyroid hormone",
        "effects": {
            "tsh": {"direction": "down", "mechanism": "exogenous T4 suppresses TSH — that's the goal"},
            "t4_free": {"direction": "up", "mechanism": "direct replacement"},
        },
        "recheck_weeks": "6-8",
    },
    "testosterone": {
        "aliases": ["testosterone", "androgel", "testosterone cypionate", "trt"],
        "class": "androgen",
        "effects": {
            "testosterone_total": {"direction": "up", "mechanism": "direct replacement"},
            "hematocrit": {"direction": "up", "mechanism":
                "erythropoiesis stimulation — above 54% warrants dose review"},
            "hemoglobin": {"direction": "up", "mechanism": "as hematocrit"},
            "hdl": {"direction": "down", "mechanism": "modest suppression"},
            "psa": {"direction": "up", "mechanism": "monitor per prescriber protocol"},
        },
        "recheck_weeks": "12",
    },
    "omeprazole": {
        "aliases": ["omeprazole", "prilosec", "esomeprazole", "nexium", "pantoprazole", "protonix"],
        "class": "proton pump inhibitor",
        "effects": {
            "magnesium": {"direction": "down", "mechanism": "impaired absorption with long-term use"},
            "vitamin_b12": {"direction": "down", "mechanism": "reduced acid-dependent absorption"},
        },
        "recheck_weeks": None,
    },
    "allopurinol": {
        "aliases": ["allopurinol", "zyloprim"],
        "class": "xanthine oxidase inhibitor",
        "effects": {
            "uric_acid": {"direction": "down", "mechanism": "reduced urate production — that's the goal"},
        },
        "recheck_weeks": "4-8",
    },
    "prednisone": {
        "aliases": ["prednisone", "prednisolone"],
        "class": "corticosteroid",
        "effects": {
            "glucose": {"direction": "up", "mechanism": "steroid-induced insulin resistance"},
            "hba1c": {"direction": "up", "mechanism": "with sustained use"},
            "wbc": {"direction": "up", "mechanism": "demargination — not infection"},
            "potassium": {"direction": "down", "mechanism": "mineralocorticoid effect"},
        },
        "recheck_weeks": None,
    },
    "finasteride": {
        "aliases": ["finasteride", "propecia", "proscar"],
        "class": "5-alpha-reductase inhibitor",
        "effects": {
            "psa": {"direction": "down", "mechanism":
                "halves PSA — prescribers double the measured value when screening"},
        },
        "recheck_weeks": None,
    },
    "cabergoline": {
        "aliases": ["cabergoline", "dostinex"],
        "class": "dopamine agonist",
        "effects": {
            "prolactin": {"direction": "down", "mechanism": "dopamine-mediated suppression — that's the goal"},
        },
        "recheck_weeks": "4-8",
    },
    "tadalafil": {
        "aliases": ["tadalafil", "cialis"],
        "class": "PDE5 inhibitor",
        "effects": {},  # lab-neutral
        "recheck_weeks": None,
    },
    "aspirin": {
        "aliases": ["aspirin", "asa", "baby aspirin"],
        "class": "antiplatelet",
        "effects": {
            "uric_acid": {"direction": "up", "mechanism": "low-dose reduces urate excretion"},
        },
        "recheck_weeks": None,
    },
    "furosemide": {
        "aliases": ["furosemide", "lasix"],
        "class": "loop diuretic",
        "effects": {
            "creatinine": {"direction": "up", "mechanism": "volume contraction"},
            "egfr": {"direction": "down", "mechanism": "follows creatinine"},
            "potassium": {"direction": "down", "mechanism": "urinary wasting — more potent than thiazides"},
            "sodium": {"direction": "down", "mechanism": "hyponatremia risk"},
            "uric_acid": {"direction": "up", "mechanism": "reduced excretion"},
        },
        "recheck_weeks": "2-4",
    },
}


# Shift significance thresholds per marker (absolute change that counts
# as "meaningful"). Markers not listed use 15% relative change.
_SHIFT_THRESHOLDS: dict = {
    "egfr": 8, "creatinine": 0.15, "bun": 4, "potassium": 0.3,
    "sodium": 3, "glucose": 10, "hba1c": 0.3, "ldl": 15,
    "hdl": 8, "triglycerides": 30, "total_cholesterol": 20,
    "alt": 15, "ast": 15, "tsh": 1.0, "hematocrit": 3,
    "hemoglobin": 1.0, "vitamin_b12": 150, "magnesium": 0.3,
    "uric_acid": 1.0, "psa": 0.8,
}


def _sb():
    try:
        from supabase import create_client
    except Exception:
        return None
    url = os.getenv("SUPABASE_URL"); key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def _match_drug(med_name: str) -> Optional[str]:
    """Match a freeform medication name from the profile against the
    reference dict. Three passes:
      1. Exact substring vs aliases (fast path).
      2. Fuzzy match (SequenceMatcher ≥ 0.82) — catches user typos
         like 'hydrchlorathiazide' (David's actual profile entry,
         missing an 'o'). Med names are long and distinctive so a
         high threshold is safe.
      3. None → unmatched (better silent than wrong)."""
    from difflib import SequenceMatcher
    name = (med_name or "").strip().lower()
    if not name:
        return None
    # Strip dose fragments users sometimes append ("metformin 500")
    name = re.sub(r"\b\d+\s*(mg|mcg|g|iu|ml)?\b", "", name).strip()

    for drug_key, spec in DRUG_EFFECTS.items():
        for alias in spec["aliases"]:
            if alias in name or name in alias:
                return drug_key

    best_key, best_ratio = None, 0.0
    for drug_key, spec in DRUG_EFFECTS.items():
        for alias in spec["aliases"]:
            r = SequenceMatcher(None, name, alias).ratio()
            if r > best_ratio:
                best_key, best_ratio = drug_key, r
    if best_ratio >= 0.82:
        return best_key
    return None


def detect_lab_shifts(user_id: str) -> list[dict]:
    """Compare the two most recent lab draws; return markers that
    shifted meaningfully. Each shift: {marker, prior, current,
    prior_date, current_date, delta}."""
    sb = _sb()
    if not sb:
        return []
    try:
        res = (sb.table("lab_entries")
                 .select("date, values")
                 .eq("user_id", user_id)
                 .order("date", desc=True)
                 .limit(10)
                 .execute())
        rows = res.data or []
    except Exception:
        return []
    if len(rows) < 2:
        return []

    # Build per-marker latest + prior values from potentially sparse draws
    latest: dict = {}
    prior:  dict = {}
    for r in rows:
        vals = r.get("values") or {}
        d    = str(r.get("date"))
        if not isinstance(vals, dict):
            continue
        for k, v in vals.items():
            if v is None:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if k not in latest:
                latest[k] = (fv, d)
            elif k not in prior:
                prior[k] = (fv, d)

    shifts: list[dict] = []
    for k, (cur, cur_d) in latest.items():
        if k not in prior:
            continue
        old, old_d = prior[k]
        delta = cur - old
        threshold = _SHIFT_THRESHOLDS.get(k)
        if threshold is not None:
            significant = abs(delta) >= threshold
        else:
            significant = old != 0 and abs(delta / old) >= 0.15
        if significant:
            shifts.append({
                "marker":       k,
                "prior":        old,
                "current":      cur,
                "prior_date":   old_d,
                "current_date": cur_d,
                "delta":        round(delta, 2),
            })
    return shifts


def attribute_shifts(shifts: list[dict], medications: list[dict]) -> list[dict]:
    """Cross-reference lab shifts against the user's current medication
    list. Returns attribution notes: which shifts are consistent with a
    known drug effect, with mechanism + recheck guidance."""
    if not shifts or not medications:
        return []

    # Map current meds → matched reference drugs
    matched: list[tuple[str, str]] = []   # (profile_name, drug_key)
    for med in medications:
        name = med.get("name") if isinstance(med, dict) else str(med)
        drug_key = _match_drug(name or "")
        if drug_key:
            matched.append((name, drug_key))

    notes: list[dict] = []
    for shift in shifts:
        marker    = shift["marker"]
        went_up   = shift["delta"] > 0
        direction = "up" if went_up else "down"
        for profile_name, drug_key in matched:
            spec   = DRUG_EFFECTS[drug_key]
            effect = spec["effects"].get(marker)
            if not effect:
                continue
            if effect["direction"] != direction:
                continue
            recheck = spec.get("recheck_weeks")
            notes.append({
                "marker":       marker,
                "medication":   profile_name,
                "drug_class":   spec["class"],
                "shift":        f"{shift['prior']} → {shift['current']}",
                "dates":        f"{shift['prior_date']} → {shift['current_date']}",
                "mechanism":    effect["mechanism"],
                "recheck":      (f"typical follow-up: recheck labs {recheck} weeks "
                                 f"after a dose change" if recheck else None),
            })
    return notes


def med_lab_context(user_id: str, medications: list[dict]) -> Optional[str]:
    """Build the Coach Al prompt block. Returns None when there's
    nothing to say (no shifts, or no shift attributable to a med)."""
    shifts = detect_lab_shifts(user_id)
    if not shifts:
        return None
    notes = attribute_shifts(shifts, medications)

    lines = ["=== LAB SHIFTS SINCE PRIOR DRAW ==="]
    attributed_markers = {n["marker"] for n in notes}
    for s in shifts:
        tag = " [see medication note below]" if s["marker"] in attributed_markers else ""
        lines.append(f"  {s['marker']}: {s['prior']} → {s['current']} "
                     f"({s['prior_date']} → {s['current_date']}){tag}")

    if notes:
        lines.append("")
        lines.append("=== MEDICATION-CONSISTENT SHIFTS (IMPORTANT) ===")
        lines.append(
            "The following lab shifts are CONSISTENT WITH known effects of "
            "the user's current medications. When discussing these markers, "
            "you MUST frame them as likely medication-related (\"consistent "
            "with\") rather than as disease progression or aging — and "
            "suggest confirming with their doctor. Do NOT tell the user to "
            "stop or change any medication."
        )
        for n in notes:
            line = (f"  {n['marker']} ({n['shift']}): consistent with "
                    f"{n['medication']} ({n['drug_class']}) — {n['mechanism']}.")
            if n["recheck"]:
                line += f" {n['recheck'].capitalize()}."
            lines.append(line)

    return "\n".join(lines)


__all__ = ["DRUG_EFFECTS", "detect_lab_shifts", "attribute_shifts", "med_lab_context"]
