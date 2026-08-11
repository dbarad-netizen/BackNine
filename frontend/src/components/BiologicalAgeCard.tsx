"use client";

/**
 * BiologicalAgeCard — headline vitality metric on the Scorecard.
 *
 * Shows chronological age vs computed biological age with the delta
 * as a big number ("4.7 years younger than 57"). Below that, an
 * expandable list of markers and their years-contribution — the
 * transparency-vs-Bevel move.
 *
 * Renders nothing when we have <3 markers (biological_age === null).
 * That's intentional: don't fake precision with 1 data point.
 *
 * David 2026-08-07.
 */

import { useState } from "react";
import type { BiologicalAge, BioAgeComponent } from "@/lib/api";

interface Props {
  data: BiologicalAge;
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function deltaColor(delta: number): { text: string; bg: string; border: string; label: string } {
  if (delta <= -3) return { text: "text-emerald-800", bg: "bg-emerald-50", border: "border-emerald-200", label: "younger" };
  if (delta <= -1) return { text: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-emerald-200", label: "younger" };
  if (delta <= 1)  return { text: "text-gray-800",    bg: "bg-gray-50",     border: "border-gray-200",    label: "on par" };
  if (delta <= 3)  return { text: "text-amber-800",   bg: "bg-amber-50",    border: "border-amber-200",   label: "older" };
  return { text: "text-red-800", bg: "bg-red-50", border: "border-red-200", label: "older" };
}

function confidencePill(conf: BiologicalAge["confidence"], n: number): { color: string; label: string } {
  if (conf === "high")   return { color: "bg-emerald-100 text-emerald-800", label: `High confidence · ${n} markers` };
  if (conf === "medium") return { color: "bg-amber-100 text-amber-800",     label: `Medium confidence · ${n} markers` };
  return                        { color: "bg-gray-100 text-gray-600",       label: `Low confidence · ${n} markers` };
}

export default function BiologicalAgeCard({ data }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (data.biological_age == null || data.delta_years == null || data.chronological_age == null) {
    return null;
  }

  const dc     = deltaColor(data.delta_years);
  const chip   = confidencePill(data.confidence, data.n_markers);
  const absDel = Math.abs(data.delta_years);
  const isYounger = data.delta_years < 0;

  return (
    <section
      id="biological-age-card"
      className={`rounded-2xl border-2 p-4 shadow-sm ${dc.border} ${dc.bg}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700">
            🧬 Biological Age
          </p>
          <h3 className="text-base font-bold text-[#1B3829] mt-0.5 leading-tight">
            Your body reads as {fmt(data.biological_age)}
          </h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.color}`}>
          {chip.label}
        </span>
      </div>

      {/* Big delta */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`text-3xl font-black ${dc.text}`}>
          {absDel < 0.5 ? "≈" : fmt(absDel)}
        </span>
        <span className={`text-sm font-semibold ${dc.text}`}>
          {absDel < 0.5 ? "on par with" : (isYounger ? "years younger than" : "years older than")}
        </span>
        <span className="text-sm text-gray-700">chronological {data.chronological_age}</span>
      </div>

      {/* One-line auto-take — surfaces the biggest driver so the user
          gets an insight without expanding. David 2026-08-11 polish. */}
      {(() => {
        const best  = data.components[data.components.length - 1]; // smallest |years_delta| — best-in-class
        const worst = data.components[0]; // largest |years_delta| — biggest mover (positive or negative)
        // Components come pre-sorted by |years_delta| desc from the backend.
        if (!worst) return null;
        const worstBad = worst.years_delta > 0.3;
        const worstGood = worst.years_delta < -0.3;
        if (!worstBad && !worstGood) return null;
        return (
          <p className="text-[11px] text-gray-700 leading-snug mb-2">
            {worstGood ? (
              <><span className="font-semibold">{worst.label}</span> is carrying you — takes ~{Math.abs(worst.years_delta).toFixed(1)} years off.</>
            ) : (
              <><span className="font-semibold">{worst.label}</span> is the biggest lever right now — adds ~{worst.years_delta.toFixed(1)} years. {best && best.years_delta < -0.3 ? `${best.label} is a bright spot.` : ""}</>
            )}
          </p>
        );
      })()}

      {/* Expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
      >
        {expanded ? "▲ Hide markers" : `▼ See what's moving your score (${data.components.length} markers)`}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {data.components.map(c => (
            <ComponentRow key={c.key} c={c} />
          ))}
          <p className="text-[10px] text-gray-500 italic mt-2 leading-snug">
            {data.caveat}
          </p>
        </div>
      )}
    </section>
  );
}

function ComponentRow({ c }: { c: BioAgeComponent }) {
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
          {sign}{fmt(delta, 1)} yr {label}
        </span>
      </div>
      <p className="text-[11px] text-gray-700 leading-snug mt-0.5">{c.why}</p>
    </div>
  );
}
