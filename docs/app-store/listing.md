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

Length: 25 chars. Room to spare. Alternatives:

- `BackNine Health` (15 chars) — cleanest, closest to brand
- `BackNine — Health & Longevity` (30 chars) — keyword-rich but verbose

**Recommended: `BackNine — Longevity Coach`**. "Longevity Coach" carries the
Coach-Al mental model and hits the search term "longevity" hard.

---

## Subtitle (max 30 chars)

```
Add years, live better after 50
```

Length: 30 chars — pinned to the limit. Alternatives:

- `Personal health intelligence` (28 chars) — safer, less category-defining
- `Recovery, sleep, longevity` (25 chars) — feature-forward
- `The back nine of life, well-played` (34 chars — TOO LONG, keep for marketing)

---

## Promotional text (max 170 chars — editable without new build)

```
Now with time-of-day med tracking, Sunday scorecard ritual, and a Doctor Handoff
one-pager you can send before your next visit.
```

Length: 148 chars. Rotate this weekly when new features ship — it's the only
listing field that doesn't require a new build submission.

---

## Description (max 4000 chars)

```
BackNine is the longevity coach for the second half of life.

Built for men and women 50+ who take their health seriously, BackNine turns your
wearable data, labs, and daily habits into a coherent picture — and then coaches
you toward better recovery, sleep, training, nutrition, and community.

--- Six pillars, one dashboard ---

RECOVERY. Your Oura or Apple Watch data streams in and becomes a readiness
signal Coach Al uses to prescribe today's workout intensity. HRV trends,
resting heart rate, and sleep balance sit next to each other so you can see
what's actually changing.

SLEEP. Track your sleep debt, streaks, and sleep tags. If you don't wear a
ring, log manually. Split-night sleep (couch + bed) is captured correctly.

TRAINING. A daily workout prescription tuned to your training level, recent
sessions, and how you're recovering. Injury flags override the plan — a sore
knee day gets mobility work, not squats. PR badges, muscle-group balance
heatmap, and weekly volume with deload prompts.

NUTRITION. Log meals with a photo or a sentence. Today's Plate summarizes
protein progress; the daily stack checklist tracks whether you took your meds
and supplements, grouped by morning / midday / evening. Hydration and vice
logging (alcohol, nicotine) feed into daily insights.

INSIGHT. Coach Al reads across all your data and surfaces one or two
observations per day. "Your HRV dips 8% on nights you drink more than one
glass of wine" — the kind of cross-signal read that no single-purpose app can
make. Correlations are gated behind statistical confidence — no random noise
dressed as insight.

COMMUNITY. Invite your friends, spouse, or workout partners. Group challenges,
weekly recaps, leaderboards, and a shared Clubhouse where friends see each
other's progress and cheer each other on. Longevity is a team sport.

--- Doctor-ready reports ---

Every quarter, BackNine generates a Doctor Handoff one-pager — a printable
summary of your blood pressure, sleep, weight, and lab trends that you can
share with your PCP before your next visit. Includes clinical escalation flags
if your BP has been consistently elevated over 7+ readings.

--- Privacy ---

Your data is your data. Full export and account deletion available in
Settings. We don't sell your data. We don't run third-party ad SDKs. Read the
full privacy policy at backnine.health/privacy.

--- Important ---

BackNine is not a medical device, and nothing in the app is medical advice,
diagnosis, or treatment. Coach Al is a coaching layer, not a clinician. Always
consult a qualified healthcare professional before beginning or changing any
exercise, nutrition, medication, or supplement regimen.
```

Length: ~2600 chars. Room to expand as features ship.

---

## Keywords (max 100 chars, comma-separated)

```
longevity,health,recovery,sleep,hrv,oura,healthspan,fitness,coach,nutrition,vo2,doctor
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
