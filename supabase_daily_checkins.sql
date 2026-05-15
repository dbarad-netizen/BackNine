-- Daily mood / energy check-in.
--
-- Single tap each morning: 😊 great / 😐 okay / 😴 tired / 😣 off.
-- Coach Al's briefing reads yesterday's value when generating today's note
-- so the AI can reference subjective state alongside the wearable data
-- ("Yesterday you said tired and your HRV confirmed it — today's different").
--
-- One row per (user_id, date). Updating an existing day's mood upserts.

create table if not exists public.daily_checkins (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  date        date        not null,
  mood        text        not null check (mood in ('great', 'okay', 'tired', 'off')),
  created_at  timestamptz default now(),
  unique (user_id, date)
);

create index if not exists daily_checkins_user_date_idx
  on public.daily_checkins (user_id, date desc);
