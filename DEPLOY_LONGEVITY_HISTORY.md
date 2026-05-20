# Deploy: Longevity Score history (trend over time)

Adds a saved history of the composite Longevity Score so the Scorecard shows
a trend line + "vs 30 days ago" delta. History is **backfilled** from your
existing Oura cache on first load, so the curve appears immediately.

## Step 1 — Run the SQL migration FIRST (Supabase → SQL Editor)

Run the contents of `supabase_longevity_history.sql`. It's idempotent
(safe to re-run). It creates `public.longevity_history`
(PK `user_id, date`) plus an index.

## Step 2 — Push code (backend + frontend deploy automatically)

```
cd ~/Documents/BackNine
git add -A
git commit -m "Add Longevity Score history: backfill + trend sparkline on Scorecard"
git push
```

- Backend (Render) and frontend (Vercel) redeploy on push.
- Enter your GitHub token at the terminal prompt if asked — never paste it in chat.

## What changed

**Backend**
- `backend/longevity_history.py` (new): `record()`, `get_history()`,
  `backfill()` (recomputes daily scores from `oura_daily_cache` — per-day
  HRV/RHR, trailing 7-day sleep & steps, latest VO2 max / body-fat carried
  back as constants), and `ensure_history()` (records today + one-time backfill).
- `backend/main.py`: imports `longevity_history`; the dashboard endpoint now
  records today's score + lazily backfills (best-effort, never breaks the
  dashboard); new `GET /api/longevity/history?days=90` returns the series plus
  a summary (`current`, `delta_7d`, `delta_30d`, `count`, `first_date`).

**Frontend**
- `src/lib/api.ts`: `LongevityHistory` types + `api.longevityHistory()`.
- `src/app/dashboard/page.tsx`: fetches history after the dashboard resolves;
  new `LongevitySparkline` SVG; trend row added to the Longevity card showing
  the line, a directional delta badge, and date axis. Trend also refreshes
  after a VO2 max edit.

## How to verify after deploy

1. Open the Scorecard. Under the Longevity Score ring you should see a
   **Score trend** sparkline with a "▲/▼ N pts vs 30d ago" badge.
2. Backfill is one-time per user: the curve should be populated on first load
   (assuming you have a few weeks of Oura data). New days append daily.
3. Edit your VO2 max → the score and the trend's latest point update together.

## Notes / honest caveats

- VO2 max and body fat move slowly, so for backfilled days they're held at your
  latest value — the trend mostly reflects recovery (HRV/RHR) and activity
  (sleep/steps), which is what actually changes day to day.
- Backfill only records days with a real sleep night (HRV present), so each
  point reflects an actual day rather than carried-back constants.
- Users with little/no Oura history see a "Now tracking…" note until the line
  has 2+ points.
