-- Run in Supabase → SQL Editor

-- Meal log
create table if not exists public.nutrition_meals (
  id          text        primary key,
  user_id     text        not null,
  date        date        not null,
  name        text        not null,
  calories    integer     not null default 0,
  protein     numeric(6,1) not null default 0,
  carbs       numeric(6,1) not null default 0,
  fat         numeric(6,1) not null default 0,
  meal_type   text        not null default 'meal',
  logged_at   timestamptz default now()
);

create index if not exists idx_nutrition_meals_user_date
  on public.nutrition_meals(user_id, date desc);

-- Weight / body composition log
create table if not exists public.nutrition_weight (
  id                        text        primary key,
  user_id                   text        not null,
  date                      date        not null unique,
  weight_lbs                numeric(6,1) not null,
  body_fat_pct              numeric(5,2),
  fat_mass_lbs              numeric(6,1),
  lean_mass_lbs             numeric(6,1),
  muscle_mass_lbs           numeric(6,1),
  trunk_muscle_lbs          numeric(6,1),
  right_arm_muscle_lbs      numeric(6,1),
  left_arm_muscle_lbs       numeric(6,1),
  right_leg_muscle_lbs      numeric(6,1),
  left_leg_muscle_lbs       numeric(6,1),
  trunk_fat_lbs             numeric(6,1),
  right_arm_fat_lbs         numeric(6,1),
  left_arm_fat_lbs          numeric(6,1),
  right_leg_fat_lbs         numeric(6,1),
  left_leg_fat_lbs          numeric(6,1),
  total_body_water_lbs      numeric(6,1),
  intracellular_water_lbs   numeric(6,1),
  extracellular_water_lbs   numeric(6,1),
  ecw_ratio                 numeric(5,3),
  visceral_fat_level        numeric(5,1),
  bone_mineral_content_lbs  numeric(5,2),
  bmr_kcal                  integer,
  inbody_score              integer,
  logged_at                 timestamptz default now()
);

create index if not exists idx_nutrition_weight_user_date
  on public.nutrition_weight(user_id, date desc);

-- Nutrition settings (one row per user)
create table if not exists public.nutrition_settings (
  user_id                     text primary key,
  calorie_target              integer     default 2000,
  protein_g                   integer     default 150,
  carbs_g                     integer     default 200,
  fat_g                       integer     default 65,
  weight_goal_lbs             numeric(6,1),
  weight_goal_type            text        default 'maintain',
  eating_start                text        default '12:00',
  eating_end                  text        default '20:00',
  fasting_enabled             boolean     default false,
  units                       text        default 'lbs',
  include_active_cal_in_budget boolean    default true,
  updated_at                  timestamptz default now()
);

-- RLS
alter table public.nutrition_meals    enable row level security;
alter table public.nutrition_weight   enable row level security;
alter table public.nutrition_settings enable row level security;

create policy "Service role manages nutrition_meals"
  on public.nutrition_meals for all using (true) with check (true);

create policy "Service role manages nutrition_weight"
  on public.nutrition_weight for all using (true) with check (true);

create policy "Service role manages nutrition_settings"
  on public.nutrition_settings for all using (true) with check (true);
