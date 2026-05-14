# Deploy: Coach Al Persistence + Observations (Week 2)

The biggest Coach-Al upgrade since launch. Two interlocking pieces:

**1. Persistence.** The backend is now the source of truth for conversation
history. The chat widget loads your past messages on mount, so a refresh —
or coming back tomorrow — picks up where you left off.

**2. Proactive observations.** On each dashboard load, a backend writer scans
for high-signal patterns and writes them as Coach-Al-voiced notes. When you
tap the chat with an unread observation, Coach Al opens with that note
instead of his generic "Hey! What do you want to work on today?" greeting.
The floating chat pill also shows a red unread badge.

Three observation detectors ship in this round; the schema is flexible
enough to add more without further migrations.

## Files in this change

```
supabase_chat_and_observations.sql                  NEW   migration (2 tables)
backend/observations.py                             NEW   detectors + read-side helpers
backend/main.py                                     MOD   chat persistence + 3 observation endpoints
frontend/src/lib/api.ts                             MOD   chatHistory/clearChat + observations namespace
frontend/src/components/ChatWidget.tsx              MOD   loads history, surfaces observations, unread badge, clear-conversation
```

## Observation detectors (current set)

1. **`hrv_drop`** — today's HRV is >10% below your 7-day rolling average.
   Surfaces with the exact numbers and asks if you want to talk through
   what might have caused it.
2. **`prediction_streak_<N>`** — when you hit a 3, 5, 7, 14, 30, 60, or 100
   day prediction streak. Each milestone has its own copy.
3. **`insight_<id>`** — the highest-|r| correlation from `insights.py` if
   |r| > 0.5. Currently disabled in the briefing hook (passed an empty list)
   because `insights.get_insights` is an 8-second query — we'll add a
   background hook for this later.

Each observation is dedup'd by `(user_id, kind, date)` so the same daily
HRV-drop note can't be written twice on a single day. Adding a new detector
means adding one function to `observations.py` — no schema changes.

## Deploy order

```bash
# 1. Run the SQL migration in Supabase
#    https://xazmwpozsmbrqoulizyn.supabase.co → SQL Editor → New query
#    Paste contents of supabase_chat_and_observations.sql, click Run.

# 2. Push code
cd ~/Documents/BackNine
git add -A
git commit -m "Coach Al persistence: chat memory + proactive observations"
git push
```

Without the migration:
- `/api/chat/history` returns `[]` (the chat widget will show the empty
  greeting like before — degrades gracefully)
- `/api/chat` will fail to persist turns but still return Claude's reply
- `/api/observations` will throw 500s and the unread badge won't appear

## What the user sees after deploy

- **Open the dashboard.** No visible change unless an observation
  triggered. If your HRV today is meaningfully below your 7-day baseline,
  expect a red **"1"** badge on the floating chat pill within a few
  seconds of the briefing endpoint finishing.
- **Tap the pill.** Coach Al opens with an amber "💡 Heads up" card
  containing the observation text — not the generic suggestion-chips
  greeting. The observation auto-marks as read on open. A "Dismiss" link
  below it removes it.
- **Send a reply.** Coach Al responds with full context (today's HRV,
  baseline, 7-day trend) baked into the system prompt — the conversation
  flows naturally.
- **Refresh the page.** Your conversation is still there.
- **Header has a new "Clear" button** when the conversation isn't empty.
  Tap once to arm, tap again within 3 seconds to confirm (prevents
  accidental wipes).

## Smoke tests

History persistence:
```bash
# Send a message
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_TOKEN" \
  -d '{"message":"how am I doing?"}' \
  https://backnine-hu60.onrender.com/api/chat

# Read it back
curl -H "Authorization: Bearer $YOUR_TOKEN" \
  https://backnine-hu60.onrender.com/api/chat/history
```

Observations:
```bash
# Trigger generation by hitting the briefing endpoint
curl -H "Authorization: Bearer $YOUR_TOKEN" \
  "https://backnine-hu60.onrender.com/api/briefing/today"

# List what was written
curl -H "Authorization: Bearer $YOUR_TOKEN" \
  https://backnine-hu60.onrender.com/api/observations
```

## API surface added

```
GET    /api/chat/history?limit=50            → { messages: [...] }
DELETE /api/chat/history                     → { cleared: true }

GET    /api/observations                     → { observations: [...], unread_count }
POST   /api/observations/{id}/read           → mark read
POST   /api/observations/{id}/dismiss        → dismiss permanently
```

`POST /api/chat` is backwards-compatible — the request body still accepts
a `history` field, it just gets ignored. Old clients will keep working.

## Cost note

- Persistence: zero new Claude calls. Same one-per-message we had before;
  history loaded from Supabase instead of from the request body.
- Observations: zero new Claude calls. All detectors are deterministic
  Python from data we already have. Adding LLM-generated observations
  later would be the next cost step.

Adding observation generation onto the existing `/api/briefing/today` hook
means it runs once per user per day max (briefing is cached) — predictable
Supabase load.

## Rollback

```bash
git revert HEAD
git push
```

Both tables can stay — they're inert without the code. Drop them only if
certain you won't come back.
