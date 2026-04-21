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

    # Sleep (7-day avg hours): 15 pts — 7-8.5h:15, 6.5-7 or 8.5-9.5:11, 6-6.5:7, else:3
    if "sleep_hours" in metrics and metrics["sleep_hours"] is not None:
        sleep = metrics["sleep_hours"]
        if 7 <= sleep <= 8.5:
            sleep_points = 15
        elif (6.5 <= sleep < 7) or (8.5 < sleep <= 9.5):
            sleep_points = 11
        elif 6 <= sleep < 6.5:
            sleep_points = 7
        else:
            sleep_points = 3
        components["sleep"] = {
            "label": "Sleep (7-day avg)",
            "value": f"{sleep:.1f} hours",
            "norm": "7–8.5 hours optimal",
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

    # Steps (daily avg): 10 pts — >=10000:10, >=7500:8, >=5000:6, >=2500:4, else:2
    if "steps" in metrics and metrics["steps"] is not None:
        steps = metrics["steps"]
        if steps >= 10000:
            steps_points = 10
        elif steps >= 7500:
            steps_points = 8
        elif steps >= 5000:
            steps_points = 6
        elif steps >= 2500:
            steps_points = 4
        else:
            steps_points = 2
        components["steps"] = {
            "label": "Daily Steps (avg)",
            "value": f"{int(steps):,}",
            "norm": ">=10,000 optimal",
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

    # Compute biological_age_delta
    biological_age_delta = None
    if has_hrv and hrv_value is not None and hrv_norm is not None:
        delta_years = round((hrv_norm - hrv_value) / 0.65)
        biological_age_delta = -delta_years  # negative = younger than chronological age

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
