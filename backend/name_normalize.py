"""
Med / supplement name normalization for doctor-facing surfaces.

Fable Round 2 caught "taladafil" (tadalafil) and "Reservatol"
(Resveratrol) passing through to the Doctor Handoff. A physician
scanning a med list expects the correct spelling — misspellings hurt
credibility and, more critically, could mislead a real drug-drug
interaction check.

Scope: we do NOT overreach with medical judgment. We only:
  1. Fix known misspellings against a curated list of drugs +
     supplements common to men-50+.
  2. Present the canonical name preserved from the user's original if
     they typed something recognized as correct.

If we can't confidently match, we return the input unchanged (never
"correct" toward a random RxNorm entry that could be wrong). Better
to show the user's typo than to silently change one drug to another.

Public API:
  normalize_name(raw: str) → str
      Canonical name if a confident match; else the input trimmed.
"""

from __future__ import annotations

import re
from typing import Optional


# ── Canonical names + common misspellings ───────────────────────────────
# Left side = canonical (properly-spelled) name. Right side = variants
# we've seen in the wild that should snap to it. All lowercase for the
# comparison; the canonical case is applied on output.
_KNOWN: dict[str, tuple[str, ...]] = {
    # BP / cardiac
    "Losartan":              ("lozartan", "losertin", "losarten"),
    "Valsartan":             ("valsertan", "valsertin"),
    "Amlodipine":            ("amlodapine", "amladipine", "amilodipine"),
    "Lisinopril":            ("lisonopril", "lysinopril", "lisinipril"),
    "Metoprolol":            ("metaprolol", "metropolol"),
    "Atorvastatin":          ("atorvistatin", "atrovastatin", "atorvistatin"),
    "Rosuvastatin":          ("rosuvistatin", "rosuvasatin"),
    "Doxazosin":             ("doxozosin", "doxasosin", "dozaxosin"),
    "Aspirin":               ("asprin", "aspirn"),
    # Diabetes / metabolic
    "Metformin":             ("metformen", "metfomin"),
    "Semaglutide":           ("semiglutide", "semaglutid", "semiglutid"),
    "Tirzepatide":           ("terzepatide", "tirzepitide"),
    "Ozempic":               ("ozempyc", "ozempek"),
    "Mounjaro":              ("moujaro", "mounjuro"),
    # Men's health
    "Tadalafil":             ("taladafil", "tadalifil", "tadalifel"),
    "Sildenafil":            ("sildinafil", "sildenifil"),
    "Finasteride":           ("finestride", "finestaride", "finasteroid"),
    "Dutasteride":           ("dutasteroid", "dutastride"),
    "Testosterone Cypionate":("test cyp", "test-cyp", "cypionate"),
    # Sleep / mental health (common)
    "Trazodone":             ("trazadone", "trazedone"),
    "Zolpidem":              ("zolpedem", "zolpedin"),
    "Melatonin":             ("melitonin", "melatonen"),
    "Escitalopram":          ("escitilopram", "essitalopram"),
    "Sertraline":            ("sertrilene", "sertrilene"),
    # Thyroid
    "Levothyroxine":         ("levothyroxin", "levothroxine"),
    # Peptides (common longevity stack)
    "BPC-157":               ("bpc157", "bpc 157"),
    "TB-500":                ("tb500", "tb 500"),
    "CJC-1295":              ("cjc1295", "cjc 1295"),
    "Ipamorelin":            ("ipamerelin", "ipamerlen"),
    "Epithalon":             ("epitalon", "epithlon"),
    "Thymosin Alpha-1":      ("thymosin alpha 1", "thymosin a1"),
    # Common supplements often misspelled
    "Resveratrol":           ("reservatol", "resveritrol", "resvertrol"),
    "Curcumin":              ("curcimin", "curkumin"),
    "Ashwagandha":           ("ashwaganda", "aswaganda", "ashwagondha"),
    "Rhodiola":              ("rodiola", "rhodeola"),
    "Berberine":             ("berbarine", "berbereen"),
    "Quercetin":             ("quercitin", "quersetin"),
    "N-Acetylcysteine (NAC)":("nac", "n-acetyl cysteine", "n acetylcysteine"),
    "Coenzyme Q10 (CoQ10)":  ("coq10", "co-q10", "coq 10", "coenzyme q-10"),
    "Alpha-Lipoic Acid":     ("alpha lipoic acid", "ala", "a-lipoic acid"),
    "Magnesium Glycinate":   ("mag glycinate", "magnesium glycinat"),
    "Magnesium Threonate":   ("mag threonate", "l-threonate"),
    "Vitamin D3":            ("vit d3", "vitamin d-3", "cholecalciferol"),
    "Vitamin K2":            ("vit k2", "mk-7", "mk7"),
    "Omega-3":               ("fish oil", "omega 3", "epa/dha", "epa dha"),
    "Creatine Monohydrate":  ("creatine", "creatine mono"),
    "L-Theanine":            ("theanine", "l theanine"),
    "Zinc":                  ("zinc picolinate", "zinc glycinate"),
    "Boron":                 ("boron glycinate", "boron citrate"),
    "Taurine":               ("taurin", "l-taurine"),
    "Glycine":               ("l-glycine",),
}


# Build a fast lookup: variant.lower() → canonical name
_LOOKUP: dict[str, str] = {}
for canonical, variants in _KNOWN.items():
    _LOOKUP[canonical.lower()] = canonical
    for v in variants:
        _LOOKUP[v.lower()] = canonical


_SPACE_RUN = re.compile(r"\s+")
_TRAILING_PARENS = re.compile(r"\s*\([^)]*\)\s*$")


def _core(name: str) -> str:
    """Strip trailing parenthetical dose ("Losartan (50mg)" → "Losartan")
    for match lookup. The user's original dose text is preserved for
    display; only the match key is stripped."""
    s = _TRAILING_PARENS.sub("", name).strip()
    return _SPACE_RUN.sub(" ", s)


def normalize_name(raw: str) -> str:
    """Return the canonical name if the input matches a known variant.
    Otherwise return the input trimmed. Never invents a "correction"
    — a match must be exact against the variant list (or a case-
    insensitive equal-string match against the canonical name)."""
    if not raw or not isinstance(raw, str):
        return raw or ""
    trimmed = raw.strip()
    if not trimmed:
        return ""
    core = _core(trimmed).lower()
    match = _LOOKUP.get(core)
    if match:
        # Preserve any trailing parenthetical (dose, form) the user
        # supplied — replace only the leading name portion.
        tail = ""
        m   = _TRAILING_PARENS.search(trimmed)
        if m:
            tail = " " + m.group(0).strip()
        return match + tail
    return trimmed


__all__ = ["normalize_name"]
