-- Run this in Supabase → SQL Editor
-- Creates the table that stores daily readiness predictions so we can
-- compare predicted vs actual scores over time.

create table if not exists public.readiness_predictions (
  id              uuid        default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  target_date     date        not null,      -- the date this prediction is FOR (tomorrow)
  predicted_score integer     not null,
  actual_score    integer,                   -- filled in when that date arrives
  created_at      timestamptz default now(),
  unique(user_id, target_date)
);

alter table public.readiness_predictions enable row level security;

create policy "Users can manage their own predictions"
  on public.readiness_predictions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
