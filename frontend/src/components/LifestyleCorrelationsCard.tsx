"use client";

/**
 * LifestyleCorrelationsCard — observational deltas between tag-positive
 * and tag-negative days, computed from the user's Oura enhanced_tag
 * history.
 *
 * Pure data layout: "On Alcohol days, Sleep Efficiency is worse by 6.2%
 * (78.4 vs 83.5 on other days)" with the number of days each side. Sorted
 * by largest absolute % impact first so the most actionable patterns
 * bubble to the top.
 *
 * Observational only — we use "associated with" language and refuse to
 * imply causation, matching the existing symptom-correlation panel.
 *
 * Renders nothing when the user has no qualifying tag history (≥3
 * occurrences of any single tag in the last 60 days). Keeps the Insights
 * page clean for new users.
 */

import { useEffect, useState } from "react";
import { api, type TagCorrelations, type TagCorrelationItem } from "@/lib/api";

function fmtVal(v: number, unit: string): string {
  if (unit === "%")    return `${v.toFixed(0)}%`;
  if (unit === "/100") return `${v.toFixed(0)}/100`;
  if (unit === "h")    return `${v.toFixed(1)}h`;
  return `${v.toFixed(1)} ${unit}`;
}

// Visual weight per confidence tier — "high" gets full color, "low" gets
// muted rendering so a skeptical reader instantly distinguishes signal
// from suggestion. This is Fable's IMPROVE #4 point: trust is the product;
// spurious precision is the failure mode.
function confidenceBadgeClass(level: TagCorrelationItem["confidence"]): string {
  switch (level) {
    case "high":   return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "medium": return "bg-sky-100 text-sky-800 border-sky-200";
    case "low":    return "bg-gray-100 text-gray-700 border-gray-200";
    default:       return "bg-gray-100 text-gray-500 border-gray-200";
  }
}
function confidenceShortLabel(level: TagCorrelationItem["confidence"]): string {
  switch (level) {
    case "high":   return "confident";
    case "medium": return "moderate";
    case "low":    return "early signal";
    default:       return "insufficient";
  }
}

function CorrelationRow({ c }: { c: TagCorrelationItem }) {
  const direction = c.worse_on_tag ? "worse" : "better";
  const arrow     = c.worse_on_tag ? "▼" : "▲";
  // Low-confidence rows render with muted tone so they don't compete
  // visually with high-confidence rows.
  const isLow     = c.confidence === "low";
  const tone      = isLow
    ? (c.worse_on_tag ? "text-rose-500" : "text-emerald-600")
    : (c.worse_on_tag ? "text-rose-700" : "text-emerald-700");
  return (
    <li className="py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <p className={`text-sm ${isLow ? "text-gray-700" : "text-gray-900"}`}>
          <span className="mr-1">{c.tag_emoji}</span>
          <span className="font-semibold">{c.tag_label}</span>
          <span className="text-gray-600"> days · {c.metric_label}</span>
        </p>
        <span className={`text-xs font-mono font-semibold whitespace-nowrap ${tone}`}>
          {arrow} {Math.abs(c.delta).toFixed(1)}{c.unit} ({c.abs_pct.toFixed(0)}%)
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-gray-600 leading-snug flex-1">
          {fmtVal(c.positive_avg, c.unit)} on tag days vs {fmtVal(c.negative_avg, c.unit)} on other days
          <span className="text-gray-500"> · {direction} on tag days</span>
        </p>
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${confidenceBadgeClass(c.confidence)}`}
          title={c.confidence_label}
        >
          {c.positive_days}d · {confidenceShortLabel(c.confidence)}
        </span>
      </div>
    </li>
  );
}

export default function LifestyleCorrelationsCard() {
  const [data,    setData]    = useState<TagCorrelations | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.tagCorrelations(60)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  if (!data.items || data.items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700">
            Lifestyle correlations
          </p>
          <h3 className="text-sm font-bold text-gray-900">
            What your Oura tags are associated with
          </h3>
        </div>
        <p className="text-[11px] text-gray-600">last {data.window_days}d</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {data.items.slice(0, 6).map((c, i) => (
          <CorrelationRow key={`${c.tag_code}-${c.metric}-${i}`} c={c} />
        ))}
      </ul>
      <p className="text-[10px] text-gray-500 italic mt-3">
        Observational pattern only — correlation, not causation. Bring to your doctor if any feels meaningful.
      </p>
    </section>
  );
}
