"use client";

/**
 * WeeklyHealthSpanCard — Attia-style "process" score.
 *
 * Complements Biological Age (clinical/outcome). Behavioral inputs
 * only: sleep habits, movement, adherence, check-in, hydration, CPAP.
 * Zero overlap with Bio Age markers.
 *
 * David 2026-08-11.
 */

import { useState } from "react";
import type { WeeklyHealthSpan, WeeklyHealthSpanComponent } from "@/lib/api";

interface Props {
  data: WeeklyHealthSpan;
}

function gradeColor(grade: string): string {
  if (grade === "Excellent") return "#22c55e";
  if (grade === "Good")      return "#84cc16";
  if (grade === "Fair")      return "#f59e0b";
  return "#ef4444";
}

export default function WeeklyHealthSpanCard({ data }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (data.score == null) return null;

  const color = gradeColor(data.grade);
  const circ  = 2 * Math.PI * 42;
  const comps = Object.values(data.components);
  // Sort by "biggest opportunity" — largest gap between points and max
  const sorted = [...comps].sort((a, b) => {
    const aGap = (a.max - a.points) / a.max;
    const bGap = (b.max - b.points) / b.max;
    return bGap - aGap;
  });

  return (
    <section
      className="rounded-2xl border-2 bg-white p-5 space-y-4"
      style={{ borderColor: color + "66" }}
    >
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="10" />
            <circle
              cx="50" cy="50" r="42" fill="none"
              stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - data.score / 100)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-gray-900 leading-none">{data.score}</span>
            <span className="text-[9px] text-gray-600 uppercase tracking-wide">Health Span</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">
            Weekly Health Span Score
          </p>
          <p className="font-bold text-base" style={{ color }}>{data.grade}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {data.bands_present} of your habits scored this week
          </p>
        </div>
      </div>

      {/* Expandable component breakdown */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
      >
        {expanded
          ? "▲ Hide breakdown"
          : `▼ See what's moving your score (${comps.length} habits)`}
      </button>

      {expanded && (
        <div className="space-y-1.5 pt-2 border-t border-gray-100">
          {sorted.map(c => (
            <ComponentRow key={c.label} c={c} />
          ))}
          <p className="text-[10px] text-gray-500 italic mt-2 leading-snug">
            {data.caveat}
          </p>
        </div>
      )}
    </section>
  );
}

function ComponentRow({ c }: { c: WeeklyHealthSpanComponent }) {
  const pct = Math.round((c.points / c.max) * 100);
  const barColor =
    pct >= 80 ? "#22c55e" :
    pct >= 60 ? "#84cc16" :
    pct >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className="rounded-lg border border-gray-100 bg-gray-50/60 p-2 space-y-1"
      title={c.why || ""}
    >
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
