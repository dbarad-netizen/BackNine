# BackNine — Business Brief

## What we're building

BackNine is a personal longevity dashboard for men over 50. It aggregates data from wearables (Oura Ring is primary today; Apple Health via Health Auto Export is being added; Withings is planned), combines it with manual inputs (workouts, meals, symptoms, private reflection journal, biometrics), and organizes everything around a single AI coach called Coach Al. Coach Al reads the user's data across sleep, training, nutrition, recovery, and lifestyle tags to answer questions in chat, generate a daily briefing, prescribe a daily workout ("Today's Workout"), suggest a daily eating plan ("Today's Plate"), and surface weekly patterns as "Insights."

The strategic thesis is that men in their fifties and sixties are over-served by athletic-performance tools like Whoop (built for younger competitive athletes) and under-served by longevity-adjacent products like Lifeforce ($349/month, blood panels + human coach) and Function Health (annual labs, no daily companion). BackNine sits in the middle: cheap, daily, AI-coached, personalized, but framed around healthspan rather than athletic strain.

## Current state

The product is functionally complete on the pre-commercial checklist. Five pillars are live: Longevity (dashboard, scores, forward projections), Community (friends, groups, group challenges, PulseFeed, weekly recap sharing, safe-tag friend events, Coach Al posts into group chat), Reports (seven health report tabs including a dedicated doctor's handoff with print/PDF and tokenized share-link support), Integrations (Oura workouts + sessions + naps + enhanced tags, Apple Health metrics), and Insight (daily Claude-generated insights, symptom journal with cross-metric correlations, stack efficacy tracking, personalized insights feed, private reflection journal with Oura-tag correlations). Coach Al chat has full context across every pillar. Row-level security is enforced on all tables.

The technology stack is Next.js on Vercel, FastAPI on Render, Supabase Postgres, Claude Haiku 4.5 for all AI narrative and coaching, and standard OAuth flows for Oura. Payment infrastructure (Stripe), Apple Sign-In, Google Sign-In, and account deletion/data export are the main pre-launch gaps.

## Business model

Planned pricing is $1.99/month or $20/year, with a free tier and money-back credit for successful referrals. Additional revenue is expected from affiliate links (a "Picked For You" gear surface already exists as an impressions-driven placement). Launch is planned as iOS-first because the persona skews iPhone-heavy. No family plan is planned; the target user is buying for himself, not managing a household. App Store name and DUNS enrollment are in progress.

## Competitive positioning

The closest analog is Sonar (sonarhealth.co), which has approximately 250,000 users, supports 60+ wearables, and recently launched Sonar AI. Sonar is the biggest threat because it independently arrived at almost the same product spec: wearable-agnostic aggregator with an AI coach across pillars. Bevel is a second close competitor but is Apple Watch-first. Whoop is a hardware-locked athletic recovery tool. Lifeforce, Function Health, Levels, and Eight Sleep each own a single vertical (biomarkers, CGM, sleep hardware) rather than an integrated companion.

BackNine's differentiation is a combination no single competitor holds: 50+ male persona positioning, a real community pillar (Sonar and Bevel are individual tools), aggressive $1.99/month wedge pricing, a doctor-handoff report layer that no competitor prioritizes, and a design principle recently committed to — "never re-render data the user has a primary source for" — so we don't compete with Oura on raw sleep hours or Apple Health on step counts. We compete on interpretation, prescription, and social layer.

## Recent notable product decisions

Two design principles emerged from a rough sleep-debt debugging arc and are now guiding future feature work. First: never re-render data the user has a primary source for. Second: if a card can't reliably show prescriptive content, hide it entirely rather than render generic filler. These have led to retiring one feature (a "Tonight's Sleep" prescription card) and consciously not building others (an in-app step counter, an in-app weight-in scale UI).

Two recent additions worth flagging as differentiators. First, full Oura enhanced-tag integration: BackNine pulls sauna, ice bath, meditation, alcohol, caffeine, late-meal, stressful-day, travel, and other lifestyle tags into a correlation engine so Coach Al can reason with lines like "your last 3 alcohol nights all had sleep efficiency below 75%." Second, a private reflection journal shipped with a hard privacy contract: entries never appear in any social surface. Coach Al reads recent entries inside the user's own chat only, with an explicit system-prompt directive that the content stays in that conversation.

## What we're asking

We want a candid outside read. Specifically:

Is the 50+ male persona thesis defensible given Sonar's demographic-agnostic traction, or does the tight persona limit us to a smaller addressable market than the AI inference costs justify at $1.99/month?

Does the $1.99/month price point make sense given per-user AI inference costs and the sophistication of the coach, or should we be pricing at $4.99–$9.99 and trading up on quality signaling?

Are there community mechanics — group challenges, weekly recap sharing, Coach Al announcing PRs into groups — that have proven durable engagement drivers in adjacent categories (Strava, Whoop teams, Peloton) we could adapt more aggressively?

Is there a category expansion play — mental wellness, biological age, cognition, sexual health — that would strengthen the positioning without diluting the healthspan framing? A private reflection journal was recently shipped as a step in that direction; is there a bigger move worth committing to before commercial launch?

Where is the biggest positioning risk we're not seeing?
