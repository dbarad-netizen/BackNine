"use client";

/**
 * SpineBreakdown — the ONE shared "why" disclosure for the Scorecard
 * spine (Option B redesign, David 2026-09-10).
 *
 * The old Scorecard had four separate expanders (rings coach text, Health
 * Span habits, Bio Age markers, QYL methodology) — four taps, four visual
 * dialects. The spine collapses them into a single "See what's moving
 * this" drawer at the chain's end, ordered the same way the spine reads:
 * this week's habits → the body markers they move → how those become
 * quality years.
 *
 * Row renderers were lifted from WeeklyHealthSpanCard / BiologicalAgeCard
 * when those cards were slimmed to one-number spine form; the cards no
 * longer carry their own expanders.
 */

import { useState } from "react";
import type {
  BiologicalAge,
  BioAgeComponent,
  WeeklyHealthSpan,
  WeeklyHealthSpanComponent,
} from "@/lib/api";

interface Props {
  bio?: BiologicalAge | null;
  hs?: WeeklyHealthSpan | null;
}

export default function SpineBreakdown({ bio, hs }: Props) {
  const [open, setOpen] = useState(false);

  const hsComps = hs ? Object.values(hs.components) : [];
  const bioComps = bio?.components ?? [];
  const hy = bio?.healthy_years;
  if (hsComps.length === 0 && bioComps.length === 0) return null;

  // Health Span habits sorted by biggest opportunity (largest gap first)
  const hsSorted = [...hsComps].sort((a, b) => {
    const aGap = a.max > 0 ? (a.max - a.points) / a.max : 0;
    const bGap = b.max > 0 ? (b.max - b.points) / b.max : 0;
    return bGap - aGap;
  });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-[12px] font-semibold text-[#1B3829]">
          {open ? "▲ Hide the details" : "▼ See what's moving this"}
        </span>
        {!open && (
          <span className="text-[10px] text-gray-500">
            {hsComps.length > 0 && `${hsComps.length} habits`}
            {hsComps.length > 0 && bioComps.length > 0 && " · "}
            {bioComps.length > 0 && `${bioComps.length} markers`}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {/* ── This week's habits (Health Span) ── */}
          {hs && hsSorted.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                This week — habits behind your Health Span
              </p>
              {hsSorted.map(c => (
                <HabitRow key={c.label} c={c} />
              ))}
              {hs.caveat && (
                <p className="text-[10px] text-gray-500 italic leading-snug">{hs.caveat}</p>
              )}
            </div>
          )}

          {/* ── Body markers (Bio Age) ── */}
          {bio && bioComps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                Your body — markers behind your Bio Age
                {bio.confidence && (
                  <span className="ml-1.5 normal-case tracking-normal font-medium text-gray-400">
                    ({bio.confidence} confidence · {bio.n_markers} markers)
                  </span>
                )}
              </p>
              {bioComps.map(c => (
                <MarkerRow key={c.key} c={c} />
              ))}
              {/* Projection — effort→outcome loop, demoted here from the
                  old Bio Age card body. */}
              {bio.projection && Math.abs(bio.projection.delta_from_now) >= 0.2 && (() => {
                const p = bio.projection;
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
              {bio.caveat && (
                <p className="text-[10px] text-gray-500 italic leading-snug">{bio.caveat}</p>
              )}
            </div>
          )}

          {/* ── QYL methodology ── */}
          {hy && hy.years != null && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                Horizon — how the QYL Index is computed
              </p>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Actuarial life tables for your age and sex, scaled to
                disability-free years (~70% of remaining years for US adults),
                evaluated at your <span className="font-medium">biological</span> age
                of {bio?.biological_age}
                {bio?.chronological_age != null
                  ? ` instead of your birthday age of ${bio.chronological_age}`
                  : " instead of your birthday age"}
                . {hy.caveat}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HabitRow({ c }: { c: WeeklyHealthSpanComponent }) {
  const pct = Math.round((c.points / c.max) * 100);
  const barColor =
    pct >= 80 ? "#22c55e" :
    pct >= 60 ? "#84cc16" :
    pct >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2 space-y-1" title={c.why || ""}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-gray-800 truncate pr-1">{c.label}</span>
        <div className="flex items-baseline gap-2 shrink-0">
          <span className="text-gray-700">{c.value}</span>
          <span className="text-gray-900 font-semibold">{c.points}/{c.max}</span>
        </div>
      </div>
      <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <p className="text-[10px] text-gray-600 leading-snug">{c.norm}</p>
    </div>
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
