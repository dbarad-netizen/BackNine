-- Fix readiness_predictions table to support both Supabase UUID users
-- and Oura-native users (whose user_id is "oura_<id>", not a UUID).
--
-- Run this in Supabase → SQL Editor

-- 1. Drop the old table (it has no real data yet due to the uuid constraint bug)
drop table if exists public.readiness_predictions;

-- 2. Recreate with user_id as text (no foreign key)
create table public.readiness_predictions (
  id              uuid        default gen_random_uuid() primary key,
  user_id         text        not null,          -- text, not uuid — supports "oura_xxx" ids
  target_date     date        not null,           -- the date this prediction is FOR (tomorrow)
  predicted_score integer     not null,
  actual_score    integer,                        -- filled in when that date arrives
  created_at      timestamptz default now(),
  unique(user_id, target_date)
);

-- 3. Index for fast per-user lookups
create index on public.readiness_predictions (user_id, target_date desc);

-- 4. No RLS needed — backend uses the service key exclusively
-- (service key bypasses RLS, same pattern as all other tables)
