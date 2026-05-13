# Deploy: Scorecard Restructure

Cleans up the Scorecard now that the Morning Briefing is doing the daily-summary
work, and adds two new strips that reflect what we're trying to make
BackNine *about*: friendly competition and curated gear that fills real gaps.

## What changed

**Removed from Scorecard** (the Morning Briefing replaces their job):
- Today's Focus
- Yesterday's Performance
- Tomorrow's Forecast (the collapsible wrapper — the Recovery Details grid that
  was nested *inside* it is preserved and lifted out so it's still visible)

**Added to Scorecard:**
- `ActiveCompetitions` strip — up to two of your live challenges, with your
  rank, days-hit / elapsed-days, today-target indicator, and streak. Silent
  if you have no active challenges. Tap to jump to the Compete tab.
- `GearPicks` strip — two product picks chosen by detecting gaps in your
  tracked data. Priority order: Oura Ring if not connected → InBody scale if
  no body fat % → Apple Watch if no VO2 Max → falls back to editor's picks
  (creatine, magnesium, foam roller). Tap to jump to the Gear tab.

**New Scorecard order:**
1. Coach Al's Morning Briefing
2. Hero rings (Readiness / Sleep / Activity)
3. Longevity Score
4. Coach Al teaser
5. **Active Competitions** ← new
6. **Picked For You** ← new
7. Coaching Insights (collapsible)
8. Body & Weight (collapsible)
9. Today's Performance (live AH)
10. Recovery Details (lifted from the removed Tomorrow's Forecast collapsible)

## Files in this change

```
frontend/src/components/ActiveCompetitions.tsx   NEW
frontend/src/components/GearPicks.tsx            NEW
frontend/src/app/dashboard/page.tsx              MOD   removes 3 sections, wires 2 new strips
```

No backend changes. No SQL changes. Frontend-only — Vercel will redeploy and
you'll see it within ~1 minute of pushing.

## Deploy

```bash
cd ~/Documents/BackNine
git add -A
git commit -m "Scorecard restructure: remove 3 sections, add Active Competitions + Gear Picks"
git push
```

## What to look for after deploy

- Scorecard is noticeably shorter and tighter.
- If you have an active challenge, an "Active Competitions" card appears
  between the Coach Al teaser and the Coaching Insights collapsible. If you
  don't, that whole section is silent (no empty state).
- A "Picked For You" 2-column gear grid appears below it. The picks will
  reflect actual gaps in your data — since you have an Oura ring connected
  and likely have body fat data from InBody logs, you'll probably see
  Apple Watch (for VO2) + an editor's pick. If you log out and into a fresh
  account, you'd see Oura Ring + InBody scale.
- The Today's Focus / Yesterday's Performance / Tomorrow's Forecast sections
  are gone.
- The Recovery Details grid (HRV / RHR / Sleep / Deep / REM / Temp) is still
  visible, now standalone instead of nested.

## Note on paused work

The friends/community foundation (`backend/friends.py`, the SQL migration in
`supabase_friends_and_events.sql`) is committed but not yet wired up. Those
files do nothing until we resume Week 3 — there are no endpoints reading
from them yet, so they're inert in production. We'll pick that thread back
up when you're ready.
