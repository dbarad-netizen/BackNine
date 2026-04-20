-- Run this in Supabase → SQL Editor
-- Adds sleep stage columns and body comp columns to apple_health_daily

alter table public.apple_health_daily
  add column if not exists sleep_deep_hours   numeric(5,2),
  add column if not exists sleep_rem_hours    numeric(5,2),
  add column if not exists sleep_core_hours   numeric(5,2),
  add column if not exists sleep_awake_hours  numeric(5,2),
  add column if not exists body_fat_percentage    numeric(5,2),
  add column if not exists lean_body_mass_kg      numeric(6,2),
  add column if not exists skeletal_muscle_mass_kg numeric(6,2),
  add column if not exists bmi                    numeric(5,2);
