-- Soft-delete for friendships.
--
-- Instead of physically deleting rows when a user removes a friend, mark
-- them with deleted_at and filter on read. Lets us recover from accidental
-- deletions (the "I tapped the X by mistake" or "my friend tapped their X"
-- case that previously wiped data permanently).
--
-- Idempotent — safe to re-run.

alter table public.friendships
  add column if not exists deleted_at timestamptz;

-- Partial index covers only active friendships (the common read path).
create index if not exists friendships_active_idx
  on public.friendships (user_id_a, user_id_b)
  where deleted_at is null;
