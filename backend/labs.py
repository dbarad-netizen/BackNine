"""
Labs module for BackNine Health.
Stores blood panel results with reference ranges and trend tracking.
Data persisted to ~/.backnine/labs.json
"""

import io
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

BASE_DIR = Path.home() / ".backnine"

def _labs_file(user_id: str) -> Path:
    d = BASE_DIR / user_id
    d.mkdir(parents=True, exist_ok=True)
    return d / "labs.json"

# ── Reference ranges ──────────────────────────────────────────────────────────
# Each marker: { unit, low, high, optimal_low?, optimal_high?, description }
# "optimal" = functional medicine target range (often tighter than standard)

REFERENCE_RANGES: Dict[str, dict] = {
    # Metabolic
    "glucose":              {"unit": "mg/dL",  "low": 70,   "high": 99,   "optimal_low": 72,  "optimal_high": 90,  "label": "Fasting Glucose",       "group": "Metabolic"},
    "hba1c":                {"unit": "%",      "low": 4.0,  "high": 5.6,  "optimal_low": 4.5, "optimal_high": 5.4, "label": "HbA1c",                  "group": "Metabolic"},
    "insulin":              {"unit": "µIU/mL", "low": 2.0,  "high": 19.6, "optimal_low": 2.0, "optimal_high": 6.0, "label": "Fasting Insulin",        "group": "Metabolic"},
    # Lipids
    "total_cholesterol":    {"unit": "mg/dL",  "low": 100,  "high": 199,  "optimal_low": 150, "optimal_high": 180, "label": "Total Cholesterol",      "group": "Lipids"},
    "ldl":                  {"unit": "mg/dL",  "low": 0,    "high": 99,   "optimal_low": 50,  "optimal_high": 80,  "label": "LDL",                    "group": "Lipids"},
    "hdl":                  {"unit": "mg/dL",  "low": 40,   "high": 999,  "optimal_low": 60,  "optimal_high": 999, "label": "HDL",                    "group": "Lipids"},
    "triglycerides":        {"unit": "mg/dL",  "low": 0,    "high": 149,  "optimal_low": 0,   "optimal_high": 100, "label": "Triglycerides",          "group": "Lipids"},
    # Thyroid
    "tsh":                  {"unit": "mIU/L",  "low": 0.45, "high": 4.5,  "optimal_low": 1.0, "optimal_high": 2.5, "label": "TSH",                    "group": "Thyroid"},
    "t3_free":              {"unit": "pg/mL",  "low": 2.0,  "high": 4.4,  "optimal_low": 3.0, "optimal_high": 4.0, "label": "Free T3",                "group": "Thyroid"},
    "t4_free":              {"unit": "ng/dL",  "low": 0.82, "high": 1.77, "optimal_low": 1.0, "optimal_high": 1.5, "label": "Free T4",                "group": "Thyroid"},
    # Hormones
    "testosterone_total":   {"unit": "ng/dL",  "low": 300,  "high": 1000, "optimal_low": 550, "optimal_high": 900, "label": "Total Testosterone",     "group": "Hormones"},
    "testosterone_free":    {"unit": "pg/mL",  "low": 9.0,  "high": 30.0, "optimal_low": 15,  "optimal_high": 25,  "label": "Free Testosterone",      "group": "Hormones"},
    "estradiol":            {"unit": "pg/mL",  "low": 10,   "high": 40,   "optimal_low": 20,  "optimal_high": 30,  "label": "Estradiol (E2)",         "group": "Hormones"},
    "dhea_s":               {"unit": "µg/dL",  "low": 100,  "high": 500,  "optimal_low": 200, "optimal_high": 400, "label": "DHEA-S",                 "group": "Hormones"},
    "cortisol":             {"unit": "µg/dL",  "low": 6.0,  "high": 23.0, "optimal_low": 10,  "optimal_high": 18,  "label": "AM Cortisol",            "group": "Hormones"},
    # Inflammation
    "crp_hs":               {"unit": "mg/L",   "low": 0,    "high": 1.0,  "optimal_low": 0,   "optimal_high": 0.5, "label": "hsCRP",                  "group": "Inflammation"},
    "homocysteine":         {"unit": "µmol/L", "low": 0,    "high": 10.4, "optimal_low": 0,   "optimal_high": 7.0, "label": "Homocysteine",           "group": "Inflammation"},
    # Blood / Iron
    "ferritin":             {"unit": "ng/mL",  "low": 30,   "high": 400,  "optimal_low": 70,  "optimal_high": 200, "label": "Ferritin",               "group": "Blood"},
    "hemoglobin":           {"unit": "g/dL",   "low": 13.5, "high": 17.5, "optimal_low": 14,  "optimal_high": 17,  "label": "Hemoglobin",             "group": "Blood"},
    "hematocrit":           {"unit": "%",      "low": 38.3, "high": 50.3, "optimal_low": 42,  "optimal_high": 48,  "label": "Hematocrit",             "group": "Blood"},
    # Vitamins
    "vitamin_d":            {"unit": "ng/mL",  "low": 30,   "high": 100,  "optimal_low": 50,  "optimal_high": 80,  "label": "Vitamin D (25-OH)",       "group": "Vitamins"},
    "vitamin_b12":          {"unit": "pg/mL",  "low": 200,  "high": 900,  "optimal_low": 500, "optimal_high": 900, "label": "Vitamin B12",             "group": "Vitamins"},
    "magnesium":            {"unit": "mg/dL",  "low": 1.7,  "high": 2.2,  "optimal_low": 2.0, "optimal_high": 2.2, "label": "Magnesium",              "group": "Vitamins"},
    "zinc":                 {"unit": "µg/dL",  "low": 60,   "high": 120,  "optimal_low": 80,  "optimal_high": 110, "label": "Zinc",                   "group": "Vitamins"},
    # Kidney / Liver
    "creatinine":           {"unit": "mg/dL",  "low": 0.74, "high": 1.35, "optimal_low": 0.9,  "optimal_high": 1.2,  "label": "Creatinine",             "group": "Kidney/Liver"},
    "egfr":                 {"unit": "mL/min", "low": 60,   "high": 999,  "optimal_low": 90,   "optimal_high": 999,  "label": "eGFR",                   "group": "Kidney/Liver"},
    "bun":                  {"unit": "mg/dL",  "low": 6,    "high": 24,   "optimal_low": 10,   "optimal_high": 18,   "label": "BUN",                    "group": "Kidney/Liver"},
    "bun_creatinine_ratio": {"unit": "",       "low": 9,    "high": 20,   "optimal_low": 10,   "optimal_high": 16,   "label": "BUN/Creatinine Ratio",   "group": "Kidney/Liver"},
    "alt":                  {"unit": "U/L",    "low": 0,    "high": 40,   "optimal_low": 0,    "optimal_high": 25,   "label": "ALT",                    "group": "Kidney/Liver"},
    "ast":                  {"unit": "U/L",    "low": 0,    "high": 40,   "optimal_low": 0,    "optimal_high": 25,   "label": "AST",                    "group": "Kidney/Liver"},
    "alkaline_phosphatase": {"unit": "IU/L",   "low": 44,   "high": 123,  "optimal_low": 50,   "optimal_high": 80,   "label": "Alkaline Phosphatase",   "group": "Kidney/Liver"},
    "bilirubin_total":      {"unit": "mg/dL",  "low": 0.0,  "high": 1.2,  "optimal_low": 0.4,  "optimal_high": 0.9,  "label": "Bilirubin, Total",       "group": "Kidney/Liver"},
    # Electrolytes / CMP
    "sodium":               {"unit": "mmol/L", "low": 134,  "high": 144,  "optimal_low": 136,  "optimal_high": 142,  "label": "Sodium",                 "group": "Electrolytes"},
    "potassium":            {"unit": "mmol/L", "low": 3.5,  "high": 5.2,  "optimal_low": 4.0,  "optimal_high": 4.5,  "label": "Potassium",              "group": "Electrolytes"},
    "chloride":             {"unit": "mmol/L", "low": 96,   "high": 106,  "optimal_low": 100,  "optimal_high": 106,  "label": "Chloride",               "group": "Electrolytes"},
    "co2":                  {"unit": "mmol/L", "low": 20,   "high": 29,   "optimal_low": 24,   "optimal_high": 28,   "label": "CO2 (Bicarbonate)",      "group": "Electrolytes"},
    "calcium":              {"unit": "mg/dL",  "low": 8.7,  "high": 10.2, "optimal_low": 9.2,  "optimal_high": 9.8,  "label": "Calcium",                "group": "Electrolytes"},
    "protein_total":        {"unit": "g/dL",   "low": 6.0,  "high": 8.5,  "optimal_low": 6.9,  "optimal_high": 7.4,  "label": "Protein, Total",         "group": "Electrolytes"},
    "albumin":              {"unit": "g/dL",   "low": 3.8,  "high": 4.9,  "optimal_low": 4.2,  "optimal_high": 4.8,  "label": "Albumin",                "group": "Electrolytes"},
    "globulin":             {"unit": "g/dL",   "low": 1.5,  "high": 4.5,  "optimal_low": 2.0,  "optimal_high": 3.0,  "label": "Globulin",               "group": "Electrolytes"},
    # CBC
    "wbc":                  {"unit": "x10³/µL","low": 3.4,  "high": 10.8, "optimal_low": 5.0,  "optimal_high": 7.0,  "label": "WBC",                    "group": "CBC"},
    "rbc":                  {"unit": "x10⁶/µL","low": 4.14, "high": 5.80, "optimal_low": 4.5,  "optimal_high": 5.3,  "label": "RBC",                    "group": "CBC"},
    "mcv":                  {"unit": "fL",     "low": 79,   "high": 97,   "optimal_low": 82,   "optimal_high": 90,   "label": "MCV",                    "group": "CBC"},
    "mch":                  {"unit": "pg",     "low": 26.6, "high": 33.0, "optimal_low": 28,   "optimal_high": 32,   "label": "MCH",                    "group": "CBC"},
    "mchc":                 {"unit": "g/dL",   "low": 31.5, "high": 35.7, "optimal_low": 33,   "optimal_high": 35,   "label": "MCHC",                   "group": "CBC"},
    "rdw":                  {"unit": "%",      "low": 11.6, "high": 15.4, "optimal_low": 11.6, "optimal_high": 13.0, "label": "RDW",                    "group": "CBC"},
    "platelets":            {"unit": "x10³/µL","low": 150,  "high": 450,  "optimal_low": 200,  "optimal_high": 350,  "label": "Platelets",              "group": "CBC"},
    # Iron Panel
    "iron_serum":           {"unit": "µg/dL",  "low": 38,   "high": 169,  "optimal_low": 60,   "optimal_high": 130,  "label": "Iron, Serum",            "group": "Iron"},
    "tibc":                 {"unit": "µg/dL",  "low": 250,  "high": 450,  "optimal_low": 250,  "optimal_high": 370,  "label": "TIBC",                   "group": "Iron"},
    "uibc":                 {"unit": "µg/dL",  "low": 111,  "high": 343,  "optimal_low": 150,  "optimal_high": 300,  "label": "UIBC",                   "group": "Iron"},
    "iron_saturation":      {"unit": "%",      "low": 15,   "high": 55,   "optimal_low": 25,   "optimal_high": 35,   "label": "Iron Saturation",        "group": "Iron"},
    # Other markers
    "psa":                  {"unit": "ng/mL",  "low": 0.0,  "high": 4.0,  "optimal_low": 0.0,  "optimal_high": 2.0,  "label": "PSA",                    "group": "Other"},
    "apolipoprotein_b":     {"unit": "mg/dL",  "low": 0,    "high": 90,   "optimal_low": 0,    "optimal_high": 80,   "label": "Apolipoprotein B",       "group": "Other"},
    "vldl":                 {"unit": "mg/dL",  "low": 5,    "high": 40,   "optimal_low": 5,    "optimal_high": 20,   "label": "VLDL Cholesterol",       "group": "Other"},
}

LAB_GROUPS = ["Metabolic", "Lipids", "Thyroid", "Hormones", "Inflammation", "Blood", "Vitamins", "Kidney/Liver", "Electrolytes", "CBC", "Iron", "Other"]


def _load(user_id: str) -> dict:
    f = _labs_file(user_id)
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    # One-time migration: copy data from the old single-user location
    legacy = BASE_DIR / "labs.json"
    if legacy.exists():
        try:
            data = json.loads(legacy.read_text())
            f.write_text(json.dumps(data, indent=2, default=str))
            legacy.rename(legacy.with_suffix(".json.migrated"))
            return data
        except Exception:
            pass
    return {"entries": []}


def _save(data: dict, user_id: str) -> None:
    _labs_file(user_id).write_text(json.dumps(data, indent=2, default=str))


def get_entries(user_id: str = "default") -> List[dict]:
    data = _load(user_id)
    return sorted(data.get("entries", []), key=lambda x: x["date"])


def add_entry(date_str: str, values: dict, notes: str = "", user_id: str = "default") -> dict:
    """values = {marker_key: float_value, ...}"""
    data  = _load(user_id)
    entry = {
        "id":        str(uuid.uuid4())[:8],
        "date":      date_str,
        "logged_at": datetime.now().isoformat(),
        "notes":     notes,
    }
    # Validate and store only known markers
    for key, val in values.items():
        if key in REFERENCE_RANGES and val is not None:
            try:
                entry[key] = round(float(val), 3)
            except (TypeError, ValueError):
                pass
    data["entries"].append(entry)
    _save(data, user_id)
    return entry


def delete_entry(entry_id: str, user_id: str = "default") -> bool:
    data = _load(user_id)
    orig = data.get("entries", [])
    data["entries"] = [e for e in orig if e["id"] != entry_id]
    if len(data["entries"]) == len(orig):
        return False
    _save(data, user_id)
    return True


def parse_pdf(file_bytes: bytes) -> Tuple[Optional[str], Dict[str, float]]:
    """
    Extract marker values and date from a lab report PDF.
    Returns (date_str_or_None, {marker_key: value}).

    Strategy: extract all text from all pages, then scan each line for
    a number that follows (or precedes) a recognised marker name alias.
    """
    import pdfplumber

    # ── Alias map: every phrase that could appear in a real lab report ─────────
    # Covers Quest, LabCorp, hospital portal, and common shorthand variations.
    ALIASES: Dict[str, List[str]] = {
        "glucose":            [
            "glucose", "fasting glucose", "glucose, serum", "glucose serum",
            "blood glucose", "glucose, plasma", "glucose, fasting",
        ],
        "hba1c":              [
            "hba1c", "hemoglobin a1c", "haemoglobin a1c", "glycated hemoglobin",
            "a1c", "hgb a1c", "glycohemoglobin", "hemoglobin a1c (hba1c)",
            "glycated hgb",
        ],
        "insulin":            [
            "insulin", "fasting insulin", "insulin, serum", "insulin fasting",
            "insulin level", "insulin, fasting",
        ],
        "total_cholesterol":  [
            "total cholesterol", "cholesterol, total", "cholesterol total",
            "cholesterol", "total chol",
        ],
        "ldl":                [
            "ldl", "ldl cholesterol", "ldl-c", "low density lipoprotein",
            "ldl chol", "ldl chol calc", "ldl cholesterol calc",
            "ldl-cholesterol", "ldl calc", "ldl (calc)", "calculated ldl",
        ],
        "hdl":                [
            "hdl", "hdl cholesterol", "hdl-c", "high density lipoprotein",
            "hdl chol", "hdl-cholesterol",
        ],
        "triglycerides":      [
            "triglycerides", "triglyceride", "trigs", "trig", "trigl",
        ],
        "tsh":                [
            "tsh", "thyroid stimulating hormone", "thyrotropin",
            "tsh, 3rd generation", "tsh reflex", "tsh (3rd generation)",
        ],
        "t3_free":            [
            "free t3", "t3, free", "triiodothyronine, free", "ft3",
            "t3 free", "t3 (free)", "triiodothyronine (t3), free",
            "t3, free serum",
        ],
        "t4_free":            [
            "free t4", "t4, free", "thyroxine, free", "ft4",
            "t4 free", "t4 (free)", "thyroxine (t4), free",
            "t4, free serum", "free thyroxine",
        ],
        "testosterone_total": [
            "testosterone, total", "testosterone total", "total testosterone",
            "testosterone, serum", "testosterone, total, lc/ms",
            "testosterone, total, lc/ms/ms", "testosterone, total serum",
            "testosterone total lc/ms", "testosterone",
        ],
        "testosterone_free":  [
            "free testosterone", "testosterone, free", "testosterone free",
            "testosterone, free (direct)", "testosterone, free and weakly bound",
            "free testosterone, direct", "testosterone, free, serum",
        ],
        "estradiol":          [
            "estradiol", "estradiol, serum", "e2", "17-beta estradiol",
            "oestradiol", "estradiol, lc/ms/ms",
        ],
        "dhea_s":             [
            "dhea-s", "dheas", "dhea sulfate", "dehydroepiandrosterone sulfate",
            "dhea-sulfate", "dhea, sulfate", "dhea-s, serum",
            "dehydroepiandrosterone sulfate, serum",
        ],
        "cortisol":           [
            "cortisol", "cortisol, total", "am cortisol", "cortisol, am",
            "cortisol (am)", "cortisol am", "morning cortisol",
        ],
        "crp_hs":             [
            "hscrp", "hs-crp", "c-reactive protein, cardiac",
            "c-reactive protein (high sensitivity)", "c reactive protein",
            "c-reactive protein", "high sensitivity crp", "crp, cardiac",
            "crp high sensitivity", "high-sensitivity c-reactive protein",
        ],
        "homocysteine":       [
            "homocysteine", "homocysteine, plasma", "homocysteine, serum",
            "total homocysteine",
        ],
        "ferritin":           [
            "ferritin", "ferritin, serum", "serum ferritin",
        ],
        "hemoglobin":         [
            "hemoglobin", "haemoglobin", "hgb",
        ],
        "hematocrit":         [
            "hematocrit", "haematocrit", "hct",
        ],
        "vitamin_d":          [
            "vitamin d", "25-oh vitamin d", "25-hydroxyvitamin d",
            "vitamin d, 25-oh", "25(oh)d", "vitamin d, 25-hydroxy",
            "25-hydroxyvitamin d, d2+d3", "vitamin d total",
            "25-oh vit d", "vitamin d3", "calcidiol", "25-hydroxy vitamin d",
            "vitamin d, 25 hydroxy",
        ],
        "vitamin_b12":        [
            "vitamin b12", "b12", "cobalamin", "vitamin b-12",
            "vitamin b12, serum", "cyanocobalamin",
        ],
        "magnesium":          [
            "magnesium", "mg, serum", "magnesium, serum",
            "magnesium, rbc", "magnesium level",
        ],
        "zinc":               [
            "zinc", "zinc, serum", "zinc, plasma",
        ],
        "creatinine":         [
            "creatinine", "creatinine, serum", "serum creatinine",
            "creatinine, blood",
        ],
        "egfr":               [
            "egfr", "gfr", "estimated gfr", "glomerular filtration",
            "egfr, ckd-epi", "estimated glomerular filtration rate",
            "gfr estimated", "egfr (ckd-epi)", "non-african american",
        ],
        "alt":                [
            "alt", "alanine aminotransferase", "alanine transaminase",
            "sgpt", "alt (sgpt)", "alanine aminotransferase (alt)",
        ],
        "ast":                [
            "ast", "aspartate aminotransferase", "aspartate transaminase",
            "sgot", "ast (sgot)", "aspartate aminotransferase (ast)",
        ],
        "bun":                [
            "bun", "blood urea nitrogen", "urea nitrogen",
            "urea nitrogen, blood",
        ],
        "bun_creatinine_ratio": [
            "bun/creatinine ratio", "bun creatinine ratio",
            "bun/creat ratio", "bun/creat",
        ],
        "alkaline_phosphatase": [
            "alkaline phosphatase", "alk phos", "alp",
            "alkaline phosphatase, serum",
        ],
        "bilirubin_total":    [
            "bilirubin, total", "bilirubin total", "total bilirubin",
            "bilirubin",
        ],
        "sodium":             [
            "sodium", "sodium, serum", "sodium, blood",
        ],
        "potassium":          [
            "potassium", "potassium, serum", "potassium, blood",
        ],
        "chloride":           [
            "chloride", "chloride, serum",
        ],
        "co2":                [
            "carbon dioxide, total", "co2", "bicarbonate",
            "carbon dioxide", "co2, total",
        ],
        "calcium":            [
            "calcium", "calcium, serum", "calcium, total",
        ],
        "protein_total":      [
            "protein, total", "total protein", "protein total",
        ],
        "albumin":            [
            "albumin", "albumin, serum",
        ],
        "globulin":           [
            "globulin, total", "total globulin", "globulin",
        ],
        "wbc":                [
            "wbc", "white blood cell", "white blood cells",
            "leukocytes", "white blood count",
        ],
        "rbc":                [
            "rbc", "red blood cell", "red blood cells",
            "erythrocytes", "red blood count",
        ],
        "mcv":                [
            "mcv", "mean corpuscular volume",
        ],
        "mch":                [
            "mch", "mean corpuscular hemoglobin",
        ],
        "mchc":               [
            "mchc", "mean corpuscular hemoglobin concentration",
            "mean corp hgb conc",
        ],
        "rdw":                [
            "rdw", "red cell distribution width", "rdw-cv",
        ],
        "platelets":          [
            "platelets", "platelet count", "plt", "thrombocytes",
        ],
        "iron_serum":         [
            "iron, serum", "serum iron", "iron, total", "iron serum",
            "iron",
        ],
        "tibc":               [
            "tibc", "iron bind.cap.(tibc)", "iron bind.cap",
            "iron binding capacity", "total iron binding capacity",
            "iron and tibc",
        ],
        "uibc":               [
            "uibc", "unsaturated iron binding capacity",
            "unsat. iron binding cap.",
        ],
        "iron_saturation":    [
            "iron saturation", "transferrin saturation",
            "% saturation", "iron sat",
        ],
        "psa":                [
            "prostate specific ag", "psa", "prostate-specific antigen",
            "prostate specific antigen",
        ],
        "apolipoprotein_b":   [
            "apolipoprotein b", "apo b", "apob", "apolipoprotein b-100",
        ],
        "vldl":               [
            "vldl", "vldl cholesterol", "vldl chol",
            "vldl cholesterol cal", "very low density lipoprotein",
        ],
    }

    # Build a flat lookup: lowercase alias → marker key
    alias_lookup: Dict[str, str] = {}
    for key, aliases in ALIASES.items():
        for a in aliases:
            alias_lookup[a.lower()] = key

    # Patterns
    num_pat   = re.compile(r"(\d+\.?\d*)")
    date_pats = [
        re.compile(r"((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})", re.I),
        re.compile(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})"),
        re.compile(r"(\d{4}-\d{2}-\d{2})"),
    ]

    # Plausibility bounds per marker — generous (allow 10x above optimal_high,
    # 0.1x below low) so we catch real outliers without grabbing page/ref numbers.
    BOUNDS: Dict[str, Tuple[float, float]] = {}
    for k, ref in REFERENCE_RANGES.items():
        lo  = ref.get("low",  0)
        hi  = ref.get("high", 9999)
        BOUNDS[k] = (max(0.0, lo * 0.05), min(10000.0, hi * 8))

    # Range-pair pattern: "N-N" or "N – N" (reference intervals)
    range_pair_pat = re.compile(r"\d+\.?\d*\s*[-–]\s*\d+\.?\d*")
    # Comparison ref: "<N" or ">N"
    cmp_ref_pat    = re.compile(r"[<>]=?\s*\d+\.?\d*")

    # Pattern for standalone numbers only — \b prevents matching digits
    # that are embedded inside words like "A1c" or "x10E3"
    standalone_num = re.compile(r"(?<![A-Za-z])\b(\d+\.?\d*)\b(?!\w)")

    def _pick_result(line: str, key: str) -> Optional[float]:
        """
        Extract the most likely result value from a single line.
        Strategy:
          1. Strip % glued to numbers (e.g. "5.4%" → "5.4 ").
          2. Find reference-range spans (N-N).  Numbers that appear BEFORE
             the first range are strong candidates for the result.
          3. If nothing before the range, try numbers after it (some formats
             put result last).
          4. Apply per-marker plausibility bounds to reject ref-range numbers,
             page numbers, years, etc.
          5. Use standalone_num pattern to avoid digits inside words (A1c → 1).
        """
        lo_bound, hi_bound = BOUNDS.get(key, (0.0, 10000.0))

        # Normalise: detach % from digits, convert en-dash to hyphen
        clean = re.sub(r"(\d)%", r"\1 ", line)
        clean = clean.replace("–", "-")

        ranges = list(range_pair_pat.finditer(clean))

        def plausible(v: float) -> bool:
            return lo_bound <= v <= hi_bound

        def find_standalone(text: str) -> List[float]:
            return [float(m.group(1)) for m in standalone_num.finditer(text)]

        if ranges:
            # Numbers strictly before the first range span
            before = clean[:ranges[0].start()]
            before_nums = find_standalone(before)
            # Take the last plausible number before the range (closest to it)
            for v in reversed(before_nums):
                if plausible(v):
                    return v
            # Fallback: numbers after the last range span
            after = clean[ranges[-1].end():]
            after_nums = find_standalone(after)
            for v in after_nums:
                if plausible(v):
                    return v
            # Last resort: any plausible standalone number not inside a range span
            range_chars = set()
            for m in ranges:
                range_chars.update(range(m.start(), m.end()))
            for m in standalone_num.finditer(clean):
                if m.start() not in range_chars:
                    v = float(m.group(1))
                    if plausible(v):
                        return v
        else:
            # No range pattern found — skip comparison-ref tokens (<N, >N)
            no_cmp = cmp_ref_pat.sub(" ", clean)
            for v in find_standalone(no_cmp):
                if plausible(v):
                    return v

        return None

    text_pages: List[str] = []
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                text_pages.append(t)
    except Exception:
        return None, {}

    full_text = "\n".join(text_pages)
    lines = full_text.splitlines()

    # ── Extract date ───────────────────────────────────────────────────────────
    found_date: Optional[str] = None
    for line in lines:
        for pat in date_pats:
            m = pat.search(line)
            if m:
                raw = m.group(1).strip().rstrip(",")
                for fmt in ("%B %d %Y", "%b %d %Y", "%b. %d %Y", "%m/%d/%Y", "%m-%d-%Y",
                            "%m/%d/%y", "%Y-%m-%d", "%d/%m/%Y"):
                    try:
                        found_date = datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        pass
                if found_date:
                    break
        if found_date:
            break

    # ── Extract marker values ──────────────────────────────────────────────────
    # Sort aliases longest-first so more specific phrases match before short ones
    sorted_aliases = sorted(alias_lookup.items(), key=lambda x: -len(x[0]))

    extracted: Dict[str, float] = {}

    # Order-code pattern: parenthesised 5-or-6 digit lab order codes
    # e.g. "(001453)" or "(322000)" — these appear in "Tests Ordered" headers
    order_code_pat = re.compile(r"\(\d{5,6}\)")

    for i, line in enumerate(lines):
        lower = line.lower()

        # Skip "Tests Ordered" section lines (contain lab order codes)
        if order_code_pat.search(line):
            continue

        # Skip pure header/column-label lines
        if re.search(r"\breference\s+interval\b|\bref\s+range\b|\bstandard\s+range\b", lower):
            continue

        matched_key: Optional[str] = None
        for alias, key in sorted_aliases:
            # Use (?<!\w) / (?!\w) so aliases ending in non-word chars
            # like "iron bind.cap.(tibc)" still match correctly.
            if re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", lower):
                matched_key = key
                break

        if not matched_key or matched_key in extracted:
            continue

        # Try the matched line, then next 4 lines (multi-line PDF formats)
        for candidate_line in [line] + lines[i + 1: i + 5]:
            val = _pick_result(candidate_line, matched_key)
            if val is not None:
                extracted[matched_key] = val
                break

    return found_date, extracted


def score_entry(entry: dict) -> List[dict]:
    """
    For each marker present in the entry, return a status flag:
      optimal | normal | low | high
    """
    scored = []
    for key, ref in REFERENCE_RANGES.items():
        val = entry.get(key)
        if val is None:
            continue
        opt_lo = ref.get("optimal_low", ref["low"])
        opt_hi = ref.get("optimal_high", ref["high"])
        lo, hi = ref["low"], ref["high"]

        if val < lo:
            status = "low"
        elif val > hi:
            status = "high"
        elif opt_lo <= val <= opt_hi:
            status = "optimal"
        else:
            status = "normal"

        scored.append({
            "key":    key,
            "label":  ref["label"],
            "group":  ref["group"],
            "value":  val,
            "unit":   ref["unit"],
            "status": status,
            "range":  f"{ref['low']}–{ref['high']} {ref['unit']}",
            "optimal_range": f"{opt_lo}–{opt_hi} {ref['unit']}",
        })
    return scored
