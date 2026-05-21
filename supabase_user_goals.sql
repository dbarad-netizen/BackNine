-- Coach Al goals/programs — a single forward-looking goal the user works toward,
-- with a multi-week plan Coach Al generates. V1: one active goal per user
-- (older ones are archived as 'replaced'/'completed'/'abandoned').
--
-- Idempotent: safe to run multiple times.

create table if not exists public.user_goals (
  id             uuid        primary key default gen_random_uuid(),
  user_id        text        not null,
  metric         text        not null,   -- longevity_score | body_fat | weight | vo2_max | resting_hr | training_freq | sleep_hours
  baseline       numeric,                -- value at creation (null if unknown yet)
  target         numeric     not null,
  start_date     date        not null,
  end_date       date        not null,
  duration_weeks int         not null,
  plan           jsonb,                  -- {headline, overview, weeks:[{week,focus,actions[]}]}
  status         text        not null default 'active',  -- active | completed | replaced | abandoned
  created_at     timestamptz not null default now()
);

create index if not exists user_goals_user_status_idx
  on public.user_goals (user_id, status);
