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
        hrv_points = min(1.5, hrv / hrv_norm) * 25
        hrv_points = round(hrv_points)
        has_hrv = True
        components["hrv"] = {
            "label": "Heart Rate Variability",
            "value": f"{hrv} ms",
            "norm": f"~{round(hrv_norm)} ms for your age",
            "points": hrv_points,
            "max": 25,
        }
        total_points += hrv_points
        max_possible += 25

    # Resting HR: 20 pts — <=50:20, <=60:17, <=70:13, <=80:9, else:5
    if "rhr" in metrics and metrics["rhr"] is not None:
        rhr = metrics["rhr"]
        if rhr <= 50:
            rhr_points = 20
        elif rhr <= 60:
            rhr_points = 17
        elif rhr <= 70:
            rhr_points = 13
        elif rhr <= 80:
            rhr_points = 9
        else:
            rhr_points = 5
        components["rhr"] = {
            "label": "Resting Heart Rate",
            "value": f"{rhr} bpm",
            "norm": "<=60 bpm ideal",
            "points": rhr_points,
            "max": 20,
        }
        total_points += rhr_points
        max_possible += 20

    # VO2 Max: 20 pts
    if "vo2_max" in metrics and metrics["vo2_max"] is not None:
        vo2 = metrics["vo2_max"]
        if sex == "male":
            if vo2 >= 50:
                vo2_points = 20
            elif vo2 >= 42:
                vo2_points = 16
            elif vo2 >= 35:
                vo2_points = 12
            elif vo2 >= 28:
                vo2_points = 8
            else:
                vo2_points = 4
            vo2_norm = ">=50 ml/kg/min (excellent)"
        else:  # female
            if vo2 >= 42:
                vo2_points = 20
            elif vo2 >= 35:
                vo2_points = 16
            elif vo2 >= 28:
                vo2_points = 12
            elif vo2 >= 22:
                vo2_points = 8
            else:
                vo2_points = 4
            vo2_norm = ">=42 ml/kg/min (excellent)"
        components["vo2_max"] = {
            "label": "VO2 Max",
            "value": f"{vo2} ml/kg/min",
            "norm": vo2_norm,
            "points": vo2_points,
            "max": 20,
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
        }
        total_points += steps_points
        max_possible += 10

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

    return {
        "score": score,
        "grade": grade,
        "biological_age_delta": biological_age_delta,
        "components": components,
        "data_coverage": data_coverage,
    }
