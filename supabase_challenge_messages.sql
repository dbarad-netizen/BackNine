-- Challenge chat messages
-- Run in Supabase → SQL Editor

create table if not exists public.challenge_messages (
  id            uuid        default gen_random_uuid() primary key,
  challenge_id  text        not null,
  user_id       text        not null,
  display_name  text        not null,
  text          text        not null check (char_length(text) <= 500),
  created_at    timestamptz default now()
);

create index on public.challenge_messages (challenge_id, created_at desc);
