-- BackNine Health — Supabase schema
-- Run this in the Supabase SQL editor to set up your database.

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Users ────────────────────────────────────────────────────────────────────
-- We piggyback on Supabase Auth (auth.users) for identity.
-- This table stores app-level profile data.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  display_name text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);


-- ── Wearable connections ──────────────────────────────────────────────────────
-- Stores OAuth tokens for each connected provider.
create table if not exists public.wearable_connections (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  provider      text not null,          -- 'oura' | 'garmin' | 'whoop' | etc.
  access_token  text not null,
  refresh_token text,
  expires_at    bigint,                 -- Unix timestamp
  scopes        text,
  connected_at  timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, provider)
);

alter table public.wearable_connections enable row level security;

-- Only the backend service role touches this table directly.
-- The frontend never reads raw tokens.
create policy "Service role can manage wearable connections"
  on public.wearable_connections
  using (auth.role() = 'service_role');


-- ── Daily metrics cache ───────────────────────────────────────────────────────
-- Cached daily metrics per user per day.
-- The backend writes these after fetching from wearable APIs.
create table if not exists public.daily_metrics (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  provider     text not null,
  date         date not null,
  readiness    smallint,
  sleep        smallint,
  activity     smallint,
  hrv          numeric(6,2),
  rhr          smallint,
  steps        int,
  total_hrs    numeric(4,1),
  temp_dev     numeric(4,2),
  deep_min     smallint,
  rem_min      smallint,
  efficiency   smallint,
  active_cal   int,
  raw_json     jsonb,                   -- full API response for that day
  fetched_at   timestamptz default now(),
  unique (user_id, provider, date)
);

create index on public.daily_metrics (user_id, date desc);

alter table public.daily_metrics enable row level security;

create policy "Users can read their own metrics"
  on public.daily_metrics for select
  using (auth.uid() = user_id);

create policy "Service role can write metrics"
  on public.daily_metrics for all
  using (auth.role() = 'service_role');


-- ── Lab entries ───────────────────────────────────────────────────────────────
-- One row per panel date per user. All marker values stored as JSONB.
create table if not exists public.lab_entries (
  id         text primary key,           -- short 8-char id
  user_id    text not null,              -- oura_<id> style
  date       date not null,
  logged_at  timestamptz default now(),
  notes      text default '',
  values     jsonb not null default '{}'
);

create index on public.lab_entries (user_id, date desc);

alter table public.lab_entries enable row level security;

create policy "Service role can manage lab entries"
  on public.lab_entries for all
  using (auth.role() = 'service_role');


-- ── Trigger: auto-update updated_at ──────────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger wearable_connections_updated_at
  before update on public.wearable_connections
  for each row execute procedure public.handle_updated_at();
