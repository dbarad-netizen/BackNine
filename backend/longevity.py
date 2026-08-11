"""
Longevity Score engine for BackNine.

Combines HRV, resting HR, VO2 max, sleep, body fat, and daily steps
into a single 0-100 vitality score with age/sex adjustments.

Each component returns points toward its max. Components with no data
are excluded so the score reflects available metrics only.
"""


def compute(metrics: dict, profile: dict) -> dict:
    """
    Compute a Longevity Score (0-100) from health metrics and user profile.

    Args:
        metrics: Dict with optional keys: hrv, rhr, vo2_max, sleep_hours (avg),
                 body_fat_percentage, steps (avg)
        profile: Dict with optional keys: age (int), biological_sex ("male"/"female"), name

    Returns:
        Dict with score (0-100), grade, biological_age_delta, component breakdown, and data_coverage.
    """
    age = profile.get("age", 0)
    sex = profile.get("biological_sex", "male").lower()

    components = {}
    total_points = 0
    max_possible = 0
    has_hrv = False
    hrv_value = None
    hrv_norm = None

    # HRV: 25 pts max — age-adjusted norm = max(25, 75 - (age-20)*0.65)
    if "hrv" in metrics and metrics["hrv"] is not None:
        hrv = metrics["hrv"]
        hrv_value = hrv
        hrv_norm = max(25, 75 - (age - 20) * 0.65)
        # Score linearly up to the age norm = full marks. Cap the ratio at 1.0 so
        # an above-norm HRV earns the component max (25) and never overflows it.
        hrv_points = round(min(1.0, hrv / hrv_norm) * 25)
        has_hrv = True
        _hrv_pct = round((hrv / hrv_norm) * 100) if hrv_norm else None
        components["hrv"] = {
            "label": "Heart Rate Variability",
            "value": f"{hrv} ms",
            "norm": f"~{round(hrv_norm)} ms for your age",
            "points": hrv_points,
            "max": 25,
            # Per-component "why" for the transparency-vs-Bevel push.
            # David 2026-08-07 — Bevel's opacity is a stated user
            # complaint; every score we show should be defensible.
            "why": (f"Your {hrv} ms is {_hrv_pct}% of the age-adjusted "
                    f"norm (~{round(hrv_norm)} ms for age {age}). "
                    f"Higher HRV signals stronger autonomic nervous system "
                    f"and better cardiovascular fitness."),
        }
        total_points += hrv_points
        max_possible += 25

    # Resting HR: 20 pts — age-adjusted. Was fixed cutoffs, which
    # over-penalized older users whose 68 bpm is genuinely normal.
    # New: use age-appropriate percentile (approximation of ACSM norms).
    # David 2026-08-07.
    if "rhr" in metrics and metrics["rhr"] is not None:
        rhr = metrics["rhr"]
        # Optimum shifts up ~1 bpm/decade after 30
        rhr_optimum = 55 + max(0, (age - 30) // 10)
        # Score: 20 if <= optimum, then step down by ~2.5 per 5 bpm above
        delta_above = max(0, rhr - rhr_optimum)
        rhr_points  = max(5, round(20 - (delta_above / 5) * 3))
        rhr_points  = min(20, rhr_points)
        components["rhr"] = {
            "label": "Resting Heart Rate",
            "value": f"{rhr} bpm",
            "norm": f"~{rhr_optimum} bpm ideal for age {age}",
            "points": rhr_points,
            "max": 20,
            "why": (f"Your {rhr} bpm is {'at or below' if rhr <= rhr_optimum else f'{rhr - rhr_optimum} bpm above'} "
                    f"the ~{rhr_optimum} bpm optimum for age {age}. Lower RHR "
                    f"typically means better cardiovascular efficiency."),
        }
        total_points += rhr_points
        max_possible += 20

    # VO2 Max: 20 pts — age- and sex-adjusted. Was fixed cutoffs which
    # over-penalized older users. New: percentile within age/sex band.
    # David 2026-08-07.
    if "vo2_max" in metrics and metrics["vo2_max"] is not None:
        vo2 = metrics["vo2_max"]
        # Age-adjusted "excellent" threshold (ACSM percentile ~90).
        # Baseline peaks ~30, declines ~10%/decade.
        if sex == "female":
            vo2_excellent = max(20, 42 - 0.28 * max(0, age - 30))
        else:
            vo2_excellent = max(24, 50 - 0.35 * max(0, age - 30))
        # Score: linear 0-100% of excellent maps to 4-20 points
        ratio = vo2 / vo2_excellent if vo2_excellent > 0 else 0
        vo2_points = round(4 + min(1.0, ratio) * 16)
        vo2_points = max(4, min(20, vo2_points))
        components["vo2_max"] = {
            "label": "VO2 Max",
            "value": f"{vo2} ml/kg/min",
            "norm": f">= {round(vo2_excellent)} ml/kg/min (excellent for age {age} {sex})",
            "points": vo2_points,
            "max": 20,
            "why": (f"Your {vo2} ml/kg/min is {round(ratio * 100)}% of "
                    f"the excellent-for-your-age threshold (~{round(vo2_excellent)}). "
                    f"VO₂ max is one of the strongest predictors of all-cause "
                    f"mortality — every 1 ml/kg/min gain is meaningful."),
        }
        total_points += vo2_points
        max_possible += 20

    # Sleep (7-day avg hours): 15 pts
    # NSF / American Academy of Sleep Medicine: 7–9 hrs for adults
    # 7–9 h: 15 pts | 6.5–7 or 9–10 h: 11 pts | 6–6.5 h: 7 pts | else: 3 pts
    if "sleep_hours" in metrics and metrics["sleep_hours"] is not None:
        sleep = metrics["sleep_hours"]
        if 7 <= sleep <= 9:
            sleep_points = 15
        elif (6.5 <= sleep < 7) or (9 < sleep <= 10):
            sleep_points = 11
        elif 6 <= sleep < 6.5:
            sleep_points = 7
        else:
            sleep_points = 3
        components["sleep"] = {
            "label": "Sleep (7-day avg)",
            "value": f"{sleep:.1f} hours",
            "norm": "7–9 hrs optimal (NSF / AAoSM)",
            "points": sleep_points,
            "max": 15,
            "why": (f"Your 7-day sleep average of {sleep:.1f} hours "
                    f"{'is in' if 7 <= sleep <= 9 else 'falls outside'} the "
                    f"7-9 hour optimal range. Consistently short or long sleep "
                    f"is associated with cardiovascular and metabolic risk."),
        }
        total_points += sleep_points
        max_possible += 15

    # Body fat %: 10 pts
    if "body_fat_percentage" in metrics and metrics["body_fat_percentage"] is not None:
        bf = metrics["body_fat_percentage"]
        if sex == "male":
            if bf <= 15:
                bf_points = 10
            elif bf <= 20:
                bf_points = 8
            elif bf <= 25:
                bf_points = 5
            else:
                bf_points = 2
            bf_norm = "<=15% (excellent)"
        else:  # female
            if bf <= 22:
                bf_points = 10
            elif bf <= 28:
                bf_points = 8
            elif bf <= 34:
                bf_points = 5
            else:
                bf_points = 2
            bf_norm = "<=22% (excellent)"
        components["body_fat"] = {
            "label": "Body Fat %",
            "value": f"{bf}%",
            "norm": bf_norm,
            "points": bf_points,
            "max": 10,
            "why": (f"Body fat of {bf}% — {bf_norm.split(' ')[0]} range for "
                    f"{sex}. Lower body fat reduces metabolic and "
                    f"cardiovascular risk, though extremely low levels "
                    f"can indicate other issues."),
        }
        total_points += bf_points
        max_possible += 10

    # Steps (daily avg): 10 pts
    # Research (2020 JAMA meta-analysis) shows mortality benefits plateau
    # at 7,000–8,000 steps/day; 10,000 is a fitness marketing figure.
    # Tiers: >=8000:10, >=7000:8, >=5000:6, >=3000:4, else:2
    if "steps" in metrics and metrics["steps"] is not None:
        steps = metrics["steps"]
        if steps >= 8000:
            steps_points = 10
        elif steps >= 7000:
            steps_points = 8
        elif steps >= 5000:
            steps_points = 6
        elif steps >= 3000:
            steps_points = 4
        else:
            steps_points = 2
        components["steps"] = {
            "label": "Daily Steps (avg)",
            "value": f"{int(steps):,}",
            "norm": "7,000–8,000 optimal (research-backed)",
            "points": steps_points,
            "max": 10,
            "why": (f"Your 7-day average of {int(steps):,} steps. Mortality "
                    f"benefits plateau around 7-8k steps/day per 2020 JAMA "
                    f"meta-analysis — 10k is a marketing figure, not a "
                    f"clinical target."),
        }
        total_points += steps_points
        max_possible += 10

    # ── Cardiometabolic band (David 2026-08-07) ─────────────────────────
    # Adds up to 25 points when lab markers exist. For 50+ users, BP +
    # HbA1c + LDL + hsCRP are higher-signal for mortality than the
    # wearable-only bands above. When ANY of these are present, we
    # include them and rescale the final composite so the total still
    # normalizes to 0-100. Users without labs simply don't see this
    # band and their score is unchanged.
    cardio_labs = metrics.get("cardio_labs") or {}
    # Systolic BP: 8 pts. <=120:8, <=130:6, <=140:4, <=160:2, else:0
    bp_sys = cardio_labs.get("blood_pressure_systolic")
    if bp_sys is not None:
        if bp_sys <= 120:   bp_points = 8
        elif bp_sys <= 130: bp_points = 6
        elif bp_sys <= 140: bp_points = 4
        elif bp_sys <= 160: bp_points = 2
        else:               bp_points = 0
        components["bp_systolic"] = {
            "label": "Systolic BP",
            "value": f"{int(bp_sys)} mmHg",
            "norm":  "<=120 optimal",
            "points": bp_points, "max": 8,
            "why": (f"Systolic BP of {int(bp_sys)} mmHg. Every 10 mmHg "
                    f"reduction from elevated levels cuts cardiovascular "
                    f"risk ~20% (SPRINT trial)."),
        }
        total_points += bp_points; max_possible += 8

    # HbA1c: 7 pts. <=5.4:7, <=5.6:5, <=6.0:3, <=6.4:1, else:0
    hba1c = cardio_labs.get("hba1c")
    if hba1c is not None:
        if hba1c <= 5.4:   hba_points = 7
        elif hba1c <= 5.6: hba_points = 5
        elif hba1c <= 6.0: hba_points = 3
        elif hba1c <= 6.4: hba_points = 1
        else:              hba_points = 0
        components["hba1c"] = {
            "label": "HbA1c",
            "value": f"{hba1c}%",
            "norm":  "<=5.4% optimal for longevity",
            "points": hba_points, "max": 7,
            "why": (f"HbA1c of {hba1c}% reflects 3-month average blood "
                    f"glucose. Below 5.4% associates with lowest "
                    f"all-cause mortality in cohort studies."),
        }
        total_points += hba_points; max_possible += 7

    # LDL: 6 pts. <=70:6, <=100:4, <=130:2, <=160:1, else:0
    ldl = cardio_labs.get("ldl")
    if ldl is not None:
        if ldl <= 70:    ldl_points = 6
        elif ldl <= 100: ldl_points = 4
        elif ldl <= 130: ldl_points = 2
        elif ldl <= 160: ldl_points = 1
        else:            ldl_points = 0
        components["ldl"] = {
            "label": "LDL",
            "value": f"{int(ldl)} mg/dL",
            "norm":  "<=70 aggressive optimum",
            "points": ldl_points, "max": 6,
            "why": (f"LDL of {int(ldl)} mg/dL. Contemporary lipidology "
                    f"targets sub-70 for anyone with elevated ASCVD risk "
                    f"(ACC 2018)."),
        }
        total_points += ldl_points; max_possible += 6

    # hsCRP: 4 pts. <=0.5:4, <=1.0:3, <=3.0:2, else:0
    hscrp = cardio_labs.get("crp_hs")
    if hscrp is not None:
        if hscrp <= 0.5:   crp_points = 4
        elif hscrp <= 1.0: crp_points = 3
        elif hscrp <= 3.0: crp_points = 2
        else:              crp_points = 0
        components["hscrp"] = {
            "label": "hsCRP",
            "value": f"{hscrp} mg/L",
            "norm":  "<0.5 low inflammation",
            "points": crp_points, "max": 4,
            "why": (f"hsCRP of {hscrp} mg/L. Elevated inflammation "
                    f"independently predicts cardiovascular events even "
                    f"with normal cholesterol (JUPITER trial)."),
        }
        total_points += crp_points; max_possible += 4

    # Compute final score
    score = None
    if max_possible > 0:
        score = round(100 * total_points / max_possible)
        score = max(0, min(100, score))

    # Determine grade
    if score is None:
        grade = "No Data"
    elif score >= 85:
        grade = "Excellent"
    elif score >= 70:
        grade = "Good"
    elif score >= 55:
        grade = "Fair"
    else:
        grade = "Needs Work"

    # Compute biological_age_delta from the composite longevity score.
    #
    # Using the composite score (not HRV alone) means RHR, sleep, steps,
    # VO2 max, and body fat all contribute — a holistic view.
    #
    # Calibration: score 70 = "Good" = roughly on par with chronological age.
    # Each ~6 points above/below 70 corresponds to ~1 year younger/older.
    # Cap at ±15 years so extreme scores stay plausible.
    #   97 → -(97-70)/6 = -4.5 → -5 yrs  (5 years younger)
    #   85 → -(85-70)/6 = -2.5 → -3 yrs  (3 years younger)
    #   70 →  0 yrs  (on par)
    #   55 → +(55-70)/(-6) = +2.5 → +3 yrs  (3 years older)
    biological_age_delta = None
    if score is not None:
        raw = -(score - 70) / 6
        biological_age_delta = max(-15, min(15, round(raw)))

    # Data coverage
    num_metrics = len(components)
    data_coverage = f"{num_metrics}/6 metrics"

    # Confidence — Fable competitive brief moat (David 2026-07-23).
    # Bevel shows a confidence chip on their biological age but hides
    # the underlying inputs. Ours is strictly better because we already
    # itemize markers; the chip just names how much of the picture we
    # actually have.
    #
    # Rules (coverage-based; recency guarded upstream by data-freshness
    # module):
    #   5-6 markers + HRV present   → high
    #   5-6 markers + no HRV        → medium (HRV is the recovery anchor)
    #   3-4 markers                 → medium
    #   1-2 markers                 → low
    #   0                           → unknown (score is None anyway)
    if num_metrics == 0:
        confidence = {"level": "unknown", "reason": "no metrics", "coverage_pct": 0}
    else:
        pct = round(100 * num_metrics / 6)
        if num_metrics >= 5 and has_hrv:
            level = "high"
            reason = f"{num_metrics} of 6 markers, HRV included"
        elif num_metrics >= 5:
            level = "medium"
            reason = f"{num_metrics} of 6 markers, HRV missing"
        elif num_metrics >= 3:
            level = "medium"
            reason = f"{num_metrics} of 6 markers available"
        else:
            level = "low"
            reason = f"only {num_metrics} of 6 markers available"
        confidence = {"level": level, "reason": reason, "coverage_pct": pct}

    return {
        "score": score,
        "grade": grade,
        "biological_age_delta": biological_age_delta,
        "components": components,
        "data_coverage": data_coverage,
        "confidence": confidence,
    }
