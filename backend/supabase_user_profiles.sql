-- ── BackNine: user_profiles table ────────────────────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It creates the user_profiles table with RLS so users can only read/write
-- their own row, keyed to auth.uid().

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id         UUID    PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  age             INTEGER,
  biological_sex  TEXT    CHECK (biological_sex IN ('male', 'female')),
  health_goals    TEXT[]  DEFAULT '{}',
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
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_select_own_profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own profile (first save)
CREATE POLICY "users_insert_own_profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "users_update_own_profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role (used by backend) has full access (bypasses RLS anyway, but explicit is cleaner)
-- No extra policy needed — service_role key bypasses RLS by default.
