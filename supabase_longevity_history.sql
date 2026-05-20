-- Longevity Score history — one row per (user_id, date).
-- Lets the Scorecard render a trend line of the composite Longevity Score
-- over time. Populated two ways:
--   1. Live: every dashboard load upserts today's authoritative score.
--   2. Backfill: on first load we reconstruct ~90 days from oura_daily_cache
--      (per-day HRV/RHR, trailing 7-day sleep/steps, carried-back VO2/body-fat).
--
-- Idempotent: safe to run multiple times.

create table if not exists public.longevity_history (
  user_id              text        not null,
  date                 date        not null,
  score                int,
  grade                text,
  biological_age_delta int,
  components           jsonb,
  computed_at          timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists idx_longevity_history_user_date
  on public.longevity_history (user_id, date);
