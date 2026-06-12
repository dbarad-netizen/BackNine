"use client";

/**
 * TodaysMoveCard — Coach Al's one concrete recommendation for right now.
 *
 * Sits at the very top of the Scorecard, above the briefing. The briefing
 * is for reading; this card is for acting. The CTA button routes to the
 * right place based on cta_kind — meal logger, workout logger, chat seed,
 * tab nav, etc. — so a tap is enough to act on the recommendation.
 */

import { useEffect, useState } from "react";
import { api, type TodaysMove } from "@/lib/api";

interface Props {
  /** Open Coach Al chat, optionally with a seed message pre-typed. */
  onOpenChat?:        (seed?: string) => void;
  /** Navigate the parent Scorecard to a different section. */
  onNavSection?:      (section: "nutrition" | "training" | "challenges") => void;
  /** Open the meal logger in place (if mounted on Scorecard). */
  onOpenMealLogger?:  () => void;
  /** Open the workout logger (navigates to training in current setup). */
  onOpenWorkoutLogger?: () => void;
  /** Open the weight log (currently lives under Nutrition). */
  onOpenWeightLog?:   () => void;
}

export default function TodaysMoveCard({
  onOpenChat,
  onNavSection,
  onOpenMealLogger,
  onOpenWorkoutLogger,
  onOpenWeightLog,
}: Props) {
  const [move,    setMove]    = useState<TodaysMove | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.todaysMove()
      .then(m => { if (!cancelled) setMove(m); })
      .catch(() => { if (!cancelled) setMove(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    // Skeleton — keep the slot occupied so the page doesn't shift when the
    // recommendation arrives. Matches the eventual card height.
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-200 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 bg-amber-200 rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-amber-200 rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-amber-200/70 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Soft fail — if Coach Al's down or the parse failed, hide rather than
  // showing a broken card. The briefing still renders below.
  if (!move || dismissed) return null;

  const fireCta = () => {
    switch (move.cta_kind) {
      case "chat":           onOpenChat?.(move.cta_seed); break;
      case "meal":           onOpenMealLogger ? onOpenMealLogger() : onNavSection?.("nutrition"); break;
      case "workout":        onOpenWorkoutLogger ? onOpenWorkoutLogger() : onNavSection?.("training"); break;
      case "weight":         onOpenWeightLog ? onOpenWeightLog() : onNavSection?.("nutrition"); break;
      case "nav_nutrition":  onNavSection?.("nutrition"); break;
      case "nav_training":   onNavSection?.("training"); break;
      case "nav_clubhouse":  onNavSection?.("challenges"); break;
      case "walk":           setDismissed(true); break;
      case "none":
      default:               setDismissed(true); break;
    }
  };

  const showButton = move.cta_kind !== "none";

  return (
    <section
      className="rounded-2xl shadow-sm overflow-hidden border border-amber-300"
      style={{
        background: "linear-gradient(135deg, #fff7e6 0%, #fef3c7 65%, #fde68a 100%)",
      }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3 mb-2">
          <span className="text-3xl leading-none shrink-0" aria-hidden>{move.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-amber-800 font-semibold mb-0.5">
              Today&apos;s Move
            </p>
            <p className="text-base font-bold text-gray-900 leading-snug">{move.title}</p>
            <p className="text-[12px] text-amber-900/80 mt-1 leading-snug">{move.detail}</p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-amber-900/50 hover:text-amber-900 text-sm leading-none px-1 shrink-0"
            aria-label="Dismiss today's move"
            title="Dismiss for now"
          >
            ✕
          </button>
        </div>
        {showButton && (
          <button
            onClick={fireCta}
            className="w-full mt-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            {move.cta_label}
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </section>
  );
}
