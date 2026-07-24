"use client";

/**
 * OnboardingCard — welcome checklist at the top of the Scorecard for
 * brand-new users.
 *
 * Three steps, in the order that unlocks the most value fastest:
 *   1. Connect your Oura ring — powers most cards (Sleep, HRV, RHR).
 *   2. Set your #1 goal — Coach Al personalizes off this.
 *   3. Do your first check-in — mood tap, ~5 seconds.
 *
 * State comes from `/api/onboarding/status` — a derived read over the
 * data the app already stores. Completed steps get a check + collapse.
 * When all three are done the card celebrates and auto-dismisses after
 * one more render. There's also a Skip link for power users who want
 * to explore first (POSTs /api/onboarding/dismiss).
 *
 * The card renders NOTHING when status.show is false, so the Scorecard
 * layout is unchanged for returning users.
 */

import { useEffect, useState } from "react";
import { api, type OnboardingStatus } from "@/lib/api";

interface Props {
  /** Optional: parent gets a hook so it can scroll/focus the Daily
   *  Check-in card when the user taps Step 3's CTA. */
  onFocusDailyCheckin?: () => void;
}

const OURA_CONNECT_PATH = "/auth/oura";  // existing OAuth start endpoint

export default function OnboardingCard({ onFocusDailyCheckin }: Props) {
  const [status, setStatus]   = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.onboardingStatus();
        if (!cancelled) setStatus(s);
      } catch { /* silently hide on error */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !status || !status.show) return null;

  const { steps, completed } = status;
  const totalSteps    = 4;
  const doneCount     =
    Number(steps.foursome_invited) +
    Number(steps.oura_connected) +
    Number(steps.goal_set) +
    Number(steps.checked_in);
  const progressPct   = Math.round((doneCount / totalSteps) * 100);

  const handleDismiss = async () => {
    setDismissing(true);
    try { await api.dismissOnboarding(); } catch { /* fall through */ }
    setStatus({ ...status, show: false });
  };

  const handleConnectOura = () => {
    // Kick off Oura OAuth. The backend sets the correct redirect back
    // to the dashboard, which will re-fetch onboarding status and mark
    // this step done.
    const base = process.env.NEXT_PUBLIC_API_URL || "";
    window.location.href = `${base}${OURA_CONNECT_PATH}`;
  };

  const handleInviteFoursome = () => {
    // Foursome-first — David 2026-07-23 (Fable competitive brief).
    // Community is our structural moat; making it the first
    // onboarding step (before Connect Oura) is the biggest default
    // change we can ship. Jumps to the Clubhouse tab's invite form.
    window.location.hash = "invite-friend";
    setTimeout(() => {
      const el = document.getElementById("invite-friend");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  };

  const handleSetGoal = () => {
    // Scroll to and open the Goal Progress card / Set-your-goal CTA.
    // We just hash-navigate — the section below intercepts.
    window.location.hash = "set-goal";
    // Give the DOM a beat to react.
    setTimeout(() => {
      const el = document.getElementById("set-goal");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  };

  const handleCheckIn = () => {
    if (onFocusDailyCheckin) onFocusDailyCheckin();
    // Fallback: scroll to the Daily Check-in card if the id is set.
    setTimeout(() => {
      const el = document.getElementById("daily-checkin");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  };

  return (
    <section
      className="rounded-2xl border border-[#1B3829]/20 bg-gradient-to-br from-[#F4F1EA] to-white shadow-sm p-4 space-y-3"
      aria-label="Welcome checklist"
    >
      {/* Header + progress */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2D6A4F]">
            {completed ? "You're set" : "Welcome to BackNine"}
          </p>
          <h2 className="text-base font-bold text-[#1B3829] mt-0.5">
            {completed
              ? "Nice — everything's connected."
              : "Let's get you set up in 60 seconds."}
          </h2>
        </div>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-[11px] text-gray-500 hover:text-[#1B3829] font-medium shrink-0 py-1 px-1.5 rounded-md hover:bg-white/60"
          title="Skip this — I know my way around"
        >
          Skip
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-[#1B3829]/10 overflow-hidden">
        <div
          className="h-full bg-[#2D6A4F] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Steps — foursome-first (David 2026-07-23, Fable brief).
          Community is the structural moat, so make it the default
          first move instead of a hidden feature. */}
      <ol className="space-y-1.5">
        <Step
          n={1}
          done={steps.foursome_invited}
          title="Bring your foursome"
          hint="Invite your spouse, workout partners, or the guys you tee off with. Longevity is a team sport — and friends halve churn."
          ctaLabel="Invite people"
          onCta={handleInviteFoursome}
        />
        <Step
          n={2}
          done={steps.oura_connected}
          title="Connect your Oura ring"
          hint="Powers Sleep, HRV, Readiness, and the Doctor Report. Optional — the app still works without it."
          ctaLabel="Connect Oura"
          onCta={handleConnectOura}
        />
        <Step
          n={3}
          done={steps.goal_set}
          title="Tell Coach Al your #1 goal"
          hint="Live longer, feel more energy, build muscle, better sleep — Coach Al personalizes off this."
          ctaLabel="Set my goal"
          onCta={handleSetGoal}
        />
        <Step
          n={4}
          done={steps.checked_in}
          title="Do your first check-in"
          hint="Tap a mood on Daily Check-in. Five seconds. Builds the pattern data insights read from."
          ctaLabel="Check in now"
          onCta={handleCheckIn}
        />
      </ol>

      {completed && (
        <p className="text-[12px] text-[#2D6A4F] font-medium pt-1">
          🎉 You're in. Come back tomorrow for your first insight.
        </p>
      )}
    </section>
  );
}


// ── Single-step row ──────────────────────────────────────────────────────

interface StepProps {
  n:         number;
  done:      boolean;
  title:     string;
  hint:      string;
  ctaLabel:  string;
  onCta:     () => void;
}

function Step({ n, done, title, hint, ctaLabel, onCta }: StepProps) {
  return (
    <li className={`rounded-xl border px-3 py-2.5 transition-colors ${
      done
        ? "border-[#2D6A4F]/25 bg-[#2D6A4F]/5"
        : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-start gap-2.5">
        {/* Number / check */}
        <div
          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
            done
              ? "bg-[#2D6A4F] text-white"
              : "bg-[#1B3829]/10 text-[#1B3829]"
          }`}
          aria-hidden
        >
          {done ? "✓" : n}
        </div>

        {/* Title + hint */}
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold leading-tight ${
            done ? "text-[#2D6A4F] line-through decoration-1" : "text-gray-900"
          }`}>
            {title}
          </p>
          {!done && (
            <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{hint}</p>
          )}
        </div>

        {/* CTA — hidden when done */}
        {!done && (
          <button
            onClick={onCta}
            className="shrink-0 text-[11px] font-semibold text-white bg-[#1B3829] hover:bg-[#2D6A4F] px-2.5 py-1.5 rounded-lg transition-colors"
          >
            {ctaLabel}
          </button>
        )}
      </div>
    </li>
  );
}
