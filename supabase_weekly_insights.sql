-- Coach Al's Weekly Insight — one row per (user_id, week_start).
-- Replaces the dry "Coaching Insights" lists with a single narrative card in
-- Coach Al's voice that surfaces the user's strongest data pattern of the week
-- (from the correlation engine in insights.py) and suggests an experiment.
--
-- week_start = the Monday (ET) of the week the insight belongs to, so the
-- expensive Claude call happens at most once per user per week.
--
-- Idempotent: safe to run multiple times.

create table if not exists public.weekly_insights (
  user_id      text        not null,
  week_start   date        not null,
  insight_id   text,                       -- which correlation drove it
  headline     text        not null,       -- short punchy title, Coach Al voice
  narrative    text        not null,       -- 1-2 short paragraphs
  experiment   text,                       -- the suggested 1-week experiment
  source       jsonb,                      -- raw insight dict (evidence chip + debugging)
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create index if not exists idx_weekly_insights_user_week
  on public.weekly_insights (user_id, week_start);
