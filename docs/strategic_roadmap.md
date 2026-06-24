# BackNine — Strategic Roadmap (June 2026)

> A live planning doc for what to build next, why, and in what order.
> Owner: David (Strategy D, Inc). Updated as priorities shift.

---

## North Star

BackNine is a **personal longevity dashboard that bridges wearable data,
behavior change, and clinical relevance.** Three things make it distinctive
versus Oura's own app, Apple Health, and the broader "quantified self" tier:

1. **The Doctor's Report layer** — turns raw wearable data into something a
   physician, dietitian, or coach can actually use in a 20-minute visit.
   No other consumer health app does this well.
2. **The community layer** — friends, leagues, pulse, DMs. Health is a team
   sport; BackNine treats it that way.
3. **Coach Al as a thinking partner** — proactive Claude-powered coaching
   that knows your goals, sleep, training, nutrition, and stack — and gets
   smarter the longer you use it.

Everything we build should reinforce at least one of these. When in doubt,
ask: *Does this make BackNine more useful to a longevity-minded adult than
the Oura app + their doctor + a coach?*

---

## Strategic Decisions (locked in — June 2026)

The four open questions from the original draft are now answered.

| Decision | Direction |
|---|---|
| **Commercial path** | Build something *we* love first, then take it commercial. Personal-first, commercial-eventual. |
| **Target persona** | **Men 50+** to start. Sharp persona. Expand to other demos once the core loop works. |
| **Pricing** | **Free tier + $1.99 / month + $20 / year.** Money-back / free months for referrals of new paying users. Affiliate revenue layered on top. |
| **Family plan** | **No.** Audience is single users (men 50+); a family plan dilutes the positioning. Revisit when expanding to women 50+. |
| **Platform** | **iOS first** (matches the existing Oura + Apple Health bias and the BackNineHealthSync work-in-flight). Cross-platform expansion after iOS is solid. |
| **App Store name** | TBD — decide before commercial launch. "BackNine" leans golf/age-50+ which fits the persona; debate whether to lean in explicitly or keep it ambient. |

**What these decisions imply for the roadmap:**

*Persona — Men 50+.* Sharpens which features matter most:
- **Strength + sarcopenia prevention** — men lose ~1% muscle/year after 40; resistance-training emphasis is central, not optional. The TrainingTab + Training & Recovery Report support this; we should keep pushing it.
- **Cardiovascular focus** — BP, RHR, HRV, VO₂ are headline. Already strong, already in the Cardiometabolic Report.
- **Sleep apnea screening** — risk rises with age and BMI. Already shipped in the Sleep tab.
- **Annual physical relevance** — this demo sees a PCP yearly. Annual Physical Snapshot report is high-priority.
- **Lab tracking** — PSA, lipid panel, A1c, testosterone. Worth adding a Labs field on Profile.
- **Cognitive + mental health** — loneliness epidemic among men 50+; community/leaderboard layer matters more for this demo than for a 25-year-old.
- **Procedure prep** — older = more procedures. Pre-Procedure Report already shipped — high value.

*Pricing — $1.99/$20 + referrals + affiliate.* Implies:
- Very low entry barrier; growth comes from **referrals + organic**, not paid acquisition.
- Referral mechanics need to feel rewarding (free months auto-credited, visible).
- Affiliate revenue per active user becomes meaningful; gear catalog quality matters.
- Unit economics force discipline on backend costs — Claude API, Oura polling, etc. Budget per-user before commercial launch.
- A modest free tier (or free trial) lowers signup friction even more.

*Platform — iOS first.* Implies:
- **Apple Health native (BackNineHealthSync)** stays priority #1 the moment Apple Developer enrollment lands.
- Whoop, Garmin, Fitbit/Google all get pushed back — they're cross-platform plays.
- PWA stays as the web fallback for users without iPhones during the iOS-only period.
- Native capabilities to exploit: widgets, push notifications, lock-screen complications, HealthKit deep integration.

*Commercial-eventual.* Adds new must-haves before public launch:
- Stripe + paywall + free trial flow
- Account deletion + data export (GDPR/CCPA-compliant)
- Stronger authentication (MFA optional, OAuth providers)
- HIPAA-adjacent posture (BAAs with Supabase, Anthropic, Render; encrypted at rest where possible)
- Customer support model — even a $1.99/mo product needs an inbox
- Marketing site + clear positioning page
- App Store listing copy + screenshots tuned for the target persona

---

## Free vs Paid Split

A free tier is the front door, not a consolation prize. The split is driven
by **what costs us money to deliver.** Anthropic's API for Coach Al is by
far the largest per-user variable cost, so AI features anchor the paid tier.
Everything else stays generous on free.

### Free tier — "the dashboard"
- Full Scorecard (Longevity Score, BP card, Body & Weight, Quick log)
- All wearable integrations (Oura, Apple Health, future Whoop/Garmin)
- Manual entry: BP, weight, workouts, meals, supplements, peptides, meds, mood
- Community in full: friends, friend codes, Pulse feed, reactions, comments,
  DMs, weekly leagues, groups
- Goal cards (create + track goals; goal plan is paid)
- Annual Physical Snapshot report (1 free report — the most universally
  useful one, draws users into the report layer)
- Gear picks (affiliate revenue applies regardless of tier)
- Achievements, streaks (low cost, high engagement)

### Paid tier — "Coach Al + the report layer"
- Coach Al chat (Claude-powered)
- Morning briefing + Weekly Insight (Claude-powered)
- AI narrative intro on every report
- All five focused reports (Sleep, Cardiometabolic, Pre-Procedure,
  Training, Nutrition, Goal Progress) with full date ranges
- Coach Al goal plans (auto-generated, regenerate-able)
- What-if simulator on Longevity Score
- "Email this report to my doctor" flow
- Biological age headline number
- Weekly Claude recap (in-app + optional email)

### Why this split works
- Free users cost us essentially nothing (fixed Supabase + Render costs;
  per-user marginal is tiny). We can support a wide free funnel.
- Paid users justify Claude API spend; the AI features are also the most
  *differentiating* — Oura's own app doesn't have Coach Al.
- The Annual Physical Snapshot stays free because it's the strongest
  "wow" moment that pulls free users toward considering paid (they'll
  want the full Sleep + Cardiometabolic + Pre-Procedure reports).
- Community stays fully free because community drives organic growth.
  Friends of paid users who are themselves free still contribute to
  retention and leaderboard liveness.

### Trial mechanics
- New users get a **14-day free trial of the paid tier** on signup —
  experience Coach Al + all reports up front, then downgrade automatically
  to free if they don't subscribe.
- Per the locked-in referral policy: each successful referral of a new
  paying user credits 1 free month to the referrer. Visible counter in
  Profile.

---

## The Five Pillars

Originally four (David's framing); a fifth — **Insight** — was added in late
June 2026 after an honest assessment of where the product is strongest vs
weakest. BackNine has a phenomenal *data presentation* layer but a thin
*insight synthesis* layer; given how much data we collect, that gap is the
biggest near-term differentiator.

| Pillar | Status today | Where to go |
|---|---|---|
| **Longevity Score** | A- | Per-metric history, what-if simulator, biological age |
| **Community** | B | Friend goal visibility (shipped), buddy pairing, weekly recap |
| **Reports** | A | AI narrative (shipped), share-link (shipped), more report types |
| **Integrations** | C+ | Apple Health native (gated on Dev enrollment), then Whoop |
| **Insight** (new) | C- | Daily Insight Card, symptom correlation, stack efficacy, weekly summary |


### Pillar 1 — Longevity Score: trustworthy, contextual, predictive

**Where it is.** Six-slot score (HRV, RHR, VO₂, Sleep, Body Fat, Steps),
0–100 vitality number, sparkline trend, "biggest opportunity" callout,
biological-age-vs-chronological comparison line.

**What's missing.**
- Per-metric history. The sparkline shows aggregate score; users can't see
  how HRV alone moved over 90 days.
- Predictive what-ifs. "If I slept 7.5h instead of 6.2h for 30 days, what
  would my score become?" — this is the question users actually ask.
- Age/sex peer context. "23/25 HRV" is meaningful only with peer baselines.
- Today's-anchor bug: when today's sleep hasn't synced yet, the score shows
  "Connect Oura" instead of falling back to last night. (Diagnosed today.)
- Coaching depth. "Biggest opportunity" exists but never explains the
  next physical step beyond a sentence.

**Recommended next 3.**
1. **Per-metric history pop-outs** (S) — tap any slot, get a 90-day chart
   for that one metric with the threshold band overlay.
2. **What-if simulator** (M) — slider for sleep/steps/etc.; projects your
   score forward 30 days at the new behavior level.
3. **Biological age headline** (M) — research-based composite (PhenoAge-style
   formula using HRV, RHR, VO₂, BF, age). Single intuitive number.

### Pillar 2 — Community: accountability as the engagement loop

**Where it is.** Friends, friend codes, Pulse feed with reactions and
comments, weekly leagues, DMs, groups with standings.

**What's missing.**
- **Friend goal visibility.** Friends can see each other's workouts but not
  their stated goals. Accountability is much stronger when your friend
  knows you're trying to drop 3% body fat by Aug 15.
- **Habit chains as shareable artifacts.** Streaks happen invisibly today;
  if hitting 7 days in a row produced a Pulse post, friends would amplify.
- **Buddy pairing.** Designate one friend as your accountability partner.
  Daily check-in prompt nudges you on each other.
- **Cohort/club concept.** Leagues reset weekly — there's no longer-running
  team identity. A "club" of 4-12 people with rolling standings would feel
  like a real community.
- **Weekly recap.** A digest summarizing your week + your friend group's
  week. Nice email to bring users back.

**Recommended next 3.**
1. **Friend goal visibility + cheering** (S) — on the FriendDetailModal,
   show their active goal + pace; "Cheer" button posts a cheer to their
   Pulse feed.
2. **Habit chains → Pulse posts** (M) — when a 7/14/30-day streak fires,
   auto-post a milestone event friends can react to.
3. **Buddy pairing** (M) — opt-in 1:1 accountability pairing; daily
   check-in card asks "How's [buddy] doing?" and prompts a quick message.

### Pillar 3 — Reports: data professionals can actually use

**Where it is.** Six reports (Sleep / Cardiometabolic / Pre-Procedure /
Training / Nutrition / Goal Progress), all print-friendly, all reading from
the same canonical data layer.

**What's missing.**
- **Share-by-link or email-to-doctor.** Print-then-email is friction.
  A "send to doctor" flow with a tokenized read-only link is the goal.
- **AI narrative on each report.** Claude reads the structured data and
  writes a "What stands out this month" opening paragraph. Doctors love a
  one-paragraph TL;DR.
- **Comparison reports.** "This 30 days vs prior 30 days" — what changed,
  what got better, what got worse. Quarterly review use case.
- **Annual physical snapshot.** One-page everything for the once-a-year PCP
  visit. Distinct from the Sleep report which is detailed.
- **Recurring-report scheduling.** "Email my Sleep report to Dr. Smith on
  the 1st of every month."
- **Recovery / post-illness tracker.** Special report mode for tracking
  return-to-baseline after illness, surgery, or hard training block.
- **Symptom correlation.** User logs "headache today" or "low energy"; the
  report shows what their sleep / nutrition / training looked like on those
  days.

**Recommended next 3.**
1. **AI narrative on each report** (M, high perceived value) — Claude reads
   the structured payload and writes a 2–4 sentence intro highlighting what
   a clinician would notice first.
2. **Annual Physical Snapshot** (S) — one-page version pulling the single
   most important value from each existing report.
3. **Email this report to my doctor** (M) — generate PDF server-side, email
   via Resend/SendGrid; later add tokenized share-links for browser viewing.

### Pillar 4 — Wearable Integrations: broaden the data feed

**Order of priority.**

A. **Apple Health (native)** — *in flight, blocked on Apple Developer
   enrollment via Strategy D / DUNS.* Single biggest unlock; one
   integration covers BP cuffs, scales, every HealthKit data type. The
   `BackNineHealthSync` Swift scaffold is built. Once Apple approves, ~1
   day of work to ship to TestFlight.

B. **Whoop** — Whoop has a public API (developer.whoop.com) with OAuth +
   day/recovery/strain endpoints. Strong overlap with target customer
   (longevity/optimization crowd). Estimated 6–8 hours.

C. **Garmin** — Garmin Connect Health API; complex (requires partnership
   tier for some endpoints) but widely used by athletes. Estimated 10–15
   hours.

D. **Fitbit / Google Fit** — Google migrated Fitbit to the Google Fit
   ecosystem. Web API available. Reaches a different demographic than Oura.
   Estimated 8–10 hours.

E. **CGMs (Dexcom, Levels, Nutrisense)** — for the metabolic-health
   audience. Large opportunity if longevity remains the positioning.

F. **Eight Sleep** — popular in the longevity community; has an API.

G. **Withings (direct OAuth)** — already scaffolded (`withings.py` exists in
   the repo), parked because Apple Health covers it.

**Recommended sequence:** Apple Health (in flight) → Whoop → Garmin →
Fitbit/Google → evaluate CGM signal based on user demand.

### Pillar 5 — Insight: synthesize the data into something the user can act on

**Where it is.** BackNine collects almost every signal a longevity-minded
adult tracks. The Reports surface that data cleanly. The morning briefing
summarizes today. The Weekly Insight shows one weekly correlation.

**What's missing.** The "so what?" answer at the per-user level. Users see
HRV 46ms, sleep 6.2h, BP 150/95 — but they don't see *"sleep is your single
biggest cardiovascular lever right now and your HRV is 12% higher on
morning-training days."* That synthesis is what separates BackNine from
"Oura with friends."

**Anyone can pipe wearable data. Almost nobody can interpret it well at the
individual level.** That's where Anthropic-scale models earn their cost
and where BackNine's moat lives.

**Recommended next 4 (in build order).**
1. **Daily Insight Card** (S) — once a day, Claude reads the user's 14-day
   cross-domain data and surfaces ONE pattern + ONE action. Lives at the
   top of the Scorecard. Thumbs-up/down/dismiss feedback tunes future
   insights. Transforms Coach Al from reactive to proactive without
   rebuilding chat.
2. **Symptom journal + correlation** (M) — quick "how do you feel today?"
   with tags (headache, low energy, brain fog, etc.). Claude correlates
   symptom days vs symptom-free days across every signal. Killer feature
   for the men-50+ demo whose questions are usually correlative.
3. **Personalized insights feed** (M) — Discover-style feed of 3-5
   insights per week. Each insight is tagged (sleep / training /
   nutrition / recovery) and can be acted on or dismissed. Cumulative
   over time becomes the user's "what works for my body" library.
4. **Stack efficacy tracking** (M) — tag supplement/peptide/medication
   start dates; 30 days later Claude compares before-vs-after on
   relevant metrics. "Magnesium added Apr 12 → sleep efficiency +4pp,
   RHR -2 bpm" type insights. Directly addresses the longevity-
   experimenter mindset.

---

## Cross-Cutting — AI / Coach Al

Coach Al today is mostly *reactive* (responds when asked) or *scheduled*
(morning briefing). The biggest unlock is making Coach Al *proactive and
pattern-aware*:

1. **Weekly intelligent recap.** Claude reads your full week and writes a
   short narrative. Emailed or in-app. Feels like a coach who actually
   reviewed your week.
2. **Pattern detection.** "Your HRV dropped 12% after late-night meals 4 of
   5 times" — only possible when Claude has access to a structured weekly
   slice. Already partially in Weekly Insight; can go deeper.
3. **Adaptive coaching plans.** Goal plans regenerate automatically when
   user falls behind pace, instead of waiting for the user to ask.
4. **Memory layer.** Coach Al "remembers" what you told it last week
   (already partial via chat history); extend to long-term preferences and
   reactions ("user dislikes treadmill cardio").

---

## Other Cross-Cutting Themes

Things that don't fit a single pillar but make the whole product better.

- **Onboarding refinement.** Still some friction; first-load Longevity Score
  reads as "incomplete" when data hasn't backfilled.
- **Native mobile.** PWA is fine; native iOS via BackNineHealthSync unlocks
  HealthKit + push notifications + better lock-screen widgets. Blocked on
  Apple Developer enrollment.
- **HIPAA-grade security.** If BackNine ever positions as anything clinical,
  this is the gate. BAAs with Supabase + Anthropic + Render exist or are
  available. Worth scoping early.
- **Data portability.** A "download all my data" CSV/JSON export. Builds
  trust and supports doctor-share workflows.
- **Photo journal / progress pics.** Visual progress is hugely motivating;
  current weight log is numbers only.
- **Workout template library.** Curated programs (PPL, 5/3/1, Tactical
  Barbell, etc.) — turnkey content.
- **Mental health / mood layer.** Already have daily mood check-ins; deeper
  journaling + correlation with sleep/HRV is a logical extension.

---

## Recommended Sequencing (reshaped around the locked decisions)

A pragmatic 90-day plan, each phase deployable independently. Reshuffled
now that we know: iOS-first, men 50+, low-price commercial path.

### Now → next 2 weeks (small wins that compound)
- ✅ Goal Progress report (shipped)
- 🟨 Longevity Score anchor-date walkback (diagnosed; one-line fix)
- 🟨 **AI narrative intro on each report** — Claude reads the structured
     payload and writes 2–4 sentences a clinician notices first. Biggest
     "the reports feel smarter" lift for zero new data plumbing.
- 🟨 **Annual Physical Snapshot report** — one-page everything-summary.
     Perfect for the men-50+ demo's annual PCP visit.
- 🟨 **Friend goal visibility + cheering** — see your friends' active goals
     and send cheers. Community is high-leverage for this demo.
- 🟨 **Lab values field on Profile** — PSA, lipid panel, A1c, testosterone.
     Pull into the Annual Physical + Cardiometabolic reports.

### Weeks 3–6 (medium-effort, set up for commercial)
- 🚧 **Apple Health native** (assuming Developer enrollment lands —
     unblocks everything else iOS).
- **Sharpen referral mechanics** — free month auto-credited per referral
     who upgrades to paid. Surface "you've earned X free months" visibly.
- **Email-this-report-to-doctor** flow — PDF generation server-side + send.
- **Per-metric Longevity history pop-outs.**
- **Habit chain milestones → Pulse posts.**
- **Workout template library v1** — curated strength programs (PPL, 5/3/1,
     Stronger by Stretching, Tactical Barbell). Resistance focus aligns
     with sarcopenia-prevention positioning.

### Months 2–3 (commercial prep + bigger features)
- **Stripe integration + paywall + free trial** — $1.99/mo and $20/yr
     SKUs. Free 14-day trial. Money-back referrals wired in.
- **Account deletion + data export** — required for App Store + GDPR.
- **MFA / OAuth providers** — Apple Sign-In (mandatory for App Store) +
     Google Sign-In as fallback.
- **Whoop integration** — first non-Apple wearable. Strong overlap with
     target persona.
- **Buddy pairing** — designated accountability partner.
- **What-if simulator on Longevity Score.**
- **Biological age headline number.**
- **Comparison reports** (this 30 days vs prior 30 days).
- **Weekly Claude recap** (in-app card, optional email).

### Quarter+ horizon (post-launch growth)
- **iOS App Store launch** — assuming all the above is in place.
- **Garmin integration.**
- **Fitbit / Google Fit.**
- **HIPAA posture work** — BAAs with Supabase + Anthropic + Render, audit.
- **CGM integrations** (Dexcom, Levels, Nutrisense) — high signal for
     metabolic-health audience.
- **Symptom correlation tool.**
- **Recovery / post-illness tracker.**
- **Photo journal.**
- **Cross-platform — Android.** Only after iOS+web feels great.
- **Persona expansion** — women 50+, then athletes, then chronic-condition
     self-monitoring. Each is a different go-to-market motion.

---

## Commercial Launch Checklist

Distinct from feature work — these are the things that need to be true
BEFORE BackNine takes payment.

**Legal / compliance**
- [ ] Terms of Use reviewed for commercial use (drafts exist in `/docs/`)
- [ ] Privacy Policy reviewed for commercial use (drafts exist in `/docs/`)
- [ ] Medical / Health Disclaimer reviewed (drafts exist in `/docs/`)
- [ ] Data Processing Agreement template for any future B2B
- [ ] GDPR / CCPA-compliant data export + deletion flows
- [ ] App Store privacy nutrition label

**Infrastructure**
- [ ] Stripe account + product/pricing SKUs configured
- [ ] Webhook handlers for subscription events (created/cancelled/failed)
- [ ] Free trial countdown UI + "your trial ends in 3 days" notifications
- [ ] Referral credit ledger (track who referred whom, who's earned what)
- [ ] Production database backups + point-in-time recovery enabled
- [ ] Error monitoring (Sentry or similar) on backend + frontend
- [ ] Status page (status.backnine.app or similar)

**Identity / Auth**
- [ ] Apple Sign-In (mandatory for App Store apps using social login)
- [ ] Google Sign-In as fallback
- [ ] Account deletion flow (App Store now requires this in-app)
- [ ] Optional MFA / passkeys for users who want them

**Support**
- [ ] support@backnine.app inbox (or similar) with monitored response SLA
- [ ] In-app feedback button → email or Linear/Notion
- [ ] FAQ / help center (light — even 10 articles to start)
- [ ] Marketing site landing page tuned to men 50+ positioning

---

## How to Decide What's Next

At every prioritization decision, weigh four criteria:

1. **User signal** — what David and current users are actively asking for.
2. **Engagement loop** — what brings someone back tomorrow.
3. **Differentiation** — what's distinctive vs Oura's app + Apple Health +
   a generic coach.
4. **Effort/impact ratio** — quickest meaningful wins first.

When two items are similar on all four, pick the one that builds skill
or infrastructure useful for the next item.

---

## Still-Open Questions

The big questions are decided. Remaining items to think through:

- **App Store name positioning.** "BackNine" reads as a golf reference,
  which fits the target demo. Decide before submitting to the App Store
  whether the marketing leans into it (tagline, icon, color palette) or
  stays ambient and longevity-first. Probably decide alongside the
  marketing site work.
- **B2B angle.** A clinic / longevity-doctor portal that ingests patient
  reports would be a defensible enterprise SKU. Defer until the consumer
  product is proven, but worth keeping in mind for architecture decisions
  (e.g. multi-tenant patterns, role-based access).
- **International / GDPR.** Are EU users in scope at launch? Determines
  whether data residency and GDPR-strict export/deletion are launch-week
  requirements or follow-on.
- **App Store category.** Health & Fitness vs Medical. Medical category
  has higher rigor (FDA scrutiny, in some cases) but also more credibility
  among the target demo. Pick once positioning is locked.

---

*Last updated: June 2026. Edit freely as priorities shift.*
