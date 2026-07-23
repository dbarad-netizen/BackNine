"use client";

/**
 * StackAdherencePill — compact Scorecard pill that shows today's stack
 * adherence at a glance and, on tap, deep-links into the Nutrition tab
 * with a highlight pulse on the full StackAdherenceCard.
 *
 * David 2026-07-23: the full checklist lives on Nutrition, but users
 * open the app on Scorecard first. Without a Scorecard surface, taking
 * a med felt like an extra journey. This pill closes the loop — glance
 * count on the Scorecard, one tap → checklist ready to check off.
 *
 * Self-hides when:
 *  • loading (never render placeholder)
 *  • the user has no stack items (nothing to track)
 *  • the endpoint errors (silent — card still renders on Nutrition and
 *    surfaces the real issue if any)
 *
 * Pass `onJump()` to switch section; this component does the scroll +
 * pulse itself so we don't leak scroll logic into page.tsx.
 */

import { useEffect, useState } from "react";
import { api, type StackAdherenceSnapshot } from "@/lib/api";

const TARGET_ID = "stack-adherence-card";

function jumpAndPulse(): void {
  // Wait a tick for the section swap to render the target, then
  // scroll + attention pulse. 60ms is enough for a state flip and
  // reflow on modern devices.
  setTimeout(() => {
    const el = document.getElementById(TARGET_ID);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[#1B3829]/60", "ring-offset-2");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-[#1B3829]/60", "ring-offset-2");
    }, 1600);
  }, 60);
}

export default function StackAdherencePill({ onJump }: { onJump: () => void }) {
  const [snap, setSnap] = useState<StackAdherenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.stackAdherenceToday()
      .then(r => { if (!cancelled) setSnap(r); })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
  }, []);

  if (loading) return null;
  if (!snap || !snap.items || snap.items.length === 0) return null;

  const { taken_today, expected_by_now, on_pace_pct } = snap.summary;
  const totalStack = snap.items.length;
  // Pending "right now" — items due but not yet taken.
  const pendingNow = Math.max(0, expected_by_now - taken_today);
  const allDone   = expected_by_now > 0 && taken_today >= expected_by_now;
  const noneDueYet = expected_by_now === 0;

  // Copy variants:
  //  • all caught up → "✅ Stack: on pace"
  //  • pending items → "💊 2 due · 1 taken"
  //  • morning not started (nothing due) → "💊 Log stack when ready"
  const headline = allDone
    ? "Stack: on pace"
    : noneDueYet
      ? "Stack ready when you are"
      : `${pendingNow} due · ${taken_today} taken`;

  const emoji = allDone ? "✅" : noneDueYet ? "💊" : "💊";

  const handleClick = () => {
    onJump();
    jumpAndPulse();
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm hover:bg-gray-50 hover:border-[#1B3829]/40 transition-colors text-left"
      aria-label="Log today's stack — jump to Nutrition"
    >
      <span className="text-xl shrink-0" aria-hidden>{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Today&rsquo;s stack
        </p>
        <p className="text-[13px] font-semibold text-gray-900 leading-tight">
          {headline}
        </p>
        {/* Sub-line: overall count + on-pace % when we have a signal */}
        {expected_by_now > 0 && !allDone && (
          <p className="text-[11px] text-gray-500 mt-0.5">
            {taken_today}/{expected_by_now} due &middot; {on_pace_pct}% on pace &middot; {totalStack} in stack
          </p>
        )}
        {allDone && (
          <p className="text-[11px] text-gray-500 mt-0.5">
            {taken_today}/{totalStack} taken today
          </p>
        )}
      </div>
      <span className="text-gray-400 text-sm shrink-0">→</span>
    </button>
  );
}
