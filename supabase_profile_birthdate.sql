-- Store date of birth so age can be derived (and stays current as the user
-- ages) rather than stored as a static number. Nullable / optional; existing
-- users keep their stored `age` as a fallback until they add their birthday.
--
-- Idempotent: safe to run multiple times.

alter table public.user_profiles
  add column if not exists birthdate date;
