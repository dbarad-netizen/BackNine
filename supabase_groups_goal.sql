-- Group shared weekly goal — a cooperative target the whole crew works toward,
-- measured in weekly engagement points (same metric as Leagues / leaderboard).
-- Nullable: a group has no goal until someone sets one.
--
-- Idempotent: safe to run multiple times.

alter table public.groups
  add column if not exists weekly_goal int;
