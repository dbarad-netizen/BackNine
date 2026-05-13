# Deploy: Friend Pulse Feed (Week 3b)

Closes the loop on the community thread. The activity events you've been
logging since the foundation deploy now have a visible home — a horizontal
strip on the Scorecard showing what your friends have been up to, with
emoji reactions.

## What's new for the user

- **Friend Pulse strip** on the Scorecard, between the Coach Al teaser and
  Active Competitions. Each card shows a friend's avatar (initial circle +
  event-type emoji), their name, the activity summary, and "X minutes ago".
- **Reaction chips** — three emoji vocabulary (🔥 💪 👀). Tap to react, tap
  again to remove. Counts roll up across all reactors. You can't react to
  your own events (server-rejected with 400).
- **Refresh button** in the strip header — pulls fresh events. The strip
  does not auto-poll to keep Render cost low.
- **Empty states** are quiet:
  - No friends yet → "🤝 Better with friends" card with an "Invite a friend
    →" link that opens the Profile modal on the Friends tab directly.
  - Friends but no events → small italic "No recent activity" line.
- Your own events are filtered out so the feed feels purely social.

## Files in this change

```
backend/friends.py                              MOD   adds reactions to event list, adds toggle_reaction
backend/main.py                                 MOD   adds POST /api/friends/events/{id}/react
frontend/src/lib/api.ts                         MOD   adds ReactionSummary + api.friends.react
frontend/src/components/PulseFeed.tsx           NEW   the horizontal strip + reaction UI
frontend/src/components/ProfileModal.tsx        MOD   accepts initialTab prop ("profile"|"friends")
frontend/src/app/dashboard/page.tsx             MOD   imports + renders PulseFeed, threads initialTab
```

No SQL migration this round — the `event_reactions` table was already
created in the foundation deploy. We're just using it for the first time.

## Deploy

```bash
cd ~/Documents/BackNine
git add -A
git commit -m "Friend Pulse feed: horizontal strip + emoji reactions"
git push
```

Vercel + Render auto-deploy. Render cold-start ~30–60s on first hit.

## Smoke test

1. From your main account, open the dashboard. The Friend Pulse strip
   appears between the Coach Al teaser and Active Competitions.
2. If you have no friends, you'll see the "🤝 Better with friends" card.
   Tap "Invite a friend →" — the Profile modal opens directly on the
   Friends tab (not Profile tab). That's the new `initialTab` plumbing.
3. With a second account: log a workout. Refresh the first account's
   dashboard. The workout appears as a card in the Pulse strip.
4. Tap 🔥 on the friend's workout card. The chip turns dark green and
   shows "🔥 1". Tap again to remove it. Refresh — your reaction
   persisted to the database.
5. Try tapping a reaction on your own workout from your own account —
   you'll see a 400 (the UI doesn't render the chips for self events
   since they're filtered out, but the server-side guard is the
   authoritative check).

## API surface added

```
POST /api/friends/events/{event_id}/react      body: { emoji }
                                               → { event_id, reactions: [...] }
```

The reaction toggle is idempotent: same call adds if missing, removes if
present. Returns the fresh aggregated reactions for the event.

## Allowed reaction emojis

Hard-coded server-side in `friends.ALLOWED_REACTIONS`:

```python
{"🔥", "💪", "👀", "🙌", "😤"}
```

The UI currently exposes only the first three. Adding 🙌 or 😤 to the
client vocabulary is a one-line change in `PulseFeed.tsx`.

## Note on background work

PulseFeed does NOT auto-refresh. We load once on mount; the user taps
"Refresh" to pull fresh data. This is intentional — auto-polling at e.g.
30s would multiply Render free-tier hits across many users for marginal
freshness. Reconsider when you upgrade Render tier or move to push.

## Rollback

```bash
git revert HEAD
git push
```

The activity_events kept growing in the foundation deploy and will keep
growing — they're inert without this UI but harmless.
