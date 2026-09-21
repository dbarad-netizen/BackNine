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

import { useState } from "react";
import type { BiologicalAge, BioAgeComponent } from "@/lib/api";

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
  const [expanded, setExpanded] = useState(false);
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

      {/* Under the hood (David 2026-09-21): per-marker transparency —
          our answer to Bevel's opaque Bio Age — restored to the card
          itself after the shared spine drawer proved too buried. */}
      {data.components.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
          >
            {expanded ? "▲ Hide" : `▼ Under the hood (${data.components.length} markers)`}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
              {data.confidence && (
                <p className="text-[10px] text-gray-500">
                  {data.confidence} confidence · {data.n_markers} markers
                </p>
              )}
              {data.components.map(c => <MarkerRow key={c.key} c={c} />)}
              {data.projection && Math.abs(data.projection.delta_from_now) >= 0.2 && (() => {
                const p = data.projection;
                const improving = p.delta_from_now < 0;
                const when = new Date(Date.now() + p.horizon_days * 24 * 60 * 60 * 1000)
                  .toLocaleDateString("en-US", { month: "long" });
                return (
                  <p className="text-[11px] leading-snug text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2" title={p.caveat}>
                    At your current pace (Health Span {p.healthspan_score}), your Bio Age
                    projects to{" "}
                    <span className={`font-bold ${improving ? "text-emerald-800" : "text-amber-800"}`}>
                      {p.projected_age}
                    </span>{" "}
                    by {when} — {Math.abs(p.delta_from_now).toFixed(1)} years{" "}
                    {improving ? "younger" : "older"} than today.
                  </p>
                );
              })()}
              {data.caveat && (
                <p className="text-[10px] text-gray-500 italic leading-snug">{data.caveat}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MarkerRow({ c }: { c: BioAgeComponent }) {
  const delta = c.years_delta;
  const isYounger = delta < -0.3;
  const isOlder   = delta > 0.3;
  const tone = isYounger
    ? "text-emerald-800 bg-emerald-50 border-emerald-100"
    : isOlder
    ? "text-red-800 bg-red-50 border-red-100"
    : "text-gray-700 bg-gray-50 border-gray-100";
  const sign  = delta < 0 ? "" : "+";
  const label = isYounger ? "younger" : isOlder ? "older" : "neutral";

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-gray-900">{c.label}</span>
        <span className="text-[11px] font-semibold">
          {sign}{delta.toFixed(1)} yr {label}
        </span>
      </div>
      <p className="text-[11px] text-gray-700 leading-snug mt-0.5">{c.why}</p>
    </div>
  );
}
