-- Run in Supabase → SQL Editor
-- Stores parsed Oura daily metrics so the dashboard can read from cache
-- instead of hitting the Oura API on every page load.
-- Written by the webhook handler each time Oura pushes a new data event.

CREATE TABLE IF NOT EXISTS public.oura_daily_cache (
  user_id      text        NOT NULL,
  date         date        NOT NULL,
  readiness    jsonb,        -- { score, hrv, temp_dev }
  sleep_score  jsonb,        -- { score, efficiency }
  activity     jsonb,        -- { score, steps, active_cal }
  sleep_model  jsonb,        -- { total, deep, rem, hrv, rhr, efficiency, bedtime_start, sleep_need }
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_oura_cache_user_date
  ON public.oura_daily_cache(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_oura_cache_fetched
  ON public.oura_daily_cache(user_id, fetched_at DESC);

ALTER TABLE public.oura_daily_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages oura_daily_cache"
  ON public.oura_daily_cache FOR ALL USING (true) WITH CHECK (true);
