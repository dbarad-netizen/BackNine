-- Per-user dismissed gear items.
--
-- When a user taps "not for me" on a Scorecard "Picked For You" card, the
-- item id is stored here so it stops appearing in their recommendations.
-- The Gear shop tab still shows every item — dismissal only affects the
-- Scorecard picks.
--
-- Idempotent — safe to re-run.

alter table public.user_profiles
  add column if not exists dismissed_gear jsonb not null default '[]'::jsonb;
