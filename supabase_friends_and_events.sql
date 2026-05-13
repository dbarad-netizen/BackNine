-- Friends graph + activity event log + reactions.
--
-- Foundation for the community layer. The visible Pulse feed reads from
-- activity_events filtered by friendships; reactions hangs off events.
-- We ship all four tables in one migration so the next round (visible feed +
-- reaction UI) doesn't need another schema change.
--
-- All user_id columns are TEXT to match the rest of the schema — Oura-native
-- users have IDs like `oura_<string>` that aren't valid UUIDs.

-- ── Friendships ───────────────────────────────────────────────────────────────
-- Canonical ordering: user_id_a is always the lexicographically smaller of the
-- two user_ids, user_id_b the larger. This guarantees one row per friendship
-- regardless of who initiated, and lets us look up "is A friends with B" with
-- a single PK hit.

create table if not exists public.friendships (
  user_id_a       text        not null,
  user_id_b       text        not null,
  user_a_name     text,
  user_b_name     text,
  created_at      timestamptz default now(),
  initiated_by    text        not null,        -- the user_id that sent the invite
  primary key (user_id_a, user_id_b),
  check (user_id_a < user_id_b)
);

create index if not exists friendships_user_a_idx on public.friendships (user_id_a);
create index if not exists friendships_user_b_idx on public.friendships (user_id_b);


-- ── Friend invites ────────────────────────────────────────────────────────────
-- One-time invite codes. Inviter creates a row, shares the code, invitee
-- accepts (which deletes/marks the row and creates the friendship).

create table if not exists public.friend_invites (
  code            text        primary key,
  inviter_id      text        not null,
  inviter_name    text        not null,
  created_at      timestamptz default now(),
  expires_at      timestamptz not null,
  used_by         text,                         -- the user_id that accepted, null while pending
  used_at         timestamptz
);

create index if not exists friend_invites_inviter_idx
  on public.friend_invites (inviter_id, created_at desc);


-- ── Activity events ───────────────────────────────────────────────────────────
-- One row per meaningful action a user takes. The feed reads from here
-- filtered by friendship. Payload is JSONB so different event types carry
-- different shapes (workout name + duration, weight value, challenge name, etc).

create table if not exists public.activity_events (
  id              uuid        primary key default gen_random_uuid(),
  user_id         text        not null,
  user_name       text,                         -- denormalized for fast feed reads
  event_type      text        not null,        -- workout_logged | weight_logged | challenge_joined | challenge_completed | streak_milestone
  payload         jsonb       not null default '{}'::jsonb,
  created_at      timestamptz default now()
);

create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);

create index if not exists activity_events_created_idx
  on public.activity_events (created_at desc);


-- ── Reactions ─────────────────────────────────────────────────────────────────
-- Emoji reactions on activity events. Not used by the foundation pass UI yet;
-- shipping the table so the next round adds zero schema work.

create table if not exists public.event_reactions (
  id              uuid        primary key default gen_random_uuid(),
  event_id        uuid        not null references public.activity_events(id) on delete cascade,
  user_id         text        not null,
  emoji           text        not null,
  created_at      timestamptz default now(),
  unique (event_id, user_id, emoji)
);

create index if not exists event_reactions_event_idx
  on public.event_reactions (event_id);
