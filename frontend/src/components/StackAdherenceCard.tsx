"use client";

/**
 * StackAdherenceCard — daily "did you take X today?" checklist.
 *
 * David 2026-07-09: the current StackEfficacyCard compares before/after
 * averages using the profile-entry date as the "start," which produces
 * false-positive efficacy claims (nobody takes every dose every day
 * and users often add supplements retroactively). This card gives real
 * adherence signal: one tap per item per morning.
 *
 * Renders nothing when the user has no medications / supplements /
 * peptides on their profile (empty checklist = noise).
 *
 * Points: user earns +1 pt per item logged, capped at their stack
 * size. Tracked client-side + written to the daily_briefings streak
 * via a separate mechanism (existing app-streak infrastructure).
 */

import { useEffect, useState } from "react";
import { api, type StackAdherenceItem, type StackAdherenceSnapshot } from "@/lib/api";

const KIND_META: Record<StackAdherenceItem["kind"], { emoji: string; label: string; tint: string }> = {
  medication: { emoji: "🩹", label: "Med",  tint: "text-rose-800"    },
  supplement: { emoji: "💊", label: "Supp", tint: "text-emerald-800" },
  peptide:    { emoji: "🧬", label: "Pep",  tint: "text-purple-800"  },
};

export default function StackAdherenceCard() {
  const [snap, setSnap]     = useState<StackAdherenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.stackAdherenceToday()
      .then(r => { if (!cancelled) setSnap(r); })
      .catch(() => { /* silent — card just hides */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (!snap || snap.items.length === 0) return null;

  const toggle = async (it: StackAdherenceItem) => {
    const nextTaken = !it.taken_today;
    // Optimistic update so the tap feels instant.
    setSnap(prev => prev ? {
      ...prev,
      items: prev.items.map(x => x.key === it.key && x.kind === it.kind
        ? { ...x, taken_today: nextTaken, logged_today: true,
            days_taken_7: nextTaken ? x.days_taken_7 + 1 : Math.max(0, x.days_taken_7 - 1) }
        : x),
      summary: {
        ...prev.summary,
        taken_today: prev.summary.taken_today + (nextTaken ? 1 : -1),
        logged_today: it.logged_today ? prev.summary.logged_today : prev.summary.logged_today + 1,
      },
    } : prev);
    setBusy(`${it.kind}:${it.key}`);
    try {
      await api.logStackAdherence({
        item_kind: it.kind,
        item_name: it.name,
        taken:     nextTaken,
      });
    } catch {
      // Roll back optimistic update on failure.
      setSnap(prev => prev ? {
        ...prev,
        items: prev.items.map(x => x.key === it.key && x.kind === it.kind
          ? { ...x, taken_today: !nextTaken }
          : x),
      } : prev);
    } finally {
      setBusy(null);
    }
  };

  const total = snap.summary.total_items;
  const taken = snap.summary.taken_today;
  const pct   = total > 0 ? Math.round((taken / total) * 100) : 0;
  // Points = 1 per logged item, capped by stack size. Frontend-only display;
  // the real streak reward is aggregated on the backend later.
  const points = snap.summary.logged_today;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Today&rsquo;s stack
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            <span className="font-semibold text-gray-900">{taken}</span>/{total} taken
          </span>
          {points > 0 && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
              title="Points earned today for tracking your stack"
            >
              +{points} pts
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
        <div
          className="h-full bg-[#2D6A4F] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-1.5">
        {snap.items.map(it => {
          const isBusy = busy === `${it.kind}:${it.key}`;
          const kindMeta = KIND_META[it.kind];
          return (
            <li key={`${it.kind}:${it.key}`}>
              <button
                onClick={() => !isBusy && toggle(it)}
                disabled={isBusy}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                  it.taken_today
                    ? "border-emerald-300 bg-emerald-50/60"
                    : it.logged_today
                      ? "border-gray-200 bg-gray-50"
                      : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
                aria-pressed={it.taken_today}
              >
                {/* Checkbox */}
                <div
                  className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                    it.taken_today
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {it.taken_today && <span className="text-[11px] leading-none">✓</span>}
                </div>

                {/* Name + kind */}
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold leading-tight ${
                    it.taken_today ? "text-emerald-900" : "text-gray-900"
                  }`}>
                    {it.name}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <span className={kindMeta.tint}>{kindMeta.emoji} {kindMeta.label}</span>
                    {it.days_taken_7 > 0 && (
                      <span className="text-gray-400">
                        · {it.days_taken_7}/7 days
                      </span>
                    )}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-gray-500 leading-snug mt-3">
        Real adherence data lets Coach Al call out whether a supplement is
        actually moving your metrics — not just guessing from when you added it.
      </p>
    </section>
  );
}
