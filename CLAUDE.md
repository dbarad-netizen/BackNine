# BackNine — working doctrine

Read this before touching anything. It is the distilled cost of two months of
mistakes. Every rule here was paid for with a wrong number on someone's phone.

BackNine is a healthspan app for men 50+ built by David B. (58) for his own
foursome. Frontend: Next.js on Vercel (`frontend/`, www.backnine.health),
wrapped in Capacitor for iOS (TestFlight). Backend: FastAPI on Render
(`backend/`, backnine-hu60.onrender.com). Database: Supabase Postgres
(project `xazmwpozsmbrqoulizyn`). Coach Al = Claude via the Anthropic API.

## What the product is

- **The text is the product; the app is the back office.** A Sunday scoreboard
  text (Letterman × Berman voice) and a midweek "Making the Turn" text drive
  the foursome. The app is where the stakes live (Coffee Tab) and where you
  go when the text makes you curious.
- **The competition is the hook.** The Weekly League plays *net*, like golf:
  par = best 40% of your daily Health Span scores over the 28 days before
  Monday (capped at 90, can drop at most 3/week, median while history < 20
  days). Net = this week − par. Lowest net buys the coffee. See `leagues.py`.
- **The doctor layer is the receipt, not the hook.** Oura ships lab upload
  and clinicians now. Don't invest in it as a differentiator.
- **Cross-device is the moat.** Oura, Apple Watch, phone-only, (WHOOP via
  Apple Health). Anything that only works for one device is against the
  product.

## Scoring doctrine

- **Sensors drive scores; logging never does.** The Health Span score
  (`healthspan.py`) is sleep hours, sleep timing, steps, active days — from
  wearables only. Meals, meds, check-ins, the Food Plan: cards and Coach Al
  context, never the score or the League.
- **Oura wins over Apple Health for Oura users.** Never borrow AH sleep for an
  Oura user because the session detail is late. "Oura user" = any Oura rows in
  the cache (`_has_oura_cache`), not a session token.
- **Honest labels over confident wrong numbers.** `≈` for estimated, "Early
  read" for provisional, "Waiting on Oura" when today has no row, "Last scored
  Oct 8" when the anchor is behind the user's real date. Never show
  yesterday's numbers under today's date.
- **Medals and head-to-heads compare the same calendar day only.** Steps and
  activity are judged on the last complete day; sleep on today once scored.
- **A baseline reset is a physiological discontinuity** (`baseline.py`).
  David started CPAP 2026-08-03; pre-CPAP HRV was apnea-inflated and is not
  a baseline. `oura_cache.get_days()` nulls HRV/RHR before the reset for every
  comparative consumer; pass `raw=True` only for the pre/post note and the
  history chart. The readiness override fires only when BackNine > Oura by
  8+ within 60 days of the reset (Oura-too-high is never the failure mode).
- **The week is a bank account** (`week_pace.py`, "Your week vs par" on the
  League card). Sunday's score is built from Mon–Sun only, so the pace view
  shows what's banked, a same-pace projection, and what the days left need.
  Par is the only target line — never add a second "maintenance" band.
- **Show your math.** Every score has an "Under the hood" or tap-to-see-bands.
  Competitor facts on the landing page are dated and re-checked quarterly.

## Coach Al doctrine (`briefing.py`, `chat.py`, `ai_context.py`)

- **Only things with a face in the app.** No ghost features: if a card was
  killed, Coach Al must never mention it (the prediction game, the forecast,
  Pulse feed, insights, recap, visit prep are all dead). Audit
  `ai_context.build()` keys when you remove a surface.
- **Earn the open.** Verdict first, in coffee-shop words. At most four numbers;
  a "vs usual" comparison counts as two. No fractions ("two-thirds more"),
  no physiology-speak, no narrating internal rules to the reader.
- **The model does no arithmetic.** Comparisons ("5.2 h vs usual 7.3 h, −29%")
  are precomputed server-side and handed over.
- **Time order.** Yesterday's check-in mood was shaped by the night *before*
  yesterday. Last night's sleep can only speak to today.
- **Never invent a meal, a workout, or a sync state.** If data is missing say
  what's missing; never say "still syncing" as if the app failed.
- **Medical language:** "consistent with", never dose advice. Doctor decides.
- Sonnet 5 returns a ThinkingBlock first → always `ai_text.first_text()`;
  thinking eats max_tokens (briefing 1600, chat 2048); never cache an empty
  narrative; fallback chain to haiku/sonnet-4-6 with timeouts.

## Data plumbing doctrine

- **The server owns the clock.** Nothing depends on a user opening the app:
  in-process Oura refresh every 20 min (`_start_inproc_oura_refresh`), daily
  Health Span snapshot, HealthKit *background delivery* on iOS
  (`BackgroundHealthSync.swift`). GitHub Actions cron is best-effort (it
  dropped ~85% of runs) — use it only as an alarm that goes red.
- **Oura's document endpoints treat `end_date` as exclusive** and Render runs
  on UTC, so `end_date` must be tomorrow or today's sleep session only arrives
  at 5pm Pacific. Daily endpoints are inclusive. (`oura.py`)
- **Oura refresh tokens are single-use.** Central store
  (`oura_connections` for text ids, `wearable_connections` for UUIDs); adopt
  newer tokens, retry with the central one, persist to both, force-refresh on
  401 — and surface 401s, never treat them as "empty data".
- **Supabase: every new table gets `GRANT … TO service_role` in the same
  migration** (Data API no longer auto-grants). The browser never talks to
  Supabase; only Render does.
- **`device_readings.recorded_at` ("first seen") is the best debugger** you
  have for "when did this number actually arrive".
- Mixed user id types: Oura users are `oura_…` text ids, Supabase-auth users
  are UUIDs. `profiles.id` is a UUID FK to auth.users; `user_profiles.user_id`
  is text.
- HealthKit: sum per source, union sleep intervals per source, then MAX across
  sources — never add sources together. The native sync mirrors
  `healthkit.ts` exactly; keep them in lockstep.

## Build gates (the sandbox can't run `next build` or install packages)

- `cd frontend && npx tsc --noEmit -p .` must pass.
- `cd backend && python3 -m py_compile *.py` must pass.
- Swift is compiled only by Xcode on David's Mac.
- `useSearchParams` needs Suspense — read `window.location` instead.

## Deploy flow

- Claude edits files in the repo; David commits and pushes; Render and Vercel
  auto-deploy from `main` (iOS needs an Xcode archive → TestFlight).
- Never paste secrets in chat. Keys live in Render env vars; the APNs `.p8`
  was once committed by mistake (revoked 2026-10-26) — `*.p8` is now ignored.
- Cowork scheduled tasks compose the Sunday/Tuesday/Friday texts from
  Supabase; their prompts carry the fair/net scoring rules and the player
  roster (David, Chris, Josh as of 2026-10-27) — update them when scoring
  changes or a player joins/leaves.

## People (ids in `user_profiles`)

- David — `oura_6c-…` (Oura; CPAP reset 2026-08-03; amlodipine note).
- Chris — `11ed8938-…` (Apple Watch; profile name "Gantler", always write
  Chris). His old Oura account `oura_267b…` is dead — don't friend it.
- Josh — `oura_2d14…` (Oura). Demo accounts for App Review: Sam Demo
  (`26082f46-…`) and Pat Demo (`a0000000-…de01`), rolled forward daily.
- Name David as "David B." on anything public. Never his full surname.

## Voice

- The Sunday text: Letterman dry + Berman play-by-play, golf as the house
  metaphor, affectionate trash talk at the lower net, backhanded compliment to
  the leader, no exclamation points, ends with the tagged `Full board:` link.
- Copy on the site promises only what has a face in the app.
