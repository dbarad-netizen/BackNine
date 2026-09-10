"use client";

/**
 * BiologicalAgeCard — the YOUR BODY stop on the Scorecard spine.
 *
 * Option B spine redesign (David 2026-09-10, "Let's do B"): slimmed to
 * one primary number (your biological age) with a single supporting
 * phrase (the delta vs chronological + trend chip). The confidence
 * pill, per-marker expander, projection box, and one-line auto-take all
 * moved into the shared SpineBreakdown drawer at the end of the chain —
 * the transparency-vs-Bevel move lives there now, still one tap away.
 * The share button moved to the QYL card (the chain's terminal, and the
 * share-led metric per the QYL Index experiment).
 *
 * Renders nothing when we have <3 markers (biological_age === null).
 * That's intentional: don't fake precision with 1 data point.
 *
 * David 2026-08-07 · spine 2026-09-10.
 */

import type { BiologicalAge } from "@/lib/api";

interface Props {
  data: BiologicalAge;
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function deltaTone(delta: number): string {
  if (delta <= -1) return "text-emerald-700";
  if (delta <= 1)  return "text-gray-700";
  if (delta <= 3)  return "text-amber-700";
  return "text-red-700";
}

export default function BiologicalAgeCard({ data }: Props) {
  if (data.biological_age == null || data.delta_years == null || data.chronological_age == null) {
    return null;
  }

  const absDel = Math.abs(data.delta_years);
  const isYounger = data.delta_years < 0;
  const tone = deltaTone(data.delta_years);

  return (
    <section id="biological-age-card" className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2.5 flex-wrap min-w-0">
          <span className="text-4xl font-bold tabular-nums leading-none text-[#1B3829]">
            {fmt(data.biological_age)}
          </span>
          <span className={`text-sm font-semibold ${tone}`}>
            {absDel < 0.5
              ? `on par with your ${data.chronological_age}`
              : `${fmt(absDel)} yrs ${isYounger ? "younger" : "older"} than your ${data.chronological_age}`}
          </span>
          {data.trend && Math.abs(data.trend.delta_years) >= 0.1 && (() => {
            const dt = data.trend.delta_years;
            const isBetter = dt < 0;
            const chip = isBetter ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                  : "text-red-700 bg-red-50 border-red-200";
            return (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${chip}`}
                title={`Compared to your Bio Age ~${data.trend.days_ago} days ago`}
              >
                {isBetter ? "▼" : "▲"} {Math.abs(dt).toFixed(1)} yr vs {data.trend.days_ago}d ago
              </span>
            );
          })()}
        </div>
        <p className="shrink-0 text-[10px] text-gray-500 uppercase tracking-widest text-right leading-tight">
          🧬 Biological<br />Age
        </p>
      </div>
    </section>
  );
}
