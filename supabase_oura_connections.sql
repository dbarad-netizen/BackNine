-- Oura connections: stable per-account mapping + server-side token store.
--
-- Why this exists:
--   1. Stable identity — a returning user resolves to the SAME BackNine user_id
--      on any device (keyed on the Oura personal id, which never changes), so
--      logging in on a new browser no longer creates a phantom account / forces
--      re-onboarding.
--   2. Webhooks — the push handler reads this table to find the user's tokens and
--      refresh oura_daily_cache the moment Oura sends new data. (The old code
--      read the empty, UUID-typed `wearable_connections` table and silently
--      no-op'd, which is why data only ever arrived on the slow lazy poll.)
--
-- Run once in the Supabase SQL editor.

create table if not exists public.oura_connections (
  oura_user_id  text primary key,        -- Oura's stable personal id
  user_id       text not null,           -- canonical BackNine id (oura_<pid> or a Supabase uuid)
  access_token  text,
  refresh_token text,
  expires_at    bigint,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_oura_connections_user on public.oura_connections (user_id);

-- Seed the identity mapping for existing direct-Oura users. Their user_id is
-- literally "oura_<pid>", so we can recover the pid by stripping the prefix.
-- Tokens are left null here and fill in automatically on each user's next
-- sign-in (the callback upserts them); until then webhooks simply skip that user.
insert into public.oura_connections (oura_user_id, user_id)
select substring(user_id from 6) as oura_user_id, user_id
from public.user_profiles
where user_id like 'oura\_%'
on conflict (oura_user_id) do nothing;
