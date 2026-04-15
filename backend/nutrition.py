"""
Nutrition & body-composition module for BackNine Health.
Stores data in Supabase (nutrition_meals, nutrition_weight, nutrition_settings).
"""
import uuid
import os
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict


# ── Supabase helper ────────────────────────────────────────────────────────────

def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


# ── Food database ─────────────────────────────────────────────────────────────
FOODS: Dict[str, dict] = {
    # ── Proteins ──
    "chicken breast":     {"calories": 165, "protein": 31,   "carbs": 0,    "fat": 3.6,  "serving": 100, "unit": "g"},
    "salmon":             {"calories": 208, "protein": 20,   "carbs": 0,    "fat": 13,   "serving": 100, "unit": "g"},
    "tuna":               {"calories": 132, "protein": 29,   "carbs": 0,    "fat": 1,    "serving": 100, "unit": "g"},
    "egg":                {"calories": 78,  "protein": 6,    "carbs": 0.6,  "fat": 5,    "serving": 1,   "unit": "large"},
    "eggs":               {"calories": 155, "protein": 13,   "carbs": 1.1,  "fat": 11,   "serving": 2,   "unit": "large"},
    "greek yogurt":       {"calories": 100, "protein": 17,   "carbs": 6,    "fat": 0.7,  "serving": 170, "unit": "g"},
    "cottage cheese":     {"calories": 110, "protein": 12,   "carbs": 6,    "fat": 5,    "serving": 120, "unit": "g"},
    "ground beef":        {"calories": 254, "protein": 26,   "carbs": 0,    "fat": 17,   "serving": 100, "unit": "g"},
    "steak":              {"calories": 271, "protein": 26,   "carbs": 0,    "fat": 19,   "serving": 100, "unit": "g"},
    "turkey":             {"calories": 135, "protein": 30,   "carbs": 0,    "fat": 1,    "serving": 100, "unit": "g"},
    "shrimp":             {"calories": 85,  "protein": 18,   "carbs": 0,    "fat": 1,    "serving": 85,  "unit": "g"},
    "tofu":               {"calories": 76,  "protein": 8,    "carbs": 2,    "fat": 4.8,  "serving": 100, "unit": "g"},
    "protein shake":      {"calories": 150, "protein": 25,   "carbs": 8,    "fat": 3,    "serving": 1,   "unit": "scoop"},
    "whey protein":       {"calories": 120, "protein": 24,   "carbs": 3,    "fat": 2,    "serving": 30,  "unit": "g"},
    "edamame":            {"calories": 188, "protein": 18,   "carbs": 14,   "fat": 8,    "serving": 155, "unit": "g"},
    "lentils":            {"calories": 230, "protein": 18,   "carbs": 40,   "fat": 0.8,  "serving": 198, "unit": "cup cooked"},
    "black beans":        {"calories": 227, "protein": 15,   "carbs": 41,   "fat": 0.9,  "serving": 172, "unit": "cup cooked"},
    # ── Grains / Carbs ──
    "white rice":         {"calories": 206, "protein": 4.3,  "carbs": 45,   "fat": 0.4,  "serving": 186, "unit": "cup cooked"},
    "brown rice":         {"calories": 216, "protein": 5,    "carbs": 45,   "fat": 1.8,  "serving": 195, "unit": "cup cooked"},
    "oatmeal":            {"calories": 154, "protein": 5.4,  "carbs": 28,   "fat": 3,    "serving": 40,  "unit": "g dry"},
    "pasta":              {"calories": 220, "protein": 8,    "carbs": 43,   "fat": 1.3,  "serving": 140, "unit": "cup cooked"},
    "bread":              {"calories": 79,  "protein": 2.7,  "carbs": 15,   "fat": 1,    "serving": 1,   "unit": "slice"},
    "bagel":              {"calories": 270, "protein": 11,   "carbs": 53,   "fat": 2,    "serving": 1,   "unit": "medium"},
    "tortilla":           {"calories": 146, "protein": 4,    "carbs": 25,   "fat": 3.6,  "serving": 1,   "unit": "medium"},
    "sweet potato":       {"calories": 103, "protein": 2.3,  "carbs": 24,   "fat": 0.1,  "serving": 130, "unit": "g"},
    "potato":             {"calories": 161, "protein": 4.3,  "carbs": 37,   "fat": 0.2,  "serving": 1,   "unit": "medium"},
    "quinoa":             {"calories": 222, "protein": 8,    "carbs": 39,   "fat": 3.6,  "serving": 185, "unit": "cup cooked"},
    "granola":            {"calories": 200, "protein": 5,    "carbs": 32,   "fat": 7,    "serving": 47,  "unit": "g"},
    # ── Vegetables ──
    "broccoli":           {"calories": 55,  "protein": 3.7,  "carbs": 11,   "fat": 0.6,  "serving": 148, "unit": "cup"},
    "spinach":            {"calories": 7,   "protein": 0.9,  "carbs": 1.1,  "fat": 0.1,  "serving": 30,  "unit": "g"},
    "kale":               {"calories": 33,  "protein": 2.9,  "carbs": 6,    "fat": 0.5,  "serving": 67,  "unit": "cup"},
    "carrots":            {"calories": 52,  "protein": 1.2,  "carbs": 12,   "fat": 0.3,  "serving": 128, "unit": "cup"},
    "bell pepper":        {"calories": 31,  "protein": 1,    "carbs": 7.6,  "fat": 0.3,  "serving": 1,   "unit": "medium"},
    "cucumber":           {"calories": 16,  "protein": 0.7,  "carbs": 3.8,  "fat": 0.1,  "serving": 119, "unit": "cup"},
    "tomato":             {"calories": 35,  "protein": 1.6,  "carbs": 8,    "fat": 0.4,  "serving": 180, "unit": "cup"},
    "asparagus":          {"calories": 27,  "protein": 3,    "carbs": 5,    "fat": 0.3,  "serving": 134, "unit": "cup"},
    "mixed greens":       {"calories": 15,  "protein": 1.5,  "carbs": 2.5,  "fat": 0.2,  "serving": 85,  "unit": "g"},
    # ── Fruits ──
    "banana":             {"calories": 105, "protein": 1.3,  "carbs": 27,   "fat": 0.4,  "serving": 1,   "unit": "medium"},
    "apple":              {"calories": 95,  "protein": 0.5,  "carbs": 25,   "fat": 0.3,  "serving": 1,   "unit": "medium"},
    "orange":             {"calories": 62,  "protein": 1.2,  "carbs": 15,   "fat": 0.2,  "serving": 1,   "unit": "medium"},
    "blueberries":        {"calories": 84,  "protein": 1.1,  "carbs": 21,   "fat": 0.5,  "serving": 148, "unit": "cup"},
    "strawberries":       {"calories": 49,  "protein": 1,    "carbs": 12,   "fat": 0.5,  "serving": 152, "unit": "cup"},
    "avocado":            {"calories": 234, "protein": 2.9,  "carbs": 12,   "fat": 21,   "serving": 1,   "unit": "medium"},
    "mango":              {"calories": 107, "protein": 0.8,  "carbs": 28,   "fat": 0.5,  "serving": 165, "unit": "cup"},
    "grapes":             {"calories": 104, "protein": 1.1,  "carbs": 27,   "fat": 0.2,  "serving": 151, "unit": "cup"},
    # ── Dairy ──
    "milk":               {"calories": 149, "protein": 8,    "carbs": 12,   "fat": 8,    "serving": 244, "unit": "cup"},
    "almond milk":        {"calories": 39,  "protein": 1,    "carbs": 3.5,  "fat": 2.5,  "serving": 244, "unit": "cup"},
    "cheddar cheese":     {"calories": 113, "protein": 7,    "carbs": 0.4,  "fat": 9,    "serving": 28,  "unit": "g"},
    "butter":             {"calories": 102, "protein": 0.1,  "carbs": 0,    "fat": 11.5, "serving": 14,  "unit": "g"},
    # ── Fats / Nuts ──
    "almonds":            {"calories": 164, "protein": 6,    "carbs": 6,    "fat": 14,   "serving": 28,  "unit": "g"},
    "peanut butter":      {"calories": 188, "protein": 8,    "carbs": 6,    "fat": 16,   "serving": 32,  "unit": "g"},
    "almond butter":      {"calories": 196, "protein": 7,    "carbs": 6,    "fat": 18,   "serving": 32,  "unit": "g"},
    "olive oil":          {"calories": 119, "protein": 0,    "carbs": 0,    "fat": 13.5, "serving": 14,  "unit": "g"},
    "walnuts":            {"calories": 185, "protein": 4.3,  "carbs": 3.9,  "fat": 18.5, "serving": 28,  "unit": "g"},
    "cashews":            {"calories": 157, "protein": 5.2,  "carbs": 9,    "fat": 12,   "serving": 28,  "unit": "g"},
    "mixed nuts":         {"calories": 173, "protein": 5,    "carbs": 7,    "fat": 16,   "serving": 28,  "unit": "g"},
    # ── Prepared meals ──
    "pizza":              {"calories": 285, "protein": 12,   "carbs": 36,   "fat": 10,   "serving": 1,   "unit": "slice"},
    "burger":             {"calories": 540, "protein": 34,   "carbs": 40,   "fat": 27,   "serving": 1,   "unit": "burger"},
    "burrito":            {"calories": 490, "protein": 22,   "carbs": 60,   "fat": 16,   "serving": 1,   "unit": "burrito"},
    "sandwich":           {"calories": 350, "protein": 18,   "carbs": 40,   "fat": 12,   "serving": 1,   "unit": "sandwich"},
    "sushi":              {"calories": 350, "protein": 18,   "carbs": 60,   "fat": 5,    "serving": 6,   "unit": "pieces"},
    "salad bowl":         {"calories": 350, "protein": 20,   "carbs": 30,   "fat": 12,   "serving": 1,   "unit": "bowl"},
    "soup":               {"calories": 180, "protein": 10,   "carbs": 20,   "fat": 5,    "serving": 360, "unit": "ml"},
    "stir fry":           {"calories": 320, "protein": 22,   "carbs": 28,   "fat": 12,   "serving": 1,   "unit": "serving"},
    "tacos":              {"calories": 320, "protein": 18,   "carbs": 30,   "fat": 14,   "serving": 3,   "unit": "tacos"},
    "bowl":               {"calories": 450, "protein": 28,   "carbs": 50,   "fat": 14,   "serving": 1,   "unit": "bowl"},
    "wrap":               {"calories": 380, "protein": 22,   "carbs": 38,   "fat": 14,   "serving": 1,   "unit": "wrap"},
    # ── Drinks ──
    "coffee":             {"calories": 5,   "protein": 0.3,  "carbs": 0,    "fat": 0,    "serving": 240, "unit": "ml"},
    "latte":              {"calories": 190, "protein": 10,   "carbs": 19,   "fat": 7,    "serving": 355, "unit": "ml"},
    "orange juice":       {"calories": 112, "protein": 1.7,  "carbs": 26,   "fat": 0.5,  "serving": 248, "unit": "ml"},
    "smoothie":           {"calories": 250, "protein": 8,    "carbs": 45,   "fat": 4,    "serving": 350, "unit": "ml"},
    "protein smoothie":   {"calories": 350, "protein": 30,   "carbs": 40,   "fat": 8,    "serving": 400, "unit": "ml"},
    # ── Snacks ──
    "granola bar":        {"calories": 190, "protein": 4,    "carbs": 29,   "fat": 7,    "serving": 1,   "unit": "bar"},
    "chips":              {"calories": 149, "protein": 2,    "carbs": 15,   "fat": 10,   "serving": 28,  "unit": "g"},
    "dark chocolate":     {"calories": 170, "protein": 2,    "carbs": 13,   "fat": 12,   "serving": 28,  "unit": "g"},
    "hummus":             {"calories": 70,  "protein": 3,    "carbs": 6,    "fat": 5,    "serving": 30,  "unit": "g"},
    "crackers":           {"calories": 130, "protein": 2,    "carbs": 22,   "fat": 4,    "serving": 30,  "unit": "g"},
    "rice cake":          {"calories": 35,  "protein": 0.7,  "carbs": 7.4,  "fat": 0.3,  "serving": 1,   "unit": "cake"},
}


# ── Food search ───────────────────────────────────────────────────────────────

def search_foods(query: str, limit: int = 8) -> List[dict]:
    q = query.lower().strip()
    if not q:
        return []
    results = [{"name": name, **macros} for name, macros in FOODS.items() if q in name]
    results.sort(key=lambda x: (0 if x["name"] == q else 1 if x["name"].startswith(q) else 2))
    return results[:limit]


# ── Meal log ──────────────────────────────────────────────────────────────────

def get_meals(date_str: str, user_id: str) -> List[dict]:
    sb = _sb()
    res = sb.table("nutrition_meals").select("*").eq("user_id", user_id).eq("date", date_str).order("logged_at").execute()
    return res.data or []


def add_meal(date_str: str, name: str, calories: float,
             protein: float, carbs: float, fat: float,
             meal_type: str = "meal", user_id: str = "default") -> dict:
    entry = {
        "id":        str(uuid.uuid4())[:8],
        "user_id":   user_id,
        "date":      date_str,
        "name":      name,
        "calories":  round(calories),
        "protein":   round(protein, 1),
        "carbs":     round(carbs,   1),
        "fat":       round(fat,     1),
        "meal_type": meal_type,
        "logged_at": datetime.now().isoformat(),
    }
    sb = _sb()
    sb.table("nutrition_meals").insert(entry).execute()
    return entry


def delete_meal(date_str: str, meal_id: str, user_id: str = "default") -> bool:
    sb = _sb()
    res = sb.table("nutrition_meals").delete().eq("id", meal_id).eq("user_id", user_id).execute()
    return bool(res.data)


# ── Weight / body composition ─────────────────────────────────────────────────

def get_weight_entries(user_id: str = "default") -> List[dict]:
    sb = _sb()
    res = sb.table("nutrition_weight").select("*").eq("user_id", user_id).order("date").execute()
    return res.data or []


def add_weight_entry(
    date_str: str,
    weight_lbs: float,
    body_fat_pct: Optional[float] = None,
    muscle_mass_lbs: Optional[float] = None,
    lean_mass_lbs: Optional[float] = None,
    trunk_muscle_lbs: Optional[float] = None,
    right_arm_muscle_lbs: Optional[float] = None,
    left_arm_muscle_lbs: Optional[float] = None,
    right_leg_muscle_lbs: Optional[float] = None,
    left_leg_muscle_lbs: Optional[float] = None,
    trunk_fat_lbs: Optional[float] = None,
    right_arm_fat_lbs: Optional[float] = None,
    left_arm_fat_lbs: Optional[float] = None,
    right_leg_fat_lbs: Optional[float] = None,
    left_leg_fat_lbs: Optional[float] = None,
    total_body_water_lbs: Optional[float] = None,
    intracellular_water_lbs: Optional[float] = None,
    extracellular_water_lbs: Optional[float] = None,
    ecw_ratio: Optional[float] = None,
    visceral_fat_level: Optional[float] = None,
    bone_mineral_content_lbs: Optional[float] = None,
    bmr_kcal: Optional[int] = None,
    inbody_score: Optional[int] = None,
    user_id: str = "default",
) -> dict:
    lean_calc = (
        round(weight_lbs * (1 - body_fat_pct / 100), 1)
        if body_fat_pct is not None else lean_mass_lbs
    )
    fat_mass_lbs = (
        round(weight_lbs * body_fat_pct / 100, 1)
        if body_fat_pct is not None else None
    )

    entry: dict = {
        "id":         str(uuid.uuid4())[:8],
        "user_id":    user_id,
        "date":       date_str,
        "weight_lbs": round(weight_lbs, 1),
        "logged_at":  datetime.now().isoformat(),
    }
    optional_fields = {
        "body_fat_pct":             body_fat_pct,
        "fat_mass_lbs":             fat_mass_lbs,
        "lean_mass_lbs":            lean_calc,
        "muscle_mass_lbs":          muscle_mass_lbs,
        "trunk_muscle_lbs":         trunk_muscle_lbs,
        "right_arm_muscle_lbs":     right_arm_muscle_lbs,
        "left_arm_muscle_lbs":      left_arm_muscle_lbs,
        "right_leg_muscle_lbs":     right_leg_muscle_lbs,
        "left_leg_muscle_lbs":      left_leg_muscle_lbs,
        "trunk_fat_lbs":            trunk_fat_lbs,
        "right_arm_fat_lbs":        right_arm_fat_lbs,
        "left_arm_fat_lbs":         left_arm_fat_lbs,
        "right_leg_fat_lbs":        right_leg_fat_lbs,
        "left_leg_fat_lbs":         left_leg_fat_lbs,
        "total_body_water_lbs":     total_body_water_lbs,
        "intracellular_water_lbs":  intracellular_water_lbs,
        "extracellular_water_lbs":  extracellular_water_lbs,
        "ecw_ratio":                ecw_ratio,
        "visceral_fat_level":       visceral_fat_level,
        "bone_mineral_content_lbs": bone_mineral_content_lbs,
        "bmr_kcal":                 bmr_kcal,
        "inbody_score":             inbody_score,
    }
    for k, v in optional_fields.items():
        if v is not None:
            entry[k] = round(v, 2) if isinstance(v, float) else v

    sb = _sb()
    # Delete existing entry for same date, then insert fresh
    sb.table("nutrition_weight").delete().eq("user_id", user_id).eq("date", date_str).execute()
    sb.table("nutrition_weight").insert(entry).execute()
    return entry


def delete_weight_entry(entry_id: str, user_id: str = "default") -> bool:
    sb = _sb()
    res = sb.table("nutrition_weight").delete().eq("id", entry_id).eq("user_id", user_id).execute()
    return bool(res.data)


# ── Settings ──────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "calorie_target":               2000,
    "protein_g":                    150,
    "carbs_g":                      200,
    "fat_g":                        65,
    "weight_goal_lbs":              None,
    "weight_goal_type":             "maintain",
    "eating_start":                 "12:00",
    "eating_end":                   "20:00",
    "fasting_enabled":              False,
    "units":                        "lbs",
    "include_active_cal_in_budget": True,
}


def get_settings(user_id: str = "default") -> dict:
    sb = _sb()
    res = sb.table("nutrition_settings").select("*").eq("user_id", user_id).execute()
    rows = res.data or []
    if rows:
        row = rows[0]
        row.pop("user_id", None)
        row.pop("updated_at", None)
        return {**DEFAULT_SETTINGS, **{k: v for k, v in row.items() if v is not None}}
    return dict(DEFAULT_SETTINGS)


def save_settings(settings: dict, user_id: str = "default") -> dict:
    sb = _sb()
    row = {"user_id": user_id, **settings, "updated_at": datetime.now().isoformat()}
    # Try update first, insert if no existing row
    existing = sb.table("nutrition_settings").select("user_id").eq("user_id", user_id).execute()
    if existing.data:
        sb.table("nutrition_settings").update(row).eq("user_id", user_id).execute()
    else:
        sb.table("nutrition_settings").insert(row).execute()
    return settings


# ── Weekly summary ────────────────────────────────────────────────────────────

def weekly_summary(active_calories_by_date: Optional[dict] = None, user_id: str = "default") -> dict:
    today      = date.today()
    week_start = today - timedelta(days=6)

    daily = []
    for i in range(7):
        d     = (week_start + timedelta(days=i)).isoformat()
        meals = get_meals(d, user_id)
        cals  = sum(m["calories"] for m in meals)
        prot  = round(sum(m["protein"] for m in meals), 1)
        carbs = round(sum(m["carbs"]   for m in meals), 1)
        fat   = round(sum(m["fat"]     for m in meals), 1)
        active = (active_calories_by_date or {}).get(d, 0)
        daily.append({
            "date":     d,
            "calories": cals,
            "protein":  prot,
            "carbs":    carbs,
            "fat":      fat,
            "active_cal": active,
            "net_cal":  cals - active,
            "logged":   len(meals) > 0,
        })

    logged_days = [d for d in daily if d["logged"]]
    n = len(logged_days) or 1
    return {
        "daily":        daily,
        "days_logged":  len(logged_days),
        "avg_calories": round(sum(d["calories"] for d in logged_days) / n),
        "avg_protein":  round(sum(d["protein"]  for d in logged_days) / n, 1),
        "avg_carbs":    round(sum(d["carbs"]    for d in logged_days) / n, 1),
        "avg_fat":      round(sum(d["fat"]      for d in logged_days) / n, 1),
    }
