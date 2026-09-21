"use client";

/**
 * WeeklyHealthSpanCard — Attia-style "process" score, spine form.
 *
 * v2 (2026-08-25) made the score SENSOR-ONLY: sleep hours, sleep timing,
 * steps, active days — fed automatically by Oura / Apple Health. Logged
 * behaviors were removed because they measured logging diligence, not
 * health.
 *
 * Option B spine redesign (David 2026-09-10, "Let's do B"): the card is
 * now the THIS WEEK stop on the Scorecard's timescale spine — one
 * primary number, one supporting phrase. The donut, the wins/misses
 * highlights grid, and the per-card expander are gone; the full habit
 * breakdown lives in the single shared SpineBreakdown drawer at the end
 * of the chain. Timescale kicker ("This week") is rendered by the spine
 * chrome in dashboard/page.tsx, not here.
 *
 * David 2026-08-11 · v2 2026-08-25 · spine 2026-09-10.
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
  const comps = Object.values(data.components);

  // Top strength + biggest gap for the single supporting phrase.
  const withPct = comps.map(c => ({
    ...c,
    pct: c.max > 0 ? c.points / c.max : 0,
    gap: c.max > 0 ? (c.max - c.points) / c.max : 0,
  }));
  const win  = [...withPct].sort((a, b) => b.pct - a.pct).find(x => x.pct >= 0.75);
  const miss = [...withPct].sort((a, b) => b.gap - a.gap).find(x => x.gap >= 0.4);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2.5 flex-wrap min-w-0">
          <span className="text-4xl font-bold tabular-nums leading-none" style={{ color }}>
            {data.score}
          </span>
          <span className="text-sm font-semibold" style={{ color }}>{data.grade}</span>
          {data.trend && data.trend.delta_pts !== 0 && (() => {
            const dt = data.trend.delta_pts;
            const isBetter = dt > 0;
            const tone = isBetter ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                  : "text-red-700 bg-red-50 border-red-200";
            return (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${tone}`}
                title={`Compared to your score ${data.trend.days_ago} days ago`}
              >
                {isBetter ? "▲" : "▼"} {Math.abs(dt)} pts vs {data.trend.days_ago}d ago
              </span>
            );
          })()}
        </div>
        <p className="shrink-0 text-[10px] text-gray-500 uppercase tracking-widest text-right leading-tight">
          Health Span<br />Score
        </p>
      </div>

      {/* Single supporting phrase — top strength + biggest lever. */}
      {(win || miss) && (
        <p className="text-[11px] text-gray-700 leading-snug mt-2">
          {win && miss ? (
            <><span className="font-semibold">{win.label}</span> is a strength — <span className="font-semibold">{miss.label}</span> is where the score can move most.</>
          ) : win ? (
            <><span className="font-semibold">{win.label}</span> is carrying the score — keep it up.</>
          ) : miss ? (
            <><span className="font-semibold">{miss.label}</span> is the biggest lever this week.</>
          ) : null}
        </p>
      )}

      {/* Under the hood (David 2026-09-21): the Option B spine moved all
          breakdowns into one shared drawer at the chain's end — too
          buried; users couldn't see what drives each score. Each card
          now carries its own drill-down again, collapsed by default. */}
      {comps.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
          >
            {expanded ? "▲ Hide" : `▼ Under the hood (${comps.length} habits)`}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
              {[...comps].sort((a, b) => {
                const aGap = a.max > 0 ? (a.max - a.points) / a.max : 0;
                const bGap = b.max > 0 ? (b.max - b.points) / b.max : 0;
                return bGap - aGap;
              }).map(c => <HabitRow key={c.label} c={c} />)}
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
