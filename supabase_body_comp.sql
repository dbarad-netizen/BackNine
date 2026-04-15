-- Add InBody / body composition columns to apple_health_daily
-- Run in Supabase → SQL Editor

alter table public.apple_health_daily
  add column if not exists body_fat_percentage    numeric(5,2),
  add column if not exists lean_body_mass_kg      numeric(6,2),
  add column if not exists skeletal_muscle_mass_kg numeric(6,2),
  add column if not exists bmi                    numeric(5,2);
