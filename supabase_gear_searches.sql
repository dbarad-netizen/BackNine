-- Demand signal for the gear catalog. Every time someone asks Coach Al for gear
-- we log the query plus what matched (catalog ids) and what Coach Al suggested
-- looking for elsewhere (gap product types). Aggregated, this is a running list
-- of what people want so the catalog can be expanded toward real demand.
--
-- Idempotent: safe to run multiple times.

create table if not exists public.gear_searches (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,
  query             text not null,
  had_match         boolean default false,
  pick_ids          text[] default '{}',
  suggestion_titles text[] default '{}',
  created_at        timestamptz default now()
);

create index if not exists gear_searches_created_idx
  on public.gear_searches (created_at desc);
