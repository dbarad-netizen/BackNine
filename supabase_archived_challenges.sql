-- Per-user archived competitions. A user can archive an ended challenge to
-- tuck it out of their main Compete list (it stays in the DB and is restorable).
--
-- Idempotent: safe to run multiple times.

alter table public.user_profiles
  add column if not exists archived_challenges text[] default '{}';
