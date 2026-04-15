# BackNine — Project Context

A personal health intelligence dashboard that pulls data from wearables (currently Oura Ring) and surfaces readiness, sleep, activity, nutrition, training, and lab tracking in one place. Built as a web app with a Python/FastAPI backend and a Next.js frontend.

---

## Architecture

```
User's browser (Netlify)
  └── fetch with Authorization: Bearer <jwt>
        └── FastAPI backend (Render)
              ├── Oura API (wearable data)
              └── Supabase (nutrition, training, labs, challenges)
```

**Frontend:** Next.js 14 App Router, Tailwind CSS, deployed on Netlify  
**Backend:** FastAPI (Python 3.11), deployed on Render (free tier)  
**Database:** Supabase (Postgres) — stores user nutrition logs, workouts, lab entries, challenges  
**Auth:** Oura OAuth 2.0 → JWT session token stored in browser `localStorage`, sent as `Authorization: Bearer` header on every API call  

---

## Live URLs

| Service | URL |
|---------|-----|
| Frontend (Netlify) | `https://enchanting-tanuki-2c4ede.netlify.app` |
| Backend (Render) | `https://backnine-hu60.onrender.com` |
| Backend health check | `https://backnine-hu60.onrender.com/health` |
| Supabase project | `https://xazmwpozsmbrqoulizyn.supabase.co` |

---

## Repository Structure

```
BackNine/
├── backend/
│   ├── main.py          # FastAPI app, all routes, JWT session logic
│   ├── oura.py          # Oura API client (OAuth, data fetching, parsing)
│   ├── coaching.py      # Generates coaching cards and recommendations
│   ├── nutrition.py     # Nutrition tracking logic
│   ├── training.py      # Training/workout logic
│   ├── labs.py          # Lab results tracking, PDF import
│   ├── challenges.py    # Friend challenges via Supabase
│   ├── models.py        # Pydantic models
│   ├── requirements.txt
│   └── .env             # Local dev only — never committed to git
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Home/landing page
│   │   │   ├── dashboard/page.tsx # Main dashboard (all tabs)
│   │   │   └── connect/page.tsx   # OAuth connect page
│   │   ├── components/
│   │   │   ├── LabsTab.tsx
│   │   │   ├── ChallengeTab.tsx
│   │   │   └── TrainingTab.tsx
│   │   └── lib/
│   │       └── api.ts             # All API calls, token storage
│   ├── next.config.js
│   └── netlify.toml (at repo root)
├── supabase/
│   └── schema.sql       # Full DB schema
├── supabase_challenges.sql
├── netlify.toml         # Netlify build config
└── DEPLOY.md            # Step-by-step deployment guide
```

---

## Authentication Flow

1. User clicks "Connect Oura Ring" → hits `https://backnine-hu60.onrender.com/auth/oura`
2. Backend redirects to Oura's OAuth consent page
3. User approves → Oura redirects to `https://backnine-hu60.onrender.com/auth/oura/callback`
4. Backend exchanges code for tokens, creates a signed JWT containing the session
5. Backend redirects to `https://enchanting-tanuki-2c4ede.netlify.app/dashboard?token=<jwt>`
6. Frontend (`api.ts`) reads token from URL, stores in `localStorage`, strips it from URL
7. All subsequent API calls include `Authorization: Bearer <jwt>` header
8. Backend reads session from either cookie OR Authorization header (supports both)

**Why this approach:** Frontend (Netlify) and backend (Render) are on different domains. Cross-site cookies are blocked by modern browsers even with `SameSite=None`, so the token is passed via URL param and stored in `localStorage` instead.

**User identity:** Each user's ID is `oura_<oura_user_id>` — stable and permanent across sessions.

---

## Key Environment Variables

### Render (backend)
| Variable | Value |
|----------|-------|
| `OURA_CLIENT_ID` | `c20aa3fb-cb25-4227-a18e-44177fb3665c` |
| `OURA_CLIENT_SECRET` | *(see `.env` file or Render dashboard)* |
| `OURA_REDIRECT_URI` | `https://backnine-hu60.onrender.com/auth/oura/callback` |
| `SUPABASE_URL` | `https://xazmwpozsmbrqoulizyn.supabase.co` |
| `SUPABASE_ANON_KEY` | *(see `.env`)* |
| `SUPABASE_SERVICE_KEY` | *(see `.env`)* |
| `JWT_SECRET` | *(see `.env`)* |
| `FRONTEND_URL` | `https://enchanting-tanuki-2c4ede.netlify.app` |
| `PYTHON_VERSION` | `3.11.0` ← **critical**: Render defaults to 3.14 which breaks pydantic |
| `ENVIRONMENT` | `production` |

### Netlify (frontend)
No environment variables required — the Render URL is hardcoded in `frontend/src/lib/api.ts` as `BASE`.

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `wearable_connections` | Oura OAuth tokens per user |
| `meals` | Nutrition meal logs |
| `weight_entries` | Weight / body composition logs |
| `nutrition_settings` | Per-user calorie/macro targets |
| `workouts` | Workout logs |
| `training_settings` | Per-user training preferences |
| `lab_entries` | Blood panel / lab results |
| `challenges` | Friend challenges metadata |
| `challenge_participants` | Who joined each challenge |
| `challenge_progress` | Daily progress entries per challenge |

---

## Dashboard Tabs

| Tab | Contents |
|-----|---------|
| **Today** | Readiness/Sleep/Activity scores, key metrics, coach cards, 30-day trends chart, tomorrow's readiness callout |
| **Coaching** | Short/mid/long-term coaching items from Oura data |
| **Nutrition** | Calorie & macro tracking, meal logging, weight log, body comp |
| **Training** | Training load (ACWR), workout logging, weekly plan, stretch routines |
| **Labs** | Blood panel tracking, PDF import (e.g. InBody scans) |
| **Challenges** | Friend vs. friend fitness challenges with leaderboard |

> **Note:** The Forecast tab was removed. Tomorrow's readiness is now a compact card at the bottom of the Today tab. Training Load (ACWR) moved to the top of the Training tab.

---

## Known Limitations / Future Work

- **Render cold starts:** Free tier spins down after 15 min inactivity. First request takes 30–60s. Fix: upgrade to Render paid ($7/mo) or add a keep-alive ping. No loading state shown to the user during warm-up.
- **Oura only:** No other wearables connected yet. Garmin, WHOOP, Apple Health are planned.
- **No persistent login across devices:** Token lives in `localStorage` — clearing browser data or switching devices requires re-doing OAuth.
- **No sign-in page:** Users go straight through Oura OAuth. There's no email/password login.
- **Custom domain:** Netlify URL (`enchanting-tanuki-2c4ede.netlify.app`) is not user-friendly. A custom domain would improve shareability.
- **Netlify build minutes:** Free tier has limited monthly build minutes. Each deploy uses some. Monitor usage.

---

## Oura Developer App

- Portal: `https://cloud.ouraring.com/oauth/applications`
- App name: BackNine Health
- Redirect URI registered: `https://backnine-hu60.onrender.com/auth/oura/callback`
- Scopes: Sleep, Readiness, Activity, Heart Rate, Age/Sex/Height/Weight, Session, SpO2, Workout

---

## Deployment

See `DEPLOY.md` for full step-by-step instructions.

**Quick deploy after code changes:**
```bash
git add -A
git commit -m "your message"
git push
# Render auto-deploys backend, Netlify auto-deploys frontend
```

Both Render and Netlify are connected to the GitHub repo and deploy automatically on push to main.
