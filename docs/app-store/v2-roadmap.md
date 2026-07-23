# BackNine v2 — post-launch App Store roadmap

Two things we consciously deferred from v1 to keep the initial App Store
review clean. Both are meaningful features; both add review overhead.
Ship v2 after v1 has been through a review cycle successfully so we're
adding one variable at a time.

## v2.1 — HealthKit integration

**Why we deferred:** Health & Fitness apps that request HealthKit access
draw a longer, more skeptical review. Apple wants proof of what you'll do
with each data type. Better to ship v1 with a clean review, prove the app
works, then request HealthKit.

**What it unlocks:**

- Chris-pattern users (Fitbit + Apple Watch + manual, no Oura) get real
  wearable data flowing into BackNine
- The "fresh source" freshness contract can lean on HealthKit as a
  third source of truth alongside Oura and manual entry
- Optional write-back: workouts logged in BackNine appear in Apple
  Health (nice for people who trust the Apple ring/rings-close UX)

**What to build:**

1. Turn on `HealthKit` capability in Xcode Signing & Capabilities
2. Uncomment `NSHealthShareUsageDescription` and
   `NSHealthUpdateUsageDescription` in Info.plist (strings already drafted
   in `Info.plist.snippet`)
3. Data types to read: `HKQuantityTypeIdentifierStepCount`,
   `HKQuantityTypeIdentifierActiveEnergyBurned`,
   `HKQuantityTypeIdentifierHeartRate`,
   `HKQuantityTypeIdentifierRestingHeartRate`,
   `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`,
   `HKQuantityTypeIdentifierVO2Max`,
   `HKCategoryTypeIdentifierSleepAnalysis`,
   `HKQuantityTypeIdentifierBloodPressureSystolic` +
   `HKQuantityTypeIdentifierBloodPressureDiastolic`,
   `HKQuantityTypeIdentifierBodyMass`
4. Data types to write (optional, keep off by default):
   `HKObjectTypeIdentifierWorkoutType` (workout logs)
5. Capacitor plugin: `@capacitor-community/health` or hand-roll a Swift
   bridge. Community plugin is faster but the maintenance risk is real.
   Decide based on how the plugin looks at v2 time.
6. Onboarding flow: single screen after Oura connect asking "also
   connect Apple Health?" with a "no thanks" secondary action

**Review notes to write in App Store Connect for the v2.1 submission:**

> "HealthKit is used to read the user's HRV, sleep, steps, VO2 max,
> resting heart rate, and blood pressure so BackNine can correlate these
> signals with the user's manual logs (nutrition, mood, symptoms) and
> present cross-signal insights via the in-app Coach Al feature. No
> HealthKit data is shared with third parties. Write access is optional
> and off by default. Data is stored on Supabase Postgres under the
> user's row-level-security policy and can be exported or deleted at any
> time from Settings."

## v2.2 — Subscription tier

**Why we deferred:** We haven't validated pricing, and shipping IAP
without conviction on price + feature tiering is a good way to torch a
free-tier upgrade path. Free at launch gets users in the door; a
subscription rolled out to that captive audience once we know what
they'll actually pay for is a much better bet.

**Tiering hypothesis to validate before building:**

- **Free forever:** the core dashboard experience — score, sleep,
  workouts, nutrition, community, one Doctor Handoff per year.
- **BackNine+ ($9.99/mo or $79/yr):** unlimited Doctor Handoffs,
  personalized weekly deep-dive report from Coach Al, priority Coach Al
  response times, family sharing (up to 4 users), lab-value trend
  charts beyond 90 days.

Numbers are placeholder — validate against friend interviews and the
current usage data first.

**What to build:**

1. Sign Paid Apps Agreement — do this during v1 setup so it's already
   in place
2. Set up App Store Connect subscription group `backnine_plus` with
   monthly + annual products
3. StoreKit 2 integration via `@capacitor-community/in-app-purchases`
   or hand-rolled bridge
4. Backend: `subscriptions` table + Supabase RLS + webhook receiver
   for App Store server-to-server notifications
5. Feature gates: standardize on a single `useEntitlements()` hook that
   the paywall reads
6. Paywall UX: single screen with the three "why upgrade" reasons
   drawn from what users actually engage with in the free tier

**App Store review notes for the v2.2 submission:**

> "BackNine+ is a $9.99/mo (or $79/yr) subscription that unlocks
> unlimited Doctor Handoff PDFs, extended lab-value trend history, a
> weekly Coach Al deep-dive report, and family sharing for up to four
> household members. Auto-renews unless canceled. Managed through the
> user's Apple ID subscription settings, per Apple's standard StoreKit
> flow."

## v2.3 — Sundry follow-ups

Small items that don't fit v1 but shouldn't be lost:

- App Preview video (30 sec) once the app has been in the store long
  enough to gather compelling screen recordings from real users
- Landscape iPhone layout — currently portrait-only. Consider once
  install data tells us how many users hold landscape at all.
- widgetKit — a Longevity Score glance widget for the iOS home screen
- App Clip — a lightweight preview of Doctor Handoff without install
- Push notifications — v1 relies on email; APNs setup is quick but
  needs a value-add case (streaks? insight alerts? avoid noise).

## LAST REVIEWED: 2026-07-23
