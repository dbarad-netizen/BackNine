-- Run in Supabase → SQL Editor (already applied on the live project)

-- Extends training_workouts so Oura-imported events (runs, walks, saunas,
-- meditations) live alongside manually-logged strength sessions. `kind`
-- separates the data model (strength rows carry sets+volume; cardio/session
-- rows carry duration/distance/HR). `source` + `external_id` make Oura
-- imports idempotent — re-running fetches is a no-op via the partial unique
-- index below.
alter table public.training_workouts
  add column if not exists kind text not null default 'strength'
    check (kind in ('strength','cardio','session')),
  add column if not exists source text,           -- null = manual, 'oura' = imported
  add column if not exists external_id text,      -- Oura workout/session id
  add column if not exists activity text,         -- running, walking, sauna, meditation, etc.
  add column if not exists distance_meters numeric,
  add column if not exists avg_hr integer,
  add column if not exists calories_kcal integer;

create unique index if not exists training_workouts_external_unique
  on public.training_workouts (user_id, source, external_id)
  where source is not null and external_id is not null;
