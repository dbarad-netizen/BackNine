-- Staging demo seed — Sam Demo + Pat Demo (the same accounts used for Apple
-- App Review). Synthetic, deterministic, no real people. Run ONCE on the
-- staging project AFTER creating the auth user demo@backnine.health in
-- Authentication → Users (Auto Confirm ticked). Safe to re-run.
--
-- The backend rolls these two accounts forward daily (DEMO_USER_IDS on
-- Render; add Sam's staging UUID there), so they always look "live".

do $$
declare
  demo text := (select id::text from auth.users where email = 'demo@backnine.health' limit 1);
  pat  text := 'a0000000-0000-4000-8000-00000000de01';
begin
  if demo is null then
    raise exception 'Create the auth user demo@backnine.health first (Authentication → Users → Add user, Auto Confirm).';
  end if;

  -- Sam: 75 days of Oura-shaped data
  insert into oura_daily_cache (user_id, date, readiness, sleep_score, activity, sleep_model, fetched_at)
  select demo, d,
    jsonb_build_object('score', 70+round(r1*20), 'hrv', 60+round(r2*30), 'temp_dev', round((r3-0.5)*0.6,2)),
    jsonb_build_object('score', 68+round(r2*22), 'efficiency', 80+round(r3*12), 'total_sleep', 70+round(r1*25), 'sleep_balance', null),
    case when d = current_date then null else jsonb_build_object('score', 62+round(r4*33), 'steps', 4800+round(r5*8200), 'active_cal', 240+round(r4*420)) end,
    jsonb_build_object('hrv', 32+round(r2*16), 'rhr', 52+round(r3*6), 'avg_hr', 57+round(r3*6),
      'total', round((6.2+r1*1.7)*3600), 'deep', round((0.9+r2*0.7)*3600), 'rem', round((1.2+r3*0.7)*3600),
      'awake', round((0.3+r4*0.4)*3600), 'efficiency', 80+round(r3*12), 'spo2', round(95+r5*2,1),
      'breath', round(14+r6*2.2,1), 'restless', 90+round(r5*120), 'sleep_need', null,
      'bedtime_start', to_char(d - interval '1 day', 'YYYY-MM-DD') || 'T' || lpad((22+floor(r6*2))::int::text,2,'0') || ':' || lpad((floor(r1*59))::int::text,2,'0') || ':00.000-07:00'),
    now()
  from (select d::date d, (extract(epoch from d)::bigint/86400) n from generate_series(current_date-74, current_date, interval '1 day') d) x
  cross join lateral (select ((n*7)%97)/97.0 r1, ((n*13)%89)/89.0 r2, ((n*17)%83)/83.0 r3, ((n*23)%79)/79.0 r4, ((n*29)%73)/73.0 r5, ((n*31)%71)/71.0 r6) r
  on conflict (user_id, date) do nothing;

  -- Pat: 40 days, a little lower so Sam leads
  insert into oura_daily_cache (user_id, date, readiness, sleep_score, activity, sleep_model, fetched_at)
  select pat, d,
    jsonb_build_object('score', 62+round(r1*22), 'hrv', 55+round(r2*30), 'temp_dev', round((r3-0.5)*0.6,2)),
    jsonb_build_object('score', 60+round(r2*24), 'efficiency', 76+round(r3*14), 'total_sleep', 60+round(r1*30), 'sleep_balance', null),
    jsonb_build_object('score', 55+round(r4*35), 'steps', 3200+round(r3*7000), 'active_cal', 180+round(r4*380)),
    jsonb_build_object('hrv', 26+round(r2*14), 'rhr', 56+round(r3*8), 'avg_hr', 61+round(r3*6),
      'total', round((5.6+r1*1.9)*3600), 'deep', round((0.7+r2*0.6)*3600), 'rem', round((1.0+r3*0.7)*3600),
      'awake', round((0.4+r4*0.5)*3600), 'efficiency', 76+round(r3*14), 'spo2', round(94.5+r1*2,1),
      'breath', round(14.5+r2*2,1), 'restless', 120+round(r4*140), 'sleep_need', null,
      'bedtime_start', to_char(d - interval '1 day', 'YYYY-MM-DD') || 'T23:' || lpad((floor(r1*59))::int::text,2,'0') || ':00.000-07:00'),
    now()
  from (select d::date d, (extract(epoch from d)::bigint/86400) n from generate_series(current_date-40, current_date-1, interval '1 day') d) x
  cross join lateral (select ((n*11)%97)/97.0 r1, ((n*19)%89)/89.0 r2, ((n*37)%83)/83.0 r3, ((n*41)%79)/79.0 r4) r
  on conflict (user_id, date) do nothing;

  insert into user_profiles (user_id, name, age, biological_sex, birthdate, height_cm, health_goals, training_level, coach_voice, sleep_target_hours, onboarded_at,
    medications, supplements, peptides, chronic_injuries, family_history, enabled_capabilities)
  values
   (demo, 'Sam Demo', 56, 'male', '1970-05-14', 180, array['Sleep better','Stay strong','Keep my numbers in range'], 'intermediate', 'straight', 7.5, now()-interval '70 days',
    '[{"name":"Losartan","dose":"50 mg","frequency":"daily","started":"2025-11-01"}]'::jsonb,
    '[{"name":"Vitamin D3","dose":"2000 IU","time":"morning"},{"name":"Magnesium glycinate","dose":"400 mg","time":"evening"},{"name":"Creatine","dose":"5 g","time":"morning"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '{"father":["High blood pressure"],"mother":["Type 2 diabetes"]}'::jsonb, array[]::text[]),
   (pat, 'Pat Demo', 58, 'male', '1968-02-02', 178, array['Walk more'], 'beginner', 'straight', 7.5, now()-interval '40 days',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, array[]::text[])
  on conflict (user_id) do nothing;

  insert into profiles (id, email, display_name, onboarding_dismissed_at)
  values (demo::uuid, 'demo@backnine.health', 'Sam Demo', now())
  on conflict (id) do update set onboarding_dismissed_at = excluded.onboarding_dismissed_at;

  insert into friendships (user_id_a, user_id_b, user_a_name, user_b_name, created_at, initiated_by, relationship_type)
  select least(demo, pat), greatest(demo, pat),
         case when demo < pat then 'Sam Demo' else 'Pat Demo' end,
         case when demo < pat then 'Pat Demo' else 'Sam Demo' end,
         now()-interval '38 days', demo, 'friend'
  on conflict do nothing;

  insert into lab_entries (id, user_id, date, logged_at, notes, "values") values
   ('demo-lab-1', demo, current_date-200, now()-interval '200 days', 'Annual physical',
    '{"total_cholesterol":212,"ldl":138,"hdl":46,"triglycerides":150,"glucose":101,"hba1c":5.8,"creatinine":1.02,"egfr":82,"alt":31,"ast":26,"psa":1.4,"testosterone_total":410,"apolipoprotein_b":104}'::jsonb),
   ('demo-lab-2', demo, current_date-18, now()-interval '18 days', 'Six-month recheck',
    '{"total_cholesterol":188,"ldl":112,"hdl":51,"triglycerides":118,"glucose":94,"hba1c":5.5,"creatinine":0.98,"egfr":86,"alt":24,"ast":22,"psa":1.3,"testosterone_total":455,"apolipoprotein_b":88}'::jsonb)
  on conflict (id) do nothing;

  insert into daily_checkins (user_id, date, mood)
  select demo, d::date, (array['good','great','okay','good','tired','good','great'])[1 + (extract(doy from d)::int % 7)]
  from generate_series(current_date-9, current_date-1, interval '1 day') d
  on conflict do nothing;

  insert into weekly_healthspan_history (user_id, date, score, grade, bands_present)
  select uid, d::date, s, case when s>=85 then 'A' when s>=75 then 'B' when s>=65 then 'C' else 'D' end, 4 from (
    select demo uid, d, (74 + (extract(doy from d)::int*7 % 17))::int s from generate_series(current_date-63, current_date-1, interval '7 day') d
    union all
    select pat, d, (61 + (extract(doy from d)::int*5 % 15))::int from generate_series(current_date-35, current_date-1, interval '7 day') d
  ) x
  on conflict (user_id, date) do nothing;

  insert into biological_age_history (user_id, date, biological_age, delta_years, n_markers, confidence) values
   (demo, current_date-60, 54.8, -1.2, 7, 'medium'),
   (demo, current_date-30, 54.1, -1.9, 8, 'high')
  on conflict (user_id, date) do nothing;

  raise notice 'Seeded Sam Demo (%) and Pat Demo (%).', demo, pat;
end $$;
