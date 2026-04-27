-- Add missing columns to user_profiles
-- Run in Supabase → SQL Editor

alter table public.user_profiles
  add column if not exists name        text,
  add column if not exists height_cm   numeric(5,1),
  add column if not exists vo2_max     numeric(5,1);
