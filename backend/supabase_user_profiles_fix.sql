-- ── BackNine: Fix user_profiles table ────────────────────────────────────────
-- Run this in the Supabase SQL Editor if you already ran the original migration.
-- It drops the UUID + FK constraint and recreates with TEXT user_id so that
-- both Oura-only users (user_id = "oura_XXXXX") and Supabase auth users work.

-- 1. Drop the old table (it's empty at this point — no data to lose)
DROP TABLE IF EXISTS public.user_profiles;

-- 2. Recreate with TEXT primary key (no FK to auth.users)
CREATE TABLE public.user_profiles (
  user_id         TEXT        PRIMARY KEY,
  age             INTEGER,
  biological_sex  TEXT        CHECK (biological_sex IN ('male', 'female')),
  health_goals    TEXT[]      DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Auto-update updated_at
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

-- 4. RLS — the backend uses the service_role key, which bypasses RLS.
--    Enable it anyway so the table is not accidentally publicly readable.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically (no extra policy needed).
-- These policies cover direct Supabase client access if ever used:
CREATE POLICY "service_all"
  ON public.user_profiles
  USING (true)
  WITH CHECK (true);
