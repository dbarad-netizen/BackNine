-- BackNine schema baseline — generated from production 2026-10-27.
-- Schema only (no rows). public schema only; auth.* is managed by Supabase.
-- Scope: BackNine tables. The production database also hosts unrelated
-- projects (acq_*, dd_*, dodgers_*, app_assets, app_secrets, workbook_sync);
-- those are deliberately NOT part of BackNine and are excluded here.
--
-- Every table is granted to service_role (Supabase stopped auto-granting new
-- tables on 2026-10-30). The browser never talks to Supabase; only the
-- FastAPI backend does, as service_role. RLS is enabled on every table and the
-- few policies that exist are preserved verbatim.

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ── Sequences ───────────────────────────────────────────────────────────
create sequence if not exists public.app_events_id_seq;
create sequence if not exists public.coffee_ledger_id_seq;

-- ── Functions ───────────────────────────────────────────────────────────
create or replace function public.handle_updated_at()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$ begin new.updated_at = now(); return new; end; $function$;

create or replace function public.set_updated_at()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.activity_events (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  user_name text,
  event_type text not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.app_events (
  id bigint default nextval('app_events_id_seq'::regclass) not null,
  user_id text not null,
  event text not null,
  meta jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.apple_health_daily (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  steps integer,
  sleep_hours numeric(5,2),
  active_calories integer,
  resting_hr integer,
  hrv numeric(6,2),
  weight_kg numeric(6,2),
  vo2_max numeric(5,2),
  respiratory_rate numeric(5,2),
  updated_at timestamp with time zone default now(),
  body_fat_percentage numeric(5,2),
  lean_body_mass_kg numeric(6,2),
  skeletal_muscle_mass_kg numeric(6,2),
  bmi numeric(5,2),
  sleep_deep_hours numeric(5,2),
  sleep_rem_hours numeric(5,2),
  sleep_core_hours numeric(5,2),
  sleep_awake_hours numeric(5,2),
  blood_pressure_systolic integer,
  blood_pressure_diastolic integer,
  spo2 numeric(5,2),
  visceral_fat_rating numeric(5,1),
  waist_circumference_cm numeric(6,2),
  sleep_start text
);

create table if not exists public.apple_health_keys (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  api_key text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.biological_age_history (
  user_id text not null,
  date date not null,
  biological_age numeric(5,2),
  delta_years numeric(4,1),
  n_markers integer,
  confidence text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.blood_pressure_log (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  time_of_day text default 'morning'::text,
  systolic integer not null,
  diastolic integer not null,
  pulse integer,
  notes text,
  source text default 'manual'::text,
  created_at timestamp with time zone default now() not null,
  external_id text
);

create table if not exists public.challenge_messages (
  id uuid default gen_random_uuid() not null,
  challenge_id text not null,
  user_id text not null,
  display_name text not null,
  text text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.challenge_participants (
  id uuid default gen_random_uuid() not null,
  challenge_id text,
  user_id text not null,
  display_name text not null,
  joined_at timestamp with time zone default now()
);

create table if not exists public.challenge_progress (
  id uuid default gen_random_uuid() not null,
  challenge_id text,
  user_id text not null,
  date date not null,
  value numeric not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.challenges (
  id text not null,
  name text not null,
  type text not null,
  metric text not null,
  target numeric not null,
  duration_days integer not null,
  start_date date not null,
  end_date date not null,
  created_at timestamp with time zone default now(),
  creator_id text not null,
  creator_name text not null,
  group_id uuid,
  visibility text default 'public'::text not null
);

create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.coach_observations (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  kind text not null,
  date date not null,
  message text not null,
  payload jsonb default '{}'::jsonb not null,
  read boolean default false not null,
  dismissed boolean default false not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.coffee_ledger (
  id bigint default nextval('coffee_ledger_id_seq'::regclass) not null,
  week_start date not null,
  loser_user_id text not null,
  winner_user_id text not null,
  loser_score integer,
  winner_score integer,
  settled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cpap_nightly_log (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  usage_hours numeric(4,2) not null,
  mask_seal_score smallint,
  events_per_hour numeric(5,2),
  total_score smallint,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.daily_briefings (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  narrative text not null,
  prediction_streak integer,
  prediction_accuracy integer,
  generated_at timestamp with time zone default now()
);

create table if not exists public.daily_checkins (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  mood text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.daily_insights (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  headline text,
  pattern text,
  action text,
  evidence text,
  confidence text,
  category text,
  feedback text,
  feedback_at timestamp with time zone,
  generated_at timestamp with time zone default now() not null
);

create table if not exists public.daily_metrics (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  provider text not null,
  date date not null,
  readiness smallint,
  sleep smallint,
  activity smallint,
  hrv numeric(6,2),
  rhr smallint,
  steps integer,
  total_hrs numeric(4,1),
  temp_dev numeric(4,2),
  deep_min smallint,
  rem_min smallint,
  efficiency smallint,
  active_cal integer,
  raw_json jsonb,
  fetched_at timestamp with time zone default now()
);

create table if not exists public.device_readings (
  user_id text not null,
  source text not null,
  metric text not null,
  date date not null,
  value numeric not null,
  unit text,
  metadata jsonb default '{}'::jsonb,
  recorded_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dm_messages (
  id uuid default gen_random_uuid() not null,
  sender_id text not null,
  recipient_id text not null,
  text text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.doctor_visits (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  visit_date date not null,
  provider_type text default 'primary_care'::text not null,
  reason text,
  status text default 'upcoming'::text not null,
  question_drafts jsonb default '[]'::jsonb not null,
  post_visit_notes text,
  outcome_summary text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  canceled_at timestamp with time zone
);

create table if not exists public.event_comments (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  user_id text not null,
  user_name text,
  text text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.event_reactions (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  user_id text not null,
  emoji text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.experiments (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  created_at timestamp with time zone default now() not null,
  insight_id uuid,
  hypothesis text not null,
  action text not null,
  metric_type text not null,
  baseline_start_date date not null,
  baseline_end_date date not null,
  test_start_date date not null,
  test_end_date date not null,
  baseline_avg numeric,
  baseline_stddev numeric,
  baseline_n integer,
  test_avg numeric,
  test_n integer,
  delta numeric,
  direction text,
  significance text,
  status text default 'active'::text not null,
  completed_at timestamp with time zone,
  user_note text
);

create table if not exists public.food_plan_days (
  user_id text not null,
  date date not null,
  veg_lunch boolean,
  veg_dinner boolean,
  note text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.friend_invites (
  code text not null,
  inviter_id text not null,
  inviter_name text not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone not null,
  used_by text,
  used_at timestamp with time zone,
  relationship_type text
);

create table if not exists public.friendships (
  user_id_a text not null,
  user_id_b text not null,
  user_a_name text,
  user_b_name text,
  created_at timestamp with time zone default now(),
  initiated_by text not null,
  deleted_at timestamp with time zone,
  relationship_type text
);

create table if not exists public.gear_reviews (
  id uuid default gen_random_uuid() not null,
  gear_item_id text not null,
  user_id text not null,
  rating integer,
  text text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.gear_searches (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  query text not null,
  had_match boolean default false,
  pick_ids text[] default '{}'::text[],
  suggestion_titles text[] default '{}'::text[],
  created_at timestamp with time zone default now()
);

create table if not exists public.group_members (
  group_id uuid not null,
  user_id text not null,
  joined_at timestamp with time zone default now() not null
);

create table if not exists public.group_messages (
  id uuid default gen_random_uuid() not null,
  group_id uuid not null,
  user_id text not null,
  text text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.groups (
  id uuid default gen_random_uuid() not null,
  name text not null,
  join_code text not null,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  weekly_goal integer
);

create table if not exists public.hydration_log (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  volume_oz numeric not null,
  source text,
  notes text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.journal_entries (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  text text not null,
  tags text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.lab_entries (
  id text not null,
  user_id text not null,
  date date not null,
  logged_at timestamp with time zone default now(),
  notes text default ''::text,
  "values" jsonb default '{}'::jsonb not null
);

create table if not exists public.lab_results (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  test_name text not null,
  value numeric,
  unit text,
  ref_low numeric,
  ref_high numeric,
  tested_on date not null,
  source text default 'manual'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.league_members (
  id uuid default gen_random_uuid() not null,
  league_id uuid not null,
  user_id text not null,
  joined_at timestamp with time zone default now(),
  weekly_score integer default 0,
  final_rank smallint,
  created_at timestamp with time zone default now()
);

create table if not exists public.leagues (
  id uuid default gen_random_uuid() not null,
  tier smallint default 1 not null,
  week_start date not null,
  week_end date not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.linked_identities (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  provider text not null,
  provider_sub text not null,
  email text,
  provider_name text,
  linked_at timestamp with time zone default now() not null
);

create table if not exists public.longevity_history (
  user_id text not null,
  date date not null,
  score integer,
  grade text,
  biological_age_delta integer,
  components jsonb,
  computed_at timestamp with time zone default now() not null
);

create table if not exists public.nudges (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  kind text not null,
  title text not null,
  body text not null,
  action_label text,
  action_target text,
  priority integer default 100 not null,
  dismissed_at timestamp with time zone,
  acted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.nutrition_meals (
  id text not null,
  user_id text not null,
  date date not null,
  name text not null,
  calories integer default 0 not null,
  protein numeric(6,1) default 0 not null,
  carbs numeric(6,1) default 0 not null,
  fat numeric(6,1) default 0 not null,
  meal_type text default 'meal'::text not null,
  logged_at timestamp with time zone default now()
);

create table if not exists public.nutrition_settings (
  user_id text not null,
  calorie_target integer default 2000,
  protein_g integer default 150,
  carbs_g integer default 200,
  fat_g integer default 65,
  weight_goal_lbs numeric(6,1),
  weight_goal_type text default 'maintain'::text,
  eating_start text default '12:00'::text,
  eating_end text default '20:00'::text,
  fasting_enabled boolean default false,
  units text default 'lbs'::text,
  include_active_cal_in_budget boolean default true,
  updated_at timestamp with time zone default now()
);

create table if not exists public.nutrition_vices (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  vice_type text not null,
  amount text,
  notes text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.nutrition_weight (
  id text not null,
  user_id text not null,
  date date not null,
  weight_lbs numeric(6,1) not null,
  body_fat_pct numeric(5,2),
  fat_mass_lbs numeric(6,1),
  lean_mass_lbs numeric(6,1),
  muscle_mass_lbs numeric(6,1),
  trunk_muscle_lbs numeric(6,1),
  right_arm_muscle_lbs numeric(6,1),
  left_arm_muscle_lbs numeric(6,1),
  right_leg_muscle_lbs numeric(6,1),
  left_leg_muscle_lbs numeric(6,1),
  trunk_fat_lbs numeric(6,1),
  right_arm_fat_lbs numeric(6,1),
  left_arm_fat_lbs numeric(6,1),
  right_leg_fat_lbs numeric(6,1),
  left_leg_fat_lbs numeric(6,1),
  total_body_water_lbs numeric(6,1),
  intracellular_water_lbs numeric(6,1),
  extracellular_water_lbs numeric(6,1),
  ecw_ratio numeric(5,3),
  visceral_fat_level numeric(5,1),
  bone_mineral_content_lbs numeric(5,2),
  bmr_kcal integer,
  inbody_score integer,
  logged_at timestamp with time zone default now()
);

create table if not exists public.oura_connections (
  oura_user_id text not null,
  user_id text not null,
  access_token text,
  refresh_token text,
  expires_at bigint,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.oura_daily_cache (
  user_id text not null,
  date date not null,
  readiness jsonb,
  sleep_score jsonb,
  activity jsonb,
  sleep_model jsonb,
  fetched_at timestamp with time zone default now() not null
);

create table if not exists public.oura_tags (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  external_id text not null,
  tag_type_code text not null,
  comment text,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  start_day date not null,
  end_day date,
  fetched_at timestamp with time zone default now() not null
);

create table if not exists public.profiles (
  id uuid not null,
  email text,
  display_name text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  onboarding_dismissed_at timestamp with time zone,
  deletion_requested_at timestamp with time zone,
  deleted_at timestamp with time zone,
  oura_paused_at timestamp with time zone,
  training_level text,
  chronic_injuries jsonb default '[]'::jsonb not null
);

create table if not exists public.push_tokens (
  token text not null,
  user_id text not null,
  platform text default 'ios'::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.readiness_predictions (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  target_date date not null,
  predicted_score integer not null,
  actual_score integer,
  created_at timestamp with time zone default now()
);

create table if not exists public.referral_codes (
  user_id text not null,
  code text not null,
  name text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.referral_credits (
  id uuid default gen_random_uuid() not null,
  referrer_id text not null,
  referee_id text not null,
  month_credits integer default 1 not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  applied_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '365 days'::interval) not null
);

create table if not exists public.report_shares (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  report_type text not null,
  params_json jsonb default '{}'::jsonb not null,
  token text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  last_viewed_at timestamp with time zone,
  view_count integer default 0 not null,
  revoked_at timestamp with time zone
);

create table if not exists public.stack_adherence_log (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  item_kind text not null,
  item_key text not null,
  item_name text not null,
  taken boolean not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  time_of_day text default 'anytime'::text not null
);

create table if not exists public.stack_events (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  class text not null,
  item_name text not null,
  display_name text,
  event_type text not null,
  dose text,
  timing text,
  notes text,
  event_date date not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.symptom_logs (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  symptoms text[] default '{}'::text[] not null,
  severity text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.today_workout (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  session_name text,
  session_type text,
  intensity text,
  duration_min integer,
  exercises jsonb default '[]'::jsonb not null,
  rationale text,
  source text,
  status text default 'pending'::text not null,
  status_at timestamp with time zone,
  feedback text,
  generated_at timestamp with time zone default now() not null
);

create table if not exists public.training_flags (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  date date not null,
  flag_type text not null,
  body_area text,
  severity smallint,
  notes text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.training_templates (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  name text not null,
  type text default 'lifting'::text not null,
  exercises jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.training_workouts (
  id text not null,
  user_id text not null,
  date date not null,
  type text not null,
  exercises jsonb default '[]'::jsonb not null,
  muscle_groups jsonb default '[]'::jsonb not null,
  duration_min integer,
  notes text,
  total_volume_lbs integer,
  logged_at timestamp with time zone default now(),
  kind text default 'strength'::text not null,
  source text,
  external_id text,
  activity text,
  distance_meters numeric,
  avg_hr integer,
  calories_kcal integer
);

create table if not exists public.user_badges (
  user_id text not null,
  badge_id text not null,
  earned_at timestamp with time zone default now() not null
);

create table if not exists public.user_goals (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  metric text not null,
  baseline numeric,
  target numeric not null,
  start_date date not null,
  end_date date not null,
  duration_weeks integer not null,
  plan jsonb,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.user_memory (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  category text not null,
  content text not null,
  source text default 'user'::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.user_profiles (
  user_id text not null,
  age integer,
  biological_sex text,
  health_goals text[] default '{}'::text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  name text,
  height_cm numeric(5,1),
  vo2_max numeric(5,1),
  notifications_last_read_at timestamp with time zone,
  onboarded_at timestamp with time zone,
  dismissed_gear jsonb default '[]'::jsonb not null,
  birthdate date,
  archived_challenges text[] default '{}'::text[],
  supplements jsonb default '[]'::jsonb not null,
  peptides jsonb default '[]'::jsonb not null,
  medications jsonb default '[]'::jsonb not null,
  labs jsonb default '[]'::jsonb not null,
  sleep_target_hours numeric(4,2),
  training_level text,
  chronic_injuries jsonb default '[]'::jsonb not null,
  enabled_capabilities text[] default '{}'::text[] not null,
  family_history jsonb,
  coach_voice text,
  baseline_reset_date date,
  baseline_reset_reason text,
  league_hold_until date,
  food_plan jsonb
);

create table if not exists public.user_training_settings (
  user_id text not null,
  settings jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.wearable_connections (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at bigint,
  scopes text,
  connected_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  oura_user_id text
);

create table if not exists public.weekly_healthspan_history (
  user_id text not null,
  date date not null,
  score smallint,
  grade text,
  bands_present smallint,
  created_at timestamp with time zone default now() not null,
  components jsonb
);

create table if not exists public.weekly_insights (
  user_id text not null,
  week_start date not null,
  insight_id text,
  headline text not null,
  narrative text not null,
  experiment text,
  source jsonb,
  generated_at timestamp with time zone default now() not null
);

-- ── Constraints ─────────────────────────────────────────────────────────
alter table public.activity_events add constraint activity_events_pkey PRIMARY KEY (id);
alter table public.app_events add constraint app_events_pkey PRIMARY KEY (id);
alter table public.apple_health_daily add constraint apple_health_daily_pkey PRIMARY KEY (id);
alter table public.apple_health_daily add constraint apple_health_daily_user_id_date_key UNIQUE (user_id, date);
alter table public.apple_health_keys add constraint apple_health_keys_api_key_key UNIQUE (api_key);
alter table public.apple_health_keys add constraint apple_health_keys_pkey PRIMARY KEY (id);
alter table public.apple_health_keys add constraint apple_health_keys_user_id_key UNIQUE (user_id);
alter table public.biological_age_history add constraint biological_age_history_pkey PRIMARY KEY (user_id, date);
alter table public.blood_pressure_log add constraint blood_pressure_log_diastolic_check CHECK (((diastolic >= 30) AND (diastolic <= 200)));
alter table public.blood_pressure_log add constraint blood_pressure_log_notes_check CHECK ((length(notes) <= 500));
alter table public.blood_pressure_log add constraint blood_pressure_log_pkey PRIMARY KEY (id);
alter table public.blood_pressure_log add constraint blood_pressure_log_pulse_check CHECK (((pulse >= 25) AND (pulse <= 250)));
alter table public.blood_pressure_log add constraint blood_pressure_log_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'apple_health'::text, 'withings'::text])));
alter table public.blood_pressure_log add constraint blood_pressure_log_systolic_check CHECK (((systolic >= 50) AND (systolic <= 300)));
alter table public.blood_pressure_log add constraint blood_pressure_log_time_of_day_check CHECK ((time_of_day = ANY (ARRAY['morning'::text, 'midday'::text, 'evening'::text, 'other'::text])));
alter table public.challenge_messages add constraint challenge_messages_pkey PRIMARY KEY (id);
alter table public.challenge_messages add constraint challenge_messages_text_check CHECK ((char_length(text) <= 500));
alter table public.challenges add constraint challenges_pkey PRIMARY KEY (id);
alter table public.challenge_participants add constraint challenge_participants_pkey PRIMARY KEY (id);
alter table public.challenge_participants add constraint challenge_participants_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE;
alter table public.challenge_participants add constraint challenge_participants_challenge_id_user_id_key UNIQUE (challenge_id, user_id);
alter table public.challenge_progress add constraint challenge_progress_pkey PRIMARY KEY (id);
alter table public.challenge_progress add constraint challenge_progress_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE;
alter table public.challenge_progress add constraint challenge_progress_challenge_id_user_id_date_key UNIQUE (challenge_id, user_id, date);
alter table public.chat_messages add constraint chat_messages_pkey PRIMARY KEY (id);
alter table public.chat_messages add constraint chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public.coach_observations add constraint coach_observations_pkey PRIMARY KEY (id);
alter table public.coach_observations add constraint coach_observations_user_id_kind_date_key UNIQUE (user_id, kind, date);
alter table public.coffee_ledger add constraint coffee_ledger_pkey PRIMARY KEY (id);
alter table public.coffee_ledger add constraint coffee_ledger_week_start_key UNIQUE (week_start);
alter table public.cpap_nightly_log add constraint cpap_nightly_log_events_per_hour_check CHECK (((events_per_hour IS NULL) OR ((events_per_hour >= (0)::numeric) AND (events_per_hour <= (100)::numeric))));
alter table public.cpap_nightly_log add constraint cpap_nightly_log_mask_seal_score_check CHECK (((mask_seal_score IS NULL) OR ((mask_seal_score >= 0) AND (mask_seal_score <= 20))));
alter table public.cpap_nightly_log add constraint cpap_nightly_log_pkey PRIMARY KEY (id);
alter table public.cpap_nightly_log add constraint cpap_nightly_log_total_score_check CHECK (((total_score IS NULL) OR ((total_score >= 0) AND (total_score <= 100))));
alter table public.cpap_nightly_log add constraint cpap_nightly_log_usage_hours_check CHECK (((usage_hours >= (0)::numeric) AND (usage_hours <= (24)::numeric)));
alter table public.cpap_nightly_log add constraint cpap_nightly_log_user_id_date_key UNIQUE (user_id, date);
alter table public.daily_briefings add constraint daily_briefings_pkey PRIMARY KEY (id);
alter table public.daily_briefings add constraint daily_briefings_user_id_date_key UNIQUE (user_id, date);
alter table public.daily_checkins add constraint daily_checkins_mood_check CHECK ((mood = ANY (ARRAY['great'::text, 'good'::text, 'okay'::text, 'tired'::text, 'off'::text])));
alter table public.daily_checkins add constraint daily_checkins_pkey PRIMARY KEY (id);
alter table public.daily_checkins add constraint daily_checkins_user_id_date_key UNIQUE (user_id, date);
alter table public.daily_insights add constraint daily_insights_pkey PRIMARY KEY (id);
alter table public.daily_insights add constraint daily_insights_user_id_date_key UNIQUE (user_id, date);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.daily_metrics add constraint daily_metrics_pkey PRIMARY KEY (id);
alter table public.daily_metrics add constraint daily_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.daily_metrics add constraint daily_metrics_user_id_provider_date_key UNIQUE (user_id, provider, date);
alter table public.device_readings add constraint device_readings_pkey PRIMARY KEY (user_id, source, metric, date);
alter table public.dm_messages add constraint dm_messages_check CHECK ((sender_id <> recipient_id));
alter table public.dm_messages add constraint dm_messages_pkey PRIMARY KEY (id);
alter table public.dm_messages add constraint dm_messages_text_check CHECK ((char_length(text) <= 2000));
alter table public.doctor_visits add constraint doctor_visits_pkey PRIMARY KEY (id);
alter table public.event_comments add constraint event_comments_pkey PRIMARY KEY (id);
alter table public.event_comments add constraint event_comments_event_id_fkey FOREIGN KEY (event_id) REFERENCES activity_events(id) ON DELETE CASCADE;
alter table public.event_comments add constraint event_comments_text_check CHECK ((char_length(text) <= 500));
alter table public.event_reactions add constraint event_reactions_pkey PRIMARY KEY (id);
alter table public.event_reactions add constraint event_reactions_event_id_fkey FOREIGN KEY (event_id) REFERENCES activity_events(id) ON DELETE CASCADE;
alter table public.event_reactions add constraint event_reactions_event_id_user_id_emoji_key UNIQUE (event_id, user_id, emoji);
alter table public.experiments add constraint experiments_pkey PRIMARY KEY (id);
alter table public.experiments add constraint experiments_check CHECK ((baseline_end_date < test_start_date));
alter table public.experiments add constraint experiments_check1 CHECK ((test_end_date >= test_start_date));
alter table public.experiments add constraint experiments_direction_check CHECK (((direction IS NULL) OR (direction = ANY (ARRAY['better'::text, 'worse'::text, 'no_change'::text]))));
alter table public.experiments add constraint experiments_metric_type_check CHECK ((metric_type = ANY (ARRAY['sleep_score'::text, 'sleep_hours'::text, 'hrv_ms'::text, 'rhr_bpm'::text, 'weight_lb'::text, 'bp_systolic'::text, 'bp_diastolic'::text, 'steps'::text, 'energy_score'::text, 'mood_score'::text, 'readiness_score'::text, 'activity_score'::text, 'protein_g'::text, 'calories'::text])));
alter table public.experiments add constraint experiments_significance_check CHECK (((significance IS NULL) OR (significance = ANY (ARRAY['noise'::text, 'notable'::text, 'meaningful'::text]))));
alter table public.experiments add constraint experiments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text, 'insufficient_data'::text])));
alter table public.food_plan_days add constraint food_plan_days_pkey PRIMARY KEY (user_id, date);
alter table public.friend_invites add constraint friend_invites_pkey PRIMARY KEY (code);
alter table public.friendships add constraint friendships_check CHECK ((user_id_a < user_id_b));
alter table public.friendships add constraint friendships_pkey PRIMARY KEY (user_id_a, user_id_b);
alter table public.gear_reviews add constraint gear_reviews_gear_item_id_user_id_key UNIQUE (gear_item_id, user_id);
alter table public.gear_reviews add constraint gear_reviews_pkey PRIMARY KEY (id);
alter table public.gear_searches add constraint gear_searches_pkey PRIMARY KEY (id);
alter table public.groups add constraint groups_join_code_key UNIQUE (join_code);
alter table public.groups add constraint groups_pkey PRIMARY KEY (id);
alter table public.group_members add constraint group_members_pkey PRIMARY KEY (group_id, user_id);
alter table public.group_members add constraint group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
alter table public.group_messages add constraint group_messages_pkey PRIMARY KEY (id);
alter table public.group_messages add constraint group_messages_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
alter table public.hydration_log add constraint hydration_log_pkey PRIMARY KEY (id);
alter table public.journal_entries add constraint journal_entries_pkey PRIMARY KEY (id);
alter table public.journal_entries add constraint journal_entries_user_id_date_key UNIQUE (user_id, date);
alter table public.lab_entries add constraint lab_entries_pkey PRIMARY KEY (id);
alter table public.lab_results add constraint lab_results_pkey PRIMARY KEY (id);
alter table public.lab_results add constraint lab_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.leagues add constraint leagues_pkey PRIMARY KEY (id);
alter table public.leagues add constraint leagues_tier_check CHECK (((tier >= 1) AND (tier <= 6)));
alter table public.leagues add constraint leagues_tier_week_start_key UNIQUE (tier, week_start);
alter table public.league_members add constraint league_members_pkey PRIMARY KEY (id);
alter table public.league_members add constraint league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
alter table public.league_members add constraint league_members_league_id_user_id_key UNIQUE (league_id, user_id);
alter table public.linked_identities add constraint linked_identities_pkey PRIMARY KEY (id);
alter table public.linked_identities add constraint linked_identities_provider_check CHECK ((provider = ANY (ARRAY['oura'::text, 'apple'::text, 'google'::text, 'email'::text, 'supabase'::text])));
alter table public.linked_identities add constraint linked_identities_provider_sub_unique UNIQUE (provider, provider_sub);
alter table public.longevity_history add constraint longevity_history_pkey PRIMARY KEY (user_id, date);
alter table public.nudges add constraint nudges_kind_check CHECK ((kind = ANY (ARRAY['bp_high'::text, 'hrv_drop'::text, 'sleep_debt'::text, 'adherence_dip'::text, 'training_gap'::text, 'alcohol_pattern'::text, 'weight_trend'::text, 'goal_stalled'::text])));
alter table public.nudges add constraint nudges_pkey PRIMARY KEY (id);
alter table public.nudges add constraint nudges_user_date_unique UNIQUE (user_id, date);
alter table public.nutrition_meals add constraint nutrition_meals_pkey PRIMARY KEY (id);
alter table public.nutrition_settings add constraint nutrition_settings_pkey PRIMARY KEY (user_id);
alter table public.nutrition_vices add constraint nutrition_vices_pkey PRIMARY KEY (id);
alter table public.nutrition_weight add constraint nutrition_weight_pkey PRIMARY KEY (id);
alter table public.nutrition_weight add constraint nutrition_weight_user_date_key UNIQUE (user_id, date);
alter table public.oura_connections add constraint oura_connections_pkey PRIMARY KEY (oura_user_id);
alter table public.oura_daily_cache add constraint oura_daily_cache_pkey PRIMARY KEY (user_id, date);
alter table public.oura_tags add constraint oura_tags_pkey PRIMARY KEY (id);
alter table public.oura_tags add constraint oura_tags_user_id_external_id_key UNIQUE (user_id, external_id);
alter table public.push_tokens add constraint push_tokens_pkey PRIMARY KEY (token);
alter table public.readiness_predictions add constraint readiness_predictions_pkey PRIMARY KEY (id);
alter table public.readiness_predictions add constraint readiness_predictions_user_id_target_date_key UNIQUE (user_id, target_date);
alter table public.referral_codes add constraint referral_codes_code_key UNIQUE (code);
alter table public.referral_codes add constraint referral_codes_pkey PRIMARY KEY (user_id);
alter table public.referral_credits add constraint referral_credits_pkey PRIMARY KEY (id);
alter table public.referral_credits add constraint referral_credits_referrer_id_referee_id_key UNIQUE (referrer_id, referee_id);
alter table public.report_shares add constraint report_shares_pkey PRIMARY KEY (id);
alter table public.report_shares add constraint report_shares_token_key UNIQUE (token);
alter table public.stack_adherence_log add constraint stack_adherence_log_pkey PRIMARY KEY (id);
alter table public.stack_adherence_log add constraint stack_adherence_log_time_of_day_check CHECK ((time_of_day = ANY (ARRAY['morning'::text, 'midday'::text, 'evening'::text, 'anytime'::text])));
alter table public.stack_adherence_log add constraint stack_adherence_log_uniq UNIQUE (user_id, date, item_kind, item_key, time_of_day);
alter table public.stack_events add constraint stack_events_pkey PRIMARY KEY (id);
alter table public.symptom_logs add constraint symptom_logs_pkey PRIMARY KEY (id);
alter table public.symptom_logs add constraint symptom_logs_user_id_date_key UNIQUE (user_id, date);
alter table public.today_workout add constraint today_workout_pkey PRIMARY KEY (id);
alter table public.today_workout add constraint today_workout_user_id_date_key UNIQUE (user_id, date);
alter table public.training_flags add constraint training_flags_pkey PRIMARY KEY (id);
alter table public.training_templates add constraint training_templates_pkey PRIMARY KEY (id);
alter table public.training_workouts add constraint training_workouts_kind_check CHECK ((kind = ANY (ARRAY['strength'::text, 'cardio'::text, 'session'::text])));
alter table public.training_workouts add constraint training_workouts_pkey PRIMARY KEY (id);
alter table public.user_badges add constraint user_badges_pkey PRIMARY KEY (user_id, badge_id);
alter table public.user_goals add constraint user_goals_pkey PRIMARY KEY (id);
alter table public.user_memory add constraint user_memory_pkey PRIMARY KEY (id);
alter table public.user_profiles add constraint user_profiles_biological_sex_check CHECK ((biological_sex = ANY (ARRAY['male'::text, 'female'::text])));
alter table public.user_profiles add constraint user_profiles_pkey PRIMARY KEY (user_id);
alter table public.user_training_settings add constraint user_training_settings_pkey PRIMARY KEY (user_id);
alter table public.wearable_connections add constraint wearable_connections_pkey PRIMARY KEY (id);
alter table public.wearable_connections add constraint wearable_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.wearable_connections add constraint wearable_connections_user_id_provider_key UNIQUE (user_id, provider);
alter table public.weekly_healthspan_history add constraint weekly_healthspan_history_pkey PRIMARY KEY (user_id, date);
alter table public.weekly_insights add constraint weekly_insights_pkey PRIMARY KEY (user_id, week_start);

-- ── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS activity_events_created_idx ON public.activity_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_user_created_idx ON public.activity_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_events_user_idx ON public.app_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS biological_age_history_user_date_idx ON public.biological_age_history USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS blood_pressure_log_user_date_idx ON public.blood_pressure_log USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS challenge_messages_challenge_id_created_at_idx ON public.challenge_messages USING btree (challenge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx ON public.chat_messages USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_observations_user_idx ON public.coach_observations USING btree (user_id, dismissed, read, created_at DESC);
CREATE INDEX IF NOT EXISTS cpap_nightly_log_user_date_idx ON public.cpap_nightly_log USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS daily_briefings_user_date_idx ON public.daily_briefings USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS daily_checkins_user_date_idx ON public.daily_checkins USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS daily_insights_user_idx ON public.daily_insights USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS daily_metrics_user_id_date_idx ON public.daily_metrics USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS dm_messages_pair_idx ON public.dm_messages USING btree (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS dm_messages_reverse_idx ON public.dm_messages USING btree (recipient_id, sender_id, created_at);
CREATE INDEX IF NOT EXISTS event_comments_event_idx ON public.event_comments USING btree (event_id, created_at);
CREATE INDEX IF NOT EXISTS event_reactions_event_idx ON public.event_reactions USING btree (event_id);
CREATE INDEX IF NOT EXISTS experiments_finalize_due_idx ON public.experiments USING btree (test_end_date) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS experiments_user_status_idx ON public.experiments USING btree (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS friend_invites_inviter_idx ON public.friend_invites USING btree (inviter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS friendships_active_idx ON public.friendships USING btree (user_id_a, user_id_b) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS friendships_user_a_idx ON public.friendships USING btree (user_id_a);
CREATE INDEX IF NOT EXISTS friendships_user_b_idx ON public.friendships USING btree (user_id_b);
CREATE INDEX IF NOT EXISTS gear_reviews_item_idx ON public.gear_reviews USING btree (gear_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gear_searches_created_idx ON public.gear_searches USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON public.group_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON public.group_messages USING btree (group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ah_daily_user_date ON public.apple_health_daily USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_challenges_group_id ON public.challenges USING btree (group_id) WHERE (group_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_device_readings_source_metric ON public.device_readings USING btree (source, metric);
CREATE INDEX IF NOT EXISTS idx_device_readings_user_date ON public.device_readings USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_device_readings_user_metric_date ON public.device_readings USING btree (user_id, metric, date DESC);
CREATE INDEX IF NOT EXISTS idx_doctor_visits_user_date ON public.doctor_visits USING btree (user_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_hydration_log_user_date ON public.hydration_log USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date ON public.journal_entries USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_longevity_history_user_date ON public.longevity_history USING btree (user_id, date);
CREATE INDEX IF NOT EXISTS idx_nutrition_meals_user_date ON public.nutrition_meals USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_vices_user_date ON public.nutrition_vices USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_weight_user_date ON public.nutrition_weight USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_oura_cache_fetched ON public.oura_daily_cache USING btree (user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_oura_cache_user_date ON public.oura_daily_cache USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_oura_connections_user ON public.oura_connections USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_oura_tags_user_day ON public.oura_tags USING btree (user_id, start_day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_tags_user_type ON public.oura_tags USING btree (user_id, tag_type_code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes USING btree (code);
CREATE INDEX IF NOT EXISTS idx_stack_adherence_user_date ON public.stack_adherence_log USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_training_flags_user_date ON public.training_flags USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_user_memory_user_active ON public.user_memory USING btree (user_id, active);
CREATE INDEX IF NOT EXISTS idx_user_memory_user_category ON public.user_memory USING btree (user_id, category);
CREATE INDEX IF NOT EXISTS idx_weekly_insights_user_week ON public.weekly_insights USING btree (user_id, week_start);
CREATE INDEX IF NOT EXISTS lab_entries_user_id_date_idx ON public.lab_entries USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS lab_results_user_id_test_name_tested_on_idx ON public.lab_results USING btree (user_id, test_name, tested_on DESC);
CREATE INDEX IF NOT EXISTS league_members_league_idx ON public.league_members USING btree (league_id);
CREATE INDEX IF NOT EXISTS league_members_user_idx ON public.league_members USING btree (user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS leagues_week_idx ON public.leagues USING btree (week_start);
CREATE INDEX IF NOT EXISTS linked_identities_lookup_idx ON public.linked_identities USING btree (provider, provider_sub);
CREATE INDEX IF NOT EXISTS linked_identities_user_idx ON public.linked_identities USING btree (user_id);
CREATE INDEX IF NOT EXISTS nudges_user_date_idx ON public.nudges USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens USING btree (user_id);
CREATE INDEX IF NOT EXISTS readiness_predictions_user_id_target_date_idx ON public.readiness_predictions USING btree (user_id, target_date DESC);
CREATE INDEX IF NOT EXISTS referral_credits_referrer_idx ON public.referral_credits USING btree (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_shares_token_idx ON public.report_shares USING btree (token) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS report_shares_user_idx ON public.report_shares USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stack_events_user_idx ON public.stack_events USING btree (user_id, event_date DESC);
CREATE INDEX IF NOT EXISTS stack_events_user_item_idx ON public.stack_events USING btree (user_id, class, item_name);
CREATE INDEX IF NOT EXISTS symptom_logs_symptoms_gin ON public.symptom_logs USING gin (symptoms);
CREATE INDEX IF NOT EXISTS symptom_logs_user_date_idx ON public.symptom_logs USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS today_workout_user_idx ON public.today_workout USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS training_templates_user_idx ON public.training_templates USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS training_workouts_user_date_idx ON public.training_workouts USING btree (user_id, date DESC);
CREATE INDEX IF NOT EXISTS user_badges_user_idx ON public.user_badges USING btree (user_id);
CREATE INDEX IF NOT EXISTS user_goals_user_status_idx ON public.user_goals USING btree (user_id, status);
CREATE INDEX IF NOT EXISTS user_profiles_enabled_capabilities_idx ON public.user_profiles USING gin (enabled_capabilities);
CREATE INDEX IF NOT EXISTS wearable_connections_oura_user_id_idx ON public.wearable_connections USING btree (oura_user_id, provider);
CREATE INDEX IF NOT EXISTS weekly_healthspan_history_user_date_idx ON public.weekly_healthspan_history USING btree (user_id, date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS blood_pressure_log_external_uniq ON public.blood_pressure_log USING btree (user_id, source, external_id) WHERE (external_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS training_workouts_external_unique ON public.training_workouts USING btree (user_id, source, external_id) WHERE ((source IS NOT NULL) AND (external_id IS NOT NULL));

-- ── Triggers ────────────────────────────────────────────────────────────
create trigger profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
create trigger wearable_connections_updated_at BEFORE UPDATE ON public.wearable_connections FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
create trigger trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row level security (every BackNine table) ───────────────────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname='public'
      and tablename not like 'acq\_%' and tablename not like 'dd\_%' and tablename not like 'dodgers\_%'
      and tablename not in ('app_assets','app_secrets','workbook_sync')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- ── Policies (preserved verbatim from production) ───────────────────────
create policy "users manage own bp" on public.blood_pressure_log as permissive for ALL to public using (((auth.uid())::text = user_id)) with check (((auth.uid())::text = user_id));
create policy "Service role can write metrics" on public.daily_metrics as permissive for ALL to public using ((auth.role() = 'service_role'::text));
create policy "Users can read their own metrics" on public.daily_metrics as permissive for SELECT to public using ((auth.uid() = user_id));
create policy doctor_visits_own_delete on public.doctor_visits as permissive for DELETE to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy doctor_visits_own_read on public.doctor_visits as permissive for SELECT to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy doctor_visits_own_update on public.doctor_visits as permissive for UPDATE to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text)) with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy doctor_visits_own_write on public.doctor_visits as permissive for INSERT to authenticated with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy experiments_user_read on public.experiments as permissive for SELECT to public using (((auth.jwt() ->> 'sub'::text) = user_id));
create policy experiments_user_update on public.experiments as permissive for UPDATE to public using (((auth.jwt() ->> 'sub'::text) = user_id));
create policy experiments_user_write on public.experiments as permissive for INSERT to public with check (((auth.jwt() ->> 'sub'::text) = user_id));
create policy hydration_log_own on public.hydration_log as permissive for ALL to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text)) with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy "Service role can manage lab entries" on public.lab_entries as permissive for ALL to public using ((auth.role() = 'service_role'::text));
create policy "Users can manage their own lab results" on public.lab_results as permissive for ALL to public using ((auth.uid() = user_id));
create policy linked_identities_user_read on public.linked_identities as permissive for SELECT to public using (((auth.jwt() ->> 'sub'::text) = user_id));
create policy nudges_user_read on public.nudges as permissive for SELECT to public using (((auth.jwt() ->> 'sub'::text) = user_id));
create policy nudges_user_update on public.nudges as permissive for UPDATE to public using (((auth.jwt() ->> 'sub'::text) = user_id));
create policy nutrition_vices_own on public.nutrition_vices as permissive for ALL to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text)) with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy "Users can update their own profile" on public.profiles as permissive for UPDATE to public using ((auth.uid() = id));
create policy "Users can view their own profile" on public.profiles as permissive for SELECT to public using ((auth.uid() = id));
create policy stack_adherence_own on public.stack_adherence_log as permissive for ALL to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text)) with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy training_flags_own on public.training_flags as permissive for ALL to authenticated using ((user_id = (( SELECT auth.uid() AS uid))::text)) with check ((user_id = (( SELECT auth.uid() AS uid))::text));
create policy "Service role can manage wearable connections" on public.wearable_connections as permissive for ALL to public using ((auth.role() = 'service_role'::text));
