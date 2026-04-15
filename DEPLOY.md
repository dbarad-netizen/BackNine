# Deploying BackNine

Deploy once. Everyone shares the same URL — each user connects their own Oura Ring and gets a completely private account with their own data.

---

## What you need (all free tiers work)

- **GitHub** account — to host the code (github.com)
- **Supabase** account — database (supabase.com)
- **Render** account — runs the backend (render.com)
- **Vercel** account — runs the frontend (vercel.com)
- **Oura Developer** app — one OAuth app for all users (cloud.ouraring.com/oauth/applications)

---

## Deploy (one time, ~20 min)

### 1. Push code to GitHub

```bash
cd BackNine
git init
git add .
git commit -m "init"
# create a repo at github.com, then:
git remote add origin https://github.com/YOU/backnine.git
git branch -M main
git push -u origin main
```

> **Note:** When GitHub asks for a password, use a Personal Access Token — not your account password.
> Generate one at github.com/settings/tokens → Generate new token (classic) → check **repo** → copy the token and paste it as your password.

---

### 2. Set up Supabase

1. New project at supabase.com
2. **SQL Editor** → paste and run `supabase/schema.sql`
3. **SQL Editor** → paste and run `supabase_challenges.sql`
4. **Settings → API** → copy your Project URL, anon key, and service_role key

---

### 3. Deploy backend to Render

1. render.com → **New + → Web Service**
2. Connect your GitHub repo
3. Configure the service:

| Setting | Value |
|---|---|
| **Root Directory** | `backend` |
| **Runtime** | Python 3 |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Free |

4. Add these environment variables (click **Advanced → Add Environment Variable**):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_SERVICE_KEY` | your service_role key |
| `JWT_SECRET` | run `openssl rand -hex 32` to generate |
| `OURA_CLIENT_ID` | fill in after step 4 |
| `OURA_CLIENT_SECRET` | fill in after step 4 |
| `OURA_REDIRECT_URI` | `https://YOUR-RENDER-URL/auth/oura/callback` |
| `FRONTEND_URL` | `https://YOUR-VERCEL-URL` (fill in after step 5) |
| `ENVIRONMENT` | `production` |

5. Click **Create Web Service** → note your Render URL (e.g. `https://backnine.onrender.com`)

> **Note:** Render's free tier sleeps after 15 minutes of inactivity. The first request after idle takes ~30 seconds to wake up. This is fine for personal use.

---

### 4. Register your Oura OAuth app

1. cloud.ouraring.com/oauth/applications → **Create New Application**
2. Set Redirect URI to: `https://YOUR-RENDER-URL/auth/oura/callback`
3. Scopes: `daily heartrate personal session sleep workout`
4. Copy the Client ID and Secret → paste into your Render environment variables
5. Render will redeploy automatically

---

### 5. Deploy frontend to Vercel

1. vercel.com → **New Project** → import your GitHub repo
2. Set **Root Directory** to `frontend`
3. Add environment variable: `NEXT_PUBLIC_API_URL` = your Render URL
4. Click **Deploy** → note your Vercel URL (e.g. `https://backnine.vercel.app`)
5. Go back to Render → update `FRONTEND_URL` to your Vercel URL → Render redeploys

---

## Sharing with friends

Send them your Vercel URL. That's it.

They click **Connect Oura Ring**, log in with their Oura account, and land on their own private dashboard. Your data and theirs are completely separate — same app, different accounts.

---

## Keeping everyone up to date

Push new code to GitHub → Render and Vercel redeploy automatically. Everyone gets the update instantly.
