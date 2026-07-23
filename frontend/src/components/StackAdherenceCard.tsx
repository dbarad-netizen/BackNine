"use client";

/**
 * StackAdherenceCard — daily "did you take X today?" checklist grouped
 * by time-of-day (David 2026-07-09).
 *
 * Original design was a flat checklist. Problem David caught: a bedtime
 * med checked in at 10am reads as "3 of 5 taken" — implying the
 * evening ones are misses when actually they're not yet due.
 *
 * Fix: group by Morning / Midday / Evening / Anytime. The summary
 * counter compares taken vs "expected by now" (window open), so at
 * 9am the counter reads "2 of 2 morning taken · 3 evening pending"
 * instead of "2 of 5 taken."
 *
 * Time-of-day comes from either an explicit picker on the profile or
 * inferred from the existing freeform `timing` string ("with dinner"
 * → evening, "AM" → morning). Zero-config for existing users.
 */

import { useEffect, useState } from "react";
import { api, type StackAdherenceItem, type StackAdherenceGroup, type StackAdherenceSnapshot } from "@/lib/api";

const KIND_META: Record<StackAdherenceItem["kind"], { emoji: string; label: string; tint: string }> = {
  medication: { emoji: "🩹", label: "Med",  tint: "text-rose-800"    },
  supplement: { emoji: "💊", label: "Supp", tint: "text-emerald-800" },
  peptide:    { emoji: "🧬", label: "Pep",  tint: "text-purple-800"  },
};

const GROUP_META: Record<StackAdherenceGroup["time_of_day"], { label: string; emoji: string; bg: string }> = {
  morning: { label: "Morning", emoji: "🌅", bg: "bg-amber-50/60"    },
  midday:  { label: "Midday",  emoji: "☀️", bg: "bg-yellow-50/60"   },
  evening: { label: "Evening", emoji: "🌙", bg: "bg-indigo-50/60"   },
  anytime: { label: "Anytime", emoji: "🕐", bg: "bg-gray-50/60"     },
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
  if (!snap || snap.groups.length === 0) return null;

  const toggle = async (it: StackAdherenceItem) => {
    const nextTaken = !it.taken_today;
    // Optimistic update — flip the item across both flat items[] and
    // the group it belongs to.
    setSnap(prev => {
      if (!prev) return prev;
      const mapItem = (x: StackAdherenceItem) =>
        x.key === it.key && x.kind === it.kind
          ? { ...x, taken_today: nextTaken, logged_today: true,
              days_taken_7: nextTaken ? x.days_taken_7 + 1 : Math.max(0, x.days_taken_7 - 1) }
          : x;
      const nextItems  = prev.items.map(mapItem);
      const nextGroups = prev.groups.map(g => {
        const items = g.items.map(mapItem);
        const taken = items.filter(x => x.taken_today).length;
        return { ...g, items, taken };
      });
      return {
        ...prev,
        items:  nextItems,
        groups: nextGroups,
        summary: {
          ...prev.summary,
          taken_today: prev.summary.taken_today + (nextTaken ? 1 : -1),
          logged_today: it.logged_today ? prev.summary.logged_today : prev.summary.logged_today + 1,
        },
      };
    });
    setBusy(`${it.kind}:${it.key}`);
    try {
      await api.logStackAdherence({
        item_kind: it.kind,
        item_name: it.name,
        taken:     nextTaken,
      });
    } catch {
      // Roll back — flip it back to prior state.
      setSnap(prev => {
        if (!prev) return prev;
        const rollback = (x: StackAdherenceItem) =>
          x.key === it.key && x.kind === it.kind ? { ...x, taken_today: !nextTaken } : x;
        return {
          ...prev,
          items:  prev.items.map(rollback),
          groups: prev.groups.map(g => ({ ...g, items: g.items.map(rollback),
                                          taken: g.items.map(rollback).filter(x => x.taken_today).length })),
        };
      });
    } finally {
      setBusy(null);
    }
  };

  const { taken_today, expected_by_now, logged_today, on_pace_pct } = snap.summary;
  // Points = 1 per logged item. Frontend-only display.
  const points = logged_today;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Today&rsquo;s stack
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {expected_by_now > 0 ? (
              <><span className="font-semibold text-gray-900">{taken_today}</span>/{expected_by_now} due · <span className="text-gray-400">{on_pace_pct}% on pace</span></>
            ) : (
              <>Waiting for morning</>
            )}
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

      {/* Progress bar — anchored to expected_by_now so evening meds don't drag it down */}
      {expected_by_now > 0 && (
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
          <div
            className="h-full bg-[#2D6A4F] transition-all duration-500"
            style={{ width: `${Math.min(100, on_pace_pct)}%` }}
          />
        </div>
      )}

      <div className="space-y-3">
        {snap.groups.map(group => {
          const meta = GROUP_META[group.time_of_day];
          const notYet = !group.window_open;
          return (
            <div key={group.time_of_day} className={`rounded-xl px-3 pt-2 pb-2.5 ${meta.bg}`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                  <span className="mr-1">{meta.emoji}</span>
                  {meta.label}
                  {notYet && (
                    <span className="ml-1.5 text-[9px] font-normal text-gray-500 normal-case">
                      · not yet
                    </span>
                  )}
                </p>
                <span className={`text-[10px] font-semibold ${notYet ? "text-gray-400" : "text-gray-700"}`}>
                  {group.taken}/{group.total}
                </span>
              </div>

              <ul className="space-y-1">
                {group.items.map(it => {
                  const isBusy = busy === `${it.kind}:${it.key}`;
                  const kindMeta = KIND_META[it.kind];
                  return (
                    <li key={`${it.kind}:${it.key}`}>
                      <button
                        onClick={() => !isBusy && toggle(it)}
                        disabled={isBusy}
                        className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                          it.taken_today
                            ? "border-emerald-300 bg-emerald-50"
                            : notYet
                              ? "border-gray-200 bg-white/60 opacity-70"
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
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 leading-snug mt-3">
        Meds are grouped by when you usually take them. Evening items don&rsquo;t
        count as &ldquo;missed&rdquo; until evening. Set the time-of-day per item on
        your Profile if the grouping looks off.
      </p>
    </section>
  );
}
