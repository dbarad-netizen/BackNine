# BackNine Health

Personal health intelligence platform. Connects to Oura Ring (and more wearables coming) to deliver daily coaching, sleep analysis, training guidance, and long-term trend tracking.

## Stack

| Layer    | Tech                          | Host            |
|----------|-------------------------------|-----------------|
| Frontend | Next.js 14 + Tailwind         | Vercel          |
| Backend  | FastAPI + Python 3.12         | Railway         |
| Database | Supabase (Postgres + Auth)    | Supabase        |
| Wearable | Oura API v2 (OAuth 2.0)       | —               |

## Project Structure

```
backnine/
  backend/
    main.py          ← FastAPI app, all routes
    oura.py          ← Oura OAuth 2.0 client
    coaching.py      ← Coaching engine (HRV zones, sleep, training load)
    models.py        ← Pydantic models
    requirements.txt
    .env.example
    Dockerfile
    railway.toml
  frontend/
    src/app/         ← Next.js pages (/, /dashboard, /connect)
    src/components/  ← ScoreRing, CoachCard, TrendChart, CoachingItem
    src/lib/         ← API client, utils
    next.config.js   ← API proxy to backend
    Dockerfile
    vercel.json
  supabase/
    schema.sql       ← Postgres schema + RLS policies
  docker-compose.yml ← Local dev (backend + frontend)
```

## Quick Start (local)

### 1. Oura OAuth App
1. Go to https://cloud.ouraring.com/oauth/applications
2. Create a new application
3. Set redirect URI to `http://localhost:8000/auth/oura/callback`
4. Copy Client ID and Client Secret

### 2. Supabase
1. Create a project at https://supabase.com
2. Run `supabase/schema.sql` in the SQL editor
3. Copy URL, anon key, and service role key

### 3. Backend
```bash
cd backend
cp .env.example .env
# fill in OURA_CLIENT_ID, OURA_CLIENT_SECRET, SUPABASE_*, JWT_SECRET
pip install -r requirements.txt
python main.py
# → http://localhost:8000
# → docs: http://localhost:8000/docs
```

### 4. Frontend
```bash
cd frontend
cp .env.local.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
# → http://localhost:3000
```

### Or with Docker Compose
```bash
# fill in backend/.env first
docker-compose up
```

## Deployment

### Backend → Railway
1. Push to GitHub
2. Create Railway project, connect repo, select `backend/` directory
3. Set environment variables (same as .env.example)
4. Railway auto-deploys on push

### Frontend → Vercel
1. Connect repo to Vercel
2. Set `NEXT_PUBLIC_API_URL` to your Railway backend URL
3. Vercel auto-deploys on push

## Wearable Roadmap

- [x] Oura Ring (OAuth 2.0, daily readiness/sleep/activity)
- [ ] Apple Health (HealthKit export parsing)
- [ ] Garmin (Connect API OAuth)
- [ ] WHOOP (WHOOP API OAuth)
- [ ] Fitbit (Fitbit Web API OAuth)

## API Reference

| Method | Path                      | Description                        |
|--------|---------------------------|------------------------------------|
| GET    | /health                   | Health check                       |
| GET    | /auth/oura                | Start Oura OAuth flow              |
| GET    | /auth/oura/callback       | OAuth callback handler             |
| POST   | /auth/logout              | Clear session                      |
| GET    | /api/dashboard            | Full dashboard data                |
| GET    | /api/wearables            | List connected wearables           |
| DELETE | /api/wearables/{provider} | Disconnect a wearable              |
# BackNine
