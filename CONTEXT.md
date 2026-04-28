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
                    ├── wearable_connections      (Oura tokens + oura_user_id)
                    ├── oura_daily_cache          (webhook cache)
                    ├── apple_health_keys         (AH API keys)
                    ├── apple_health_daily        (AH synced data)
                    ├── user_profiles             (name, age, sex, height, vo2_max, goals)
                    ├── meals / nutrition_settings
                    ├── nutrition_weight          (weight/InBody logs)
                    ├── workouts / training_settings
                    ├── lab_entries
                    ├── challenges / challenge_participants / challenge_progress
                    ├── challenge_messages        (per-challenge chat)
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
│   ├── oura.py           # Oura OAuth + parse_oura_data() + parse_oura_vo2_max()
│   ├── coaching.py       # Coaching engine (short/mid/long-term items)
│   ├── chat.py           # Coach Al — Anthropic Claude chat with health context
│   ├── longevity.py      # Longevity Score (6 metrics: HRV, RHR, VO2, sleep, body fat, steps)
│   ├── insights.py       # Pearson correlation insights engine (60-day)
│   ├── progress.py       # 30-day vs previous-30-day progress tracker
│   ├── predictions.py    # Tomorrow's readiness forecast + accuracy tracking
│   ├── oura_cache.py     # Cache layer for Oura data (webhook-warmed)
│   ├── apple_health.py   # Apple Health sync (iOS Shortcut or HAE format)
│   ├── nutrition.py      # Nutrition tracking + InBody PDF import
│   ├── training.py       # Training/workout logic
│   ├── labs.py           # Lab results + reference ranges
│   ├── challenges.py     # Friend challenges + leaderboard + chat
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
│       │   ├── AppleHealthTab.tsx
│       │   ├── ChatWidget.tsx            # Coach Al floating chat drawer
│       │   ├── CoachAlAvatar.tsx
│       │   ├── ChallengeTab.tsx          # Competitions tab (with per-challenge chat)
│       │   ├── InsightsSection.tsx
│       │   ├── ProgressSection.tsx       # 30-day progress (window_days=30 denominator)
│       │   ├── ProfileModal.tsx
│       │   ├── TrainingTab.tsx
│       │   ├── LabsTab.tsx
│       │   └── GearTab.tsx
│       └── lib/
│           ├── api.ts                    # All API calls + TypeScript types
│           └── supabase.ts              # Supabase JS client + token helpers
├── supabase_*.sql                        # Migration files (run in order if setting up fresh)
├── CONTEXT.md
├── DEPLOY.md
└── README.md
```

---

## Scorecard Layout Order (dashboard/page.tsx)

The Scorecard ("coaching") section has **always-visible** items at the top and **collapsible sections** below. The `CollapsibleSection` component wraps secondary content — collapsed by default, with a summary badge visible when closed.

### Always visible
1. **Hero card** — Readiness / Sleep / Activity rings + key metrics
2. **Longevity Score** — 6-component vitality score, grade, bio age delta, component bars, VO2 Max inline edit
3. **Coach Al** — Dark green teaser card with quick-start prompt chips → opens chat drawer
4. **Today's Focus** — Short-term coaching items
5. **Today's Performance** — Live AH steps/calories + today's Oura activity score

### Collapsible (closed by default)
6. ⚖️ **Body & Weight** — Body Composition chart + Log Weigh-In form (badge shows current weight)
7. 📅 **Yesterday's Performance** — Full Oura activity for prior day
8. 🔮 **Tomorrow's Forecast** — Readiness prediction (badge shows score + label when collapsed)
9. 📈 **Trends & Progress** — 30-Day Trends chart + Progress Section
10. 💡 **Coaching Insights** — This Week / Long-Term Watch + InsightsSection

---

## Sign-In Page Layout (page.tsx)

1. BackNine logo
2. **Oura Ring** button (primary — green-tinted, at top)
3. Divider "or sign in with email"
4. Email / password card (with Google OAuth button inside)
5. Terms of service note

---

## Authentication

### Supabase auth (email/password or Google)
1. Email/password → `supabase.auth.signInWithPassword()` → JWT stored as `bn_token`
2. Google → `supabase.auth.signInWithOAuth()` → `/auth/callback` → JWT stored → `/dashboard`
3. Backend verifies JWTs via `_verify_supabase_jwt()` using `SUPABASE_JWT_SECRET`
4. `user_id` = Supabase UUID
5. To connect Oura: `/connect` page → `link_user_id=<uuid>` → Oura tokens stored under UUID

### Legacy auth (Oura-only)
1. "Sign in with Oura Ring" → Oura OAuth → backend mints JWT with `user_id = oura_<oura_user_id>`
2. Token stored as `bn_token`
3. `oura_user_id` stored in `wearable_connections` to allow cross-device identity resolution

### Cross-device identity
When an Oura-native user logs in from a new device, `oura_auth_callback` looks up `oura_user_id` in `wearable_connections` to find the canonical UUID (if the user previously linked via Supabase). This prevents duplicate user_ids causing data splits.

> ⚠️ **All `user_id` columns in all tables must be `text` (not `uuid`).** Oura-native user IDs are `oura_<string>`, which are not valid UUIDs and will fail FK constraints silently.

---

## Key Environment Variables

### Render (backend)
| Variable | Notes |
|----------|-------|
| `OURA_CLIENT_ID` | `c20aa3fb-cb25-4227-a18e-44177fb3665c` |
| `OURA_CLIENT_SECRET` | Render dashboard |
| `OURA_REDIRECT_URI` | `https://backnine-hu60.onrender.com/auth/oura/callback` |
| `SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Render dashboard |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret |
| `JWT_SECRET` | Legacy Oura JWT signing secret |
| `FRONTEND_URL` | `https://back-nine-six.vercel.app` |
| `ANTHROPIC_API_KEY` | Powers Coach Al (Claude Haiku) |
| `PYTHON_VERSION` | `3.11.0` ← **critical** — Render defaults break pydantic |
| `ENVIRONMENT` | `production` |

### Vercel (frontend)
| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |

> ⚠️ If `NEXT_PUBLIC_SUPABASE_URL` is missing from Vercel, the login page shows a `placeholder.supabase.co` DNS error.

---

## Supabase Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| `wearable_connections` | Oura OAuth tokens | `user_id text`, `oura_user_id text` column required |
| `oura_daily_cache` | JSONB Oura data by date | Warmed by webhooks |
| `apple_health_keys` | Per-user AH sync API keys | |
| `apple_health_daily` | Daily AH metrics | See extended columns SQL below |
| `user_profiles` | name, age, sex, height_cm, vo2_max, goals | `user_id text` PK |
| `nutrition_meals` | Meal logs | |
| `nutrition_settings` | Calorie/macro targets + fasting window | |
| `nutrition_weight` | Weight + InBody body composition logs | |
| `workouts` | Workout logs | |
| `training_settings` | Per-user training preferences | |
| `lab_entries` | Blood panel / lab results | |
| `challenges` | Friend challenges metadata | |
| `challenge_participants` | Who joined + display name | |
| `challenge_progress` | Daily progress per participant | |
| `challenge_messages` | Per-challenge chat messages | `user_id text`, 500 char limit |
| `readiness_predictions` | Tomorrow's forecast + actual score | `user_id text` — NOT uuid |

### Required SQL migrations (run if setting up fresh or columns missing)

```sql
-- user_profiles: add columns added after initial migration
alter table public.user_profiles
  add column if not exists name        text,
  add column if not exists height_cm   numeric(5,1),
  add column if not exists vo2_max     numeric(5,1);

-- wearable_connections: cross-device identity
alter table public.wearable_connections
  add column if not exists oura_user_id text;

-- challenge_messages table
create table if not exists public.challenge_messages (
  id            uuid        default gen_random_uuid() primary key,
  challenge_id  text        not null,
  user_id       text        not null,
  display_name  text        not null,
  text          text        not null check (char_length(text) <= 500),
  created_at    timestamptz default now()
);
create index if not exists on public.challenge_messages (challenge_id, created_at desc);

-- readiness_predictions: must use text user_id (Oura-native users are not UUIDs)
-- If table was created with uuid user_id, drop and recreate:
drop table if exists public.readiness_predictions;
create table public.readiness_predictions (
  id              uuid    default gen_random_uuid() primary key,
  user_id         text    not null,
  target_date     date    not null,
  predicted_score integer not null,
  actual_score    integer,
  created_at      timestamptz default now(),
  unique(user_id, target_date)
);
create index on public.readiness_predictions (user_id, target_date desc);

-- Apple Health extended columns
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

## Oura Data Architecture

### Fetch strategy (cache-first)
1. Oura webhook fires → background task fetches 3 days → stores in `oura_daily_cache`
2. Dashboard checks cache freshness (< 30 min) → serves from cache
3. If stale → live fetch from Oura API → updates cache

### Oura API endpoints fetched
- `daily_readiness` (core)
- `daily_sleep` (core)
- `daily_activity` (core)
- `sleep` session detail (optional)
- `daily_cardiovascular_age` (optional) → source of Oura VO2 Max estimate

### Timezone-safe "today" (`oura_today`)
The Render server runs UTC. After ~8 PM Eastern, server date is one day ahead of the user's local date. **Never use `datetime.now().strftime("%Y-%m-%d")` as "today" for Oura data.**

```python
all_oura_dates = sorted(set(list(rm) + list(slm) + list(am)))
oura_today = all_oura_dates[-1] if all_oura_dates else today_str
```

`oura_today` is used for: coaching generation, prediction target dates, AH live data lookups.

### score=0 means ring not worn
Oura returns `score=0` (not `null`) when the ring wasn't worn. Treat `score=0` as no data:
```python
def _scored(d: str, mapping: dict) -> bool:
    s = mapping.get(d, {}).get("score")
    return bool(s and s > 0)
```

### Bedtime date offset (critical)
- `/daily_sleep` scores → keyed by **wake date**
- `/sleep` session detail → keyed by **bedtime date** (one day earlier)
- All `smm` lookups: try `anchor` first, then `anchor - 1 day`

---

## Oura Webhooks

Subscriptions expire ~90 days after registration. **Current expiry: ~2026-07-16.** Re-register:
```bash
curl -X POST https://backnine-hu60.onrender.com/admin/oura/register-webhook \
  -H "X-Admin-Key: <ADMIN_KEY>"
```

---

## Longevity Score (`longevity.py`)

6 components scored against age/sex-adjusted norms:

| Component | Source | Max pts |
|-----------|---------|---------|
| HRV | Oura sleep model (`smm`) | 25 |
| Resting Heart Rate | Oura sleep model | 20 |
| VO2 Max | AH → Oura cardiovascular_age → user_profiles.vo2_max | 20 |
| Sleep (7-day avg) | Oura sleep model | 15 |
| Body Fat % | AH → nutrition_weight entries | 10 |
| Daily Steps (7-day avg) | Oura activity | 10 |

### VO2 Max fallback chain
```python
_vo2 = (apple_health_today.get("vo2_max")          # 1. Apple Health
        or oura_vo2_max                             # 2. Oura cardiovascular_age API
        or profile.get("vo2_max"))                  # 3. Manually entered in profile
```
Manual entry: inline input in the Longevity Score card "Unlock more points" section. Once VO2 is present, an **edit** link appears on the component row for updates.

### Body Fat fallback chain
```python
_body_fat = (apple_health_today.get("body_fat_percentage")   # 1. Apple Health
             or apple_health_summary.get("latest_body_fat_pct")  # 2. AH most recent
             or most_recent_weight_entry.body_fat_pct)           # 3. Body Composition card log
```

### `get_summary()` key names (apple_health.py)
The correct keys are `"today"` and `"averages"` — **not** `"most_recent"`. Infrequent metrics (VO2, body fat, weight) use `latest()` inside `"today"` and are also exposed as `"latest_body_fat_pct"`, `"latest_weight_kg"`, etc. at the top level.

---

## Tomorrow's Forecast / Prediction Tracking

- Each dashboard load saves a prediction for `oura_tomorrow` (timezone-safe, not UTC server date)
- `fill_actuals()` backfills past predictions with real Oura readiness scores on each load
- Gamification display: streak 🔥, accuracy %, bar chart — unlocks after **3 resolved predictions**
- Was silently failing until `readiness_predictions.user_id` was changed from `uuid` to `text`

---

## Training Load (ACWR)

Acute:Chronic Workload Ratio using active calories as load proxy:
- Acute = 7-day avg active cal
- Chronic = 28-day avg active cal
- Zones: <0.8 under-trained | 0.8–1.3 optimal | 1.3–1.5 high | >1.5 overreaching

Dashboard card shows: ACWR ratio, colored zone label (`Optimal: 0.8–1.3` reference visible), 7-day avg, 28-day avg, and a **Status** tile (✓ In zone / ↑ Too low / ⚠ High / ⛔ Over).

---

## Progress Section (`progress.py`)

Compares last 30 calendar days vs previous 30 days across: Readiness, Sleep Score, HRV, Activity Score, Steps, Optimal Training Load, Protein Target.

### 22/30 denominator fix
`period_days` = days with ring data (e.g. 22). `window_days` = 30 (calendar window, always fixed). The `OnTargetBar` component uses `window_days` as denominator so the display is honest: "22/30 days" not "22/22 days".

---

## Competitions / Challenges (`challenges.py`)

### Challenge types
`steps`, `calories`, `protein`, `custom`

### Auto-sync from Oura
`_auto_sync_oura_steps()` runs on every `my_challenges`, `get_challenge`, `create_challenge`, and `join_challenge` call. It walks the challenge date range and upserts Oura step data into `challenge_progress` — no manual entry needed for steps challenges.

### Challenge chat
Each challenge card has a **💬 Chat** section at the bottom:
- Messages stored in `challenge_messages` table
- Quick reaction chips: 🔥 💪 😤 🐌
- Free text input (200 char display limit, 500 char DB limit)
- Polls for new messages every 8 seconds while open
- Only participants can post (verified server-side)

---

## Apple Health Sync

**Current approach: iOS Shortcuts (free)**
- Each user gets a personal API key: `GET /api/apple-health/key`
- Sync endpoint: `POST /api/apple-health/sync` with `X-AH-Key: <key>` header
- Accepts flat JSON (Shortcuts) and HAE nested format
- Setup shown in Metrics tab

**Target devices for full Longevity Score:**
- Apple Watch → VO2 Max, HRV, steps
- InBody scale → body fat %, lean mass (syncs to Apple Health)
- Withings BP monitor → blood pressure (syncs to Apple Health)

**Commercialization plan:** Native iOS app (Expo + react-native-health) for seamless HealthKit. Terra API and Vital API evaluated but both require paid plans.

---

## Coach Al (`chat.py`)

- Model: `claude-haiku-4-5-20251001`
- Context includes: user profile, today's metrics, 7-day averages, longevity score, active coaching items
- Keeps last 20 conversation turns
- Cost at scale: ~$15–20/month per 1,000 active users (10 messages/month each)

---

## Body Composition Tracking

- Logs stored in `nutrition_weight` table via `POST /api/nutrition/weight`
- Full InBody fields: body fat %, lean mass, muscle mass, visceral fat, ECW ratio, BMR, InBody score, etc.
- **Located on Scorecard tab** in the collapsible ⚖️ Body & Weight section
- Weight entries pre-loaded on dashboard init (separate `api.weightEntries()` call in `useEffect`)
- Most recent entry with `body_fat_pct` auto-feeds the Longevity Score body fat component

---

## Known Issues / TODO

- **Google OAuth** — code complete but Google Cloud Console OAuth client not configured in Supabase
- **Render cold starts** — free tier spins down after 15 min; first load takes 30–60s (upgrade for production)
- **Oura webhook expiry** — ~2026-07-16, must re-register
- **Apple Health native sync** — iOS Shortcut works for beta; native iOS app needed for commercial launch
- **Next.js security** — upgrade to latest 14.x+ (`next@14.2.29` has known vulnerability)

---

## Commercialization Roadmap

1. **Now** — Beta with Oura Ring users (covers HRV, RHR, sleep, steps, activity automatically)
2. **Next** — Native iOS companion app (Expo + react-native-health) for HealthKit sync
3. **Future** — Android, Garmin/WHOOP integration, subscription pricing

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
| `GET /debug-sb` | Verify Supabase connection |
| `GET /api/debug/sleep` | Raw Oura sleep data |
| `GET /docs` | FastAPI Swagger UI (disabled in production) |
