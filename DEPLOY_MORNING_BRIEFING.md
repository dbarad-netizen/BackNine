# Deploy: Morning Briefing (Week 1)

A new Coach Al "Morning Briefing" card now appears at the top of the Scorecard
once per day. It calls Claude Haiku once to generate a 2-paragraph synthesis of
the user's overnight metrics and one specific action for today; subsequent
loads on the same day return a cached row from `daily_briefings`.

## Files in this change

```
supabase_daily_briefings.sql                    NEW   migration
backend/briefing.py                             NEW   narrative generator
backend/main.py                                 MOD   adds /api/briefing/today
frontend/src/lib/api.ts                         MOD   adds api.briefing() + BriefingResponse type
frontend/src/components/MorningBriefing.tsx     NEW   the card UI
frontend/src/app/dashboard/page.tsx             MOD   renders <MorningBriefing/> above Hero
```

Everything is additive — the existing Scorecard layout (rings, Longevity Score,
Coach Al teaser, collapsibles) is unchanged. The new card simply renders above
them, so you can revert the whole change by removing the import and the single
render line in `dashboard/page.tsx`.

## Deploy order

Run the SQL migration **before** pushing the code. The endpoint will still work
without it (it falls back to "no cache" mode), but you'll burn an Anthropic call
on every dashboard load until the table exists.

```bash
# 1. Supabase — run the migration in the SQL editor
#    https://xazmwpozsmbrqoulizyn.supabase.co → SQL Editor
#    Paste the contents of supabase_daily_briefings.sql and run.

# 2. Push code — Vercel + Render both auto-deploy from main
cd ~/Documents/BackNine
git add -A
git commit -m "Add Coach Al Morning Briefing (Week 1 of daily-experience plan)"
git push

# 3. Once Render finishes deploying (~30–60s for the cold start),
#    smoke test the endpoint:
curl -i "https://backnine-hu60.onrender.com/api/briefing/today" \
  -H "Authorization: Bearer $YOUR_TOKEN"
```

## What to look for

When you load https://back-nine-six.vercel.app/dashboard:

1. The new dark-green card appears at the very top of the Scorecard, above the
   greeting + rings card. It shows Coach Al's avatar and a 2-paragraph note.
2. On first load of the day the loading shimmer flashes briefly while Claude
   generates the narrative (~1–3s on warm Render, longer on cold start).
3. Subsequent reloads on the same day are instant — they hit the cache.
4. A 🔥 streak pill appears in the upper-right of the card if you have a
   3+ day prediction streak. Below 3 days it's hidden.
5. The footer has a "Talk to Coach Al →" link that opens the existing chat drawer.

## What's NOT included

- The endpoint pulls today's metrics, 7-day context, and your prediction streak.
  Longevity Score context is intentionally omitted from the prompt for now —
  the longevity build helper is gnarly to invoke from outside the dashboard
  endpoint and adds little for a 2-paragraph note. Add later if the briefing
  feels too thin.
- No "refresh" UI button. You can manually force a regenerate via
  `GET /api/briefing/today?refresh=1` but it's not exposed in the UI.
- No Sunday weekly review note. That's Week 5.

## Cost

One Claude Haiku call per user per day. At max ~400 output tokens and ~600
input tokens, that's well under $0.001/user/day. A 1,000-user beta = ~$30/mo
incremental Anthropic spend.

## Rollback

```bash
git revert HEAD
git push
```

The `daily_briefings` table can stay — it does no harm empty. Drop it only if
you're sure you won't come back to this feature.
