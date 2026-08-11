"""
Lab OCR stress test — synthetic fixtures mimicking the three most common
lab report formats (Quest, Labcorp, hospital two-column). Verifies
labs.parse_pdf extracts the expected markers from each.

Run:  python3 tests/test_labs_ocr_stress.py     (from backend/)

Generates PDFs with reportlab (text-native, same class of PDF as real
portal downloads), runs the production parser, and reports hit/miss per
marker. Exit code 1 if any format falls below its expected hit rate.

David 2026-08-11 — defense before the Christian demo.
"""

import io
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as pdf_canvas

import labs


# ── Fixture builders ────────────────────────────────────────────────────

def _build_pdf(lines: list[str]) -> bytes:
    """Simple text-native PDF: one line of text per row, top-down."""
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    _, height = letter
    y = height - 50
    for line in lines:
        c.drawString(40, y, line)
        y -= 16
        if y < 50:
            c.showPage()
            y = height - 50
    c.save()
    return buf.getvalue()


QUEST_STYLE = [
    "Quest Diagnostics Incorporated",
    "Patient: BARAD, DAVID    DOB: 09/03/1968",
    "Collected: 03/12/2026 09:14    Reported: 03/13/2026",
    "",
    "Test Name                          In Range   Out Of Range   Reference Range",
    "GLUCOSE                            98                        65-99 mg/dL",
    "HEMOGLOBIN A1c                     5.2                       <5.7 %",
    "CHOLESTEROL, TOTAL                 138                       100-199 mg/dL",
    "HDL CHOLESTEROL                    65                        > OR = 40 mg/dL",
    "TRIGLYCERIDES                      64                        <150 mg/dL",
    "LDL-CHOLESTEROL                    60                        <100 mg/dL (calc)",
    "CREATININE                         1.29                      0.60-1.35 mg/dL",
    "eGFR                               65                        > OR = 60 mL/min/1.73m2",
    "BUN                                22                        7-25 mg/dL",
    "SODIUM                             142                       135-146 mmol/L",
    "POTASSIUM                          4.2                       3.5-5.3 mmol/L",
    "ALT                                24                        9-46 U/L",
    "AST                                18                        10-35 U/L",
    "TSH                                2.31                      0.40-4.50 mIU/L",
    "VITAMIN D, 25-OH, TOTAL            52                        30-100 ng/mL",
    "FERRITIN                           132                       38-380 ng/mL",
]
QUEST_EXPECT = {
    "glucose": 98, "hba1c": 5.2, "total_cholesterol": 138, "hdl": 65,
    "triglycerides": 64, "ldl": 60, "creatinine": 1.29, "egfr": 65,
    "bun": 22, "sodium": 142, "potassium": 4.2, "alt": 24, "ast": 18,
    "tsh": 2.31, "vitamin_d": 52, "ferritin": 132,
}

LABCORP_STYLE = [
    "Labcorp",
    "Specimen ID: 123-456-7890    Acct #: 04567890",
    "Date Collected: 03/12/2026    Date Reported: 03/14/2026",
    "",
    "TESTS                       RESULT    FLAG    UNITS      REFERENCE INTERVAL",
    "Glucose                     98                mg/dL      70-99",
    "Hemoglobin A1c              5.2               %          4.8-5.6",
    "Cholesterol, Total          138               mg/dL      100-199",
    "Triglycerides               64                mg/dL      0-149",
    "HDL Cholesterol             65                mg/dL      >39",
    "LDL Chol Calc (NIH)         60                mg/dL      0-99",
    "Creatinine                  1.29              mg/dL      0.76-1.27",
    "eGFR If NonAfricn Am        65                mL/min/1.73 >59",
    "BUN                         22                mg/dL      6-24",
    "Hemoglobin                  15.6              g/dL       13.0-17.7",
    "Hematocrit                  48.7              %          37.5-51.0",
    "Vitamin B12                 642               pg/mL      232-1245",
    "TSH                         2.31              uIU/mL     0.450-4.500",
    "Testosterone                623               ng/dL      264-916",
]
LABCORP_EXPECT = {
    "glucose": 98, "hba1c": 5.2, "total_cholesterol": 138,
    "triglycerides": 64, "hdl": 65, "ldl": 60, "creatinine": 1.29,
    "egfr": 65, "bun": 22, "hemoglobin": 15.6, "hematocrit": 48.7,
    "vitamin_b12": 642, "tsh": 2.31, "testosterone_total": 623,
}

HOSPITAL_STYLE = [
    "MOUNT SINAI HEALTH SYSTEM — LABORATORY REPORT",
    "Patient: David Barad   MRN: 000123456",
    "Collection Date/Time: 12-Mar-2026 09:14",
    "",
    "BASIC METABOLIC PANEL",
    "  Sodium: 142 mmol/L (Reference: 136 - 145)",
    "  Potassium: 4.2 mmol/L (Reference: 3.5 - 5.1)",
    "  Chloride: 105 mmol/L (Reference: 98 - 107)",
    "  Glucose Level: 98 mg/dL (Reference: 70 - 99)",
    "  BUN: 22 mg/dL (Reference: 8 - 23)",
    "  Creatinine: 1.29 mg/dL (Reference: 0.7 - 1.3)",
    "",
    "LIPID PANEL",
    "  Total Cholesterol: 138 mg/dL (Reference: < 200)",
    "  Triglycerides: 64 mg/dL (Reference: < 150)",
    "  HDL: 65 mg/dL (Reference: > 40)",
    "  LDL Calculated: 60 mg/dL (Reference: < 100)",
    "",
    "HEMATOLOGY",
    "  Hemoglobin: 15.6 g/dL (Reference: 13.5 - 17.5)",
    "  Hematocrit: 48.7 % (Reference: 41 - 53)",
    "  Ferritin: 132 ng/mL (Reference: 30 - 400)",
]
HOSPITAL_EXPECT = {
    "sodium": 142, "potassium": 4.2, "glucose": 98,
    "bun": 22, "creatinine": 1.29,
    "total_cholesterol": 138, "triglycerides": 64, "hdl": 65, "ldl": 60,
    "hemoglobin": 15.6, "hematocrit": 48.7, "ferritin": 132,
}


# ── Runner ──────────────────────────────────────────────────────────────

def run_fixture(name: str, lines: list[str], expect: dict) -> tuple[int, int, list[str]]:
    pdf = _build_pdf(lines)
    date_str, extracted = labs.parse_pdf(pdf)
    hits, misses = 0, []
    for key, want in expect.items():
        got = extracted.get(key)
        if got is not None and abs(float(got) - float(want)) < 0.01:
            hits += 1
        else:
            misses.append(f"{key}: want {want}, got {got}")
    # Extras that we didn't expect but got — could be false positives
    extras = {k: v for k, v in extracted.items() if k not in expect}
    print(f"\n=== {name} ===")
    print(f"date: {date_str}")
    print(f"hits: {hits}/{len(expect)}")
    if misses:
        print("MISSES:")
        for m in misses:
            print(f"  ✗ {m}")
    if extras:
        print("EXTRAS (check for false positives):")
        for k, v in extras.items():
            print(f"  ? {k} = {v}")
    return hits, len(expect), misses


def main() -> int:
    total_hits, total_expect = 0, 0
    failures = []
    for name, lines, expect in [
        ("QUEST", QUEST_STYLE, QUEST_EXPECT),
        ("LABCORP", LABCORP_STYLE, LABCORP_EXPECT),
        ("HOSPITAL", HOSPITAL_STYLE, HOSPITAL_EXPECT),
    ]:
        hits, n, misses = run_fixture(name, lines, expect)
        total_hits += hits
        total_expect += n
        # Each format should hit at least 85%
        if hits / n < 0.85:
            failures.append(f"{name}: {hits}/{n} below 85% threshold")

    print(f"\n{'='*40}")
    print(f"TOTAL: {total_hits}/{total_expect} ({round(100*total_hits/total_expect)}%)")
    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  ✗ {f}")
        return 1
    print("ALL FORMATS PASS ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
