-- Run this in your Supabase project → SQL Editor

create table if not exists challenges (
  id            text primary key,
  name          text        not null,
  type          text        not null,  -- 'steps' | 'calories' | 'protein' | 'custom'
  metric        text        not null,  -- human label, e.g. "steps per day"
  target        numeric     not null,
  duration_days integer     not null,
  start_date    date        not null,
  end_date      date        not null,
  created_at    timestamptz default now(),
  creator_id    text        not null,
  creator_name  text        not null
);

create table if not exists challenge_participants (
  id            uuid  primary key default gen_random_uuid(),
  challenge_id  text  references challenges(id) on delete cascade,
  user_id       text  not null,
  display_name  text  not null,
  joined_at     timestamptz default now(),
  unique(challenge_id, user_id)
);

create table if not exists challenge_progress (
  id            uuid    primary key default gen_random_uuid(),
  challenge_id  text    references challenges(id) on delete cascade,
  user_id       text    not null,
  date          date    not null,
  value         numeric not null,
  updated_at    timestamptz default now(),
  unique(challenge_id, user_id, date)
);

-- Allow public read/write (challenge codes act as the access token)
alter table challenges           enable row level security;
alter table challenge_participants enable row level security;
alter table challenge_progress   enable row level security;

create policy "open" on challenges            for all using (true) with check (true);
create policy "open" on challenge_participants for all using (true) with check (true);
create policy "open" on challenge_progress    for all using (true) with check (true);
