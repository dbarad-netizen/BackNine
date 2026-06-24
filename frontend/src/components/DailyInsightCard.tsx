"use client";

/**
 * DailyInsightCard — Phase 1 of the Insight pillar.
 *
 * Once a day, Claude reads the user's 14-day cross-domain data and writes
 * ONE pattern + ONE action. Rendered as a brand-tinted card at the top of
 * the Scorecard so it's the first thing the user sees after the
 * Coach Al briefing.
 *
 * Three reactions: 👍 (useful — tunes future insights toward this category),
 * 👎 (not useful), or × dismiss. After feedback, the card collapses to a
 * thin "feedback recorded" pill until tomorrow.
 *
 * Best-effort: when the backend returns no insight (no API key, sparse
 * data, transient error), this component renders NOTHING. The Scorecard
 * stays clean — no empty-state noise.
 */

import { useEffect, useState } from "react";
import { api, type DailyInsight } from "@/lib/api";

const CATEGORY_BADGE: Record<DailyInsight["category"], { label: string; emoji: string; bg: string; fg: string }> = {
  sleep:     { label: "Sleep",     emoji: "😴", bg: "bg-indigo-100",   fg: "text-indigo-800"   },
  training:  { label: "Training",  emoji: "🏋️", bg: "bg-emerald-100",  fg: "text-emerald-800"  },
  nutrition: { label: "Nutrition", emoji: "🍳", bg: "bg-amber-100",    fg: "text-amber-900"    },
  cardio:    { label: "Cardio",    emoji: "❤️", bg: "bg-rose-100",     fg: "text-rose-800"     },
  recovery:  { label: "Recovery",  emoji: "🛌", bg: "bg-sky-100",      fg: "text-sky-800"      },
  general:   { label: "Insight",   emoji: "💡", bg: "bg-gray-100",     fg: "text-gray-800"     },
};

const CONFIDENCE_LABEL: Record<DailyInsight["confidence"], string> = {
  high:   "High confidence",
  medium: "Moderate confidence",
  low:    "Early signal",
};

export default function DailyInsightCard() {
  const [insight, setInsight] = useState<DailyInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  useEffect(() => {
    api.dailyInsight()
      .then(r => setInsight(r.insight))
      .catch(() => setInsight(null))
      .finally(() => setLoading(false));
  }, []);

  const handleFeedback = async (kind: "up" | "down" | "dismissed") => {
    if (!insight || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      await api.dailyInsightFeedback(insight.date, kind);
      setInsight({ ...insight, feedback: kind });
    } catch {
      // silent — user can try again
    } finally {
      setFeedbackBusy(false);
    }
  };

  // Render nothing while loading OR if backend has no insight to show.
  // Keeps the Scorecard clean for users mid-onboarding or with sparse data.
  if (loading) return null;
  if (!insight) return null;

  // Dismissed: collapse to a quiet pill so the user can re-expand if they
  // want to see today's insight again (rare but harmless).
  if (insight.feedback === "dismissed") {
    return (
      <button
        onClick={() => setInsight({ ...insight, feedback: null })}
        className="w-full py-2 rounded-2xl border border-gray-200 bg-white text-[11px] text-gray-600 hover:bg-gray-50 transition-colors"
      >
        💡 Today&apos;s insight is hidden — tap to view
      </button>
    );
  }

  const badge = CATEGORY_BADGE[insight.category] ?? CATEGORY_BADGE.general;
  const fb    = insight.feedback;

  return (
    <section className="rounded-2xl border border-[#1B3829]/30 bg-gradient-to-br from-[#1B3829]/5 to-white p-4 shadow-sm">
      <div className="flex items-start gap-3 mb-2">
        <div className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${badge.bg} ${badge.fg}`}>
          <span className="mr-1">{badge.emoji}</span>{badge.label}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829]">Coach Al · today&apos;s insight</p>
          <h3 className="text-base font-bold text-gray-900 leading-tight mt-0.5">{insight.headline}</h3>
        </div>
        <button
          onClick={() => handleFeedback("dismissed")}
          disabled={feedbackBusy || !!fb}
          className="shrink-0 text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
          aria-label="Dismiss"
          title="Hide today's insight"
        >×</button>
      </div>

      <p className="text-sm text-gray-800 leading-relaxed mb-2">{insight.pattern}</p>

      <div className="rounded-lg border border-[#1B3829]/20 bg-white px-3 py-2 mb-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-0.5">Try this week</p>
        <p className="text-sm text-gray-900 leading-snug">{insight.action}</p>
      </div>

      {insight.evidence && (
        <p className="text-[11px] text-gray-600 leading-snug italic mb-2">
          {insight.evidence} · {CONFIDENCE_LABEL[insight.confidence]}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-gray-200 -mx-1 px-1">
        <span className="text-[11px] text-gray-600">Was this useful?</span>
        <button
          onClick={() => handleFeedback("up")}
          disabled={feedbackBusy || !!fb}
          className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
            fb === "up"
              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
              : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          }`}
        >
          👍 Yes
        </button>
        <button
          onClick={() => handleFeedback("down")}
          disabled={feedbackBusy || !!fb}
          className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
            fb === "down"
              ? "bg-rose-100 text-rose-800 border border-rose-200"
              : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          }`}
        >
          👎 No
        </button>
        {fb && (
          <span className="ml-auto text-[10px] text-gray-600 italic">
            Thanks — future insights will tune to your taste.
          </span>
        )}
      </div>
    </section>
  );
}
