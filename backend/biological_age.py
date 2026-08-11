"""
Biological Age v1 — BackNine's answer to Bevel's headline metric.

Not a clinical epigenetic age (that would need DNA methylation).
Instead: an evidence-informed heuristic that combines the markers we
actually have — wearable-derived (HRV, RHR, VO2 max, sleep, body fat)
and lab-derived (BP, HbA1c, LDL, hsCRP) — into a single "your body
looks like a X-year-old" number.

Design principles:
  - Transparent, not black-box. Every marker's contribution is shown
    ("HRV of 47ms is 8ms above expected for age 57 → makes you look
    ~3 years younger"). This is the anti-Bevel move — their user
    complaint is opacity.
  - Age- and sex-adjusted. A 60-year-old with 40ms HRV is EXCELLENT
    for their age; a 25-year-old with the same number is average.
    We use age-appropriate norms, not fixed cutoffs.
  - Higher-signal markers weight more. VO2 max and BP are among the
    strongest all-cause mortality predictors (Blair et al., Ross et
    al.), so they get more weight than steps.
  - Explicit confidence chip. 6+ markers → high; 3-5 → medium; <3 →
    hidden. Don't fake precision with 1 data point.
  - Weekly cadence, cached. Recompute Sunday 6am; show weekly delta
    so users can see effort translating (or not).
  - Caveat honestly. Bio Age is a heuristic; NOT a diagnosis and NOT
    equivalent to a Horvath / GrimAge clock. Copy in the UI should
    say so.

Formula (per marker):
  1. Compute expected_at_age(marker, age, sex) — the value a healthy
     person that age/sex would typically have.
  2. Compute z = (actual - expected) / sd, sign-adjusted so positive
     z is always "worse" (older-looking).
  3. Convert z → years delta = z * years_per_sd. Cap per-marker at ±10.
  4. Weighted average across all available markers = final biological
     age delta from chronological.

David 2026-08-07.
"""

from __future__ import annotations

import math
from typing import Optional


# ── Norms table ─────────────────────────────────────────────────────────
#
# Each entry describes how to score one marker:
#   expected(age, sex)  — value a healthy person their age/sex has
#   sd                  — population standard deviation
#   direction           — "higher_worse" or "lower_worse" (which way is aging?)
#   years_per_sd        — clinical signal weight: how many biological years
#                         each SD deviation represents
#   weight              — how much this marker contributes to the final blend
#                         (all weights are re-normalized across available
#                         markers, so missing ones don't distort)
#   min_actual          — floor below which we clamp (avoids absurd deltas)
#   max_actual          — ceiling
#
# Weights sum to ~1.0 when all markers are present. Rationale for weight
# choices grounded in all-cause mortality literature:
#   VO2 max     — strongest single wearable predictor (Ross 2016, Blair 1989)
#   Systolic BP — sustained hypertension is largest addressable driver
#   HbA1c       — metabolic health, whole-body glycation
#   HRV         — autonomic function, cardiac vagal tone
#   RHR         — inverse fitness proxy, independent mortality signal
#   LDL         — ASCVD driver (weight 0.10 because BP + HbA1c already
#                  capture much of cardiometabolic risk)
#   hsCRP       — inflammation, complements LDL
#   Body fat    — indirect metabolic (weight 0.05; already correlated with
#                  BP/HbA1c/HRV so avoid double-counting)
#   Sleep hours — U-shape optimum around 7-8; low weight because SIGNAL is
#                  in quality (not duration) and we only have duration here
#   Steps       — deliberately excluded from Bio Age (already implicit in
#                  VO2 max and body fat; using it would double-count).

def _hrv_expected(age: int, _sex: str) -> float:
    """Age-adjusted HRV (SDNN) expected value in ms. Based on Umetani
    et al. and Voss et al. — HRV declines ~0.6 ms/year from a young
    baseline of ~65 ms. Floor at 20 (below that is genuinely low)."""
    return max(20.0, 65.0 - 0.6 * max(0, age - 20))

def _rhr_expected(_age: int, sex: str) -> float:
    """Population median RHR is ~60 for adults, slightly higher for
    women. Age has minimal effect within the healthy range."""
    return 62.0 if sex == "female" else 60.0

def _vo2_expected(age: int, sex: str) -> float:
    """VO2 max declines ~10%/decade after 30. Male baseline higher.
    From ACSM norms — average for age 55 male ~35, female ~28."""
    if sex == "female":
        return max(15.0, 42.0 - 0.28 * max(0, age - 25))
    return max(18.0, 50.0 - 0.35 * max(0, age - 25))

def _bp_expected(_age: int, _sex: str) -> float:
    """Optimal systolic. Note: this is the CLINICAL optimum, not
    'average for age' — average creeps up with age but that's the
    hypertension epidemic, not healthy aging. Aim = 115."""
    return 115.0

def _hba1c_expected(_age: int, _sex: str) -> float:
    """Non-diabetic optimum. Diabetic cutoff is 6.5; below 5.4 is
    the goldilocks zone for longevity per Roberts et al."""
    return 5.2

def _ldl_expected(_age: int, _sex: str) -> float:
    """Aggressive optimum per contemporary lipidology (Attia, ACC
    2018 guidelines for high-risk). Population mean is much higher,
    but that reflects prevalence of undiagnosed ASCVD risk."""
    return 80.0

def _hscrp_expected(_age: int, _sex: str) -> float:
    """<1 mg/L = low inflammation. AHA cutoffs: <1 low, 1-3 mid,
    >3 high risk. Optimum for longevity ~0.5."""
    return 0.5

def _body_fat_expected(_age: int, sex: str) -> float:
    """Healthy adult body fat by sex. Some age creep is expected but
    we hold the optimum stable — target isn't 'average for age.'"""
    return 22.0 if sex == "female" else 15.0

def _sleep_expected(_age: int, _sex: str) -> float:
    """Adult sleep optimum (NSF). U-shape: 7-9h is the zone."""
    return 7.75

def _hdl_expected(_age: int, sex: str) -> float:
    """HDL — higher is protective. Sex-specific optimum."""
    return 60.0 if sex == "female" else 50.0

def _triglycerides_expected(_age: int, _sex: str) -> float:
    """Triglycerides — lower is better; independent CV risk from LDL."""
    return 80.0

def _glucose_expected(_age: int, _sex: str) -> float:
    """Fasting glucose optimum for longevity — Roberts et al."""
    return 85.0

def _egfr_expected(age: int, _sex: str) -> float:
    """eGFR declines with age (~1 mL/min/1.73m² per year after 40).
    Sub-60 is CKD range regardless of age. Optimum for a healthy
    adult at 40 is ~90+."""
    return max(60.0, 100.0 - 0.8 * max(0, age - 30))


_MARKERS = {
    "hrv": {
        "label": "Heart Rate Variability",
        "unit":  "ms",
        "expected": _hrv_expected,
        "sd": 10.0, "direction": "lower_worse",
        "years_per_sd": 4.0, "weight": 0.14,
        "min_actual": 5.0, "max_actual": 200.0,
    },
    "rhr": {
        "label": "Resting Heart Rate",
        "unit":  "bpm",
        "expected": _rhr_expected,
        "sd": 8.0, "direction": "higher_worse",
        "years_per_sd": 3.0, "weight": 0.10,
        "min_actual": 30.0, "max_actual": 120.0,
    },
    "vo2_max": {
        "label": "VO₂ Max",
        "unit":  "ml/kg/min",
        "expected": _vo2_expected,
        "sd": 6.0, "direction": "lower_worse",
        "years_per_sd": 5.0, "weight": 0.20,
        "min_actual": 10.0, "max_actual": 80.0,
    },
    "blood_pressure_systolic": {
        "label": "Systolic Blood Pressure",
        "unit":  "mmHg",
        "expected": _bp_expected,
        "sd": 12.0, "direction": "higher_worse",
        "years_per_sd": 4.0, "weight": 0.16,
        "min_actual": 85.0, "max_actual": 210.0,
    },
    "hba1c": {
        "label": "HbA1c",
        "unit":  "%",
        "expected": _hba1c_expected,
        "sd": 0.3, "direction": "higher_worse",
        "years_per_sd": 5.0, "weight": 0.14,
        "min_actual": 4.0, "max_actual": 12.0,
    },
    "ldl": {
        "label": "LDL Cholesterol",
        "unit":  "mg/dL",
        "expected": _ldl_expected,
        "sd": 25.0, "direction": "higher_worse",
        "years_per_sd": 3.0, "weight": 0.10,
        "min_actual": 30.0, "max_actual": 300.0,
    },
    "crp_hs": {
        "label": "hsCRP",
        "unit":  "mg/L",
        "expected": _hscrp_expected,
        "sd": 1.5, "direction": "higher_worse",
        "years_per_sd": 3.0, "weight": 0.08,
        "min_actual": 0.0, "max_actual": 20.0,
    },
    "body_fat_percentage": {
        "label": "Body Fat",
        "unit":  "%",
        "expected": _body_fat_expected,
        "sd": 5.0, "direction": "higher_worse",
        "years_per_sd": 2.0, "weight": 0.05,
        "min_actual": 3.0, "max_actual": 60.0,
    },
    "sleep_hours": {
        "label": "Sleep (7-day avg)",
        "unit":  "hours",
        "expected": _sleep_expected,
        "sd": 1.0, "direction": "u_shape",  # both extremes are older-looking
        "years_per_sd": 2.0, "weight": 0.03,
        "min_actual": 3.0, "max_actual": 12.0,
    },
    # ── Additional lab markers surfaced by the JSON blob loader (David 2026-08-11) ──
    "hdl": {
        "label": "HDL Cholesterol",
        "unit":  "mg/dL",
        "expected": _hdl_expected,
        "sd": 12.0, "direction": "lower_worse",   # higher HDL = younger
        "years_per_sd": 2.0, "weight": 0.05,
        "min_actual": 15.0, "max_actual": 150.0,
    },
    "triglycerides": {
        "label": "Triglycerides",
        "unit":  "mg/dL",
        "expected": _triglycerides_expected,
        "sd": 40.0, "direction": "higher_worse",
        "years_per_sd": 2.0, "weight": 0.05,
        "min_actual": 20.0, "max_actual": 800.0,
    },
    "glucose": {
        "label": "Fasting Glucose",
        "unit":  "mg/dL",
        "expected": _glucose_expected,
        "sd": 10.0, "direction": "higher_worse",
        "years_per_sd": 3.0, "weight": 0.06,
        "min_actual": 50.0, "max_actual": 300.0,
    },
    "egfr": {
        "label": "eGFR (Kidney)",
        "unit":  "mL/min",
        "expected": _egfr_expected,
        "sd": 15.0, "direction": "lower_worse",   # higher eGFR = younger
        "years_per_sd": 4.0, "weight": 0.08,
        "min_actual": 5.0, "max_actual": 150.0,
    },
}


def _score_marker(key: str, actual: float, age: int, sex: str) -> Optional[dict]:
    """Score a single marker. Returns None if actual is out of plausible
    range (data-quality guard). Otherwise returns a dict with the
    computed years-delta and a human-readable explanation."""
    spec = _MARKERS.get(key)
    if not spec:
        return None
    if actual is None:
        return None
    try:
        v = float(actual)
    except (TypeError, ValueError):
        return None
    if v < spec["min_actual"] or v > spec["max_actual"]:
        return None

    expected = spec["expected"](age, sex)
    sd       = spec["sd"]

    if spec["direction"] == "u_shape":
        # Distance from optimum in either direction ages you.
        z = abs(v - expected) / sd
        signed_z = z  # always non-negative — never "younger" from sleep alone
    elif spec["direction"] == "higher_worse":
        z = (v - expected) / sd
        signed_z = z
    else:  # lower_worse
        z = (expected - v) / sd
        signed_z = z

    years_delta = signed_z * spec["years_per_sd"]
    # Per-marker cap so one extreme reading doesn't dominate
    years_delta = max(-10.0, min(10.0, years_delta))

    # Human-readable explanation
    if spec["direction"] == "u_shape":
        cmp_word = "optimal" if abs(v - expected) < sd * 0.3 else "off-target"
        why = (f"{spec['label']} of {v:.1f} {spec['unit']} is {cmp_word} "
               f"(target ~{expected:.1f}).")
    else:
        better_is = "higher" if spec["direction"] == "lower_worse" else "lower"
        vs_word   = "better than" if years_delta < -0.5 else \
                    ("worse than" if years_delta > 0.5 else "close to")
        why = (f"{spec['label']} of {v:.1f} {spec['unit']} is {vs_word} "
               f"the ~{expected:.1f} typical for age {age} "
               f"(where {better_is} is better).")

    return {
        "key":         key,
        "label":       spec["label"],
        "value":       v,
        "unit":        spec["unit"],
        "expected":    round(expected, 1),
        "z":           round(signed_z, 2),
        "years_delta": round(years_delta, 1),
        "weight":      spec["weight"],
        "why":         why,
    }


def compute(metrics: dict, profile: dict, labs: Optional[dict] = None) -> dict:
    """Compute Biological Age from available markers.

    Args:
        metrics: wearable-derived. Keys mirror longevity.compute():
                 hrv, rhr, vo2_max, sleep_hours, body_fat_percentage
        profile: at minimum {age, biological_sex}
        labs:    latest lab values (from lab_entries). Optional keys:
                 hba1c, ldl, crp_hs, blood_pressure_systolic (also from
                 apple_health_daily if manually or Withings-logged)

    Returns:
        {
          "biological_age":       58.4,          # chronological + delta
          "chronological_age":    57,
          "delta_years":          1.4,           # positive = older-looking
          "confidence":           "high",        # high | medium | low
          "n_markers":            7,
          "as_of":                "2026-08-07",
          "components":           [...marker breakdown...],
          "caveat":               "..."
        }

        Returns {"biological_age": None, "confidence": "low", ...} when
        fewer than 3 markers are available.
    """
    age = int(profile.get("age") or 0)
    sex = (profile.get("biological_sex") or "male").lower()
    if age < 18 or age > 100:
        return _empty(age, "invalid age")

    all_inputs = dict(metrics or {})
    if labs:
        # Merge labs into a flat namespace; labs take precedence if
        # a marker appears in both (e.g. BP could be in AH or labs).
        for k, v in labs.items():
            if v is not None:
                all_inputs[k] = v

    components: list[dict] = []
    total_weighted_delta = 0.0
    total_weight         = 0.0

    for key in _MARKERS.keys():
        val = all_inputs.get(key)
        scored = _score_marker(key, val, age, sex)
        if scored is None:
            continue
        components.append(scored)
        total_weighted_delta += scored["years_delta"] * scored["weight"]
        total_weight         += scored["weight"]

    n = len(components)
    if n < 3:
        return _empty(age, "not enough markers", components=components)

    # Confidence chip based on marker count
    if n >= 6: confidence = "high"
    elif n >= 4: confidence = "medium"
    else: confidence = "low"

    # Normalize by actual weight sum so partial data doesn't scale down
    delta = total_weighted_delta / total_weight
    # Final cap at ±15 for plausibility
    delta = max(-15.0, min(15.0, delta))

    biological_age = round(age + delta, 1)

    # Sort components by absolute years contribution (biggest movers first)
    components.sort(key=lambda c: abs(c["years_delta"]), reverse=True)

    return {
        "biological_age":    biological_age,
        "chronological_age": age,
        "delta_years":       round(delta, 1),
        "confidence":        confidence,
        "n_markers":         n,
        "components":        components,
        "caveat":            _CAVEAT_TEXT,
    }


def _empty(age: int, reason: str, components: Optional[list] = None) -> dict:
    return {
        "biological_age":    None,
        "chronological_age": age or None,
        "delta_years":       None,
        "confidence":        "low",
        "n_markers":         len(components or []),
        "components":        components or [],
        "caveat":            _CAVEAT_TEXT,
        "reason":            reason,
    }


_CAVEAT_TEXT = (
    "Estimate based on wearable and lab markers — not a clinical DNA methylation "
    "clock (Horvath / GrimAge). Useful for trends and comparisons, not diagnosis."
)


# ── Latest-labs helper ──────────────────────────────────────────────────

def project(snapshot: dict, healthspan_score: Optional[int],
            horizon_days: int = 90) -> Optional[dict]:
    """Project Bio Age `horizon_days` forward based on the user's current
    Weekly Health Span Score (the behavioral/process score).

    Model: behavioral consistency drives the wearable-derived markers
    (HRV, RHR, VO2 max, body fat, sleep) over months. We map the Health
    Span score to a monthly drift rate:

        rate_per_month = -(healthspan - 65) / 100   (years/month)

      Health Span 100 → -0.35 yr/month  (aggressive improvement)
      Health Span  85 → -0.20 yr/month
      Health Span  65 →  0.00           (holding steady)
      Health Span  50 → +0.15 yr/month  (drifting older)

    Quarterly projection capped at ±1.5 years for plausibility — a
    wearable-derived Bio Age genuinely can move ~1 yr in a quarter from
    consistent behavior change (HRV/RHR/body fat all respond), but more
    than that would over-promise.

    This is the effort→outcome loop: Bio Age (outcome) projected from
    Health Span (process). Bevel shows an age projection but has no
    separated behavior score to drive it — that's the moat.
    David 2026-08-11.

    Returns None when either input is missing.
    """
    bio_age = snapshot.get("biological_age")
    if bio_age is None or healthspan_score is None:
        return None
    months = horizon_days / 30.0
    rate   = -(healthspan_score - 65) / 100.0     # yr per month
    drift  = rate * months
    drift  = max(-1.5, min(1.5, drift))
    projected = round(float(bio_age) + drift, 1)
    return {
        "horizon_days":     horizon_days,
        "projected_age":    projected,
        "delta_from_now":   round(drift, 1),
        "healthspan_score": healthspan_score,
        "caveat": (
            "Projection assumes your current weekly habits continue. "
            "Based on how behavior moves wearable markers over months — "
            "an estimate, not a guarantee."
        ),
    }


def persist_and_delta(user_id: str, today_iso: str, snapshot: dict) -> Optional[dict]:
    """Upsert today's Bio Age snapshot, then return trend info vs
    ~30 days ago. Bio Age moves slowly — monthly delta is the right
    horizon (weekly would be noise). Returns None when either today
    or prior snapshot is missing/incomplete.

    Structure returned when available:
      { delta_years: float, days_ago: int }
    delta_years < 0 = getting younger (green), > 0 = getting older (red)
    """
    sb = _sb()
    if not sb or not user_id:
        return None
    bio_age = snapshot.get("biological_age")
    if bio_age is None:
        return None
    try:
        sb.table("biological_age_history").upsert({
            "user_id":        user_id,
            "date":           today_iso,
            "biological_age": float(bio_age),
            "delta_years":    snapshot.get("delta_years"),
            "n_markers":      snapshot.get("n_markers"),
            "confidence":     snapshot.get("confidence"),
        }, on_conflict="user_id,date").execute()
    except Exception:
        log.exception("bio age history upsert failed for %s", user_id)

    # Lookup a prior snapshot within [21, 45] days ago (target 30 with
    # tolerance so a missed day doesn't kill the delta).
    from datetime import date as _d, timedelta as _td
    try:
        today = _d.fromisoformat(today_iso)
        lo    = (today - _td(days=45)).isoformat()
        hi    = (today - _td(days=21)).isoformat()
        res = (sb.table("biological_age_history")
                 .select("date, biological_age")
                 .eq("user_id", user_id)
                 .gte("date", lo)
                 .lte("date", hi)
                 .order("date", desc=True)
                 .limit(1)
                 .execute())
        rows = res.data or []
        if not rows:
            return None
        prior      = rows[0]
        prior_age  = float(prior["biological_age"])
        prior_date = _d.fromisoformat(prior["date"])
        delta      = round(float(bio_age) - prior_age, 1)
        return {
            "delta_years": delta,
            "days_ago":    (today - prior_date).days,
        }
    except Exception:
        log.exception("bio age history lookup failed for %s", user_id)
        return None


def latest_labs(user_id: str) -> dict:
    """Pull the most recent value per marker from lab_entries.

    lab_entries stores each entry as a row with `date` + a `values`
    JSONB blob (keys are the marker names). We flatten the last 90 days
    of entries, keeping the most recent non-null value per marker.

    David 2026-08-11: previous version queried nonexistent columns and
    silently returned {} for everyone — Bio Age was wearables-only.
    Now every marker in the JSON blob is available to the compute.
    """
    if not user_id:
        return {}
    sb = _sb()
    if not sb:
        return {}

    try:
        res = (sb.table("lab_entries")
                 .select("date, values")
                 .eq("user_id", user_id)
                 .order("date", desc=True)
                 .limit(60)
                 .execute())
        rows = res.data or []
    except Exception:
        log.exception("latest_labs: query failed for %s", user_id)
        return {}

    # Rows come in newest-first. First non-null value per marker wins.
    out: dict = {}
    for r in rows:
        vals = r.get("values") or {}
        if not isinstance(vals, dict):
            continue
        for k, v in vals.items():
            if v is None:
                continue
            if k not in out:
                out[k] = v
    return out


def _sb():
    import os
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
