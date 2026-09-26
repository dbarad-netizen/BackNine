# BackNine — App Store Connect listing

Draft copy for every text field in App Store Connect. Character limits are enforced
by App Store Connect and included inline for reference. Paste directly, or tweak
first — this is a starting draft, not final.

Update the LAST-REVIEWED line at the bottom whenever you change anything.

---

## App name (max 30 chars)

```
BackNine — Longevity Coach
```

Length: 25 chars. Kept from the July draft — "Longevity Coach" still carries
the Coach Al mental model and the search term.

---

## Subtitle (max 30 chars)

```
Know what today is buying you
```

Length: 29 chars. Rewritten 2026-09-24 (competitive review): every recovery
app's subtitle is a feature list ("Watch, Workout & Heart Rate"). Ours is the
one promise none of them make — the horizon. Alternatives:

- `Years, not just days` (20) — shorter, punchier, less clear cold
- `Add years, live better after 50` (30) — the July draft; fine, generic

---

## Promotional text (max 170 chars — editable without new build)

```
Works with the Apple Watch you already own. Your Biological Age, your QYL Index
(quality years left), and a Sunday scoreboard with your friends. Free in beta.
```

Length: 166 chars. Rotate when something ships; this is the only field that
doesn't need a new build.

---

## Description (max 4000 chars)

Rewritten 2026-09-24 — OUTCOMES FIRST, and only features that currently have a
face in the app (post-August audit). Do not re-add Insight feed, sleep tags,
Visit Prep, experiments, or groups unless the surface is back.

```
Recovery apps tell you about today. BackNine tells you what today is buying you.

Built by a 58-year-old for his own foursome, BackNine reads the Apple Watch or
Oura ring you already own — plus your labs and blood pressure — and turns them
into three numbers that matter on the back nine of life.

KNOW WHAT TODAY IS BUYING YOU
Your Health Span Score grades the week from sensors only — sleep, movement,
consistency. Nothing you log or forget to log changes it. Your Biological Age
reads up to thirteen markers (HRV, VO2 max, blood pressure, HbA1c, LDL, kidney
function and more) against what's typical for your age, not an athlete's
optimum. And the QYL Index — Quality Years Left — projects your active,
independent years ahead, evaluated at your biological age rather than your
birthday. Move the markers and the years move with them.

NO BLACK BOXES
Every score has an "Under the hood" view: which inputs, how each one moved the
number, and how recent the data is. The full methodology is published at
backnine.health/how-we-score. If we can't show the math, we don't show the
score.

A COACH WHO READS YOUR NUMBERS
Coach Al writes you a morning briefing from your actual data — the one thing
worth knowing and the one thing to do about it — and reports back the next day
on whether it worked. Pick his voice: straight talk, or the broadcast booth.

A REPORT YOUR DOCTOR READS
One page, in clinical language: trends, flagged values, medications, family
history. Bring it to the visit instead of your phone. Upload a lab PDF and it
reads the values in.

YOUR FOURSOME, KEEPING SCORE
Invite your friends. A weekly leaderboard ranked on behavior — not on who owns
the fanciest gadget — and a Sunday scoreboard that tells the group who's
buying coffee. The men who keep going are the ones with someone watching.

WORKS WITH WHAT YOU OWN
Apple Watch connects in one tap. Oura ring, Withings blood pressure, and lab
PDFs all feed the same picture.

YOUR DATA
Free while we're in beta; we'll charge for BackNine Pro later, and that is the
entire business model. No ads, no data sales, no "partners." One-tap export,
one-tap delete. Details at backnine.health/your-data.

BackNine is not a medical device, and nothing in the app is medical advice,
diagnosis, or treatment. Coach Al is a coaching layer, not a clinician. Always
consult a qualified healthcare professional before beginning or changing any
exercise, nutrition, medication, or supplement regimen.
```

Length: ~2450 chars.

---

## Keywords (max 100 chars, comma-separated)

```
longevity,apple watch,oura,healthspan,biological age,hrv,recovery,sleep,coach,doctor,friends
```

Length: 96 chars. Notes:

- No spaces after commas — every char counts
- Do NOT repeat words already in name/subtitle (Apple weights those automatically)
- "oura" and "hrv" are high-intent low-competition
- "healthspan" is the demographic-target keyword

---

## Support URL

```
https://www.backnine.health/support
```

**TODO before submit:** create a real `/support` page. Simplest: a page with
the email `support@backnine.health` and a note "we typically respond within
one business day."

---

## Marketing URL (optional)

```
https://www.backnine.health
```

---

## Privacy Policy URL

```
https://www.backnine.health/privacy
```

Confirm this route exists in the frontend (it does — `/privacy` page renders
`legalContent.privacyPolicy`).

---

## Category

**Primary:** Health & Fitness (locked 2026-07-23)
**Secondary:** Lifestyle

Rationale: We considered Medical for secondary but pulled back. Medical
category draws intensive review, requires more clinical positioning, and
limits some content freedom. Lifestyle keeps the app in the wellness lane
where Whoop, Levels, MacroFactor, etc. sit.

## Launch decisions (locked 2026-07-23)

- **Monetization:** free at launch. No IAP, no subscription in v1. V2 will
  ship a subscription tier — see `docs/app-store/v2-roadmap.md`. Even
  though we're launching free, sign the **Paid Apps Agreement** in App
  Store Connect during initial setup so the switch to IAP later is
  frictionless.
- **HealthKit:** v2. Launching without HealthKit keeps the review
  simple. The `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`
  keys are commented in `Info.plist.snippet` and stay off until v2.
- **iPad support:** yes at launch. Universal binary (iPhone + iPad). This
  doubles screenshot work but roughly doubles addressable Apple users
  and there's no meaningful engineering cost — the Next.js layout is
  already responsive.

---

## Age rating

Answer the App Store Connect age-rating questionnaire as follows:

- Cartoon or fantasy violence — None
- Realistic violence — None
- Prolonged graphic or sadistic realistic violence — None
- Profanity or crude humor — None
- Mature/suggestive themes — None
- Horror/fear themes — None
- Medical/treatment information — **Infrequent/Mild**
- Alcohol, tobacco, or drug use references — **Infrequent/Mild** (vice logging)
- Simulated gambling — None
- Sexual content or nudity — None
- Unrestricted web access — No (in-app content only; external links open in Safari)
- Gambling — No

**Result: 17+ rating** (driven by medical/treatment info answer). Standard for
health apps.

---

## App Preview Video (optional, 15-30 sec)

Skip for v1 launch — screenshots convert acceptably without it. Add for v2 if
we see stagnant install rates. Script draft when we do:

- 0-3 sec: Person putting on Oura ring, opening BackNine on iPhone
- 3-8 sec: Dashboard scroll — score, sleep, workout, nutrition
- 8-15 sec: Coach Al chat — "Why did I sleep worse last night?"
- 15-22 sec: Doctor Handoff PDF being emailed
- 22-30 sec: Group leaderboard, cheer button, close on logo

---

## Screenshots

Required device sizes:

- **6.9" iPhone** (iPhone 16 Pro Max): 1290 × 2796 (required)
- **6.5" iPhone** (iPhone 11 Pro Max): 1242 × 2688 (Apple auto-scales 6.9
  down, so skip and let auto-scaling handle these)
- **iPad Pro 12.9"** (6th gen): 2048 × 2732 (**required** — iPad support
  is on for launch)
- **iPad Pro 11"** (4th gen): 1668 × 2388 (auto-scaled from 12.9, skip)

Recommended screens to capture:

1. Scorecard hero — Longevity Score, Today's Briefing, Goal card
2. Nutrition tab — Today's Plate + stack adherence with time-of-day grouping
3. Training tab — Today's Workout + PR badges
4. Coach Al chat — an actual conversation showing cross-signal insight
5. Clubhouse — friends leaderboard, group challenge
6. Doctor Handoff — the printable summary
7. Sleep tab — sleep debt + tags + streak
8. Onboarding welcome — Oura connect + email fallback

Each screenshot needs a short overlay caption. Draft these when we shoot the
real screens.

---

## What's New (release notes, per version, max 4000 chars)

Reuse the same tone as Sunday Scorecard emails — friendly, specific.

Example for v1.0:

```
Welcome to BackNine.

Version 1.0 lands with the six pillars we've been building toward:
recovery, sleep, training, nutrition, insight, and community. Connect
your Oura ring or Apple Watch, invite a friend, and let Coach Al start
learning your patterns.

Thanks for being here early. Send feedback anytime — the address is in
Settings. We read every note.

— The BackNine team
```

---

## LAST REVIEWED: 2026-07-23 (David + Claude, initial draft)
