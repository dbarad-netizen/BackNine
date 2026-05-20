-- Weekly Leagues — Duolingo-style auto-grouped competitions.
--
-- Every Mon-Sun cycle, each user gets placed into a league of up to 10
-- people at their current tier. Leagues fill organically as users hit
-- the /api/leagues/current endpoint during the week. Ranking is by
-- weekly step count summed across the week.
--
-- V1: no auto-promotion / demotion. Members rank within their league;
-- next week everyone gets a fresh league at the same tier. V2 will add
-- tier changes based on final standings.

create table if not exists public.leagues (
  id          uuid        primary key default gen_random_uuid(),
  tier        smallint    not null default 1
              check (tier between 1 and 6),
  week_start  date        not null,    -- Monday of the league week
  week_end    date        not null,    -- Sunday of the league week
  created_at  timestamptz default now(),
  unique (tier, week_start)            -- one league per (tier, week) for filling
);

create index if not exists leagues_week_idx
  on public.leagues (week_start);


create table if not exists public.league_members (
  id              uuid        primary key default gen_random_uuid(),
  league_id       uuid        not null references public.leagues(id) on delete cascade,
  user_id         text        not null,
  joined_at       timestamptz default now(),
  -- Cached score so list reads don't always recompute. Refreshed on each
  -- /api/leagues/current call. Final rank is populated when the week ends.
  weekly_score    integer     default 0,
  final_rank      smallint,
  created_at      timestamptz default now(),
  unique (league_id, user_id)
);

create index if not exists league_members_user_idx
  on public.league_members (user_id, joined_at desc);

create index if not exists league_members_league_idx
  on public.league_members (league_id);
