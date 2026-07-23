# App Store screenshots — composition specs

Eight iPhone screenshots + eight iPad screenshots for the App Store listing.
Each shot has a target route, the account state to reproduce, an overlay
caption, and composition notes.

Two general rules:

- **Caption placement**: top 20% of the frame, single sentence, large white
  text on a green (#1B3829) or dark (#0f1a15) safe zone. Never over
  content — overlay a solid strip.
- **Data honesty**: use the "review-account@backnine.health" demo account.
  Do NOT screenshot with real personal data (Chris's, Julie's, David's).
  Reviewers can tell when numbers look like a specific real person.

Every screenshot goes into `docs/app-store/screenshots/YYYY-MM-DD/`
with filename `iphone-01-scorecard-hero.png`, `ipad-01-scorecard-hero.png`,
etc. Keep them versioned so we can regen without losing prior takes.

---

## Device targets

| Device | Size | File suffix | Required? |
|--------|------|-------------|-----------|
| iPhone 16 Pro Max | 1290 × 2796 | `iphone-` | Yes — 6.9" is the only required iPhone size (Apple auto-scales down) |
| iPad Pro 12.9" (6th gen) | 2048 × 2732 portrait | `ipad-` | Yes — iPad support is on |
| iPad Pro 12.9" landscape | 2732 × 2048 | `ipad-landscape-` | Optional; upload if landscape reads well after layout polish |

---

## The 8 shots

### 01 — Scorecard hero

**Route:** `/dashboard` (Scorecard tab, top of scroll)
**Account state:**

- Longevity Score shows **82** (good but not perfect)
- Today's Briefing shows a Coach Al summary with two specific numbers ("HRV up 8%, RHR 54")
- Goal card: active goal at 60% progress
- Stack pill: "3 due · 2 taken · 67% on pace"

**Overlay caption:**
```
Your health, in one glance.
```

**Composition notes:**
- Ensure the freshness banner is hidden (Oura synced fresh)
- Hide any onboarding cards (demo account has completed onboarding)

---

### 02 — Coach Al reads across signals

**Route:** `/dashboard` → open Coach Al chat drawer
**Account state:**

- Show a chat exchange like:
  - User: "Why was my sleep worse last night?"
  - Coach Al: "Two things stand out: you logged a glass of wine at 8pm — your HRV dips ~8% on wine nights — and your final ~90 min was restless (2 wakeups). Try holding the glass until dinner and see how tonight scores."

**Overlay caption:**
```
Coach Al reads across all your data.
```

**Composition notes:**
- The specific-numbers detail is what sells the shot — no generic "get more sleep" replies
- Show the chat pill's context indicator ("Reading your sleep + nutrition")

---

### 03 — Today's Workout prescription

**Route:** `/dashboard` → Training tab
**Account state:**

- Today's Workout card at top: "Zone 2 Bike · 40 min · moderate effort"
- Rationale line: "HRV is 6% below your 30-day baseline — easy day builds without dragging tomorrow down"
- Weekly volume sparkline with a deload nudge visible if it fits
- One PR badge visible on a recent workout below

**Overlay caption:**
```
A workout tuned to how you slept.
```

**Composition notes:**
- Injury flag chip in the right corner adds credibility (shows the app respects constraints)

---

### 04 — Nutrition + stack adherence

**Route:** `/dashboard` → Nutrition tab
**Account state:**

- Today's Plate card at top: protein 96g / target 140g, macros clean
- Today's stack with 🌅 Morning taken (checked) and 🌙 Evening pending
- One vice logged (e.g., 1 glass of wine yesterday) for context

**Overlay caption:**
```
Meds, macros, and micros — one tap each.
```

**Composition notes:**
- Time-of-day grouping is the differentiated UX moment — make sure both Morning and Evening groups are visible
- The 🌙 Evening group should say "not yet" chip since it's a daytime screenshot

---

### 05 — Sleep summary

**Route:** `/dashboard` → Sleep tab
**Account state:**

- Last night's sleep: 7h 42m, efficiency 91%
- Sleep balance signal: "In balance"
- Streak counter: 12 nights over 7h in the last 14
- Tag pills: "read before bed", "no screen", "8pm dinner"

**Overlay caption:**
```
Track the pattern, not just the number.
```

**Composition notes:**
- Tag pills visible = shows Oura tag integration (recently fixed) is a differentiator
- Hide the manual-log CTA (empty state noise)

---

### 06 — Doctor Handoff

**Route:** `/dashboard` → Scorecard → tap "Doctor Handoff" → PDF preview modal open
**Account state:**

- PDF shows: patient name (demo), BP summary (30-day avg + morning/evening split), sleep trend, weight trend, latest 5 lab values with reference ranges, current med list

**Overlay caption:**
```
Show up prepared to every doctor visit.
```

**Composition notes:**
- The PDF is the star — frame it prominently
- The share/download buttons should be visible below

---

### 07 — Community leaderboard

**Route:** `/dashboard` → Clubhouse tab
**Account state:**

- Weekly Leaderboard with 4 friends and one demo user
- Community averages row visible below leaderboard
- One cheer button highlighted (arrow indicator? — decide during shoot)

**Overlay caption:**
```
Longevity is a team sport.
```

**Composition notes:**
- Friend names should be first-name-only for demo privacy ("Alex", "Sam", "Jordan")
- One friend ahead of user, one behind — realistic

---

### 08 — Insight card

**Route:** `/dashboard` → Scorecard, scrolled to Daily Insight card
**Account state:**

- Insight text: "You slept 45 min longer on nights you finished eating by 8pm (n=9). Try a 7:30pm dinner cutoff this week."
- Confidence chip: "Moderate confidence · 9 nights"
- "Log dinner time" CTA button visible

**Overlay caption:**
```
Real correlations. Real actions.
```

**Composition notes:**
- Confidence chip is a trust signal — Fable feedback #4 baked into UX
- The CTA button closes the loop from insight to action

---

## iPad variants

For the 8 iPad shots, target the **same** routes but with these two changes:

1. **Wider content column**. After the iPad layout polish lands (task #127),
   the main container widens to `max-w-3xl` on iPad and `max-w-4xl` in
   landscape. Screenshots capture that comfortable-width layout.
2. **Add screen chrome context** in caption placement — iPad captions can
   go bottom-third and still leave room for content up top.

If the iPad landscape layout doesn't read well by shoot day, skip
`ipad-landscape-*` files and just upload portrait — Apple accepts portrait
only for iPad if you don't offer landscape.

---

## Shooting script (once TestFlight build is live)

```bash
# 1. Install TestFlight build on iPhone 16 Pro Max simulator
xcrun simctl boot "iPhone 16 Pro Max"
open -a Simulator

# 2. In simulator: sign in as review-account@backnine.health
# 3. Navigate to each of the 8 screens above and take screenshots
#    (Cmd+S in Simulator, saves to Desktop)

# 4. Same routine for iPad Pro 12.9"
xcrun simctl boot "iPad Pro (12.9-inch) (6th generation)"
```

Then run through `docs/app-store/apply-overlays.py` (to be built when the
first shoot happens — Photoshop is fine for v1).

---

## LAST REVIEWED: 2026-07-23
