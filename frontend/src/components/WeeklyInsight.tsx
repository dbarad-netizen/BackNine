"use client";

/**
 * WeeklyInsight — Coach Al's once-per-week narrative on the Scorecard.
 *
 * Replaces the old dry "Coaching Insights" lists. BackNine's correlation engine
 * finds the user's single strongest data pattern of the week; Coach Al turns it
 * into a warm, specific note plus ONE experiment to try. Pulls
 * /api/insight/weekly on mount (first call of the week generates + caches; later
 * calls return the cached row).
 */

import { useEffect, useState } from "react";
import { api, type WeeklyInsightResponse } from "@/lib/api";
import CoachAlAvatar from "@/components/CoachAlAvatar";

interface Props {
  /** Open the main Coach Al chat drawer, optionally seeding a first question. */
  onOpenChat?: (seed?: string) => void;
}

export default function WeeklyInsight({ onOpenChat }: Props) {
  const [data, setData] = useState<WeeklyInsightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    api.weeklyInsight()
      .then(res => { if (!cancelled) setData(res); })
      .catch(() => { /* soft-fail: render nothing */ })
      .finally(() => { clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, []);

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const fresh = await api.weeklyInsight(true);
      setData(fresh);
    } catch { /* keep the old one visible */ }
    finally { setRegenerating(false); }
  };

  // Loading shimmer — keep height stable so the page doesn't jump.
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-100 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-1/3 bg-gray-100 rounded animate-pulse" />
            <div className="h-3.5 w-4/5 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-full bg-gray-50 rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-gray-50 rounded animate-pulse" />
          </div>
        </div>
      </section>
    );
  }

  if (!data) return null; // endpoint down — never block the dashboard

  const accent =
    data.stat?.direction === "negative" ? "#f59e0b"
    : data.stat?.direction === "neutral" ? "#64748b"
    : "#22c55e"; // positive / default

  const paragraphs = data.narrative
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  // ── No-data / not-enough-data placeholder ──
  if (data.has_data === false) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <CoachAlAvatar size={40} className="rounded-full ring-2 ring-gray-100 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">
              Coach Al · Weekly Insight
            </p>
            <p className="font-bold text-gray-900 text-[15px] leading-snug mb-1">{data.headline}</p>
            <p className="text-[13px] text-gray-500 leading-relaxed">{data.narrative}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border bg-white shadow-sm overflow-hidden"
      style={{ borderColor: accent + "44" }}
    >
      {/* Accent strip */}
      <div className="h-1" style={{ backgroundColor: accent }} />

      <div className="p-5">
        <div className="flex items-start gap-3">
          <CoachAlAvatar size={44} className="rounded-full ring-2 ring-gray-100 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
                Coach Al · Weekly Insight
              </p>
              <span
                className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: accent + "1A", color: accent }}
              >
                This week
              </span>
            </div>

            <h3 className="font-bold text-gray-900 text-[17px] leading-snug mb-2">
              {data.headline}
            </h3>

            {paragraphs.map((p, i) => (
              <p key={i} className={`text-[13.5px] text-gray-700 leading-relaxed ${i > 0 ? "mt-2" : ""}`}>
                {p}
              </p>
            ))}
          </div>
        </div>

        {/* Experiment callout */}
        {data.experiment && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-1">
              🧪 Experiment to try this week
            </p>
            <p className="text-[13px] text-amber-900 leading-snug">{data.experiment}</p>
          </div>
        )}

        {/* Evidence chip — the data behind the story, for credibility */}
        {data.stat && data.stat.n != null && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
            <span>Based on {data.stat.n} days</span>
            {data.stat.r != null && <span>· correlation r={data.stat.r}</span>}
            {data.stat.group_a_label && data.stat.group_b_label && (
              <span className="text-gray-500">
                · {data.stat.group_a_label} {data.stat.group_a_avg} vs {data.stat.group_b_label} {data.stat.group_b_avg}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="border-t border-gray-50 px-5 py-2.5 flex items-center justify-between gap-3">
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className={`text-[11px] text-gray-400 hover:text-gray-600 transition-colors underline-offset-2 hover:underline disabled:opacity-40 ${
            regenerating ? "animate-pulse" : ""
          }`}
          title="Generate a fresh take on this week's pattern"
        >
          {regenerating ? "Refreshing…" : "Regenerate"}
        </button>
        {onOpenChat && (
          <button
            onClick={() => {
              const parts = [`Tell me more about this week's insight: "${data.headline}".`];
              if (data.experiment) parts.push(`You suggested I try: ${data.experiment}`);
              parts.push("Why is this happening, and how do I make the most of it?");
              onOpenChat(parts.join(" "));
            }}
            className="text-[11px] font-semibold flex items-center gap-1 transition-colors"
            style={{ color: accent }}
          >
            Ask Coach Al about this →
          </button>
        )}
      </div>
    </section>
  );
}
