-- Reusable workout routines/templates.
--
-- A template is a saved set of exercises (with target sets/weights/reps) the
-- user can start a session from, so they don't rebuild the same Push/Pull/Leg
-- day every time. Stored as the same exercises[] shape a workout uses.
--
-- Idempotent: safe to run multiple times.

create table if not exists public.training_templates (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  name       text        not null,
  type       text        not null default 'lifting',   -- lifting | stretching | mobility
  exercises  jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists training_templates_user_idx
  on public.training_templates (user_id, created_at desc);
