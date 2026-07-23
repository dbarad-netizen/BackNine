# App Store submission — BackNine

Everything needed to ship BackNine to the App Store lives in this folder.
Follow this README top-to-bottom the first time you set up. Once initialized,
just run the sync command in the "Ongoing releases" section for each new
build.

## Files in this folder

| File | Purpose |
|------|---------|
| `README.md` | You are here |
| `listing.md` | App name, subtitle, description, keywords, category |
| `privacy-nutrition-labels.md` | Ground truth for App Store Privacy answers |
| `apple-app-site-association.json` | Universal Links config (host at /.well-known/) |
| `Info.plist.snippet` | Info.plist keys to paste after `npx cap add ios` |
| `generate_icons.py` | Icon asset generator (run once + on any icon change) |

---

## Launch decisions (locked 2026-07-23)

- **Monetization:** free at launch, subscription in v2. **Still sign the
  Paid Apps Agreement** during initial App Store Connect setup so the
  IAP switch later is instant.
- **HealthKit:** v2. Keep `NSHealthShareUsageDescription` /
  `NSHealthUpdateUsageDescription` commented in `Info.plist.snippet`
  and do NOT enable the HealthKit capability in Xcode until v2.
- **iPad:** yes at launch. Universal (iPhone + iPad) binary.
- **Primary category:** Health & Fitness. Secondary: Lifestyle.

## Prerequisites

1. Apple Developer Program enrollment complete under **Strategy D, Incorporated** (D-U-N-S `095225396`)
2. Xcode 15+ installed on your Mac
3. Node 20+ and npm 10+ (matches Vercel)
4. `~/Documents/BackNine` cloned and up to date

## One-time setup (run after developer cert lands)

### 1. Install Capacitor deps

```bash
cd ~/Documents/BackNine/frontend
npm install --save @capacitor/core @capacitor/ios
npm install --save-dev @capacitor/cli
```

Note: this is the first time in the project we're adding native-wrapper deps.
Reviewed and approved per this readiness push — no other new deps beyond
these three.

### 2. Build the offline shell

Next has to emit static HTML for Capacitor's `webDir`. Add to
`frontend/next.config.js`:

```js
// After the existing config
module.exports.output = "export";  // enables `next export` on `next build`
```

Then:

```bash
cd ~/Documents/BackNine/frontend
npm run build
```

This produces `frontend/out/`. Capacitor will bundle it.

### 3. Add the iOS platform

```bash
cd ~/Documents/BackNine/frontend
npx cap add ios
```

Creates `frontend/ios/App/`. This is what you commit and later open in Xcode.

### 4. Patch Info.plist

Open `frontend/ios/App/App/Info.plist` and merge in the keys from
`docs/app-store/Info.plist.snippet` (usage descriptions for HealthKit, camera,
photo library — Apple rejects the build without these strings even if you
don't call the APIs yet).

### 5. Copy the app icons in

```bash
cd ~/Documents/BackNine
python3 docs/app-store/generate_icons.py
```

Writes every required PNG size into
`frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/` and updates the
`Contents.json` manifest.

### 6. Host the AASA file (Universal Links)

Copy `docs/app-store/apple-app-site-association.json` to
`frontend/public/.well-known/apple-app-site-association` (no extension). Next
serves everything in `public/` at root, so `www.backnine.health/.well-known/apple-app-site-association`
will resolve after your next deploy.

Then in Xcode → Signing & Capabilities → Associated Domains, add:

```
applinks:backnine.health
applinks:www.backnine.health
```

### 7. Sign in with Apple in Supabase

Once the Apple Developer cert lands:

1. In Apple Developer → Certificates, Identifiers & Profiles:
   - Create an **App ID** with capability "Sign in with Apple" enabled
   - Create a **Services ID** with the callback URL Supabase gives you
     (looks like `https://xazmwpozsmbrqoulizyn.supabase.co/auth/v1/callback`)
   - Create a **Sign in with Apple key** (.p8 file — download and keep safe)
2. In Supabase → Authentication → Providers → Apple:
   - Turn on Apple
   - Paste Services ID, Team ID, Key ID, and the .p8 file contents
3. Test the flow via the "Sign in with Apple" button on the sign-in page

The button is already in `frontend/src/app/page.tsx` and will start working
the moment Supabase's Apple provider is configured.

### 8. Xcode target settings — Universal (iPad support)

In Xcode → Project navigator → App target → General:

- **Targeted Device Family**: check both **iPhone** and **iPad**. This
  compiles to `TARGETED_DEVICE_FAMILY = "1,2"` in build settings.
- **Deployment Info** → **iPhone Orientation**: Portrait only (skip
  Landscape until we design the landscape layout).
- **Deployment Info** → **iPad Orientation**: All 4 (Portrait, Portrait
  Upside Down, Landscape Left, Landscape Right). iPad users expect
  landscape support.
- **Minimum Deployments**: iOS 16.4. Below 16.4, standalone-mode PWA
  cookie sharing (the dual-storage token fix) doesn't work, so users
  would still hit re-auth loops. Documenting this here so future you
  doesn't lower it.

### 9. First Xcode build

```bash
cd ~/Documents/BackNine/frontend
npx cap open ios
```

Opens Xcode. Set Team to Strategy D, Incorporated. Product → Archive. Follow
Xcode's prompts to upload to App Store Connect.

---

## Ongoing releases

For every subsequent build:

```bash
cd ~/Documents/BackNine/frontend
npm run build          # rebuilds out/
npx cap sync ios       # copies bundled web + updates deps
npx cap open ios       # opens Xcode; archive + upload from there
```

---

## Submission checklist

Pre-flight before hitting "Submit for Review" in App Store Connect:

- [ ] iPhone screenshots uploaded (6.9" — Apple auto-scales down)
- [ ] iPad screenshots uploaded (12.9" — required, iPad support is on)
- [ ] App preview video uploaded (optional; skip for v1)
- [ ] Privacy Nutrition Labels answered per `privacy-nutrition-labels.md`
- [ ] Age rating survey answered per `listing.md` → Age rating section
- [ ] Support URL live and returns 200 (currently TODO: build `/support` page)
- [ ] Privacy Policy URL live and returns 200
- [ ] "What's New" release notes filled in
- [ ] Universal binary confirmed (both iPhone and iPad checked in target)
- [ ] Sign in with Apple tested end-to-end on a real device (iPhone + iPad)
- [ ] Account deletion tested end-to-end on a real device
- [ ] Data export tested end-to-end on a real device
- [ ] Medical disclaimer link reachable from every clinical surface (BP,
      score, doctor handoff) — spot-check on TestFlight build
- [ ] Universal Link `https://backnine.health` opens the app (not Safari)
      after installing the TestFlight build
- [ ] Paid Apps Agreement signed in App Store Connect (v2 IAP prep, do
      it now while you're already in the account setup flow)
- [ ] HealthKit capability confirmed OFF in Xcode (v2 deferred)
- [ ] Landscape layout smoke-tested on iPad simulator (iPhone stays
      portrait-only)

---

## App Review notes to include (App Store Connect → App Review Information)

```
BackNine is a personal-health dashboard. To review the full experience, use
the demo account:

  Email:    review-account@backnine.health
  Password: [rotate before every submission]

The account has 30 days of pre-populated Oura data, workout logs, and a lab
PDF. No real user data. Delete-account and export-data flows both work on
this account.

BackNine is not a medical device and does not make diagnostic or treatment
claims. See the Medical Disclaimer in-app (Settings → Legal → Medical
Disclaimer) for the full text.

Sign in with Apple is offered alongside Oura Ring OAuth and email/password.
```

**TODO before each submission:** rotate the demo password.

---

## LAST REVIEWED: 2026-07-23
