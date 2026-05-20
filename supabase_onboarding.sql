-- First-time user onboarding tracking.
--
-- onboarded_at is null until the user finishes (or skips through) the
-- onboarding flow. The dashboard shows the OnboardingModal whenever this
-- is null. Setting it to a timestamp dismisses the flow permanently.
--
-- Idempotent — safe to re-run.

alter table public.user_profiles
  add column if not exists onboarded_at timestamptz;
