# Deploy: Coach Al's Weekly Insight

Replaces the dry, collapsed "Coaching Insights" section on the Scorecard with a
prominent narrative card in Coach Al's voice. Each week it surfaces your single
strongest data pattern (from the correlation engine) and suggests one experiment
to test it. Daily Briefing + Weekly Insight = two Coach Al touchpoints.

## Step 1 — Run the SQL migration FIRST (Supabase → SQL Editor)

Run the contents of `supabase_weekly_insights.sql`. Idempotent (safe to re-run).
Creates `public.weekly_insights` (PK `user_id, week_start`) + an index.

## Step 2 — Push code

```
cd ~/Documents/BackNine
git add -A
git commit -m "Add Coach Al Weekly Insight card; remove dry Coaching Insights section"
git push
```

Render (backend) + Vercel (frontend) redeploy on push. Enter your GitHub token at
the terminal prompt if asked — never paste it in chat.

## What changed

**Backend**
- `backend/weekly_insight.py` (new): takes the strongest correlation insight +
  profile and generates `{headline, narrative, experiment}` via Claude Haiku
  (JSON output, parsed defensively).
- `backend/main.py`: imports `weekly_insight`; new `GET /api/insight/weekly`
  endpoint. Caches one row per (user_id, ET-week-Monday) in `weekly_insights`;
  first call of the week runs the engine, picks the top pattern, generates +
  caches; later calls return the cached row. `?refresh=1` forces a regenerate.
  Returns a no-data placeholder (no Claude call) when there isn't enough data.

**Frontend**
- `src/lib/api.ts`: `WeeklyInsightResponse` / `WeeklyInsightStat` types +
  `api.weeklyInsight(refresh)`.
- `src/components/WeeklyInsight.tsx` (new): prominent Coach Al card — avatar,
  headline, narrative, an "🧪 Experiment to try this week" callout, an evidence
  chip (days analyzed · correlation r · group comparison), Regenerate, and
  "Ask Coach Al about this". Direction-aware accent color.
- `src/app/dashboard/page.tsx`: removed the "Coaching Insights" collapsible
  (the "This Week" / "Long-Term Watch" rule-based lists + `InsightsSection`) and
  wired in `<WeeklyInsight>` in its place. Dropped the now-unused `coaching`
  destructure, `InsightsSection` / `CoachingItem` imports, and `CoachingSection`.

## Verify after deploy

1. Open the Scorecard. Where "Coaching Insights" used to be (a collapsed list),
   you'll now see a non-collapsed **Coach Al · Weekly Insight** card.
2. If you have a few weeks of data it shows a headline, a short narrative citing
   your real numbers, and an experiment. Otherwise it shows a friendly "first
   weekly insight is on the way" placeholder.
3. "Regenerate" forces a fresh take (one Claude call). The result is cached for
   the rest of the ET week.

## Notes

- One Claude Haiku call per user per week (plus any manual Regenerate) — cheap.
- The card picks the engine's #1 ranked pattern (largest effect size). As your
  data shifts week to week, the surfaced pattern can change.
- The old `InsightsSection.tsx` / `CoachingItem.tsx` / `CoachCard.tsx` component
  files are left in the repo (now unused) — harmless; can be deleted later.
