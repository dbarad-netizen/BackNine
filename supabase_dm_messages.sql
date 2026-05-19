-- Direct messages between friend pairs.
--
-- Private 1:1 conversation channel separate from public event comments.
-- Two friends can chat without anyone else seeing — even other friends-
-- of-the-author-of-the-original-event. Fixes the privacy leak where two
-- friends-of-the-same-person would see each other's names on shared
-- event comments.
--
-- Each message is owned by its sender; reads query both directions
-- (sender_id=me AND recipient_id=friend) OR (sender_id=friend AND recipient_id=me)
-- to assemble the conversation.

create table if not exists public.dm_messages (
  id            uuid        primary key default gen_random_uuid(),
  sender_id     text        not null,
  recipient_id  text        not null,
  text          text        not null check (char_length(text) <= 2000),
  created_at    timestamptz default now(),
  check (sender_id <> recipient_id)
);

create index if not exists dm_messages_pair_idx
  on public.dm_messages (sender_id, recipient_id, created_at);

create index if not exists dm_messages_reverse_idx
  on public.dm_messages (recipient_id, sender_id, created_at);
