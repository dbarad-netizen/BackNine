# BackNine — Project Context

A personal health intelligence dashboard that aggregates wearable data (Oura Ring, Apple Health) with manual tracking (nutrition, training, labs, body composition) and surfaces actionable coaching, longevity scoring, insights, and progress tracking. Built with Next.js + FastAPI + Supabase. Commercialization planned — target market is health-optimizing individuals using Oura Ring, Apple Watch, InBody scales, and Withings BP monitors.

---

## Architecture

```
User's browser (Vercel)
  └── fetch with Authorization: Bearer <token>
        └── FastAPI backend (Render)
              ├── Oura API (wearable data — live + webhook cache)
              ├── Anthropic API (Coach Al — claude-haiku-4-5)
              ├── Supabase Auth (email/password + Google OAuth)
              └── Supabase Postgres
                    ├── wearable_connections      (Oura tokens)
                    ├── oura_daily_cache          (webhook cache)
                    ├── apple_health_keys         (AH API keys)
                    ├── apple_health_daily        (AH synced data)
                    ├── user_profiles             (name, age, sex, goals)
                    ├── meals / nutrition_settings
                    ├── weight_entries            (body composition logs)
                    ├── workouts / training_settings
                    ├── lab_entries
                    ├── challenges / challenge_participants / challenge_progress
                    └── readiness_predictions     (forecast accuracy tracking)
```

**Frontend:** Next.js 14 App Router, Tailwind CSS → deployed on **Vercel**
**Backend:** FastAPI (Python 3.11) → deployed on **Render**
**Database:** Supabase (Postgres)
**Auth:** Dual — Supabase Auth (email/password + Google OAuth) OR legacy Oura-only OAuth
**AI Coach:** Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) via `ANTHROPIC_API_KEY`

---

## Live URLs

| Service | URL |
|---------|-----|
| Frontend (Vercel) | `https://back-nine-six.vercel.app` |
| Backend (Render) | `https://backnine-hu60.onrender.com` |
| Backend health check | `https://backnine-hu60.onrender.com/health` |
| Supabase project | `https://xazmwpozsmbrqoulizyn.supabase.co` |

---

## Repository Structure

```
BackNine/
├── backend/
│   ├── main.py           # FastAPI app, all routes, dual-JWT auth
│   ├── oura.py           # Oura OAuth client + parse_oura_data()
│   ├── coaching.py       # Coaching engine (short/mid/long-term items)
│   ├── chat.py           # Coach Al — Anthropic Claude chat with health context
│   ├── longevity.py      # Longevity Score (6 metrics: HRV, RHR, VO2, sleep, body fat, steps)
│   ├── insights.py       # Pearson correlation insights engine (60-day)
│   ├── progress.py       # 30-day vs previous-30-day progress tracker
│   ├── predictions.py    # Tomorrow's readiness forecast + accuracy tracking
│   ├── oura_cache.py     # Cache layer for Oura data (webhook-warmed)
│   ├── apple_health.py   # Apple Health sync (iOS Shortcut or HAE format)
│   ├── nutrition.py      # Nutrition tracking + InBody PDF import
│   ├── training.py       # Training/workout logic + ACWR
│   ├── labs.py           # Lab results + reference ranges
│   ├── challenges.py     # Friend challenges + leaderboard
│   ├── models.py         # Pydantic models
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx                  # Login: Oura (top) → email/pw → Google
│       │   ├── dashboard/page.tsx        # Main dashboard (all tabs + scorecard)
│       │   ├── connect/page.tsx          # Post-login wearables connection screen
│       │   └── auth/callback/page.tsx    # Supabase OAuth redirect handler
│       ├── components/
│       │   ├── AppleHealthTab.tsx        # Metrics tab — AH sync setup + data display
│       │   ├── ChatWidget.tsx            # Coach Al floating chat drawer
│       │   ├── CoachAlAvatar.tsx         # Coach Al caricature
│       │   ├── CoachCard.tsx
│       │   ├── CoachingItem.tsx
│       │   ├── InsightsSection.tsx       # Correlation insight cards
│       │   ├── ProgressSection.tsx       # 30-day progress comparison
│       │   ├── ProfileModal.tsx          # User profile (name/age/sex/goals)
│       │   ├── ScoreRing.tsx
│       │   ├── TrendChart.tsx
│       │   ├── ChallengeTab.tsx
│       │   ├── TrainingTab.tsx
│       │   ├── LabsTab.tsx
│       │   └── GearTab.tsx
│       └── lib/
│           ├── api.ts                    # All API calls + TypeScript types
│           └── supabase.ts              # Supabase JS client + token helpers
├── supabase/
│   └── schema.sql
├── supabase_apple_health.sql
├── supabase_oura_cache.sql
├── supabase_challenges.sql
├── supabase_nutrition.sql
├── supabase_body_comp.sql
├── supabase_readiness_predictions.sql
├── CONTEXT.md
├── DEPLOY.md
└── README.md
```

---

## Scorecard Layout Order (dashboard/page.tsx)

The Scorecard ("coaching") section renders in this order:

1. **Hero card** — Readiness / Sleep / Activity rings + key metrics (HRV, RHR, Steps, Sleep hours, Deep, REM, Temp deviation)
2. **Longevity Score** — 6-component vitality score with grade, biological age delta, component bars, unlock tips, improvement callout
3. **Body Composition** — Weight trend chart, latest InBody breakdown, last 3 entries
4. **Log Weigh-In** — WeightForm (expandable InBody fields)
5. **Coach Al** — Dark green teaser card with quick-start prompt chips → opens chat drawer
6. **Today's Focus** — Short-term coaching items (coaching.short)
7. **Today's Performance** — Live AH steps/calories + today's Oura activity score
8. **Yesterday's Performance** — Full Oura activity for day before anchor
9. **Tomorrow's Forecast** — Readiness prediction with HRV + sleep debt adjustments
10. **30-Day Trends** — Recharts line chart (scores / HRV / sleep detail tabs)
11. **Progress Section** — 30-day vs previous-30-day comparison
12. **This Week / Long-Term Watch** — Mid and long coaching items
13. **Insights** — Pearson correlation cards

---

## Sign-In Page Layout (page.tsx)

1. BackNine logo
2. **Oura Ring** button (primary — green-tinted, at top)
3. Divider "or sign in with email"
4. Email / password card (with Google OAuth button inside)
5. Terms of service note

---

## Authentication

### New auth (Supabase — email/password or Google)
1. User visits `/` → email/password form or Google Sign-In
2. Email/password → `supabase.auth.signInWithPassword()` → JWT stored in `localStorage` as `bn_token`
3. Google → `supabase.auth.signInWithOAuth()` → redirects to `/auth/callback` → stores JWT → `/dashboard`
4. Backend verifies Supabase JWTs via `_verify_supabase_jwt()` using `SUPABASE_JWT_SECRET`
5. User's `user_id` = Supabase UUID (`claims["sub"]`)
6. To connect Oura: `/connect` page → passes `link_user_id=<uuid>` → Oura tokens stored under Supabase UUID

### Legacy auth (Oura-only)
1. "Sign in with Oura Ring" → `/auth/oura` on backend → Oura OAuth flow
2. Backend mints its own JWT with `user_id = oura_<oura_user_id>`
3. Token stored in `localStorage` as `bn_token`

### `_require_session()` in main.py
Accepts both token types via `Authorization: Bearer`:
- Legacy Oura JWT → `_decode_session()`
- Supabase JWT → `_verify_supabase_jwt()`

---

## Key Environment Variables

### Render (backend)
| Variable | Value / Notes |
|----------|---------------|
| `OURA_CLIENT_ID` | `c20aa3fb-cb25-4227-a18e-44177fb3665c` |
| `OURA_CLIENT_SECRET` | See Render dashboard |
| `OURA_REDIRECT_URI` | `https://backnine-hu60.onrender.com/auth/oura/callback` |
| `SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `SUPABASE_SERVICE_KEY` | See Render dashboard |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret |
| `JWT_SECRET` | Legacy Oura JWT signing secret |
| `FRONTEND_URL` | `https://back-nine-six.vercel.app` |
| `BACKEND_URL` | `https://backnine-hu60.onrender.com` |
| `OURA_WEBHOOK_TOKEN` | Any strong random string (webhook verification) |
| `ADMIN_KEY` | Protects `/admin/*` routes |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-…` — powers Coach Al (Claude Haiku) |
| `PYTHON_VERSION` | `3.11.0` ← **critical** — Render defaults to 3.14 which breaks pydantic |
| `ENVIRONMENT` | `production` |

### Vercel (frontend)
| Variable | Value / Notes |
|----------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |

> ⚠️ If `NEXT_PUBLIC_SUPABASE_URL` is missing from Vercel, the app falls back to `placeholder.supabase.co` and shows a DNS error on login. Set both vars in Vercel → Settings → Environment Variables → redeploy.

### Supabase Auth config
- Email provider: enabled
- Google provider: enabled (requires Google Cloud Console OAuth client)
- Site URL: `https://back-nine-six.vercel.app`
- Redirect URLs: `https://back-nine-six.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `wearable_connections` | Oura OAuth tokens per user |
| `oura_daily_cache` | JSONB cache of Oura data by date (warmed by webhooks) |
| `apple_health_keys` | Per-user static API keys for AH sync |
| `apple_health_daily` | Daily Apple Health metrics |
| `user_profiles` | name, age, biological_sex, health_goals |
| `meals` | Nutrition meal logs |
| `weight_entries` | Weight + full InBody body composition logs |
| `nutrition_settings` | Per-user calorie/macro targets + fasting window |
| `nutrition_weight` | Legacy weight log (fallback for body comp) |
| `workouts` | Workout logs |
| `training_settings` | Per-user training preferences |
| `lab_entries` | Blood panel / lab results |
| `challenges` | Friend challenges metadata |
| `challenge_participants` | Who joined + their display name |
| `challenge_progress` | Daily progress per participant |
| `readiness_predictions` | Tomorrow's forecast + actual (for accuracy gamification) |

---

## Oura Data Architecture

### Fetch strategy (cache-first)
1. Oura webhook fires → background task fetches 3 days → stores in `oura_daily_cache`
2. Dashboard checks cache freshness (< 30 min) → serves from cache
3. If stale → live fetch from Oura API → updates cache

### Timezone-safe "today" (`oura_today`)
The Render server runs UTC. After ~8 PM Eastern, server date is one day ahead of user's local date. **Never use `datetime.now().strftime("%Y-%m-%d")` as "today" for Oura data.**

```python
all_oura_dates = sorted(set(list(rm) + list(slm) + list(am)))
oura_today = all_oura_dates[-1] if all_oura_dates else today_str
```

This `oura_today` is passed to `generate_coaching()` and used for AH live data lookups.

### score=0 means ring not worn
Oura returns `score=0` (not `null`) when the ring wasn't worn. Treat `score=0` as no data:
```python
def _scored(d: str, mapping: dict) -> bool:
    s = mapping.get(d, {}).get("score")
    return bool(s and s > 0)
```

### Hero ring fallback
When today's readiness/sleep score is null/0 (ring not worn overnight), rings fall back to the most recent non-zero score from the 30-day `trend` array and display "last" sublabel in a dimmed style.

### Bedtime date offset (critical)
- `/daily_sleep` scores → keyed by **wake date** (Monday morning → "Monday")
- `/sleep` session detail → keyed by **bedtime date** (Sunday night → "Sunday")
- All `smm` lookups: try `anchor` first, then `anchor - 1 day`

### Session aggregation
`parse_oura_data()` sums qualifying sessions per day:
- Min length: 5 min (300s)
- Excluded types: `rest`, `late_nap`, `deleted`
- HRV: weighted average by session length; RHR: minimum across sessions

---

## Oura Webhooks

Subscriptions expire ~90 days after registration. **Expiry: ~2026-07-16.** Re-register:
```bash
curl -X POST https://backnine-hu60.onrender.com/admin/oura/register-webhook \
  -H "X-Admin-Key: <ADMIN_KEY>"
```

---

## Apple Health Sync

**Current approach: iOS Shortcuts (free)**
- Each user gets a personal API key: `GET /api/apple-health/key`
- Sync endpoint: `POST /api/apple-health/sync` with `X-AH-Key: <key>` header
- Backend accepts both flat JSON (Shortcuts) and HAE nested format
- Setup instructions shown in the Metrics tab (AppleHealthTab.tsx)

**Target devices for full Longevity Score:**
- Apple Watch → VO2 Max (required for longevity score component)
- InBody scale → body fat %, lean mass, muscle mass (syncs to Apple Health)
- Withings BP monitor → blood pressure (syncs to Apple Health)

**Commercialization plan:** Build a native iOS app (React Native / Expo) with HealthKit permissions for seamless automatic sync. Terra API and Vital API were evaluated but both require paid plans. Apple HealthKit for Web (iOS 18) is another option to investigate.

**Apple Health SQL (run in Supabase if columns missing):**
```sql
alter table public.apple_health_daily
  add column if not exists body_fat_percentage       numeric(5,2),
  add column if not exists lean_body_mass_kg         numeric(6,2),
  add column if not exists skeletal_muscle_mass_kg   numeric(6,2),
  add column if not exists bmi                       numeric(5,2),
  add column if not exists blood_pressure_systolic   integer,
  add column if not exists blood_pressure_diastolic  integer,
  add column if not exists spo2                      numeric(5,2),
  add column if not exists visceral_fat_rating       numeric(5,2),
  add column if not exists waist_circumference_cm    numeric(6,2);
```

---

## Longevity Score (`longevity.py`)

6 components scored against age/sex-adjusted norms:

| Component | Source | Max pts |
|-----------|---------|---------|
| HRV | Oura sleep model (`smm`) | 25 |
| Resting Heart Rate | Oura sleep model | 20 |
| VO2 Max | Apple Health | 20 |
| Sleep (7-day avg) | Oura sleep model | 15 |
| Body Fat % | Apple Health (InBody) | 10 |
| Daily Steps (7-day avg) | Oura activity | 10 |

- Requires `user_profiles` age + biological_sex for accurate norms
- VO2 Max and Body Fat % show as "Unlock more points" if Apple Health not synced
- Biological age delta calculated from composite score deviation

---

## Coach Al (`chat.py`)

- Model: `claude-haiku-4-5-20251001` (cheapest Claude model, ~$0.001–0.002/message)
- System prompt includes: user profile, today's metrics, 7-day averages, longevity score, active coaching items
- Keeps last 20 conversation turns in context
- Requires `ANTHROPIC_API_KEY` in Render env vars
- Cost at scale: ~$15–20/month per 1,000 active users sending 10 messages/month

---

## Coaching Engine (`coaching.py`)

Generates short (today), mid (1–2 weeks), long (chronic) coaching items.
Key signals: sleep debt vs `sleep_need`, HRV vs 30-day baseline, bedtime consistency, training load (ACWR), lab flags.
Uses `oura_today` parameter (timezone-safe) instead of server UTC clock.
`today_rdy = t_rdy.get("score") or None` — avoids false alarms when ring not worn (score=0).

---

## Training Load (ACWR)

Acute:Chronic Workload Ratio using active calories as load proxy:
- Acute = 7-day avg active cal
- Chronic = 28-day avg active cal
- Zones: <0.8 under-trained | 0.8–1.3 optimal | 1.3–1.5 high | >1.5 overreaching

---

## Body Composition Tracking

- Logs stored in `weight_entries` table via `POST /api/nutrition/weight`
- Full InBody fields supported: body fat %, lean mass, muscle mass, visceral fat, ECW ratio, BMR, InBody score, etc.
- **Body Composition card and Log Weigh-In are on the Scorecard tab** (not Nutrition)
- Weight entries pre-loaded on dashboard init so card is ready without switching tabs

---

## Known Issues / TODO

- **Google OAuth** — code wired up but Google Cloud Console OAuth client not yet configured in Supabase
- **Render cold starts** — free tier spins down after 15 min; first load takes 30–60s (upgrade to paid Render plan for production)
- **Oura webhook expiry** — subscriptions expire ~2026-07-16, must re-register
- **Apple Health native sync** — iOS Shortcut works for beta; need native iOS app for commercial launch
- **Next.js** — upgrade to latest 14.x+ to resolve security vulnerability (`next@14.2.29`)

---

## Commercialization Roadmap

1. **Now** — Beta with Oura Ring users (Oura covers HRV, RHR, sleep, steps, activity)
2. **Next** — Native iOS companion app (Expo + react-native-health) for seamless HealthKit sync
3. **Future** — Android support, Garmin/WHOOP integration, subscription pricing

---

## Quick Deploy

```bash
cd ~/Documents/BackNine
git add -A
git commit -m "your message"
git push
# Vercel auto-deploys frontend on push to main
# Render auto-deploys backend on push to main
```

## Debug Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic health check |
| `GET /debug-sb` | Verify Supabase connection + key prefix |
| `GET /api/debug/sleep` | Raw Oura sleep data — diagnose date/anchor issues |
| `GET /docs` | FastAPI Swagger UI (disabled in production) |
