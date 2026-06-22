"""
Pre-Procedure / Pre-Surgery Report.

A medication-and-supplement reconciliation tool for the user to bring to a
surgeon, anesthesiologist, dentist, or any procedural visit. Reads the
user's active medications, supplements, and peptides and cross-references
them against a curated list of items known to affect:

  • Bleeding risk (NSAIDs, fish oil/omega-3, vitamin E, ginkgo, garlic,
    ginseng, turmeric in high doses, saw palmetto, feverfew, bromelain)
  • Anesthesia interactions (St John's Wort, kava, melatonin)
  • Cardiovascular drug interactions (yohimbine, high-dose stimulants)
  • Blood sugar / metabolic (chromium, alpha-lipoic acid, bitter melon)

Each match comes with a SHORT clinician-facing note explaining the concern.
We do NOT tell the user to stop anything — that's the doctor's call.

This is the report the user prints and hands to the front desk during the
"any medications or supplements?" intake. It removes the "I forgot to
mention X" failure mode that's responsible for many surgical complications.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional


# ── Risk catalog ──────────────────────────────────────────────────────────
# Keyed by lowercase substring; the first match wins. Each entry returns a
# (severity, category, note) tuple. Severity is HIGH (clinician should be
# told before any procedure) or NOTE (worth disclosing, lower urgency).
#
# Sources for these flags: peer-reviewed reviews on perioperative supplement
# management (e.g. JAMA 2001 Ang-Lee et al., ASA preoperative guidance).
# Not exhaustive — tuned to the items BackNine users commonly stack.

RISK_CATALOG: list[tuple[str, str, str, str]] = [
    # substring,           severity, category,        clinician note
    ("warfarin",           "HIGH", "Anticoagulant",    "Anticoagulant — surgical bleeding risk; coordinate INR/bridge plan."),
    ("coumadin",           "HIGH", "Anticoagulant",    "Anticoagulant — coordinate hold/bridge with prescriber."),
    ("aspirin",            "HIGH", "Antiplatelet",     "Antiplatelet — typically held 7 days pre-op unless cardio-protective hold contraindicated."),
    ("clopidogrel",        "HIGH", "Antiplatelet",     "Antiplatelet — typically held 5-7 days pre-op per cardiology guidance."),
    ("plavix",             "HIGH", "Antiplatelet",     "Antiplatelet (clopidogrel) — coordinate hold with prescribing cardiologist."),
    ("ibuprofen",          "HIGH", "NSAID",            "NSAID — platelet inhibition, increased bleeding; typically held 3-5 days pre-op."),
    ("naproxen",           "HIGH", "NSAID",            "NSAID — platelet inhibition; typically held 3-5 days pre-op."),
    ("meloxicam",          "HIGH", "NSAID",            "NSAID — platelet inhibition; coordinate hold with prescriber."),
    ("celebrex",           "NOTE", "COX-2 selective",  "COX-2 selective NSAID — lower bleeding risk than non-selective; mention to surgeon."),
    ("celecoxib",          "NOTE", "COX-2 selective",  "COX-2 selective NSAID — lower bleeding risk; mention to surgeon."),
    ("fish oil",           "HIGH", "Supplement",       "Omega-3/fish oil — may increase bleeding time; commonly held 7 days pre-op."),
    ("omega 3",            "HIGH", "Supplement",       "Omega-3 — may increase bleeding time; commonly held 7 days pre-op."),
    ("omega-3",            "HIGH", "Supplement",       "Omega-3 — may increase bleeding time; commonly held 7 days pre-op."),
    ("epa",                "HIGH", "Supplement",       "EPA/DHA — may increase bleeding time; mention if part of an omega-3 stack."),
    ("vitamin e",          "HIGH", "Supplement",       "Vitamin E — antiplatelet effect at high doses; commonly held 7 days pre-op."),
    ("ginkgo",             "HIGH", "Supplement",       "Ginkgo biloba — inhibits platelet-activating factor; held 36 hours to 2 weeks pre-op."),
    ("garlic",             "HIGH", "Supplement",       "Garlic (supplemental) — irreversible platelet inhibition; held 7-10 days pre-op."),
    ("ginseng",            "HIGH", "Supplement",       "Ginseng — platelet inhibition + hypoglycemia risk; held 7 days pre-op."),
    ("saw palmetto",       "HIGH", "Supplement",       "Saw palmetto — possible platelet effect; mention to surgeon."),
    ("feverfew",           "HIGH", "Supplement",       "Feverfew — platelet inhibition; mention to surgeon."),
    ("bromelain",          "NOTE", "Supplement",       "Bromelain (pineapple enzyme) — possible antiplatelet effect at high doses."),
    ("turmeric",           "NOTE", "Supplement",       "Curcumin/turmeric — antiplatelet at high doses; mention if dose >1g/day."),
    ("curcum",             "NOTE", "Supplement",       "Curcumin — antiplatelet at high doses; mention if dose >1g/day."),
    ("st john",            "HIGH", "Supplement",       "St John's Wort — major drug interactions including anesthetics and SSRIs."),
    ("kava",               "HIGH", "Supplement",       "Kava — may potentiate anesthetic effect; also hepatotoxicity concern."),
    ("valerian",           "NOTE", "Supplement",       "Valerian — can potentiate sedatives; taper rather than abrupt stop."),
    ("melatonin",          "NOTE", "Supplement",       "Melatonin — sedative interactions; mention timing relative to procedure."),
    ("yohimbine",          "HIGH", "Supplement",       "Yohimbine — can raise BP/HR; cardiovascular risk during anesthesia."),
    ("ephedra",            "HIGH", "Supplement",       "Ephedra/ma huang — significant cardiovascular risk during anesthesia."),
    ("dhea",               "NOTE", "Hormonal",         "DHEA — hormonal precursor; disclose to anesthesiologist."),
    ("testosterone",       "HIGH", "Hormonal",         "Testosterone — coagulation effects + cardiovascular considerations."),
    ("gaba",               "NOTE", "Supplement",       "GABA — may potentiate sedation."),
    ("bpc-157",            "NOTE", "Peptide",          "Peptide — not FDA-approved; disclose route + dose."),
    ("bpc 157",            "NOTE", "Peptide",          "Peptide — not FDA-approved; disclose route + dose."),
    ("tb-500",             "NOTE", "Peptide",          "Peptide — not FDA-approved; disclose route + dose."),
    ("tb 500",             "NOTE", "Peptide",          "Peptide — not FDA-approved; disclose route + dose."),
    ("ipamorelin",         "NOTE", "Peptide",          "Peptide — disclose to anesthesiologist; hormonal effects."),
    ("sermorelin",         "NOTE", "Peptide",          "Peptide — disclose to anesthesiologist; hormonal effects."),
    ("cjc-1295",           "NOTE", "Peptide",          "Peptide — disclose to anesthesiologist; hormonal effects."),
    ("cjc 1295",           "NOTE", "Peptide",          "Peptide — disclose to anesthesiologist; hormonal effects."),
    ("semaglutide",        "HIGH", "GLP-1",            "GLP-1 agonist — delays gastric emptying; ASA guidance is to hold pre-op (aspiration risk)."),
    ("ozempic",            "HIGH", "GLP-1",            "GLP-1 agonist — delays gastric emptying; ASA guidance is to hold pre-op."),
    ("wegovy",             "HIGH", "GLP-1",            "GLP-1 agonist — delays gastric emptying; ASA guidance is to hold pre-op."),
    ("tirzepatide",        "HIGH", "GLP-1/GIP",        "GLP-1/GIP agonist — delays gastric emptying; ASA guidance is to hold pre-op."),
    ("mounjaro",           "HIGH", "GLP-1/GIP",        "GLP-1/GIP agonist — delays gastric emptying; ASA guidance is to hold pre-op."),
    ("zepbound",           "HIGH", "GLP-1/GIP",        "GLP-1/GIP agonist — delays gastric emptying; ASA guidance is to hold pre-op."),
    ("metformin",          "NOTE", "Diabetes",         "Metformin — typically held day of procedure if contrast or NPO."),
    ("nad",                "NOTE", "Supplement",       "NAD+ precursor — no major procedural concern; routinely disclosed."),
    ("creatine",            "NOTE","Supplement",       "Creatine — no major procedural concern; can elevate creatinine on labs."),
]


def _normalize_items(items) -> list[dict]:
    out = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        out.append({
            "name":   name,
            "dose":   (it.get("dose")   or "").strip() or None,
            "timing": (it.get("timing") or "").strip() or None,
            "notes":  (it.get("notes")  or "").strip() or None,
        })
    return out


def _flag(item_name: str) -> Optional[dict]:
    """Match item_name against the risk catalog. Returns first hit or None."""
    lname = item_name.lower()
    for substring, severity, category, note in RISK_CATALOG:
        if substring in lname:
            return {"severity": severity, "category": category, "note": note}
    return None


def _patient(profile: dict) -> dict:
    age = None
    bd = profile.get("birthdate")
    if bd:
        try:
            from datetime import date as _d
            bd_d = datetime.strptime(bd, "%Y-%m-%d").date()
            today = _d.today()
            age = today.year - bd_d.year - ((today.month, today.day) < (bd_d.month, bd_d.day))
        except Exception:
            pass
    return {
        "name":           (profile.get("name") or "").strip() or None,
        "birthdate":      profile.get("birthdate"),
        "age":            age,
        "biological_sex": profile.get("biological_sex"),
        "height_cm":      profile.get("height_cm"),
    }


def build_report(user_id: str, profile: dict) -> dict:
    """No date range — this report is about the user's CURRENT state.
    Reads medications + supplements + peptides from the profile, flags
    each against the bleeding/anesthesia/interaction catalog, and groups
    the flagged items at the top for the clinician to scan first."""
    meds  = _normalize_items(profile.get("medications"))
    supps = _normalize_items(profile.get("supplements"))
    pepts = _normalize_items(profile.get("peptides"))

    # Attach flags to each item.
    def _annotate(arr: list[dict], default_class: str) -> list[dict]:
        out = []
        for it in arr:
            flag = _flag(it["name"])
            out.append({**it, "flag": flag, "class": default_class})
        return out

    meds_a  = _annotate(meds,  "Medication")
    supps_a = _annotate(supps, "Supplement")
    pepts_a = _annotate(pepts, "Peptide")

    all_items = meds_a + supps_a + pepts_a
    flagged   = [i for i in all_items if i.get("flag")]
    high_risk = [i for i in flagged if (i.get("flag") or {}).get("severity") == "HIGH"]
    notes     = [i for i in flagged if (i.get("flag") or {}).get("severity") == "NOTE"]

    return {
        "generated_at":  datetime.utcnow().isoformat() + "Z",
        "patient":       _patient(profile),
        "items": {
            "medications": meds_a,
            "supplements": supps_a,
            "peptides":    pepts_a,
        },
        "flagged": {
            "high_risk": high_risk,
            "notes":     notes,
            "total":     len(flagged),
        },
        "totals": {
            "medications": len(meds_a),
            "supplements": len(supps_a),
            "peptides":    len(pepts_a),
        },
        "disclaimer": (
            "This list is self-reported. Risk flags are based on commonly-cited "
            "perioperative considerations and do not constitute medical advice. "
            "Do not stop any prescribed medication without consulting the "
            "prescriber. Always disclose your complete supplement and peptide "
            "stack to the surgeon and anesthesiologist before any procedure."
        ),
    }
