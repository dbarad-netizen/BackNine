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
import Link from "next/link";
import { api, type DailyInsight, type ExperimentMetric } from "@/lib/api";

/**
 * suggestMetric — light client-side dispatcher mirroring
 * backend/experiments.py::suggest_metric_for_insight. Bias toward
 * `null` over guessing wrong so we don't spawn junk experiments.
 * Kept here rather than round-tripping to a backend endpoint because
 * the mapping is tiny and stable.
 */
function suggestMetric(category: DailyInsight["category"], action: string): ExperimentMetric | null {
  const txt = (action || "").toLowerCase();
  if (txt.includes("hrv")) return "hrv_ms";
  if (txt.includes("rhr") || (txt.includes("resting") && txt.includes("heart"))) return "rhr_bpm";
  if (txt.includes("sleep score")) return "sleep_score";
  if (txt.includes("sleep") && /hour|hrs|duration/.test(txt)) return "sleep_hours";
  if (txt.includes("blood pressure") || txt.includes(" bp ") || txt.includes("systolic")) return "bp_systolic";
  if (txt.includes("weight")) return "weight_lb";
  if (txt.includes("step")) return "steps";
  if (txt.includes("readiness")) return "readiness_score";
  const catDefault: Partial<Record<DailyInsight["category"], ExperimentMetric>> = {
    sleep:     "sleep_score",
    recovery:  "hrv_ms",
    cardio:    "rhr_bpm",
    training:  "readiness_score",
    nutrition: "weight_lb",
  };
  return catDefault[category] ?? null;
}

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

/**
 * "Log now" CTA resolver. Coach Al's action text often ends in
 * "log something tonight" — but there's no button. Chris (Whoop user
 * in beta) actually asked David where to log the sleep the insight
 * card was suggesting. This resolver looks at the insight's category
 * and action text and returns a { label, targetId } tuple so we can
 * render a jump-to button next to the "Try this week" line.
 *
 * Returns null when the insight doesn't map to a logging surface —
 * we never render a fake CTA.
 */
function logCta(category: DailyInsight["category"], action: string): { label: string; targetId: string } | null {
  const lower = (action || "").toLowerCase();
  const asksToLog =
    lower.includes("log ")   || lower.includes(" logging") ||
    lower.includes("track ") || lower.includes("record ");

  if (category === "sleep" && (asksToLog || lower.includes("sleep"))) {
    return { label: "Log sleep", targetId: "sleep-quick-log" };
  }
  if (category === "nutrition" && (asksToLog || lower.includes("meal") || lower.includes("protein"))) {
    return { label: "Log a meal", targetId: "meal-quick-add" };
  }
  // NOTE: no training CTA yet — the workout logger lives on the Training
  // tab and there's no direct scroll target on the Scorecard. Skip
  // rather than render a broken button. Add back when the training
  // surface gets a scorecard-anchored quick-log.
  // General "start by logging sleep tonight" pattern (Chris's screenshot
  // literally had this) — cat is often "general" but the text says sleep.
  if (category === "general" && lower.includes("sleep")) {
    return { label: "Log sleep", targetId: "sleep-quick-log" };
  }
  return null;
}

function scrollToTarget(targetId: string): void {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Give the element a brief attention pulse so the user's eye lands
  // on it — matches the "log now" mental model of jumping to action.
  el.classList.add("ring-2", "ring-[#1B3829]/60", "ring-offset-2");
  setTimeout(() => {
    el.classList.remove("ring-2", "ring-[#1B3829]/60", "ring-offset-2");
  }, 1600);
}

interface Props {
  /** When true, render as an inline section without the outer rounded-card
   *  chrome — used when the insight is embedded INSIDE another card (the
   *  unified Coach Al briefing on the Scorecard). */
  embedded?: boolean;
}

export default function DailyInsightCard({ embedded = false }: Props = {}) {
  const [insight, setInsight] = useState<DailyInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  // Proven For You commit state (Fable moat 2026-07-23) — tracks whether
  // the user has already committed to this insight so we render a green
  // "Testing" confirm state instead of the button.
  const [committing, setCommitting] = useState(false);
  const [committed,  setCommitted]  = useState(false);

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
    if (embedded) {
      return (
        <button
          onClick={() => setInsight({ ...insight, feedback: null })}
          className="w-full py-2 text-[11px] text-gray-600 hover:text-gray-900 transition-colors"
        >
          💡 Today&apos;s insight is hidden — tap to view
        </button>
      );
    }
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

  // Embedded mode = sits inside another card (the unified briefing). Drop
  // the outer rounded-card chrome and use a tighter section style.
  const wrapperClass = embedded
    ? "pt-4 mt-4 border-t border-gray-200"
    : "rounded-2xl border border-[#1B3829]/30 bg-gradient-to-br from-[#1B3829]/5 to-white p-4 shadow-sm";

  return (
    <section className={wrapperClass}>
      <div className="flex items-start gap-3 mb-2">
        <div className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${badge.bg} ${badge.fg}`}>
          <span className="mr-1">{badge.emoji}</span>{badge.label}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829]">
            {embedded ? "Pattern of the week" : "Coach Al · today's insight"}
          </p>
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
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-0.5">Try this week</p>
          {/* Log-now CTA (Chris fix): closes the loop between insight
              guidance and action. If the action mentions logging and the
              category maps to a known input surface, render a jump-to
              button. Silently absent when no target exists — we never
              render a fake or dead-end CTA. */}
          {(() => {
            const cta = logCta(insight.category, insight.action);
            if (!cta) return null;
            return (
              <button
                onClick={() => scrollToTarget(cta.targetId)}
                className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors"
              >
                {cta.label} →
              </button>
            );
          })()}
        </div>
        <p className="text-sm text-gray-900 leading-snug">{insight.action}</p>

        {/* Proven For You commit CTA — Fable competitive brief moat.
            Closes the loop: user taps → 7-day test → result vs baseline
            → Proven ledger. Silently absent when we can't confidently
            map the insight to a trackable metric (never spawn a garbage
            experiment). Also absent when user already committed this
            session (renders green confirmation instead). */}
        {(() => {
          const metric = suggestMetric(insight.category, insight.action);
          if (!metric) return null;
          if (committed) {
            return (
              <div className="mt-2 pt-2 border-t border-[#1B3829]/10">
                <p className="text-[11px] font-semibold text-emerald-800">
                  ✅ Testing for 7 days &middot; check the Scorecard for progress
                </p>
              </div>
            );
          }
          return (
            <div className="mt-2 pt-2 border-t border-[#1B3829]/10 flex items-center justify-between gap-2">
              <p className="text-[10px] text-gray-500 leading-tight">
                Save the result to your <span className="font-semibold">Proven for you</span> ledger.
              </p>
              <button
                onClick={async () => {
                  if (committing) return;
                  setCommitting(true);
                  try {
                    await api.commitExperiment({
                      hypothesis:  insight.pattern,
                      action:      insight.action,
                      metric_type: metric,
                      insight_id:  insight.id,
                    });
                    setCommitted(true);
                  } catch {
                    // Silent — user can tap again
                  } finally {
                    setCommitting(false);
                  }
                }}
                disabled={committing}
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors disabled:opacity-50"
              >
                {committing ? "Committing..." : "Test for a week →"}
              </button>
            </div>
          );
        })()}
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
          <span className="ml-2 text-[10px] text-gray-600 italic">
            Thanks — future insights will tune to your taste.
          </span>
        )}
        {/* Always-visible link to the Insights Feed — accumulating history
            of every insight Coach Al has surfaced for the user. */}
        <Link
          href="/insights"
          className="ml-auto text-[11px] font-semibold text-[#1B3829] hover:underline"
        >
          View all insights →
        </Link>
      </div>
    </section>
  );
}
