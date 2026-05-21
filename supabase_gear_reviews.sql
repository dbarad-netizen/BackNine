-- Communal reviews on gear items. One review per user per item (editable);
-- rating is optional so a user can leave a text-only comment. gear_item_id is
-- the static catalog id from frontend/src/lib/gearData.ts (e.g. "oura-ring").
--
-- Idempotent: safe to run multiple times.

create table if not exists public.gear_reviews (
  id           uuid        primary key default gen_random_uuid(),
  gear_item_id text        not null,
  user_id      text        not null,
  rating       int,                       -- 1-5, nullable
  text         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (gear_item_id, user_id)
);

create index if not exists gear_reviews_item_idx
  on public.gear_reviews (gear_item_id, created_at desc);
