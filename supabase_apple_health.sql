-- Run this in your Supabase project → SQL Editor
-- Creates tables for Apple Health data synced via iOS Shortcuts

-- Per-user API keys (used by iOS Shortcut for auth)
create table if not exists public.apple_health_keys (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null unique,
  api_key     text        not null unique,
  created_at  timestamptz default now()
);

-- Daily Apple Health metrics (one row per user per day)
create table if not exists public.apple_health_daily (
  id                uuid        primary key default gen_random_uuid(),
  user_id           text        not null,
  date              date        not null,
  steps             integer,
  sleep_hours       numeric(5,2),
  active_calories   integer,
  resting_hr        integer,
  hrv               numeric(6,2),
  weight_kg         numeric(6,2),
  vo2_max           numeric(5,2),
  respiratory_rate  numeric(5,2),
  updated_at        timestamptz default now(),
  unique(user_id, date)
);

-- Indexes for fast queries
create index if not exists idx_ah_daily_user_date
  on public.apple_health_daily(user_id, date desc);

-- Enable RLS
alter table public.apple_health_keys   enable row level security;
alter table public.apple_health_daily  enable row level security;

-- Service role has full access (backend uses service key)
create policy "Service role manages apple_health_keys"
  on public.apple_health_keys for all
  using (true) with check (true);

create policy "Service role manages apple_health_daily"
  on public.apple_health_daily for all
  using (true) with check (true);
