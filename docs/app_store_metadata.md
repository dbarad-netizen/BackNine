# App Store Connect — BackNine Health Sync submission package

Everything you'll need to paste into App Store Connect when the app is
ready for review. All fields below are within Apple's character limits.

---

## Basic info

| Field | Value |
|---|---|
| App name | **BackNine Health Sync** |
| Subtitle (30 chars) | **Apple Health → BackNine** |
| Primary category | Health & Fitness |
| Secondary category | Lifestyle |
| Content rating | 4+ |
| Bundle ID | `com.backnine.sync` |
| SKU | `BACKNINE-SYNC-001` |

## Marketing copy

### Promotional text (170 chars, can be updated between releases)

Connect Apple Health to BackNine in one tap. Steps, sleep, heart rate, weight, VO₂ max and more sync in the background — no copy-paste, no third-party apps.

### Description (4000 chars max)

```
BackNine Health Sync is a companion app for BackNine — the personal health
dashboard for adults focused on the second half of life. This app does
one thing well: it reads your Apple Health data and sends it to your
BackNine account on a schedule, so everything you've tracked on your
iPhone or Apple Watch shows up automatically on the BackNine web app
alongside your Oura, Withings, and other connected sources.

WHAT IT SYNCS

• Steps and active calories
• Sleep duration (asleep time)
• Resting heart rate
• Heart rate variability (HRV)
• Weight
• VO₂ Max
• Respiratory rate
• Body fat percentage

WHY THIS EXISTS

If you use BackNine and an Apple Watch, your Watch already collects rich
health data — but BackNine can't see it unless someone tells it to. Until
now, the options were typing your numbers in by hand, paying for a
third-party shortcut app, or skipping the data entirely. BackNine Health
Sync is the free, native, set-and-forget solution.

HOW IT WORKS

1. Open BackNine on the web, copy your one-time sync key
2. Paste it into this app
3. Grant Apple Health read permissions
4. Done — your data flows once an hour in the background

PRIVACY

This app only READS from Apple Health. It never writes anything back. The
data is sent exclusively to BackNine's own servers (backnine-hu60.onrender.com)
over HTTPS, and only your account on BackNine sees it. No third parties,
no analytics SDKs, no advertising. The app contains zero third-party
libraries. Your sync key is stored encrypted in iOS Keychain and is
purged automatically if you uninstall the app or sign out.

REQUIREMENTS

• iPhone running iOS 17 or later
• An active BackNine account (sign up free at back-nine-d28t.vercel.app)
• Apple Health data — works best if you have an Apple Watch, but any
  HealthKit-enabled device (including third-party scales, glucose
  monitors, blood pressure cuffs, etc.) works

This is a companion app — you'll do most of your reading, logging, and
coaching on the BackNine web app. This app's job is to keep the data
flowing without you thinking about it.
```

### Keywords (100 chars, comma-separated, no spaces around commas)

```
apple health,oura,sync,health tracking,hrv,steps,sleep,vo2 max,fitness,healthkit,longevity
```

### Support URL

`https://back-nine-d28t.vercel.app/support` *(create this page if it doesn't exist — can be a simple "Email support@backnine.app for help" stub)*

### Marketing URL

`https://back-nine-d28t.vercel.app/`

### Privacy Policy URL

`https://back-nine-d28t.vercel.app/legal/privacy` *(already exists per #249)*

---

## App Privacy (Privacy Nutrition Labels)

Apple requires these declarations. Submit honestly — Apple cross-checks
against your app's network behavior and rejects mismatches.

### Data linked to user

**Health & Fitness**
- Fitness — Activity, exercise, workouts
- Health — Heart rate, sleep, respiratory rate, weight, body fat, HRV, VO₂ Max

How it's used: **App Functionality** (the data IS the product — without it
there's nothing to sync).

Used for tracking? **No.**
Shared with third parties? **No.**

### Data not collected

- Contact info, location, browsing history, search history, identifiers,
  purchases, usage data, diagnostics, sensitive info, financial info, etc.

We don't even collect device crash logs. The app has no analytics SDK.

---

## Build settings

| Setting | Value |
|---|---|
| Deployment target | iOS 17.0 |
| Supported devices | iPhone (universal not required for v1) |
| Orientation | Portrait only |
| Built with Xcode | 15 or later |

## App Review information

### Contact info

Use David's email on file with App Store Connect.

### Demo account

App Store reviewers will need a test BackNine account and a sync key.
Before submitting, log in to BackNine as the test reviewer account and
copy the X-AH-Key. Paste both into the "Notes" field in App Review
Information so the reviewer can complete the flow.

### Notes for reviewer (template)

```
BackNine Health Sync is a companion app for BackNine, a personal health
dashboard. It reads Apple Health data and POSTs it to our backend.

To review:
1. Open the app — you'll see a "Paste your sync key" prompt
2. Paste this test key: [PASTE FROM BACKNINE'S APPLE HEALTH TAB FOR
   THE TEST ACCOUNT]
3. Tap Connect — you'll see the main screen
4. Grant HealthKit permissions when prompted
5. Tap "Sync now" — the app sends yesterday's data to our backend

The app does not collect any data beyond what's declared in the Privacy
Nutrition Labels. There is no in-app purchase, no analytics, no advertising.
```

---

## What you still need to produce

These are creative deliverables I can't generate but can describe:

### App icon (1024×1024 PNG, no alpha, no rounded corners)

See `docs/app_icon_spec.md` for design directions.

### Screenshots (required: 6.7" iPhone display = 1290×2796 px)

You'll need 3-10 screenshots showing the app in use. Recommended set:
1. Sign-in screen with marketing tagline overlay
2. Main "Connected · Last sync 3 min ago" screen
3. Per-metric detail view showing the list with toggles
4. (Optional) An iOS-style "permissions" mock showing what the app reads

Use a real iPhone or an Xcode simulator at the right resolution. Apple
provides a free Screenshot Specialist app, or just use the system screenshot
shortcut in the simulator.

### App Preview video (optional but boosts conversion)

15-30 seconds. Voiceless. Shows sign-in → main screen → detail view.
Can be skipped for v1.
