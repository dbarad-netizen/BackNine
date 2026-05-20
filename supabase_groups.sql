-- Groups (Crews) — a named, shared space a few people explicitly join via a
-- code, with a group chat everyone in it sees. Distinct from 1:1 DMs.
--
-- Idempotent: safe to run multiple times.

create table if not exists public.groups (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  join_code  text        not null unique,
  created_by text        not null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid        not null references public.groups(id) on delete cascade,
  user_id   text        not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx
  on public.group_members (user_id);

create table if not exists public.group_messages (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.groups(id) on delete cascade,
  user_id    text        not null,
  text       text        not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_idx
  on public.group_messages (group_id, created_at);
