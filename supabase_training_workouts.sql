-- Persistent, per-user workout storage.
--
-- Workouts were previously written to a local JSON file (~/.backnine/training.json)
-- on the Render server. Render's filesystem is ephemeral — it's wiped on every
-- cold start / redeploy — so logged workouts silently disappeared. This table
-- moves them to Supabase, scoped by user_id, so they persist.
--
-- Fresh table name (training_workouts) to avoid colliding with any legacy
-- `workouts` table that may exist with a different schema.

create table if not exists public.training_workouts (
  id                text        primary key,
  user_id           text        not null,
  date              date        not null,
  type              text        not null,
  exercises         jsonb       not null default '[]'::jsonb,
  muscle_groups     jsonb       not null default '[]'::jsonb,
  duration_min      integer,
  notes             text,
  total_volume_lbs  integer,
  logged_at         timestamptz default now()
);

create index if not exists training_workouts_user_date_idx
  on public.training_workouts (user_id, date desc);
