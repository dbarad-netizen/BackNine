"use client";

/**
 * ActiveExperimentsCard — Scorecard surface for in-flight experiments.
 *
 * The competitive moat card. Aveil's "What Works For You" ledger only
 * shows finished results; BackNine also shows the *commitment* — day
 * 3 of 7 on your dinner-cutoff test, day 5 on the magnesium trial.
 * The active state is the daily anchor.
 *
 * Self-hides when there are no active experiments — the empty state
 * is that the Daily Insight card is where users start experiments,
 * and nagging "you have no experiments" would be noise. Once one is
 * running the card appears with the day-progress bar.
 *
 * Tap on an experiment → expands inline with abandon button + baseline
 * numbers so the user can see what's being measured. No deep-link;
 * kept quick + honest.
 */

import { useEffect, useState } from "react";
import { api, type Experiment } from "@/lib/api";

export default function ActiveExperimentsCard() {
  const [items, setItems]     = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState<string | null>(null);
  const [busyId, setBusyId]   = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.activeExperiments()
      .then(r => setItems(r.experiments || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const abandon = async (exp: Experiment) => {
    if (!confirm(`Stop tracking "${exp.action}"? No result will be saved to your ledger.`)) return;
    setBusyId(exp.id);
    try {
      await api.abandonExperiment(exp.id);
      setItems(prev => prev.filter(x => x.id !== exp.id));
    } catch {
      // Fall through — user can retry
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#1B3829]/20 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#1B3829]">
          Testing this week
        </p>
        <span className="text-[10px] text-gray-500">
          {items.length} active
        </span>
      </div>

      <ul className="space-y-2.5">
        {items.map(exp => {
          const isOpen = openId === exp.id;
          const pct    = exp.progress_pct ?? 0;
          const day    = exp.day_index ?? 0;
          const total  = exp.day_total ?? 7;
          return (
            <li key={exp.id}>
              <button
                onClick={() => setOpenId(isOpen ? null : exp.id)}
                className="w-full text-left rounded-xl bg-white border border-gray-200 hover:border-[#1B3829]/40 px-3 py-2.5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[13px] font-semibold text-gray-900 leading-tight flex-1">
                    {exp.action}
                  </p>
                  <span className="text-[10px] font-medium text-[#1B3829] shrink-0 whitespace-nowrap">
                    Day {day} of {total}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-[#2D6A4F] transition-all duration-500"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5 leading-tight">
                  Testing: {exp.metric_label}
                  {exp.baseline_avg !== null && (
                    <> · baseline {exp.baseline_avg}{exp.unit}</>
                  )}
                </p>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="mt-1.5 mx-1 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 space-y-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">
                      Hypothesis
                    </p>
                    <p className="text-[12px] text-gray-700 leading-snug italic">
                      &ldquo;{exp.hypothesis}&rdquo;
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">
                        Baseline (last 7 days)
                      </p>
                      <p className="text-[13px] font-semibold text-gray-900">
                        {exp.baseline_avg !== null ? `${exp.baseline_avg}${exp.unit}` : "—"}
                        <span className="text-[10px] font-normal text-gray-500 ml-1">
                          n={exp.baseline_n ?? 0}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">
                        Result by
                      </p>
                      <p className="text-[13px] font-semibold text-gray-900">
                        {new Date(exp.test_end_date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => abandon(exp)}
                    disabled={busyId === exp.id}
                    className="text-[11px] text-gray-500 hover:text-red-600 underline underline-offset-2 disabled:opacity-50"
                  >
                    {busyId === exp.id ? "Stopping..." : "Stop this experiment"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-gray-500 mt-3 leading-snug">
        Each experiment compares your last 7 days before to 7 days during.
        Results land on your Proven ledger only when the change beats
        normal day-to-day noise.
      </p>
    </section>
  );
}
