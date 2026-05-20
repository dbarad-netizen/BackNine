-- Reusable per-user referral code for shareable invite cards.
--
-- Unlike friend_invites (one-time, 72h TTL), a referral code is stable and
-- reusable: one code per user that can be shared on a card to many people.
-- Anyone who taps the link and signs up gets auto-connected as a friend of
-- the code's owner (see friends.accept_referral).
--
-- Idempotent: safe to run multiple times.

create table if not exists public.referral_codes (
  user_id    text        primary key,
  code       text        not null unique,
  name       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_codes_code
  on public.referral_codes (code);
