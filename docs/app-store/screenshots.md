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

## The 6 shots (rewritten 2026-09-24 — outcomes, not features)

Format lesson from the category leaders: each screenshot is a four-to-six
word PROMISE in big type with the product as the evidence beneath it. No
feature lists in the headline. Dark BackNine green background, white
headline, one accent word in green.

### 01 — Hero
Headline: **KNOW WHAT TODAY IS BUYING YOU**
Shot: Scorecard spine — TODAY rings → THIS WEEK Health Span → YOUR BODY Bio
Age → HORIZON QYL card. Crop so all four kickers are visible.

### 02 — Horizon
Headline: **YEARS, NOT JUST DAYS**
Shot: the QYL card expanded (Under the hood open) — "~17 quality years, likely
12–22, your Bio Age is buying you +1.2 of them."

### 03 — Transparency
Headline: **NO BLACK BOXES**
Shot: Bio Age card with Under the hood open — marker rows showing years
younger/older each.

### 04 — Coach Al
Headline: **A COACH WHO READS YOUR NUMBERS**
Shot: a real morning briefing in broadcast-booth voice (pick a good one), with
the Straight talk / Broadcast booth picker inset if room.

### 05 — Doctor
Headline: **A REPORT YOUR DOCTOR READS**
Shot: Doctor Handoff one-pager.

### 06 — Foursome
Headline: **YOUR FOURSOME, KEEPING SCORE**
Shot: Weekly Leaderboard card with 3–4 real names, plus the Sunday text
overlaid as an iMessage bubble ("Coffee's on David.").

Retired shots (feature has no face post-audit): Today's Workout, Nutrition +
stack, Sleep summary, Insight card.

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

## LAST REVIEWED: 2026-09-24
