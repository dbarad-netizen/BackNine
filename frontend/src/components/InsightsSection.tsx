"use client";

import { useEffect, useState } from "react";
import { api, Insight } from "@/lib/api";

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICONS: Record<string, string> = {
  high_cal_readiness: "🍽️",
  protein_hrv:        "💪",
  sleep_activity:     "😴",
  steps_readiness:    "👟",
  deficit_weight:     "⚖️",
  hrv_trend:          "📈",
};

// ── Single insight card ───────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: Insight }) {
  const borderColor =
    insight.direction === "positive" ? "#22c55e"
    : insight.direction === "negative" ? "#ef4444"
    : "#6b7280";

  const badgeBg =
    insight.direction === "positive" ? "bg-green-50 text-green-700"
    : insight.direction === "negative" ? "bg-red-50 text-red-600"
    : "bg-gray-50 text-gray-600";

  const arrow =
    insight.direction === "positive" ? "↑"
    : insight.direction === "negative" ? "↓"
    : "→";

  return (
    <div
      className="rounded-2xl bg-white border p-4 flex flex-col gap-3"
      style={{ borderColor: borderColor + "44" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{ICONS[insight.id] ?? "🔍"}</span>
          <p className="font-semibold text-gray-900 text-sm leading-tight">{insight.title}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${badgeBg}`}>
          {arrow} {insight.magnitude} {insight.unit}
        </span>
      </div>

      {/* Finding */}
      <p className="text-sm text-gray-700 leading-snug">{insight.finding}</p>

      {/* Detail */}
      {insight.detail && (
        <p className="text-xs text-gray-400 leading-snug">{insight.detail}</p>
      )}

      {/* Group comparison bar */}
      <div className="flex gap-3 mt-1">
        <div className="flex-1">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{insight.group_a_label}</p>
          <div className="flex items-center gap-2">
            <div className="h-1.5 rounded-full bg-gray-200 flex-1">
              <div
                className="h-1.5 rounded-full bg-gray-400"
                style={{ width: `${Math.min(100, (insight.group_a_avg / Math.max(insight.group_a_avg, insight.group_b_avg)) * 100)}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-600 w-8 text-right">
              {insight.group_a_avg}
            </span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{insight.group_b_label}</p>
          <div className="flex items-center gap-2">
            <div className="h-1.5 rounded-full bg-gray-200 flex-1">
              <div
                className="h-1.5 rounded-full"
                style={{
                  width: `${Math.min(100, (insight.group_b_avg / Math.max(insight.group_a_avg, insight.group_b_avg)) * 100)}%`,
                  backgroundColor: borderColor,
                }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-600 w-8 text-right">
              {insight.group_b_avg}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-gray-300">
        Based on {insight.n} days · correlation r={insight.r}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function InsightsSection() {
  const [insights, setInsights]   = useState<Insight[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10-second timeout

    api.insights(60, { signal: controller.signal })
      .then(r => {
        clearTimeout(timer);
        setInsights(r.insights);
        setLoading(false);
      })
      .catch(e => {
        clearTimeout(timer);
        // AbortError = our 10-second timeout fired — silently show the empty state
        // rather than spinning forever or showing a broken UI
        if (e.name !== "AbortError") {
          setError(e.message ?? "Failed to load insights");
        }
        setLoading(false);
      });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error) {
    return null; // silent fail — don't break the Coach tab
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-gray-100 p-5 text-center">
        <p className="text-sm font-medium text-gray-500 mb-1">Not enough data yet</p>
        <p className="text-xs text-gray-400">
          Insights appear after a few weeks of combined Oura, nutrition, and Apple Health data.
          Keep logging and check back soon.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Your Patterns
        </h3>
        <span className="text-[10px] text-gray-300">Last 60 days</span>
      </div>
      <div className="grid gap-3">
        {insights.map(insight => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </section>
  );
}
