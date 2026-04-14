/**
 * BackNine API client
 * All requests are proxied through Next.js rewrites → FastAPI backend
 */

const BASE = "";  // proxied via next.config.js

export interface TodayData {
  readiness:   Record<string, unknown>;
  sleep:       Record<string, unknown>;
  activity:    Record<string, unknown>;
  sleep_model: Record<string, unknown>;
}

export interface TrendDay {
  date:       string;
  readiness:  number | null;
  sleep:      number | null;
  activity:   number | null;
  hrv:        number | null;
  rhr:        number | null;
  steps:      number | null;
  total_hrs:  number | null;
  temp_dev:   number | null;
  deep_min:   number | null;
  rem_min:    number | null;
  efficiency: number | null;
  active_cal: number | null;
}

export interface CoachCard {
  color:  string;
  border: string;
  icon:   string;
  title:  string;
  msg:    string;
}

export interface CoachItem {
  icon:    string;
  label:   string;
  text:    string;
  color:   string;
  urgency: string;
}

export interface Coaching {
  short: CoachItem[];
  mid:   CoachItem[];
  long:  CoachItem[];
  meta:  Record<string, unknown>;
}

export interface TrainingLoad {
  acwr:         number | null;
  acute_avg:    number | null;
  chronic_avg:  number | null;
  zone:         string;
  label:        string;
  color:        string;
  acute_days:   number;
  chronic_days: number;
}

export interface ReadinessForecast {
  score:     number;
  label:     string;
  color:     string;
  hrv_adj:   number;
  sleep_adj: number;
  base:      number;
}

export interface DashboardData {
  generated:           string;
  data_through:        string;
  provider:            string;
  today:               TodayData;
  trend:               TrendDay[];
  coaches:             { overall: CoachCard; sleep: CoachCard; activity: CoachCard };
  coaching:            Coaching;
  training_load:       TrainingLoad;
  readiness_forecast:  ReadinessForecast;
}

export interface Wearable {
  provider: string;
  name:     string;
  status:   "connected" | "available" | "coming_soon";
}

// ── Nutrition types ───────────────────────────────────────────────────────────

export interface FoodItem {
  name:     string;
  calories: number;
  protein:  number;
  carbs:    number;
  fat:      number;
  serving:  number;
  unit:     string;
}

export interface Meal {
  id:        string;
  name:      string;
  calories:  number;
  protein:   number;
  carbs:     number;
  fat:       number;
  meal_type: string;
  logged_at: string;
}

export interface MacroTotals {
  calories: number;
  protein:  number;
  carbs:    number;
  fat:      number;
}

export interface NutritionSettings {
  calorie_target:              number;
  protein_g:                   number;
  carbs_g:                     number;
  fat_g:                       number;
  weight_goal_lbs:             number | null;
  weight_goal_type:            "lose" | "maintain" | "gain";
  eating_start:                string;
  eating_end:                  string;
  fasting_enabled:             boolean;
  units:                       string;
  include_active_cal_in_budget: boolean;
}

export interface NutritionToday {
  date:     string;
  meals:    Meal[];
  totals:   MacroTotals;
  settings: NutritionSettings;
}

export interface WeightEntry {
  id:                       string;
  date:                     string;
  weight_lbs:               number;
  logged_at:                string;
  // Optional body comp
  body_fat_pct?:             number;
  fat_mass_lbs?:             number;
  lean_mass_lbs?:            number;
  muscle_mass_lbs?:          number;
  // InBody segmental muscle
  trunk_muscle_lbs?:         number;
  right_arm_muscle_lbs?:     number;
  left_arm_muscle_lbs?:      number;
  right_leg_muscle_lbs?:     number;
  left_leg_muscle_lbs?:      number;
  // InBody segmental fat
  trunk_fat_lbs?:            number;
  right_arm_fat_lbs?:        number;
  left_arm_fat_lbs?:         number;
  right_leg_fat_lbs?:        number;
  left_leg_fat_lbs?:         number;
  // InBody water
  total_body_water_lbs?:     number;
  intracellular_water_lbs?:  number;
  extracellular_water_lbs?:  number;
  ecw_ratio?:                number;
  // InBody other
  visceral_fat_level?:       number;
  bone_mineral_content_lbs?: number;
  bmr_kcal?:                 number;
  inbody_score?:             number;
}

export interface NutritionSummaryDay {
  date:       string;
  calories:   number;
  protein:    number;
  carbs:      number;
  fat:        number;
  active_cal: number;
  net_cal:    number;
  logged:     boolean;
}

export interface NutritionSummary {
  daily:        NutritionSummaryDay[];
  days_logged:  number;
  avg_calories: number;
  avg_protein:  number;
  avg_carbs:    number;
  avg_fat:      number;
}

// ── Training types ────────────────────────────────────────────────────────────

export interface ExerciseInfo {
  name:      string;
  primary:   string[];
  secondary: string[];
  equipment: string;
  category:  string;
}

export interface WorkoutSet {
  weight_lbs: number;
  reps:       number;
  rpe?:       number;
}

export interface WorkoutExercise {
  name:         string;
  sets?:        WorkoutSet[];   // lifting
  duration_sec?: number;        // stretching
}

export interface Workout {
  id:                string;
  date:              string;
  type:              "lifting" | "stretching" | "mobility";
  exercises:         WorkoutExercise[];
  muscle_groups:     string[];
  duration_min?:     number;
  notes?:            string;
  logged_at:         string;
  total_volume_lbs?: number;
}

export interface TrainingRecommendation {
  level:            "full" | "moderate" | "light" | "rest";
  label:            string;
  color:            string;
  title:            string;
  detail:           string;
  modifiers:        string[];
  suggestion:       string;
  readiness:        number;
  consecutive_days: number;
}

export interface StretchExercise {
  name:         string;
  duration_sec: number;
  cue:          string;
  muscle_group: string;
  sides:        number;
}

export interface StretchRoutine {
  exercises:     StretchExercise[];
  total_min:     number;
  muscle_groups: string[];
}

export interface WeeklySession {
  name:       string;
  date:       string;
  is_today:   boolean;
  rest:       boolean;
  optional?:  boolean;
  focus?:     string[];
  exercises?: Array<{ name: string; sets: number; reps: string; note: string }>;
}

export interface WeeklyPlan {
  plan:          WeeklySession[];
  days_per_week: number;
}

export interface TrainingSettings {
  goal:          string;
  days_per_week: number;
  split_type:    string;
  equipment:     string[];
  units:         string;
}

// ── Labs types ─────────────────────────────────────────────────────────────────

export interface LabEntry {
  id:         string;
  date:       string;
  logged_at:  string;
  // Metabolic panel
  glucose?:      number;
  hba1c?:        number;
  insulin?:      number;
  // Lipids
  total_cholesterol?: number;
  ldl?:          number;
  hdl?:          number;
  triglycerides?: number;
  // Thyroid
  tsh?:          number;
  t3_free?:      number;
  t4_free?:      number;
  // Hormones
  testosterone_total?: number;
  testosterone_free?:  number;
  estradiol?:    number;
  dhea_s?:       number;
  cortisol?:     number;
  // Inflammation
  crp_hs?:       number;
  homocysteine?: number;
  // Blood / Iron
  ferritin?:     number;
  hemoglobin?:   number;
  hematocrit?:   number;
  // Vitamins & minerals
  vitamin_d?:    number;
  vitamin_b12?:  number;
  magnesium?:    number;
  zinc?:         number;
  // Kidney / Liver
  creatinine?:   number;
  egfr?:         number;
  alt?:          number;
  ast?:          number;
  notes?:        string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Don't set Content-Type for FormData — the browser sets it with the boundary automatically
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: isFormData ? undefined : {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboard():          Promise<DashboardData> { return request("/api/dashboard"); },
  wearables():          Promise<{ connected: Wearable[]; available: Wearable[] }> { return request("/api/wearables"); },
  disconnect(p: string): Promise<void> { return request(`/api/wearables/${p}`, { method: "DELETE" }); },
  logout():             Promise<void> { return request("/auth/logout", { method: "POST" }); },
  connectOura():        void { window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "https://backnine-hu60.onrender.com"}/auth/oura`; },

  // ── Nutrition ──────────────────────────────────────────────────────────────
  nutritionToday():     Promise<NutritionToday>    { return request("/api/nutrition/today"); },
  nutritionSummary():   Promise<NutritionSummary>  { return request("/api/nutrition/summary"); },
  searchFoods(q: string): Promise<{ results: FoodItem[] }> { return request(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}`); },
  logMeal(meal: Omit<Meal, "id" | "logged_at"> & { date?: string }): Promise<Meal> {
    return request("/api/nutrition/meals", { method: "POST", body: JSON.stringify(meal) });
  },
  deleteMeal(id: string, date?: string): Promise<void> {
    const qs = date ? `?date=${date}` : "";
    return request(`/api/nutrition/meals/${id}${qs}`, { method: "DELETE" });
  },
  weightEntries():      Promise<{ entries: WeightEntry[] }> { return request("/api/nutrition/weight"); },
  logWeight(entry: Partial<WeightEntry> & { weight_lbs: number }): Promise<WeightEntry> {
    return request("/api/nutrition/weight", { method: "POST", body: JSON.stringify(entry) });
  },
  deleteWeight(id: string): Promise<void> { return request(`/api/nutrition/weight/${id}`, { method: "DELETE" }); },
  nutritionSettings():  Promise<NutritionSettings> { return request("/api/nutrition/settings"); },
  saveNutritionSettings(s: NutritionSettings): Promise<NutritionSettings> {
    return request("/api/nutrition/settings", { method: "POST", body: JSON.stringify(s) });
  },

  // ── Training ──────────────────────────────────────────────────────────────
  searchExercises(q: string): Promise<{ results: ExerciseInfo[] }> {
    return request(`/api/training/exercises/search?q=${encodeURIComponent(q)}`);
  },
  workouts(days?: number): Promise<{ workouts: Workout[] }> {
    return request(`/api/training/workouts${days ? `?days=${days}` : ""}`);
  },
  logWorkout(w: Omit<Workout, "id" | "logged_at" | "muscle_groups" | "total_volume_lbs">): Promise<Workout> {
    return request("/api/training/workouts", { method: "POST", body: JSON.stringify(w) });
  },
  deleteWorkout(id: string): Promise<void> {
    return request(`/api/training/workouts/${id}`, { method: "DELETE" });
  },
  trainingRecommendation(): Promise<TrainingRecommendation> {
    return request("/api/training/recommendation");
  },
  stretchRoutine(muscleGroups: string[], durationMin?: number): Promise<StretchRoutine> {
    return request("/api/training/stretch-routine", {
      method: "POST",
      body: JSON.stringify({ muscle_groups: muscleGroups, duration_min: durationMin ?? 10 }),
    });
  },
  weeklyPlan(): Promise<WeeklyPlan> {
    return request("/api/training/weekly-plan");
  },
  trainingSettings(): Promise<TrainingSettings> {
    return request("/api/training/settings");
  },
  saveTrainingSettings(s: TrainingSettings): Promise<TrainingSettings> {
    return request("/api/training/settings", { method: "POST", body: JSON.stringify(s) });
  },

  // ── Labs ──────────────────────────────────────────────────────────────────
  labEntries(): Promise<{ entries: LabEntry[] }> {
    return request("/api/labs");
  },
  logLab(entry: Partial<LabEntry> & { date: string }): Promise<LabEntry> {
    return request("/api/labs", { method: "POST", body: JSON.stringify(entry) });
  },
  deleteLab(id: string): Promise<void> {
    return request(`/api/labs/${id}`, { method: "DELETE" });
  },
  importLabPdf(file: File): Promise<{ date: string; extracted: Record<string, number>; count: number }> {
    const form = new FormData();
    form.append("file", file);
    return request("/api/labs/import-pdf", { method: "POST", body: form });
  },

  // ── Challenges ──────────────────────────────────────────────────────────────
  myChallenges(): Promise<{ challenges: Challenge[]; user_id: string }> {
    return request("/api/challenges/me");
  },
  createChallenge(body: {
    name: string; type: string; target: number;
    duration_days: number; creator_name: string; custom_unit?: string;
  }): Promise<Challenge> {
    return request("/api/challenges", { method: "POST", body: JSON.stringify(body) });
  },
  joinChallenge(challenge_id: string, display_name: string): Promise<Challenge> {
    return request("/api/challenges/join", { method: "POST", body: JSON.stringify({ challenge_id, display_name }) });
  },
  getChallenge(id: string): Promise<Challenge> {
    return request(`/api/challenges/${id}`);
  },
  logChallengeProgress(challenge_id: string, value: number, date?: string): Promise<Challenge> {
    return request(`/api/challenges/${challenge_id}/progress`, {
      method: "POST",
      body: JSON.stringify({ value, date }),
    });
  },
};

// ── Challenge types ───────────────────────────────────────────────────────────
export interface ChallengeParticipant {
  user_id:      string;
  display_name: string;
  is_me:        boolean;
  total_value:  number;
  days_hit:     number;
  today_value:  number;
  streak:       number;
  daily:        Record<string, number>;
}

export interface Challenge {
  id:            string;
  name:          string;
  type:          string;
  metric:        string;
  target:        number;
  duration_days: number;
  start_date:    string;
  end_date:      string;
  creator_id:    string;
  creator_name:  string;
  elapsed_days:  number;
  days_left:     number;
  total_days:    number;
  is_active:     boolean;
  is_mine:       boolean;
  participants:  ChallengeParticipant[];
  type_info:     { label: string; unit: string; icon: string };
}
