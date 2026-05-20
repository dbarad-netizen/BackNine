-- Persistent, per-user training preferences (goal, days/week, split, equipment).
--
-- Like workouts, these were stored in the ephemeral local JSON file and reset
-- on every Render cold start. This table persists them per user.
--
-- Fresh table name to avoid colliding with any legacy training_settings table.
-- Settings are stored as a single jsonb blob merged against DEFAULT_SETTINGS
-- in code, so adding new preference keys later needs no schema change.

create table if not exists public.user_training_settings (
  user_id     text        primary key,
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);
