-- Add 'good' to the daily_checkins mood vocabulary.
--
-- Original migration used a 4-point scale (great / okay / tired / off).
-- This adds 'good' between 'great' and 'okay' for a 5-point scale that
-- captures the "fine but not great" middle ground.
--
-- Safe to re-run: drops then re-adds the named constraint.

alter table public.daily_checkins
  drop constraint if exists daily_checkins_mood_check;

alter table public.daily_checkins
  add constraint daily_checkins_mood_check
  check (mood in ('great', 'good', 'okay', 'tired', 'off'));
