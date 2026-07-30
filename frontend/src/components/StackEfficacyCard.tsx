"use client";

/**
 * StackEfficacyCard — RETIRED 2026-07-30.
 *
 * The original design compared "before you started X" averages to
 * "after you started X" averages across HRV / RHR / sleep / etc. and
 * displayed the delta with green/red color coding for "helpful" vs
 * "harmful."
 *
 * David 2026-07-30 caught the fundamental problem: when a user takes
 * 15 things simultaneously and life confounders swing HRV 20%
 * week-to-week, no per-item before/after can honestly separate signal
 * from noise. The color-coded delta table read as causation regardless
 * of the disclaimer text underneath. That's not a fixable prompt
 * problem — it's a fundamentally unsound analytical method for the
 * kind of data we have.
 *
 * Replacement: Proven For You (task #130). One variable at a time,
 * 7-day baseline snapshot at commit, 7-day test window, Cohen's-d
 * significance against the user's own noise. That IS honest efficacy
 * data.
 *
 * We keep this component around as a pointer so returning users who
 * open the Nutrition tab find their way to the new mechanism instead
 * of just seeing a card disappear. Small, one-time, dismissible.
 */

import { useEffect, useState } from "react";

const DISMISSED_KEY = "bn_stack_efficacy_retirement_dismissed";

export default function StackEfficacyCard() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const val = localStorage.getItem(DISMISSED_KEY);
      setDismissed(val === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0" aria-hidden>📓</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-900">
              Stack efficacy has moved
            </p>
            <button
              onClick={handleDismiss}
              className="shrink-0 text-amber-700 hover:text-amber-900 text-base leading-none px-1 -mt-0.5"
              aria-label="Dismiss"
              title="Dismiss"
            >×</button>
          </div>
          <p className="text-[13px] text-gray-900 font-semibold leading-tight">
            The old before-vs-after table was retired.
          </p>
          <p className="text-[12px] text-gray-700 leading-relaxed mt-1">
            Too many things change at once in real life for a raw before-vs-after
            comparison to honestly say whether ONE supplement is doing anything.
            Efficacy claims now come from <strong>Proven For You</strong> — commit
            to a 7-day test on one thing at a time, and the app compares the
            test window to your own baseline with a proper significance check.
            Any Daily Insight can be tested this way with a single tap.
          </p>
          <p className="text-[11px] text-gray-600 italic mt-2 leading-snug">
            Your Proven ledger lives on the Scorecard.
          </p>
        </div>
      </div>
    </section>
  );
}
