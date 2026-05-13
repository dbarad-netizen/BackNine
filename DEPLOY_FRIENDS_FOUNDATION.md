# Deploy: Friends Foundation (Week 3a)

Ships the plumbing for the community layer — friend graph, activity event log,
event reactions table, and a Friends section in the Profile modal. Lays the
groundwork for the visible Pulse feed in the next round.

This is the "foundation" pass from the Week 3 plan. After this ships you can:

- Invite friends with a 6-char code (72-hour TTL, single use)
- See your friends list and remove friendships
- Have activity events automatically recorded when you log a workout, weigh-in,
  or join a challenge (these are saved server-side; not yet shown anywhere in UI)

The Pulse feed UI that displays those events on the Scorecard ships in the next
round, on top of these same tables.

## Files in this change

```
supabase_friends_and_events.sql                  ALREADY COMMITTED   migration
backend/friends.py                               ALREADY COMMITTED   module
backend/main.py                                  MOD                 imports friends, adds 5 endpoints, hooks 3 log endpoints
frontend/src/lib/api.ts                          MOD                 adds api.friends namespace + 3 types
frontend/src/components/ProfileModal.tsx         MOD                 adds Profile/Friends tab toggle + Friends panel
```

The first two files were already in your repo from the earlier Week 3 work —
they were inert (no endpoints read from them, so no production effect). This
deploy is what activates them.

## Deploy order

**SQL migration must run before code is deployed.** If code lands and the
tables don't exist, the friend endpoints will return 500s. The activity-event
hooks are wrapped in `try/except pass`, so they'll fail silently and won't
break workout/weight/challenge writes — but the modal will be unusable.

```bash
# 1. Supabase — run the migration in the SQL editor
#    https://xazmwpozsmbrqoulizyn.supabase.co → SQL Editor → New query
#    Paste the contents of supabase_friends_and_events.sql, then Run.

# 2. Push code
cd ~/Documents/BackNine
git add -A
git commit -m "Friends foundation: graph, events, invite/accept flow"
git push
```

Render + Vercel will auto-deploy. Render cold-start adds ~30–60s on the first
hit after deploy.

## Quick smoke test (after both deploys complete)

The cleanest test is with two accounts:

1. **Account A** — open the Profile modal → switch to the Friends tab →
   "Generate invite code". Copy the code.
2. **Account B** (different browser or incognito, signed in as another user) —
   open Profile → Friends tab → paste the code in "Got an Invite Code?" → Accept.
3. Both accounts should now see each other in the Friends list.
4. Log a workout from Account A. Then call this in a terminal:

   ```bash
   curl -H "Authorization: Bearer $YOUR_TOKEN_FOR_B" \
     "https://backnine-hu60.onrender.com/api/friends/events"
   ```

   You should see the workout event in the response — Account B can see
   Account A's activity even though there's no UI for it yet.

## API surface added

```
POST   /api/friends/invite           → { code, inviter_name, expires_at }
POST   /api/friends/accept           → body: { code }
GET    /api/friends                  → { friends: [{user_id, name, since}] }
DELETE /api/friends/{friend_user_id} → { removed: true }
GET    /api/friends/events?limit=30  → { events: [...with summary line...] }
```

All require auth via Supabase JWT (same as every other endpoint).

## Event sources hooked

These existing endpoints now write activity_events on success:

```
POST /api/training/workouts   → "workout_logged"
POST /api/nutrition/weight    → "weight_logged"
POST /api/challenges/join     → "challenge_joined"
```

Each hook is wrapped in try/except — if the event-log write fails (DB blip,
table missing pre-migration, etc.) the actual workout/weight/challenge write
still succeeds. The user never sees an error from this.

The `event_reactions` table is in the schema but not used yet — it ships now
so the next round (reactions UI on the Pulse feed) doesn't need another
migration.

## Note on user display names

Friend names are captured at the moment the friendship is accepted, from
`user_profiles.name`. If a user hasn't filled in their profile, they'll show
as "BackNine user". Encouraging users to fill in their name in the Profile
tab now makes their future friend connections look better.

## Rollback

```bash
git revert HEAD
git push
```

The tables can stay — they're inert without the endpoints reading them. Drop
the tables only if you're certain you won't come back to community work.
