/**
 * BackNine API client
 * All requests go directly to the FastAPI backend on Render.
 * Auth token is passed via Authorization header to avoid cross-site cookie issues.
 */

import GEAR from "./gearData";

const BASE = "https://backnine-hu60.onrender.com";

// The user's LOCAL calendar date as YYYY-MM-DD. Using this (instead of
// toISOString(), which is UTC) keeps "today" aligned with the user's timezone —
// otherwise an evening meal in the US gets the next day's UTC date and shows up
// as "today" the following morning.
export function localToday(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Token storage ─────────────────────────────────────────────────────────────
// On load, grab token from URL ?token= param (set by backend after OAuth),
// persist to localStorage, then remove from URL so it's not bookmarked.
function _initToken(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    localStorage.setItem("bn_token", urlToken);
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    return urlToken;
  }
  return localStorage.getItem("bn_token");
}

let _token: string | null = null;

export function getToken(): string | null {
  if (!_token) _token = _initToken();
  return _token;
}

export function clearToken(): void {
  _token = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("bn_token");
    clearDashboardCache();
  }
}

// ── Dashboard cache (stale-while-revalidate) ───────────────────────────────
// On every dashboard mount, we paint from this cache immediately so the user
// sees their data instead of a spinner. Then api.dashboard() runs in the
// background and the page updates in place when fresh data lands.
//
// Cache is cleared on logout (above) so a previous user's dashboard never
// leaks into a new session.
const DASHBOARD_CACHE_KEY = "bn_dashboard_cache";
const DASHBOARD_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — older than this, don't pretend it's fresh

export function readDashboardCache(): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed._ts !== "number") return null;
    if (Date.now() - parsed._ts > DASHBOARD_CACHE_MAX_AGE_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeDashboardCache(data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ _ts: Date.now(), data }));
  } catch {
    /* quota or serialization issue — silently skip; the network fetch still works */
  }
}

export function clearDashboardCache(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(DASHBOARD_CACHE_KEY); } catch { /* noop */ }
}

// ── Pending referral (shareable invite cards) ───────────────────────────────────
// A shared card link is https://<app>/?ref=CODE. We stash the code in
// localStorage as early as possible (before any auth redirect — e.g. the Oura
// OAuth round trip leaves and returns to the origin), then the dashboard
// auto-accepts it once the user is signed in. localStorage survives the redirect.
const PENDING_REF_KEY = "bn_pending_ref";

/** Read ?ref= from the URL, persist it, and strip it from the address bar. */
export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem(PENDING_REF_KEY, ref.trim().toUpperCase());
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState({}, "", url.toString());
    }
  } catch { /* no-op */ }
}

export function getPendingReferral(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PENDING_REF_KEY);
}

export function clearPendingReferral(): void {
  if (typeof window !== "undefined") localStorage.removeItem(PENDING_REF_KEY);
}

export interface ActivityLive {
  date:       string;
  steps:      number | null;
  active_cal: number | null;
  score:      number | null;  // Oura activity score for today if already closed
}

export interface TodayData {
  date?:               string;   // Oura anchor date (often yesterday)
  calendar_today?:     string;   // Timezone-safe "today" from Oura max date
  readiness:           Record<string, unknown>;
  sleep:               Record<string, unknown>;
  activity:            Record<string, unknown>; // Oura summary for anchor (coach card)
  yesterday_activity?: Record<string, unknown>; // Day before anchor Oura activity
  today_activity?:     Record<string, unknown>; // Full Oura activity for oura_today
  activity_live?:      ActivityLive;            // AH live + today's Oura score
  sleep_model:         Record<string, unknown>;
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

export interface PredictionDay {
  date:      string;
  predicted: number;
  actual:    number;
  diff:      number;
  hit:       boolean;
}

export interface PredictionAccuracy {
  resolved:       PredictionDay[];
  accuracy_pct:   number | null;
  streak:         number;
  best_streak:    number;
  total_resolved: number;
  hit_threshold:  number;
}

export interface LongevityComponent {
  label:  string;
  value:  string;
  norm:   string;
  points: number;
  max:    number;
}

export interface LongevityScore {
  score:                number | null;
  grade:                string | null;
  biological_age_delta: number | null;
  components:           Record<string, LongevityComponent>;
  data_coverage:        string;
}

export interface LongevityHistoryPoint {
  date:                 string;
  score:                number;
  grade:                string | null;
  biological_age_delta: number | null;
}

export interface LongevityHistory {
  history: LongevityHistoryPoint[];
  summary: {
    current:    number | null;
    delta_7d:   number | null;
    delta_30d:  number | null;
    count:      number;
    first_date: string | null;
  };
}

export interface Supplement {
  name:    string;
  dose?:   string;     // e.g. "400mg", "2 caps"
  timing?: string;     // e.g. "morning", "with dinner"
  notes?:  string;
}

/** Peptides use the exact same shape as supplements today — separate type
 *  so future divergence (cycle info, route of administration, etc.) doesn't
 *  break supplements call sites. */
export type Peptide = Supplement;

export interface UserProfile {
  name?:           string | null;
  age?:            number | null;     // derived from birthdate when set
  birthdate?:      string | null;     // ISO YYYY-MM-DD
  biological_sex?: "male" | "female" | null;
  health_goals?:   string[];
  vo2_max?:        number | null;
  supplements?:    Supplement[];
  peptides?:       Peptide[];
}

export interface ChatMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface MeResponse {
  user_id:          string;
  email:            string | null;
  provider:         string;
  has_oura:         boolean;
  needs_onboarding: boolean;
}

export interface AppleHealthToday {
  steps?:                    number | null;
  sleep_hours?:              number | null;
  active_calories?:          number | null;
  resting_hr?:               number | null;
  hrv?:                      number | null;
  respiratory_rate?:         number | null;
  weight_kg?:                number | null;
  vo2_max?:                  number | null;
  body_fat_percentage?:      number | null;
  lean_body_mass_kg?:        number | null;
  skeletal_muscle_mass_kg?:  number | null;
  bmi?:                      number | null;
  blood_pressure_systolic?:  number | null;
  blood_pressure_diastolic?: number | null;
  spo2?:                     number | null;
  visceral_fat_rating?:      number | null;
}

export interface AppleHealthBlock {
  as_of:        string | null;
  today:        AppleHealthToday;
  averages?:    Partial<AppleHealthToday>;
  days_synced?: number;
  last_sync_at?: string;
}

export interface DashboardData {
  generated:            string;
  data_through:         string;
  provider:             string;
  has_oura?:            boolean;
  has_apple_health?:    boolean;
  apple_health?:        AppleHealthBlock | null;
  today:                TodayData;
  trend:                TrendDay[];
  coaches:              { overall: CoachCard; sleep: CoachCard; activity: CoachCard };
  coaching:             Coaching;
  training_load:        TrainingLoad;
  readiness_forecast:   ReadinessForecast;
  prediction_accuracy?: PredictionAccuracy;
  longevity_score?:     LongevityScore;
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

/** A draft food item (from AI parse, recents) before it's logged as a Meal. */
export interface MealDraftItem {
  name:     string;
  calories: number;
  protein:  number;
  carbs:    number;
  fat:      number;
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

// ── Blood pressure ─────────────────────────────────────────────────────────
export type BPTimeOfDay = "morning" | "midday" | "evening" | "other";

export interface BPReading {
  id:          string;
  date:        string;        // ISO YYYY-MM-DD
  time_of_day: BPTimeOfDay;
  systolic:    number;
  diastolic:   number;
  pulse?:      number | null;
  notes?:      string | null;
  source:      "manual" | "apple_health" | "withings";
  created_at:  string;
}

export interface BPSummary {
  count:   number;
  days:    number;
  average?: { systolic: number | null; diastolic: number | null };
  morning?: { systolic: number | null; diastolic: number | null; n: number };
  evening?: { systolic: number | null; diastolic: number | null; n: number };
  latest?:  { date: string; time: BPTimeOfDay; systolic: number; diastolic: number; pulse: number | null };
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
  // Number of complete days backing the averages (today is excluded so a
  // partial day doesn't drag the trend down). Usually 0..6.
  avg_days_count?: number;
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
  done?:      boolean;   // UI-only: marked complete during the session
}

export interface WorkoutTemplate {
  id:        string;
  name:      string;
  type:      "lifting" | "stretching" | "mobility";
  exercises: WorkoutExercise[];
  created_at?: string;
}

export interface ParsedWorkout {
  type:         "lifting" | "stretching" | "mobility";
  exercises:    WorkoutExercise[];
  duration_min: number | null;
  notes:        string;
}

export interface WorkoutExercise {
  name:         string;
  sets?:        WorkoutSet[];   // lifting
  duration_sec?: number;        // stretching
}

export interface Workout {
  id:                string;
  date:              string;
  type:              string;            // free-text label (e.g. "Lifting", "Running", "Sauna")
  exercises:         WorkoutExercise[];
  muscle_groups:     string[];
  duration_min?:     number;
  notes?:            string;
  logged_at:         string;
  total_volume_lbs?: number;
  // Extended attributes (Oura imports + future cardio entries)
  kind?:             "strength" | "cardio" | "session";
  source?:           "oura" | null;     // null = manually logged
  external_id?:      string;            // Oura workout/session id
  activity?:         string;            // running, walking, sauna, meditation, etc.
  distance_meters?:  number;
  avg_hr?:           number;
  calories_kcal?:    number;
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
  const isFormData = options?.body instanceof FormData;
  const token = getToken();
  const authHeader = token ? { "Authorization": `Bearer ${token}` } : {};
  // X-User-Local-Date — pinned in ONE place so every API call carries the
  // user's device-local "today" with it. Backend `_user_local_today(request)`
  // helper reads this. Without this, Render (UTC) silently rolls over to
  // tomorrow after ~4pm PT, which is the bug we kept re-introducing every
  // time we added a new endpoint that touched "today".
  const tzHeader = { "X-User-Local-Date": localToday() };
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: isFormData ? { ...authHeader, ...tzHeader } : {
      "Content-Type": "application/json",
      ...authHeader,
      ...tzHeader,
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
  logout():             Promise<void> { clearToken(); return request("/auth/logout", { method: "POST" }); },
  connectOura(userId?: string): void {
    const url = userId
      ? `https://backnine-hu60.onrender.com/auth/oura?link_user_id=${encodeURIComponent(userId)}`
      : "https://backnine-hu60.onrender.com/auth/oura";
    window.location.href = url;
  },

  // ── Longevity history ────────────────────────────────────────────────────────
  longevityHistory(days = 90): Promise<LongevityHistory> {
    return request(`/api/longevity/history?days=${days}`);
  },

  // ── Nutrition ──────────────────────────────────────────────────────────────
  nutritionToday(date?: string): Promise<NutritionToday> {
    return request(`/api/nutrition/today?date=${date || localToday()}`);
  },
  nutritionSummary(date?: string): Promise<NutritionSummary> { return request(`/api/nutrition/summary?date=${date || localToday()}`); },
  searchFoods(q: string): Promise<{ results: FoodItem[] }> { return request(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}`); },
  logMeal(meal: Omit<Meal, "id" | "logged_at"> & { date?: string }): Promise<Meal> {
    return request("/api/nutrition/meals", {
      method: "POST",
      body: JSON.stringify({ ...meal, date: meal.date || localToday() }),
    });
  },
  logMealsBatch(meals: MealDraftItem[], date?: string): Promise<{ meals: Meal[] }> {
    return request("/api/nutrition/meals/batch", {
      method: "POST",
      body: JSON.stringify({ meals, date: date || localToday() }),
    });
  },
  recentFoods(): Promise<{ foods: MealDraftItem[] }> {
    return request("/api/nutrition/recent");
  },
  parseMealText(text: string): Promise<{ items: MealDraftItem[] }> {
    return request("/api/nutrition/parse-text", { method: "POST", body: JSON.stringify({ text }) });
  },
  parseMealPhoto(image: string, media_type: string): Promise<{ items: MealDraftItem[] }> {
    return request("/api/nutrition/parse-photo", {
      method: "POST",
      body: JSON.stringify({ image, media_type }),
    });
  },
  deleteMeal(id: string, date?: string): Promise<void> {
    const qs = date ? `?date=${date}` : "";
    return request(`/api/nutrition/meals/${id}${qs}`, { method: "DELETE" });
  },
  updateMeal(id: string, patch: Partial<Pick<Meal, "name" | "calories" | "protein" | "carbs" | "fat" | "meal_type">>): Promise<Meal> {
    return request(`/api/nutrition/meals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  weightEntries():      Promise<{ entries: WeightEntry[] }> { return request("/api/nutrition/weight"); },

  // ── Blood pressure log ─────────────────────────────────────────────────────
  /** List BP readings + recent-window summary stats. days=0 → all-time. */
  bpList(days = 90): Promise<{ readings: BPReading[]; summary: BPSummary }> {
    return request(`/api/bp?days=${days}`);
  },
  /** Save a single reading. Defaults `date` to today and `time_of_day` to morning. */
  bpLog(entry: { systolic: number; diastolic: number; pulse?: number; date?: string; time_of_day?: BPTimeOfDay; notes?: string }): Promise<BPReading> {
    return request("/api/bp", {
      method: "POST",
      body: JSON.stringify({ ...entry, date: entry.date || localToday() }),
    });
  },
  bpDelete(id: string): Promise<{ status: string }> {
    return request(`/api/bp/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  logWeight(entry: Partial<WeightEntry> & { weight_lbs: number }): Promise<WeightEntry> {
    return request("/api/nutrition/weight", {
      method: "POST",
      body: JSON.stringify({ ...entry, date: entry.date || localToday() }),
    });
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
  updateWorkout(id: string, patch: Partial<Pick<Workout, "date" | "type" | "duration_min" | "notes" | "activity" | "distance_meters" | "avg_hr" | "calories_kcal">>): Promise<Workout> {
    return request(`/api/training/workouts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  parseWorkout(text: string): Promise<ParsedWorkout> {
    return request("/api/training/parse-workout", { method: "POST", body: JSON.stringify({ text }) });
  },
  trainingTemplates(): Promise<{ templates: WorkoutTemplate[] }> {
    return request("/api/training/templates");
  },
  saveTemplate(t: { name: string; type: string; exercises: WorkoutExercise[] }): Promise<WorkoutTemplate> {
    return request("/api/training/templates", { method: "POST", body: JSON.stringify(t) });
  },
  deleteTemplate(id: string): Promise<void> {
    return request(`/api/training/templates/${id}`, { method: "DELETE" });
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
  archiveChallenge(id: string, archived: boolean): Promise<{ ok: boolean; archived_challenges: string[] }> {
    return request(`/api/challenges/${id}/archive`, {
      method: "POST",
      body: JSON.stringify({ archived }),
    });
  },
  logChallengeProgress(challenge_id: string, value: number, date?: string): Promise<Challenge> {
    return request(`/api/challenges/${challenge_id}/progress`, {
      method: "POST",
      body: JSON.stringify({ value, date }),
    });
  },
  getChallengeMessages(challenge_id: string): Promise<{ messages: ChallengeMessage[] }> {
    return request(`/api/challenges/${challenge_id}/messages`);
  },
  postChallengeMessage(challenge_id: string, text: string, display_name: string): Promise<ChallengeMessage> {
    return request(`/api/challenges/${challenge_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, display_name }),
    });
  },

  // ── Apple Health ─────────────────────────────────────────────────────────────
  /** Generates a one-sentence Coach Al reaction to a logged action. The text
   *  may be null if generation failed — call sites should noop in that case. */
  coachReact(action: "meal_logged" | "workout_logged" | "weight_logged",
             details: Record<string, unknown>): Promise<{ text: string | null }> {
    return request("/api/coach/react", {
      method: "POST",
      body: JSON.stringify({ action, details }),
    });
  },
  appleHealthKey(): Promise<{ api_key: string }> {
    return request("/api/apple-health/key");
  },
  /** Manual daily-stats log for users without a connected device. Any subset
   *  of fields is valid — submit just what you know. Date defaults to today. */
  manualLog(payload: {
    date?:                      string;
    steps?:                     number;
    sleep_hours?:               number;
    weight_lbs?:                number;
    weight_kg?:                 number;
    resting_hr?:                number;
    hrv?:                       number;
    active_calories?:           number;
    body_fat_percentage?:       number;
    vo2_max?:                   number;
    respiratory_rate?:          number;
    spo2?:                      number;
    blood_pressure_systolic?:   number;
    blood_pressure_diastolic?:  number;
  }): Promise<{ status: string; date: string; fields_logged: string[] }> {
    // Auto-attach the device-local date when the caller didn't specify one.
    // Without this, the backend defaults to datetime.now() which is UTC on
    // Render, causing late-evening west-coast users to log "tomorrow".
    const withDate = { date: localToday(), ...payload };
    return request("/api/manual-log", {
      method: "POST",
      body: JSON.stringify(withDate),
    });
  },
  appleHealthData(days = 30): Promise<AppleHealthSummary> {
    return request(`/api/apple-health/data?days=${days}`);
  },
  /** Connection + freshness status for the AH integration. Lets the setup page
   *  show "connected · 14 days of data · last sync 2h ago" instead of leaving
   *  the user guessing whether their iOS Shortcut is actually working. */
  appleHealthStatus(): Promise<{
    connected:    boolean;
    last_sync_at: string | null;
    latest_date:  string | null;
    days_synced:  number;
  }> {
    return request("/api/apple-health/status");
  },

  // ── Insights ──────────────────────────────────────────────────────────────
  insights(days = 60, options?: RequestInit): Promise<{ insights: Insight[]; days_analyzed: number }> {
    return request(`/api/insights?days=${days}`, options);
  },

  // ── Progress ──────────────────────────────────────────────────────────────
  progress(): Promise<ProgressReport> {
    return request("/api/progress");
  },

  // ── Gear (Picked For You dismissals) ────────────────────────────────────────
  gear: {
    dismissed(): Promise<{ dismissed: string[] }> {
      return request("/api/gear/dismissed");
    },
    dismiss(item_id: string): Promise<{ ok: boolean; dismissed: string[] }> {
      return request("/api/gear/dismiss", {
        method: "POST",
        body: JSON.stringify({ item_id }),
      });
    },
    // Communal reviews
    reviewsSummary(): Promise<{ summary: Record<string, GearReviewSummary> }> {
      return request("/api/gear/reviews/summary");
    },
    reviews(item_id: string): Promise<{ reviews: GearReview[] }> {
      return request(`/api/gear/${encodeURIComponent(item_id)}/reviews`);
    },
    postReview(item_id: string, rating: number | null, text: string): Promise<{ ok: boolean }> {
      return request(`/api/gear/${encodeURIComponent(item_id)}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating, text }),
      });
    },
    deleteReview(item_id: string): Promise<{ status: string }> {
      return request(`/api/gear/${encodeURIComponent(item_id)}/reviews`, { method: "DELETE" });
    },
    // Coach Al gear finder — describe what you're trying to do, get matched
    // catalog picks + honest "what to look for" guidance for anything we don't carry.
    ask(query: string, context?: string): Promise<GearFinderResult> {
      const catalog = GEAR.flatMap((cat) =>
        cat.items.map((it) => ({
          id: it.id,
          name: it.name,
          brand: it.brand,
          category: cat.label,
          price: it.price,
          description: it.description,
        }))
      );
      return request("/api/gear/ask", {
        method: "POST",
        body: JSON.stringify({ query, catalog, context: context || "" }),
      });
    },
    // Owner-only demand list — what people are searching for. 403s for non-admins.
    demand(): Promise<GearDemand> {
      return request("/api/gear/demand");
    },
  },

  // ── Identity / onboarding ───────────────────────────────────────────────────
  me(): Promise<MeResponse> {
    return request("/api/me");
  },
  completeOnboarding(): Promise<{ ok: boolean }> {
    return request("/api/me/complete-onboarding", { method: "POST" });
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  getProfile(): Promise<UserProfile> {
    return request("/api/profile");
  },
  saveProfile(profile: UserProfile): Promise<UserProfile> {
    return request("/api/profile", { method: "POST", body: JSON.stringify(profile) });
  },

  // ── AI Chat ───────────────────────────────────────────────────────────────
  chat(message: string, history: ChatMessage[]): Promise<{ reply: string }> {
    // Send the device-local date so today's macros anchor to the user's day.
    return request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, history, date: localToday() }),
    });
  },
  chatHistory(limit = 50): Promise<{ messages: ChatMessage[] }> {
    return request(`/api/chat/history?limit=${limit}`);
  },
  clearChat(): Promise<{ cleared: boolean | number }> {
    return request("/api/chat/history", { method: "DELETE" });
  },

  // ── Notification inbox ────────────────────────────────────────────────────
  notifications: {
    list(): Promise<NotificationsResponse> {
      return request("/api/notifications");
    },
    markRead(): Promise<{ ok: boolean }> {
      return request("/api/notifications/mark-read", { method: "POST" });
    },
  },

  // ── Coach Al observations ─────────────────────────────────────────────────
  observations: {
    list(): Promise<{ observations: CoachObservation[]; unread_count: number }> {
      return request("/api/observations");
    },
    markRead(id: string): Promise<{ ok: boolean; id: string }> {
      return request(`/api/observations/${encodeURIComponent(id)}/read`, { method: "POST" });
    },
    dismiss(id: string): Promise<{ ok: boolean; id: string }> {
      return request(`/api/observations/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
    },
  },

  // ── Morning Briefing ──────────────────────────────────────────────────────
  briefing(refresh = false, date?: string, allowNoSleep = false): Promise<BriefingResponse> {
    const params = new URLSearchParams({ date: date || localToday() });
    if (refresh) params.set("refresh", "1");
    if (allowNoSleep) params.set("allow_no_sleep", "1");
    return request(`/api/briefing/today?${params.toString()}`);
  },

  // ── Coach Al Weekly Insight ───────────────────────────────────────────────
  weeklyInsight(refresh = false): Promise<WeeklyInsightResponse> {
    return request(`/api/insight/weekly${refresh ? "?refresh=1" : ""}`);
  },

  // (badges / XP / level method removed — gamification layer was killed)

  // ── Groups (Crews) ─────────────────────────────────────────────────────────
  groups: {
    list(): Promise<{ groups: Group[] }> {
      return request("/api/groups");
    },
    create(name: string): Promise<Group> {
      return request("/api/groups", { method: "POST", body: JSON.stringify({ name }) });
    },
    join(code: string): Promise<Group> {
      return request("/api/groups/join", { method: "POST", body: JSON.stringify({ code }) });
    },
    leave(group_id: string): Promise<{ status: string }> {
      return request(`/api/groups/${encodeURIComponent(group_id)}/leave`, { method: "POST" });
    },
    messages(group_id: string): Promise<{ messages: GroupMessage[] }> {
      return request(`/api/groups/${encodeURIComponent(group_id)}/messages`);
    },
    postMessage(group_id: string, text: string): Promise<GroupMessage> {
      return request(`/api/groups/${encodeURIComponent(group_id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    },
    standings(group_id: string): Promise<GroupStandings> {
      return request(`/api/groups/${encodeURIComponent(group_id)}/standings`);
    },
    setGoal(group_id: string, goal: number | null): Promise<{ ok: boolean; weekly_goal: number | null }> {
      return request(`/api/groups/${encodeURIComponent(group_id)}/goal`, {
        method: "POST",
        body: JSON.stringify({ goal }),
      });
    },
  },

  // ── Goals (Coach Al program) ───────────────────────────────────────────────
  goal: {
    active(): Promise<{ goal: Goal | null }> {
      return request("/api/goals/active");
    },
    metrics(): Promise<{ metrics: GoalMetricOption[] }> {
      return request("/api/goals/metrics");
    },
    create(metric: string, target: number, duration_weeks: number): Promise<Goal> {
      return request("/api/goals", {
        method: "POST",
        body: JSON.stringify({ metric, target, duration_weeks }),
      });
    },
    complete(id: string): Promise<{ status: string }> {
      return request(`/api/goals/${encodeURIComponent(id)}/complete`, { method: "POST" });
    },
    remove(id: string): Promise<{ status: string }> {
      return request(`/api/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    /** Re-run goal_coach.generate_plan against the same goal parameters.
     *  Useful when we've updated Coach Al's prompts (e.g. new voice block
     *  rules) and existing cached plans should be refreshed. */
    regenerate(id: string): Promise<Goal> {
      return request(`/api/goals/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
    },
  },

  // ── Daily check-in ────────────────────────────────────────────────────────
  getCheckinToday(date?: string): Promise<CheckinSnapshot> {
    return request(`/api/checkin/today?date=${date || localToday()}`);
  },
  postCheckin(mood: Mood, date?: string): Promise<{ ok: boolean; mood: Mood; date: string }> {
    return request("/api/checkin", {
      method: "POST",
      body: JSON.stringify({ mood, date: date || localToday() }),
    });
  },

  // ── Friends ────────────────────────────────────────────────────────────────
  friends: {
    invite(): Promise<FriendInvite> {
      return request("/api/friends/invite", { method: "POST" });
    },
    accept(code: string): Promise<unknown> {
      return request("/api/friends/accept", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
    },
    list(): Promise<{ friends: Friend[] }> {
      return request("/api/friends");
    },
    remove(friend_user_id: string): Promise<{ removed: boolean }> {
      return request(`/api/friends/${encodeURIComponent(friend_user_id)}`, { method: "DELETE" });
    },
    events(limit = 30): Promise<{ events: FriendActivityEvent[] }> {
      return request(`/api/friends/events?limit=${limit}`);
    },
    /** Single hydrated event — for notification deep-links when the targeted
     *  event isn't in the latest feed window. */
    event(event_id: string): Promise<FriendActivityEvent> {
      return request(`/api/friends/events/${encodeURIComponent(event_id)}`);
    },
    react(event_id: string, emoji: string): Promise<{ event_id: string; reactions: ReactionSummary[] }> {
      return request(`/api/friends/events/${encodeURIComponent(event_id)}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
    },
    comments(event_id: string): Promise<{ comments: EventComment[] }> {
      return request(`/api/friends/events/${encodeURIComponent(event_id)}/comments`);
    },
    postComment(event_id: string, text: string): Promise<EventComment> {
      return request(`/api/friends/events/${encodeURIComponent(event_id)}/comments`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    },
    leaderboard(): Promise<LeaderboardResponse> {
      // Send the device-local date so the leaderboard's "today" matches the
      // user's clock, not server ET — otherwise freshness labels misfire after
      // 9pm PT (ET has rolled to tomorrow but the user's day is still today).
      return request(`/api/friends/leaderboard?date=${localToday()}`);
    },
    /** Friend detail view — 7-day sparklines, longevity, recent workouts. */
    profile(friend_user_id: string): Promise<FriendProfile> {
      return request(`/api/friends/${encodeURIComponent(friend_user_id)}/profile`);
    },
    /** This week's auto-grouped league standings (Duolingo-style). */
    league(): Promise<LeagueResponse> {
      return request("/api/leagues/current");
    },
    /** Stable, reusable referral code for shareable invite cards. */
    referral(): Promise<ReferralCode> {
      return request("/api/friends/referral");
    },
    /** Auto-connect via a referral code captured from a shared link. */
    acceptReferral(code: string): Promise<{ ok: boolean; self?: boolean }> {
      return request("/api/friends/referral/accept", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
    },
    dm: {
      list(friend_user_id: string): Promise<{ messages: DirectMessage[] }> {
        return request(`/api/friends/dm/${encodeURIComponent(friend_user_id)}`);
      },
      send(friend_user_id: string, text: string): Promise<DirectMessage> {
        return request(`/api/friends/dm/${encodeURIComponent(friend_user_id)}`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      },
    },
    cheer(friend_user_id: string, kind: TauntKind = "cheer"): Promise<{
      ok: boolean;
      cheered_user_id: string;
      kind: TauntKind;
    }> {
      return request(`/api/friends/cheer/${encodeURIComponent(friend_user_id)}`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
    },
  },
};

// ── Briefing types ────────────────────────────────────────────────────────────
export interface BriefingResponse {
  date:                string;
  narrative:           string;
  prediction_streak:   number | null;
  prediction_accuracy: number | null;
  generated_at:        string | null;
  cached:              boolean;
  app_streak:          number;     // consecutive days the user has opened BackNine
  has_data?:           boolean;    // false = welcome state for users with no metrics yet
  sleep_status?:       "ok" | "pending";  // "pending" = last night's sleep hasn't synced yet
}

export interface WeeklyInsightStat {
  title:         string | null;
  magnitude:     number | null;
  unit:          string | null;
  direction:     "positive" | "negative" | "neutral" | null;
  n:             number | null;
  r:             number | null;
  group_a_label: string | null;
  group_a_avg:   number | null;
  group_b_label: string | null;
  group_b_avg:   number | null;
}

export interface WeeklyInsightResponse {
  week_start:   string;
  headline:     string;
  narrative:    string;
  experiment:   string;
  insight_id:   string | null;
  stat:         WeeklyInsightStat | null;
  generated_at: string | null;
  cached:       boolean;
  has_data:     boolean;
}

// Badge / LevelInfo / AchievementsResponse types removed — gamification
// layer was killed. The league + streaks + leaderboards drive behavior;
// the badge chip was decorative.

export interface GearReview {
  id:         string;
  user_id:    string;
  user_name:  string;
  rating:     number | null;
  text:       string;
  created_at: string;
  is_me:      boolean;
}

export interface GearReviewSummary {
  avg:   number | null;
  count: number;
}

// ── Coach Al gear finder ──────────────────────────────────────────────────────
export interface GearFinderPick {
  id:     string;   // matches a catalog item id
  reason: string;
}

export interface GearFinderSuggestion {
  title:  string;   // product type to look for (not in our catalog)
  detail: string;
  search: string;   // search phrase to find it
}

export interface GearFinderResult {
  intro:       string;
  picks:       GearFinderPick[];
  suggestions: GearFinderSuggestion[];
}

// Owner-only gear demand list (what people are searching for).
export interface GearDemand {
  total_searches: number;
  match_rate: number | null;
  gaps: { title: string; count: number }[];
  unmatched_queries: { query: string; count: number }[];
  recent: { query: string; had_match: boolean; created_at: string | null }[];
}

// ── Daily check-in types ──────────────────────────────────────────────────────
export type Mood = "great" | "good" | "okay" | "tired" | "off";

export interface DailyCheckin {
  mood:       Mood;
  date:       string;
  created_at: string;
}

export interface CheckinSnapshot {
  today:     DailyCheckin | null;
  yesterday: DailyCheckin | null;
}

// ── Coach Al observations ────────────────────────────────────────────────────
export interface CoachObservation {
  id:         string;
  kind:       string;     // e.g. "hrv_drop", "prediction_streak_5", "insight_<id>"
  date:       string;     // YYYY-MM-DD
  message:    string;     // Coach-Al-voiced opening line
  payload:    Record<string, unknown>;
  read:       boolean;
  dismissed:  boolean;
  created_at: string;
}

// ── Leaderboard types ────────────────────────────────────────────────────────
export type LeaderboardMetric = "steps" | "sleep" | "activity";

export type TauntKind = "cheer" | "catch_me" | "race_me" | "slow_today";

export interface MetricValue {
  value:  number | null;
  anchor: string;
}

export interface HeadToHeadTally {
  w: number;
  l: number;
  t: number;
}

export interface HeadToHead {
  steps:    HeadToHeadTally;
  sleep:    HeadToHeadTally;
  activity: HeadToHeadTally;
}

export interface LeaderboardEntry {
  user_id:       string;
  name:          string;
  is_me:         boolean;
  steps:         MetricValue;
  sleep:         MetricValue;
  activity:      MetricValue;
  /** Weekly engagement points — the inclusive ranking metric (works without a wearable). */
  points:        number;
  /** @deprecated Always null — badge/XP/Level layer was removed. Key kept
   *  for response-shape backwards-compat. Safe to remove on next API revision. */
  level?:        number | null;
  /** Which taunt (if any) the current user has sent to this friend today. */
  taunt_sent:    TauntKind | null;
  /** Weekly head-to-head tally vs the current user. Null for self. */
  head_to_head:  HeadToHead | null;
}

export interface ReferralCode {
  code: string;
  name: string;
}

export interface GroupMember {
  user_id: string;
  name:    string;
}

export interface Group {
  id:           string;
  name:         string;
  join_code:    string;
  created_by:   string;
  member_count: number;
  members:      GroupMember[];
}

export interface GroupMessage {
  id:         string;
  user_id:    string;
  user_name:  string;
  text:       string;
  created_at: string;
  is_me:      boolean;
}

export interface GroupStandingMember {
  user_id: string;
  name:    string;
  points:  number;
  rank:    number;
  is_me:   boolean;
}

export interface GroupStandings {
  name:       string;
  members:    GroupStandingMember[];
  total:      number;
  goal:       number | null;
  week_start: string;
}

export interface GoalPlanWeek {
  week:    number;
  focus:   string;
  actions: string[];
}

export interface GoalMetricOption {
  metric:        string;
  label:         string;
  unit:          string;
  higher_better: boolean;
  current:       number | null;
}

export type GoalPaceStatus =
  | "no_data" | "starting" | "reached"
  | "well_ahead" | "ahead" | "on_track" | "slightly_behind" | "behind";

export interface GoalPace {
  status:       GoalPaceStatus;
  label:        string;                 // short chip text, e.g. "Ahead of pace"
  message:      string;                 // one-line Coach Al nudge
  tone:         "win" | "good" | "warn" | "neutral";
  expected_pct: number | null;          // % of timeline elapsed
  delta_pct:    number | null;          // progress_pct - expected_pct
}

export interface Goal {
  id:           string;
  metric:       string;
  label:        string;
  unit:         string;
  baseline:     number | null;
  current:      number | null;
  target:       number;
  progress_pct: number | null;
  week:         number;
  total_weeks:  number;
  days_left:    number;
  status:       string;
  start_date:   string;
  end_date:     string;
  headline:     string | null;
  overview:     string | null;
  weeks:        GoalPlanWeek[];
  this_week:    GoalPlanWeek | null;
  pace?:        GoalPace | null;
}

export interface LeagueStanding {
  user_id: string;
  name:    string;
  score:   number;   // weekly engagement points
  rank:    number;
  is_me:   boolean;
  /** @deprecated Always null — gamification layer removed. */
  level?:  number | null;
  points_by_cat?: Record<string, number>;   // points per category key (grid)
}

/** Tiered points payload for categories whose math isn't a simple per × count.
 *  Two shapes today:
 *    - workouts: `{ extra_per, max_per_day }` — first/day = `per`, each
 *      additional workout (up to `max_per_day`) = `extra_per`.
 *    - goal_pace: `{ behind_pts }` — `per` is the on-pace bonus; users
 *      behind pace get `behind_pts` instead. Both are optional so future
 *      categories can opt into either pattern.
 */
export interface LeagueCategoryTier {
  extra_per?:   number;
  max_per_day?: number;
  behind_pts?:  number;
}

export interface LeagueCategory {
  key:      string;   // checkin | workout | meal | weighin | steps
  label:    string;   // "Daily check-in"
  icon:     string;   // emoji (used as the grid column header)
  per:      number;   // points earned per unit
  per_unit: string;   // "day" | "first/day" | "1k steps"
  tier?:    LeagueCategoryTier; // when set, the rule is tiered (see above)
}

export interface LeagueBreakdownItem {
  key:      string;   // checkin | workout | meal | weighin | steps
  label:    string;   // "Daily check-in"
  icon:     string;   // emoji
  per:      number;   // points earned per unit
  per_unit: string;   // "day" | "first/day" | "1k steps"
  count:    number;   // how many units you've done this week
  points:   number;   // count * per (or the tiered total for workouts)
  tier?:    LeagueCategoryTier;
}

export interface LeagueBreakdown {
  items: LeagueBreakdownItem[];
  total: number;       // sums to your league score
}

export interface LeagueResponse {
  league: {
    tier:       number;
    tier_name:  string;   // Bronze / Silver / …
    week_start: string;
    week_end:   string;
  } | null;
  standings:    LeagueStanding[];
  me_rank:      number | null;
  days_left:    number | null;
  member_count: number;
  my_breakdown?: LeagueBreakdown | null;   // current user's per-category points
  categories?:   LeagueCategory[];         // column defs for the per-task grid
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  /** user_id of the per-metric leader, or null if no one has a value yet. */
  leaders: { steps: string | null; sleep: string | null; activity: string | null };
  date:    string;
}

// ── Friend detail (peer profile) ────────────────────────────────────────────

export interface SparkPoint { date: string; value: number | null; }

// Shared per-user snapshot shape, used for BOTH the friend and the viewer in
// the friend detail / comparison view.
export interface FriendHealthSnapshot {
  series: {
    steps: SparkPoint[];
    sleep: SparkPoint[];
    hrv:   SparkPoint[];
    rhr:   SparkPoint[];
  };
  longevity: {
    score: number | null;
    grade: string | null;
    date:  string | null;
  };
  recent_workouts: Workout[];
  latest_weight: {
    date:            string;
    weight_lbs:      number | null;
    body_fat_pct?:   number | null;
    muscle_mass_lbs?: number | null;
  } | null;
  // Supplement stack shared between friends. Empty array if the user hasn't
  // logged any supplements in their Nutrition tab.
  supplements?: Array<{
    name:    string;
    dose?:   string | null;
    timing?: string | null;
  }>;
}

export interface FriendProfile extends FriendHealthSnapshot {
  user_id: string;
  name:    string;
  /** @deprecated Always null — gamification layer removed. */
  level:   number | null;
  // The viewer's own snapshot — drives the side-by-side comparison view.
  // Optional for backwards compat with older backend deploys.
  you?: FriendHealthSnapshot & { name: string; level: number | null };
}

// ── Notification types ──────────────────────────────────────────────────────
export interface Notification {
  id:         string;
  kind:       string;   // 'dm' | 'taunt:cheer' | 'taunt:catch_me' | … | 'comment' | 'reaction'
  actor_id:   string;
  actor_name: string;
  preview:    string;   // first message excerpt, emoji, etc.
  event_id?:  string;   // for comment/reaction kinds
  created_at: string;
  unread:     boolean;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count:  number;
}

// ── DM types ────────────────────────────────────────────────────────────────
export interface DirectMessage {
  id:            string;
  sender_id:     string;
  recipient_id:  string;
  text:          string;
  created_at:    string;
  user_name?:    string;
  is_me:         boolean;
}

// ── Friends types ─────────────────────────────────────────────────────────────
export interface FriendInvite {
  code:         string;
  inviter_name: string;
  expires_at:   string;
}

export interface Friend {
  user_id: string;
  name:    string;
  since:   string | null;
}

export interface ReactionSummary {
  emoji:      string;
  count:      number;
  i_reacted:  boolean;
}

export interface FriendActivityEvent {
  id:             string;
  user_id:        string;
  user_name:      string | null;
  event_type:     string;
  payload:        Record<string, unknown>;
  created_at:     string;
  is_me:          boolean;
  summary:        string;
  reactions:      ReactionSummary[];
  comment_count:  number;
}

export interface EventComment {
  id:         string;
  event_id:   string;
  user_id:    string;
  user_name:  string | null;
  text:       string;
  created_at: string;
  is_me:      boolean;
}

// ── Insight types ─────────────────────────────────────────────────────────────
export interface Insight {
  id:             string;
  title:          string;
  finding:        string;
  detail:         string;
  direction:      "positive" | "negative" | "neutral";
  magnitude:      number;
  unit:           string;
  n:              number;
  r:              number;
  group_a_label:  string;
  group_b_label:  string;
  group_a_avg:    number;
  group_b_avg:    number;
}

// ── Progress types ────────────────────────────────────────────────────────────
export interface ProgressItem {
  id:               string;
  title:            string;
  icon:             string;
  current_avg:      number | null;
  previous_avg:     number | null;
  current_on:       number | null;
  previous_on:      number | null;
  period_days:          number;   // days with actual ring data in window
  previous_period_days: number;
  window_days:          number;   // calendar window size (always 30)
  target:           number | null;
  target_label:     string | null;
  unit:             string;
  delta_avg:        number | null;
  delta_on:         number | null;
  direction:        "positive" | "negative" | "neutral";
  personal_best:    number | null;
  summary:          string;
}

export interface ProgressReport {
  items:        ProgressItem[];
  period_label: string;
  cur_start:    string;
  cur_end:      string;
  prev_start:   string;
  prev_end:     string;
}

// ── Challenge types ───────────────────────────────────────────────────────────
export interface ChallengeMessage {
  id:           string;
  user_id:      string;
  display_name: string;
  text:         string;
  created_at:   string;
}

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

export interface AppleHealthDay {
  steps?:                   number;
  sleep_hours?:             number;
  active_calories?:         number;
  resting_hr?:              number;
  hrv?:                     number;
  weight_kg?:               number;
  vo2_max?:                 number;
  respiratory_rate?:        number;
  body_fat_percentage?:     number;
  lean_body_mass_kg?:       number;
  skeletal_muscle_mass_kg?: number;
  bmi?:                     number;
}

export interface AppleHealthSummary {
  has_data:                  boolean;
  as_of?:                    string;
  today?:                    AppleHealthDay;
  averages?:                 AppleHealthDay;
  latest_weight_kg?:         number;
  latest_body_fat_pct?:      number;
  latest_lean_mass_kg?:      number;
  latest_skeletal_muscle_kg?: number;
  latest_bmi?:               number;
  days_synced?:              number;
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
  archived?:     boolean;
  participants:  ChallengeParticipant[];
  type_info:     { label: string; unit: string; icon: string };
}
