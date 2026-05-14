-- Coach Al persistence (Week 2):
--   chat_messages       — persistent conversation between user and Coach Al
--   coach_observations  — proactive notes Coach Al has surfaced about the user
--
-- All user_id columns are TEXT (Oura-native users are not UUIDs — same
-- convention as challenge_messages, readiness_predictions, daily_briefings,
-- friendships, etc.).

-- ── Chat messages ─────────────────────────────────────────────────────────────
-- One row per turn. Roles match the Anthropic API: 'user' or 'assistant'.
-- We read the most-recent N rows (newest-first then reverse) to build the
-- history passed to Claude on each /api/chat call.

create table if not exists public.chat_messages (
  id              uuid        primary key default gen_random_uuid(),
  user_id         text        not null,
  role            text        not null check (role in ('user', 'assistant')),
  content         text        not null,
  created_at      timestamptz default now()
);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);


-- ── Coach observations ────────────────────────────────────────────────────────
-- Proactive notes Coach Al has surfaced. The chat widget opens with the
-- freshest unread observation as the first message instead of a generic
-- greeting. Each observation is dedup'd by (user_id, kind, date) so the
-- same daily insight isn't written twice on a single day.
--
-- kind examples:
--   hrv_drop                  — today's HRV >12% below 7-day average
--   prediction_streak_5       — hit a 5-day prediction streak
--   prediction_streak_7       — hit a 7-day prediction streak
--   insight_<id>              — a high-r correlation from insights.py

create table if not exists public.coach_observations (
  id              uuid        primary key default gen_random_uuid(),
  user_id         text        not null,
  kind            text        not null,
  date            date        not null,
  message         text        not null,
  payload         jsonb       not null default '{}'::jsonb,
  read            boolean     not null default false,
  dismissed       boolean     not null default false,
  created_at      timestamptz default now(),
  unique (user_id, kind, date)
);

create index if not exists coach_observations_user_idx
  on public.coach_observations (user_id, dismissed, read, created_at desc);
