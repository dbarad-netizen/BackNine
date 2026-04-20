"use client";

import { useEffect, useState } from "react";
import { api, ProgressItem, ProgressReport } from "@/lib/api";

// ── Delta badge ───────────────────────────────────────────────────────────────
function DeltaBadge({ value, unit, direction }: {
  value: number | null;
  unit: string;
  direction: "positive" | "negative" | "neutral";
}) {
  if (value === null || value === undefined) return null;
  const abs = Math.abs(value);
  if (abs < 0.5) return <span className="text-[10px] text-gray-300">no change</span>;

  const color =
    direction === "positive" ? "text-green-600" :
    direction === "negative" ? "text-red-500"   : "text-gray-400";
  const arrow = value > 0 ? "↑" : "↓";

  return (
    <span className={`text-[11px] font-semibold ${color}`}>
      {arrow} {abs} {unit}
    </span>
  );
}

// ── On-target progress bar ────────────────────────────────────────────────────
function OnTargetBar({ current, previous, total, prevTotal }: {
  current: number;
  previous: number | null;
  total: number;
  prevTotal: number;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const prevPct = (previous !== null && prevTotal > 0) ? Math.round((previous / prevTotal) * 100) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>Last 30 days: <span className="font-semibold text-gray-700">{current}/{total} days</span></span>
        {prevPct !== null && (
          <span>Prior 30 days: {previous}/{prevTotal}</span>
        )}
      </div>
      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        {/* Previous period ghost bar */}
        {prevPct !== null && (
          <div
            className="absolute inset-y-0 left-0 bg-gray-200 rounded-full"
            style={{ width: `${prevPct}%` }}
          />
        )}
        {/* Current period bar */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>
    </div>
  );
}

// ── Single progress card ──────────────────────────────────────────────────────
function ProgressCard({ item }: { item: ProgressItem }) {
  const showOnTarget = item.current_on !== null && item.period_days > 0;
  const deltaValue   = item.delta_on ?? item.delta_avg;
  const deltaUnit    = item.delta_on !== null ? "days" : item.unit;

  return (
    <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{item.icon}</span>
          <span className="text-sm font-semibold text-gray-900">{item.title}</span>
          {item.target_label && (
            <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">
              {item.target_label}
            </span>
          )}
        </div>
        <DeltaBadge value={deltaValue} unit={deltaUnit} direction={item.direction} />
      </div>

      {/* Average comparison */}
      {item.current_avg !== null && (
        <div className="flex gap-4">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Last 30 Days</p>
            <p className="text-xl font-bold text-gray-900">
              {typeof item.current_avg === "number" && item.unit === "steps"
                ? item.current_avg.toLocaleString()
                : item.current_avg}
              <span className="text-xs text-gray-400 font-normal ml-1">{item.unit}</span>
            </p>
          </div>
          {item.previous_avg !== null && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Prior 30 Days</p>
              <p className="text-xl font-semibold text-gray-300">
                {typeof item.previous_avg === "number" && item.unit === "steps"
                  ? item.previous_avg.toLocaleString()
                  : item.previous_avg}
                <span className="text-xs font-normal ml-1">{item.unit}</span>
              </p>
            </div>
          )}
          {item.personal_best !== null && (
            <div className="ml-auto text-right">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Best</p>
              <p className="text-sm font-semibold text-amber-500">
                {typeof item.personal_best === "number" && item.unit === "steps"
                  ? item.personal_best.toLocaleString()
                  : item.personal_best}
              </p>
            </div>
          )}
        </div>
      )}

      {/* On-target progress bar */}
      {showOnTarget && (
        <OnTargetBar
          current={item.current_on!}
          previous={item.previous_on}
          total={item.period_days}
          prevTotal={item.previous_period_days ?? item.period_days}
        />
      )}

      {/* Summary sentence */}
      <p className="text-xs text-gray-500 leading-snug">{item.summary}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProgressSection() {
  const [report,  setReport]  = useState<ProgressReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.progress()
      .then(r => { setReport(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!report || report.items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Progress
        </h3>
        <span className="text-[10px] text-gray-300">{report.period_label}</span>
      </div>
      <div className="grid gap-3">
        {report.items.map(item => (
          <ProgressCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
