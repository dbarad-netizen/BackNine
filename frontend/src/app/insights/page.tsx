"use client";

/**
 * /insights — the Personalized Insights Feed.
 *
 * Phase 3 of the Insight pillar. Cumulative library of every Daily
 * Insight the user has received, grouped by week and filterable by
 * category. Each row shows the headline, pattern, action, and the
 * user's past feedback (if any).
 *
 * Accessible via a "View all insights →" link from the DailyInsightCard
 * on the Scorecard. No auth-special — uses the same JWT as the rest of
 * the app.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type DailyInsight } from "@/lib/api";
import LifestyleCorrelationsCard from "@/components/LifestyleCorrelationsCard";

const CATEGORY_META: Record<DailyInsight["category"], { label: string; emoji: string; bg: string; fg: string }> = {
  sleep:     { label: "Sleep",     emoji: "😴", bg: "bg-indigo-100",   fg: "text-indigo-800"   },
  training:  { label: "Training",  emoji: "🏋️", bg: "bg-emerald-100",  fg: "text-emerald-800"  },
  nutrition: { label: "Nutrition", emoji: "🍳", bg: "bg-amber-100",    fg: "text-amber-900"    },
  cardio:    { label: "Cardio",    emoji: "❤️", bg: "bg-rose-100",     fg: "text-rose-800"     },
  recovery:  { label: "Recovery",  emoji: "🛌", bg: "bg-sky-100",      fg: "text-sky-800"      },
  general:   { label: "Insight",   emoji: "💡", bg: "bg-gray-100",     fg: "text-gray-800"     },
};

const ALL_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "",          label: "All categories" },
  { value: "sleep",     label: "😴 Sleep"       },
  { value: "training",  label: "🏋️ Training"     },
  { value: "nutrition", label: "🍳 Nutrition"   },
  { value: "cardio",    label: "❤️ Cardio"      },
  { value: "recovery",  label: "🛌 Recovery"    },
  { value: "general",   label: "💡 General"     },
];

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return iso; }
}

function isoWeek(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00");
    const y = d.getUTCFullYear();
    // ISO week number — close enough for our grouping; doesn't need to be exact.
    const start = new Date(Date.UTC(y, 0, 1));
    const days  = Math.floor((d.getTime() - start.getTime()) / 86400000);
    const week  = Math.ceil((days + start.getUTCDay() + 1) / 7);
    return `${y} · Week ${week}`;
  } catch { return ""; }
}

export default function InsightsFeedPage() {
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<string>("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.insightList({ days: 365, category: filter || undefined })
      .then(r => setInsights(r.insights))
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load"))
      .finally(() => setLoading(false));
  }, [filter]);

  // Group insights by week label for visual separation
  const byWeek = useMemo(() => {
    const groups: { weekLabel: string; rows: DailyInsight[] }[] = [];
    for (const ins of insights) {
      const lbl = isoWeek(ins.date);
      const existing = groups.find(g => g.weekLabel === lbl);
      if (existing) existing.rows.push(ins);
      else groups.push({ weekLabel: lbl, rows: [ins] });
    }
    return groups;
  }, [insights]);

  // Summary stats
  const stats = useMemo(() => {
    const total = insights.length;
    const liked = insights.filter(i => i.feedback === "up").length;
    const byCat: Record<string, number> = {};
    for (const i of insights) byCat[i.category] = (byCat[i.category] || 0) + 1;
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    return { total, liked, topCat: topCat ? `${CATEGORY_META[topCat[0] as DailyInsight["category"]]?.label ?? topCat[0]} (${topCat[1]})` : "—" };
  }, [insights]);

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-[#1B3829]">Coach Al · Insight Feed</p>
            <h1 className="text-xl font-bold text-gray-900 mt-0.5">Your patterns over time</h1>
          </div>
          <Link href="/dashboard" className="text-xs font-semibold text-gray-600 hover:text-gray-900">
            ← Back to Scorecard
          </Link>
        </div>
      </header>

      {/* Stats strip + filter */}
      <div className="max-w-4xl mx-auto px-5 py-4">
        {/* Lifestyle correlations — Oura tag-driven deltas. Sits above
            the insights feed because it's a higher-order pattern view
            (multi-week aggregate) than the per-day Daily Insights below. */}
        <div className="mb-4">
          <LifestyleCorrelationsCard />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Total insights</p>
            <p className="text-lg font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">You marked useful</p>
            <p className="text-lg font-bold text-gray-900">{stats.liked}</p>
          </div>
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Most common</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{stats.topCat}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-600">Filter:</span>
          {ALL_CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                filter === c.value
                  ? "bg-[#1B3829] text-white border border-[#1B3829]"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Loading / error / empty states */}
        {loading && <p className="text-sm text-gray-600 italic mt-6">Loading your insight history…</p>}
        {error   && <p className="text-sm text-red-500 mt-6">Couldn&apos;t load: {error}</p>}
        {!loading && !error && insights.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center mt-6">
            <p className="text-sm text-gray-700 font-semibold">No insights yet</p>
            <p className="text-xs text-gray-600 mt-1">
              Your daily insights will collect here over time. Check the Scorecard each day for the latest one.
            </p>
          </div>
        )}

        {/* Grouped feed */}
        {!loading && !error && byWeek.map(group => (
          <section key={group.weekLabel} className="mb-6">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-600 mb-2">
              {group.weekLabel}
            </p>
            <ul className="space-y-3">
              {group.rows.map(ins => {
                const badge = CATEGORY_META[ins.category] ?? CATEGORY_META.general;
                return (
                  <li key={`${ins.date}-${ins.headline}`} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${badge.bg} ${badge.fg}`}>
                          {badge.emoji} {badge.label}
                        </span>
                        <span className="text-[11px] text-gray-600">{fmtDate(ins.date)}</span>
                      </div>
                      {ins.feedback === "up" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          👍 You found this useful
                        </span>
                      )}
                      {ins.feedback === "down" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                          👎 Not useful
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 mb-1">{ins.headline}</h3>
                    <p className="text-sm text-gray-800 leading-relaxed mb-2">{ins.pattern}</p>
                    <div className="rounded-lg border border-[#1B3829]/15 bg-[#1B3829]/5 px-3 py-2 mb-1.5">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-0.5">Suggested action</p>
                      <p className="text-sm text-gray-900 leading-snug">{ins.action}</p>
                    </div>
                    {ins.evidence && (
                      <p className="text-[10px] text-gray-600 italic leading-snug">{ins.evidence}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
