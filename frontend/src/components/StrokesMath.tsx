"use client";

/**
 * StrokesMath — the League's show-your-math (2026-11-20).
 *
 * The League ranks on strokes gained against each player's own usual
 * (backend/strokes.py): steps, activity, sleep hours, bedtime. One row per
 * band: this week against your usual, and the strokes it earned. A band
 * with no data or no usual yet plays even and says why.
 */

import type { StrokeBand } from "@/lib/api";

const ORDER = ["steps", "activity", "sleep", "bedtime"] as const;

function fmt(key: string, v: number | null | undefined): string {
  if (v == null) return "—";
  if (key === "steps") return Math.round(v).toLocaleString();
  if (key === "activity") return `${Math.round(v)} cal`;
  if (key === "sleep") return `${v.toFixed(1)} h`;
  // bedtime: how much it wanders, in words — never "±68 min"
  return v < 15 ? "same time nightly" : `within ${Math.round(v / 5) * 5} min`;
}

export function fmtStrokes(v: number | null | undefined): string {
  if (v == null) return "—";
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "E";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
}

export default function StrokesMath({ strokes, net, rule }: {
  strokes?: Record<string, StrokeBand> | null;
  net?: number | null;
  rule?: string;
}) {
  const keys = ORDER.filter(k => strokes && strokes[k]);
  if (!strokes || keys.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
      {keys.map(k => {
        const b = strokes[k];
        const scored = b.status === "scored";
        return (
          <div key={k} className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${scored ? "" : "opacity-60"}`}>
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-gray-800">{b.label}</span>
              {scored ? (
                <span className="text-gray-500"> · {fmt(k, b.week)} <span className="text-gray-400">vs your usual {fmt(k, b.usual)}</span></span>
              ) : (
                <span className="text-gray-400"> · even ({b.status})</span>
              )}
            </span>
            <span className={`font-mono tabular-nums shrink-0 ${b.strokes > 0 ? "text-emerald-700" : b.strokes < 0 ? "text-red-600" : "text-gray-600"}`}>
              {fmtStrokes(b.strokes)}
            </span>
          </div>
        );
      })}
      <p className="px-3 py-1.5 text-[10px] text-gray-500">
        {net != null ? `Net ${net > 0 ? "+" : net < 0 ? "−" : ""}${net === 0 ? "even" : Math.abs(net)}. ` : ""}
        {rule ?? "Strokes gained against your own usual over the eight weeks before Monday. Each band builds day by day and is capped at ±6 for the week."}
      </p>
    </div>
  );
}
