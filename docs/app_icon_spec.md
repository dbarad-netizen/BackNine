# App icon — BackNine Health Sync

Apple requires a 1024×1024 PNG, no alpha channel, no rounded corners
(iOS rounds it for you). The icon shows up at sizes from 29×29 (Settings
list) up to 180×180 (home screen) and 1024×1024 (App Store), so the
design needs to survive aggressive downscaling. Keep it bold, high
contrast, and recognizable at 29px.

## Brand constraints

- BackNine brand color: **#1B3829** (deep forest green)
- Brand accent: **#2D6A4F** (mid forest green) — only as a gradient partner
- Type: Inter (BackNine sets `fontFamily: ["Inter", ...]` in Tailwind)
- The web app uses 🏌️/golf metaphors lightly — explicit golf imagery in
  the app icon would be too narrow for a health-sync app. Skip it here.

## Design directions (pick one)

### Direction 1 — "B + Heart" (recommended)

A bold lowercase "b" or uppercase "B" in white, centered on a #1B3829
background. Below the B, a tiny heart-rate-line graphic (a stylized
EKG trace) in #2D6A4F or white at lower opacity. Reads as "BackNine"
plus the health context.

**Pros:** unambiguous brand, survives 29px scaling, looks like a
modern health-app icon.
**Cons:** generic; doesn't differentiate from other health apps at first glance.

### Direction 2 — "Pulse curve"

The classic EKG/pulse line shape (the single zigzag), in white, on a
#1B3829 background with a subtle radial gradient to #2D6A4F at the edge.
No text.

**Pros:** instantly readable as a health app, calming, premium feel.
**Cons:** less BackNine-specific (could be any health app).

### Direction 3 — "Wordmark mark"

Just the letters "B9" (BackNine condensed) in a bold custom typeface,
white on #1B3829. Like Slack's S, or Notion's N — letterforms doing
the work.

**Pros:** strongest brand recall; matches BackNine's identity (B9 = BackNine).
**Cons:** harder to design well; requires polish.

## My recommendation

**Direction 3 (B9 wordmark).** It's the most distinctive, most
BackNine-specific, and ages well. Pair it with a subtle one-pixel
inner stroke in #2D6A4F so the mark has a faint depth at large sizes
without going full skeuomorphic.

## Suggested workflow

1. Open Figma (or Affinity / Sketch). Create a 1024×1024 frame.
2. Background: solid #1B3829.
3. Type: Inter Bold (or Inter Black) — "B9" centered. Vertical metrics
   set to optical center, not geometric center (slightly above middle).
4. Optional accent: a 2px stroke around the inside edge at #2D6A4F 30% opacity.
5. Export 1024×1024 PNG, no transparency, sRGB color space.
6. Run through [appicon.co](https://appicon.co) or similar to generate
   the per-size variants Xcode wants (29@2x, 40@2x, 60@2x, etc.).
7. Drop the resulting `AppIcon.appiconset` into the Xcode project's
   `Assets.xcassets`.

## What to send Apple

Just the 1024×1024 master. App Store Connect generates the rest from it
when you upload the build. The smaller sizes bundled in the app are for
the home screen icon, settings list, spotlight search, etc.

## Inspiration

- Apple Health (white heart on red gradient) — the gold standard for a
  health-app icon. Simple, instantly recognizable at any size.
- Oura (the ring silhouette) — clean wordless mark
- Strava (orange "S" wordmark) — proves a single letter works at scale
- Whoop (just a small white W on black) — minimalism that reads premium

Don't copy any of these — they're examples of how the constraints shake out.
