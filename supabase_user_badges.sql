-- Achievements / badges the user has unlocked. Once earned, a badge stays
-- earned (we never delete), even if the underlying metric later drops.
--
-- Idempotent: safe to run multiple times.

create table if not exists public.user_badges (
  user_id   text        not null,
  badge_id  text        not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create index if not exists user_badges_user_idx
  on public.user_badges (user_id);
