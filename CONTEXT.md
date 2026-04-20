# BackNine — Project Context

A personal health intelligence dashboard that aggregates wearable data (Oura Ring, Apple Health) with manual tracking (nutrition, training, labs) and surfaces actionable coaching, insights, and progress tracking. Built with Next.js + FastAPI + Supabase.

---

## Architecture

```
User's browser (Vercel)
  └── fetch with Authorization: Bearer <token>
        └── FastAPI backend (Render)
              ├── Oura API (wearable data — live + webhook cache)
              ├── Supabase Auth (email/password + Google OAuth)
              └── Supabase Postgres
                    ├── wearable_connections  (Oura tokens)
                    ├── oura_daily_cache      (webhook cache)
                    ├── apple_health_keys     (AH API keys)
                    ├── apple_health_daily    (AH synced data)
                    ├── meals / nutrition_settings / weight_entries
                    ├── workouts / training_settings
                    ├── lab_entries
                    └── challenges / challenge_participants / challenge_progress
```

**Frontend:** Next.js 14 App Router, Tailwind CSS, deployed on **Vercel**
**Backend:** FastAPI (Python 3.11), deployed on **Render**
**Database:** Supabase (Postgres)
**Auth:** Dual — Supabase Auth (email/password + Google OAuth) OR legacy Oura-only OAuth

---

## Live URLs

| Service | URL |
|---------|-----|
| Frontend (Vercel) | `https://back-nine-six.vercel.app` (+ any Vercel preview URLs) |
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
│   ├── insights.py       # Cross-source correlation insights engine
│   ├── progress.py       # 30-day vs previous-30-day progress tracker
│   ├── oura_cache.py     # Cache layer for Oura data (webhook-warmed)
│   ├── nutrition.py      # Nutrition tracking
│   ├── training.py       # Training/workout logic
│   ├── labs.py           # Lab results + InBody PDF import
│   ├── challenges.py     # Friend challenges
│   ├── apple_health.py   # Apple Health sync (iOS Shortcut / HAE)
│   ├── models.py         # Pydantic models
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx              # Login page (email/pw + Google + Oura)
│       │   ├── dashboard/page.tsx    # Main dashboard (all tabs)
│       │   ├── connect/page.tsx      # Post-login wearables connection screen
│       │   └── auth/callback/page.tsx # Supabase OAuth redirect handler
│       ├── components/
│       │   ├── InsightsSection.tsx   # Correlation insights cards
│       │   ├── ProgressSection.tsx   # 30-day progress comparison
│       │   ├── ChallengeTab.tsx      # Full challenge calendar + leaderboard
│       │   ├── TrainingTab.tsx
│       │   ├── LabsTab.tsx
│       │   ├── AppleHealthTab.tsx
│       │   └── GearTab.tsx
│       └── lib/
│           ├── api.ts                # All API calls, token storage
│           └── supabase.ts           # Supabase JS client + token helpers
├── supabase/
│   └── schema.sql                    # Core DB schema
├── supabase_apple_health.sql         # apple_health_keys + apple_health_daily
├── supabase_oura_cache.sql           # oura_daily_cache table
├── supabase_challenges.sql
├── supabase_nutrition.sql
└── CONTEXT.md
```

---

## Authentication

### New auth (Supabase — email/password or Google)
1. User visits `/` → login page with email/password form, Google Sign-In button, Oura direct connect
2. Email/password → `supabase.auth.signInWithPassword()` → JWT stored in `localStorage` as `bn_token`
3. Google → `supabase.auth.signInWithOAuth()` → redirects to `/auth/callback` → stores JWT → `/dashboard`
4. Backend verifies Supabase JWTs via `_verify_supabase_jwt()` using `SUPABASE_JWT_SECRET`
5. User's `user_id` = their Supabase UUID (`claims["sub"]`)
6. To connect Oura: `/connect` page → "Connect Oura Ring" button passes `link_user_id=<uuid>` to backend → Oura tokens stored under Supabase UUID in `wearable_connections`

### Legacy auth (Oura-only users)
1. User clicks "Sign in with Oura Ring" on login page → `/auth/oura` on backend
2. Oura OAuth flow → backend mints its own JWT containing `user_id = oura_<oura_user_id>`
3. Token stored in `localStorage` as `bn_token`

### `_require_session()` in main.py
Accepts both token types in `Authorization: Bearer` header:
- Legacy Oura JWT → `_decode_session()` → extracts `user_id`
- Supabase JWT → `_verify_supabase_jwt()` → returns `{"user_id": sub, "provider": "supabase"}`

---

## Key Environment Variables

### Render (backend)
| Variable | Notes |
|----------|-------|
| `OURA_CLIENT_ID` | `c20aa3fb-cb25-4227-a18e-44177fb3665c` |
| `OURA_CLIENT_SECRET` | See Render dashboard |
| `OURA_REDIRECT_URI` | `https://backnine-hu60.onrender.com/auth/oura/callback` |
| `SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `SUPABASE_SERVICE_KEY` | See Render dashboard |
| `SUPABASE_JWT_SECRET` | From Supabase → Settings → API → JWT Secret |
| `JWT_SECRET` | Legacy Oura JWT signing secret |
| `FRONTEND_URL` | `https://back-nine-six.vercel.app` |
| `BACKEND_URL` | `https://backnine-hu60.onrender.com` |
| `OURA_WEBHOOK_TOKEN` | Any strong random string — used for Oura webhook verification |
| `ADMIN_KEY` | Protects `/admin/*` routes |
| `PYTHON_VERSION` | `3.11.0` ← critical — Render defaults to 3.14 which breaks pydantic |
| `ENVIRONMENT` | `production` |

### Vercel (frontend)
| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → Settings → API → anon public |

### Supabase Auth config (via Supabase dashboard)
- Email provider: enabled
- Google provider: enabled (needs Google Cloud Console OAuth Client ID + Secret)
- Site URL: `https://back-nine-six.vercel.app`
- Redirect URLs: `https://back-nine-six.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `wearable_connections` | Oura OAuth tokens per user (keyed by user_id — Oura or Supabase UUID) |
| `oura_daily_cache` | JSONB cache of Oura data by date, warmed by webhooks |
| `apple_health_keys` | Per-user static API keys for Apple Health sync |
| `apple_health_daily` | Daily Apple Health metrics synced from iOS |
| `meals` | Nutrition meal logs |
| `weight_entries` | Weight / body composition logs |
| `nutrition_settings` | Per-user calorie/macro targets and fasting window |
| `workouts` | Workout logs |
| `training_settings` | Per-user training preferences |
| `lab_entries` | Blood panel / lab results |
| `challenges` | Friend challenges metadata |
| `challenge_participants` | Who joined each challenge + daily progress |
| `challenge_progress` | Daily progress entries per challenge per participant |

---

## Dashboard Tabs

| Tab | Contents |
|-----|---------|
| **Today** | Readiness/Sleep/Activity scores, HRV/RHR/Sleep/Steps/Deep/REM/Temp metrics, coach cards, 30-day trends chart. Shows "Connect Oura" banner when `has_oura=false` |
| **Coach** | Tomorrow's Readiness forecast card, 30-day Progress section, Short/mid/long coaching items, Insights (cross-source correlations) |
| **Nutrition** | Calorie ring, macro bars, meal logging, weight log, body comp, fasting clock |
| **Training** | Training load (ACWR), workout log, weekly plan, stretch routines |
| **Labs** | Blood panel tracking, PDF import (InBody scans), trend charts |
| **Compete** | Full challenge calendar with per-day cell coloring, leaderboard |
| **Metrics** | Apple Health sync setup + data display |
| **Gear** | Supplement / gear tracking |

---

## Oura Data Architecture

### Fetch strategy (cache-first)
1. Webhook fires when Oura has new data → background task fetches 3 days → stores in `oura_daily_cache`
2. Dashboard load checks if cache is fresh (< 30 min) → serves from cache
3. If stale → live fetch from Oura API → updates cache

### Critical date offset bug (fixed)
Oura's `/sleep` (session detail) endpoint uses **bedtime date** (Sunday night = "Sunday").
Oura's `/daily_sleep` (scores) endpoint uses **wake date** (wake Monday morning = "Monday").

All `smm` (sleep model) lookups must try `anchor` first, then `anchor - 1 day`:
```python
anchor_bedtime = (datetime.strptime(anchor, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
t_sm = smm.get(anchor) or smm.get(anchor_bedtime) or {}
```
This applies in `main.py` (dashboard endpoint + `_build_trend()`), `coaching.py` (`_smm_for_day()` helper), `insights.py`, and `progress.py`.

### Session aggregation
Oura can split one night into multiple sessions (ring removed, two sleep periods, etc.).
`parse_oura_data()` in `oura.py` sums all qualifying sessions per day:
- Minimum session length: 5 minutes (300s) — filters true blips
- Excluded types: `rest`, `late_nap`, `deleted`
- Duration fields (total, deep, rem): summed across sessions
- HRV: weighted average by session length
- RHR: minimum across sessions

---

## Oura Webhooks

Registered via `POST /admin/oura/register-webhook` (requires `X-Admin-Key` header).
Subscriptions expire after 90 days (~2026-07-16). Re-register before expiry:
```bash
curl -X POST https://backnine-hu60.onrender.com/admin/oura/register-webhook \
  -H "X-Admin-Key: <ADMIN_KEY>"
```

Webhook endpoints:
- `GET /webhooks/oura?challenge=<x>` → returns `{"challenge": x}` for verification
- `POST /webhooks/oura` → receives events → background task refreshes cache

---

## Apple Health Integration

Users sync via **Health Auto Export** iOS app (or custom iOS Shortcut):
- Each user gets a personal API key: `GET /api/apple-health/key` → `{"api_key": "ah_..."}`
- Sync endpoint: `POST /api/apple-health/sync` with `X-AH-Key: <key>` header
- Accepts both our flat JSON format and Health Auto Export's nested format
- HAE config: URL = `https://backnine-hu60.onrender.com/api/apple-health/sync`, Header = `X-AH-Key`

SQL to run in Supabase if columns are missing:
```sql
alter table public.apple_health_daily
  add column if not exists body_fat_percentage  numeric(5,2),
  add column if not exists lean_body_mass_kg    numeric(6,2),
  add column if not exists skeletal_muscle_mass_kg numeric(6,2),
  add column if not exists bmi                  numeric(5,2);
```

---

## Coaching & Insights Engine

### Coaching (`coaching.py`)
Generates short (actionable today), mid (next 1-2 weeks), and long-term (chronic/labs) items.
Key calculations: sleep target from Oura's personalised `sleep_need`, sleep debt, HRV vs 30-day baseline, bedtime consistency, training load, lab-based flags.
All `smm` lookups use `_smm_for_day()` helper to handle the bedtime-date offset.

### Insights (`insights.py`)
Pearson correlation engine. Runs 6 cross-source checks over 60 days:
- HRV trend vs sleep hours
- Sleep hours vs next-day activity score
- High calorie days vs next-day readiness
- Protein intake vs HRV
- Daily steps vs readiness
- Calorie deficit vs weight change

### Progress (`progress.py`)
Compares last 30 days vs previous 30 days for 7 metrics: readiness, sleep score, HRV, activity score, steps, training load (ACWR), protein. Shows delta, personal best, and on-target rate.

---

## Known Issues / TODO

- **Google OAuth not yet activated** — code is wired up but Google Cloud Console OAuth client and Supabase Google provider still need to be configured
- **Apple Health data not importing** — tables need `body_fat_percentage` etc. columns added (SQL above), and user needs Health Auto Export configured
- **Render cold starts** — free tier spins down after 15 min inactivity; first load takes 30–60s
- **Oura webhook expiry** — subscriptions expire 2026-07-16, must re-register

---

## Quick Deploy

```bash
cd ~/Documents/BackNine
git add -A
git commit -m "your message"
git push
# Vercel auto-deploys frontend, Render auto-deploys backend
```
