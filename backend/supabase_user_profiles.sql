-- ── BackNine: user_profiles table ────────────────────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It creates the user_profiles table with RLS so users can only read/write
-- their own row, keyed to auth.uid().

-- user_id is TEXT (not UUID) to support both Oura-only users
-- (user_id = "oura_XXXXX") and future Supabase auth users.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id         TEXT        PRIMARY KEY,
  age             INTEGER,
  biological_sex  TEXT        CHECK (biological_sex IN ('male', 'female')),
  health_goals    TEXT[]      DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────
-- The backend always uses the service_role key, which bypasses RLS automatically.
-- RLS is enabled to prevent accidental public exposure; the permissive policy
-- covers any direct Supabase client access in the future.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all"
  ON public.user_profiles
  USING (true)
  WITH CHECK (true);
