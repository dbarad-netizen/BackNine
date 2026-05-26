-- Run in Supabase → SQL Editor (already applied on the live project)

-- Static supplement stack per user. JSON array of {name, dose, timing, notes}
-- so Coach Al can speak to what they're taking (chat + briefing context). One
-- jsonb column keeps it cheap until/unless we ever need adherence logging,
-- which would warrant a dedicated supplements table with a daily row per user.
alter table public.user_profiles
  add column if not exists supplements jsonb not null default '[]'::jsonb;
