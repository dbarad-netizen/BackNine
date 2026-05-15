-- Per-event comment threads for the Friend Pulse feed.
--
-- Each Pulse card on the Scorecard can now expand into a reply thread.
-- Comments are scoped to a single activity_event so the conversation has
-- context (you're replying to "Sarah crushed sleep — 92", not in a generic DM).
--
-- On delete cascade: if the parent activity_event ever gets deleted, its
-- comment thread goes with it.

create table if not exists public.event_comments (
  id          uuid        primary key default gen_random_uuid(),
  event_id    uuid        not null references public.activity_events(id) on delete cascade,
  user_id     text        not null,
  user_name   text,
  text        text        not null check (char_length(text) <= 500),
  created_at  timestamptz default now()
);

create index if not exists event_comments_event_idx
  on public.event_comments (event_id, created_at);
