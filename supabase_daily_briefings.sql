-- Daily Coach Al briefing cache.
-- One row per (user_id, date). Generated lazily on first dashboard load
-- of the day; subsequent loads on the same day return the cached row.
--
-- user_id is TEXT (not uuid) to support Oura-native users whose IDs
-- look like `oura_<string>` and are not valid UUIDs. This matches
-- challenge_messages / readiness_predictions / wearable_connections.

create table if not exists public.daily_briefings (
  id                  uuid        default gen_random_uuid() primary key,
  user_id             text        not null,
  date                date        not null,
  narrative           text        not null,
  prediction_streak   integer,
  prediction_accuracy integer,
  generated_at        timestamptz default now(),
  unique(user_id, date)
);

create index if not exists daily_briefings_user_date_idx
  on public.daily_briefings (user_id, date desc);
