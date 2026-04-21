-- Run this in Supabase → SQL Editor
-- Adds blood pressure, SpO2, visceral fat, and waist circumference
-- to the apple_health_daily table.

alter table public.apple_health_daily
  add column if not exists blood_pressure_systolic   integer,
  add column if not exists blood_pressure_diastolic  integer,
  add column if not exists spo2                      numeric(5,2),
  add column if not exists visceral_fat_rating       numeric(5,1),
  add column if not exists waist_circumference_cm    numeric(6,2);
