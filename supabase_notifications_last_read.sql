-- Notification inbox: tracks when the user last opened their notification
-- panel. The /api/notifications endpoint aggregates everything from the
-- relevant tables (dm_messages, activity_events, event_comments,
-- event_reactions) since this timestamp to compute unread.
--
-- Idempotent — safe to re-run.

alter table public.user_profiles
  add column if not exists notifications_last_read_at timestamptz;
