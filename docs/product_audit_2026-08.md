# BackNine Product Audit — Keep / Freeze / Kill
*August 2026 · against the spine: "My health, scored weekly, competed with my foursome."*

**The core loop:** open the app → see your Weekly Health Span Score and Bio Age → see where you stand in the league → do the Daily Check-in → get one good Coach Al line → log the minimum (sleep/meds/meal/workout). Everything below is judged by one question: does it make that loop stronger, or is it a promise we have to keep for no one?

**Definitions.** KEEP: core loop — polish, maintain, this is where all new work goes. FREEZE: stays shipped, zero new investment, bug-fixed only if it breaks the core; hide where cheap. KILL: remove from the UI now (code can stay dormant in the repo).

---

## KEEP — the spine (9 surfaces)

| Surface | Why it stays |
|---|---|
| Weekly Health Span Score | The scoreboard. The one number the app exists to move. |
| Biological Age (+ share card) | The outcome anchor and the viral artifact. Bevel counter. |
| Weekly League + leaderboards | The king. Social is the moat — but see consolidation note below. |
| Daily Check-in | The daily habit anchor; feeds Coach Al and the streak. |
| Coach Al briefing + chat | The voice of the app. One coach, already consolidated. |
| Stack adherence (meds/supps) | Core to the 50+ audience; feeds Health Span. As-is, no expansion. |
| Data plumbing (Oura, HealthKit, Withings-via-AH, manual logs) | Nothing works without trusted data. Most bug-fix budget goes here. |
| This Week's Activity timeline | Read-only trust surface — "the app saw my Pilates class." Cheap to keep. |
| Doctor Handoff one-pager + labs OCR | The quiet moat. No other consumer app walks into the exam room. Low cadence, keep polished. |

Plus the non-negotiable chassis: auth/SIWA, profile, onboarding, capability toggles.

## FREEZE — shipped, stop investing (the long tail)

**Nutrition:** keep basic meal logging + protein (feeds Health Span). Freeze the AI plate coach, nutrition extras, macro-preset depth, body-comp report.

**Training:** keep basic workout logging (feeds Health Span). Freeze PR badges, lifetime PRs, muscle heatmap, template browser, training load cards, prescribed Today's Workout, exercise history modals, injury flags.

**Social beyond the foursome:** freeze Groups, group chat, group challenges, challenge competitions, Pulse feed depth, friend DMs. Keep one-tap taunts/cheers — they're league fuel and already built. The foursome is the unit; a foursome doesn't need a groups feature.

**Coach adjacencies:** freeze standalone Insights feed, Daily Insight card, lifestyle correlations, coach memory card, goals/goal coach, experiments (Proven For You). Anything worth saying routes through the briefing.

**Doctor layer beyond the Handoff:** freeze Visit Prep mode, visit modals, the specialty report library (annual physical, cardiometabolic, training recovery, pre-procedure, goal progress). The Handoff one-pager IS the wedge; five report types for zero doctors is inventory.

**Rituals & misc:** freeze Weekly Recap + recap share (the league's Sunday reset is the ritual), gear tab (hide from nav at launch — it dilutes the health story), vices + hydration (capability-gate like CPAP), BP card beyond data capture.

**CPAP** stays exactly as-is: capability-gated, invisible unless switched on. This is the template for every niche feature from now on.

## KILL — remove the corpses

Already dead in the UI, still in the repo: JournalCard, TonightSleepCard, WeeklyInsight, NudgeCard, TodaysTagsCard, StackEfficacyCard, ProvenLedgerCard, the old Longevity card (behind `{false &&}`). Delete the dead component files — today's stray `lib/page.tsx` bug is what unburied code costs.

---

## Two consolidations the audit forces

**1. Three leaderboard surfaces is one too many.** Weekly League (Clubhouse), Today's Leaderboard (Scorecard), LeagueGlance (Scorecard) — we just spent a session making them agree with each other. That's the breadth tax in one anecdote. Recommendation: LeagueGlance + one full leaderboard. Fold Today's Leaderboard's daily matchup (steps/sleep/activity + head-to-head + taunts) into the Weekly League page as its top section.

**2. The Metrics tab is a data admin panel, not a destination.** Connection status, sync buttons, charts. Fine — but it should feel like Settings, not compete with the Scorecard. No investment beyond reliability.

## What this buys

Every bug this week was a consistency failure across surfaces, not a hard problem: leaderboards disagreeing on methodology, a feature interaction slowing startup, Julie hitting two rough edges in her first session. Fewer live surfaces = fewer ways to disagree.

**Launch test (the Julie test):** a brand-new user's first session reaches the full core loop — score, league, check-in, one coach line, one log — with zero rough edges. We ship new features again when that test passes three new users in a row.

## What this is NOT

Not deleting work. Frozen code stays; discovery wasn't waste — it's how we found the spine (sleep debt took 8 versions to learn the card should die; that lesson is now permanent). When the foursome loop is humming and retention proves it, we unfreeze deliberately, one surface at a time, behind capability toggles.
