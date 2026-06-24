"use client";

/**
 * NutritionCoachCard — Today's Plate for the Nutrition tab.
 *
 * Brings Training-tab parity to Nutrition: a Coach Al voice card that turns
 * the macro bars into a decision. Pace check → streak → concrete next-meal
 * suggestion. Same dark-gradient hero treatment as Today's Workout so the
 * design language stays consistent across coaching surfaces.
 *
 * Renders nothing while loading. When the user hasn't set macro targets the
 * pace section degrades to a gentle "set your targets" prompt — we never
 * fabricate a coaching note from empty data.
 */

import { useEffect, useState } from "react";
import { api, type NutritionCoachPayload } from "@/lib/api";

const PACE_STYLE: Record<NutritionCoachPayload["pace"]["kind"], { emoji: string; tone: string }> = {
  on_pace:          { emoji: "✓",  tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  behind_protein:   { emoji: "🥩", tone: "bg-amber-100 text-amber-900 border-amber-300" },
  behind_calories:  { emoji: "🍽", tone: "bg-sky-100 text-sky-800 border-sky-200"        },
  over_calories:    { emoji: "🛑", tone: "bg-rose-100 text-rose-800 border-rose-200"     },
  early:            { emoji: "☕", tone: "bg-gray-100 text-gray-700 border-gray-200"     },
  late_settled:     { emoji: "🌙", tone: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  no_targets:       { emoji: "⚙",  tone: "bg-gray-100 text-gray-700 border-gray-200"     },
};

interface Props {
  /** Optional — when provided, an "Ask Coach Al" link appears in the card
   *  footer and opens the chat drawer pre-seeded with a contextual prompt
   *  about today's macros, pace, or what to eat next. */
  onAsk?: (seed: string) => void;
}

export default function NutritionCoachCard({ onAsk }: Props = {}) {
  const [data,    setData]    = useState<NutritionCoachPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.nutritionTodayCoach()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  const paceStyle      = PACE_STYLE[data.pace.kind] || PACE_STYLE.no_targets;
  const proteinPct     = data.targets.protein > 0
    ? Math.min(100, Math.round(data.consumed.protein / data.targets.protein * 100))
    : 0;
  const caloriesPct    = data.targets.calories > 0
    ? Math.min(100, Math.round(data.consumed.calories / data.targets.calories * 100))
    : 0;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#1B3829] to-[#2D6A4F] p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-200">
            Coach Al · today&apos;s plate
          </p>
          <h3 className="text-base font-bold text-white leading-tight mt-0.5">
            {data.consumed.calories} / {data.targets.calories || "—"} kcal
          </h3>
        </div>
        {data.streak_days > 0 && (
          <span
            className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/90 text-amber-900"
            title={`Hit ≥${data.streak_threshold_pct}% of protein target ${data.streak_days} day${data.streak_days === 1 ? "" : "s"} in a row`}
          >
            🔥 {data.streak_days}-day protein streak
          </span>
        )}
      </div>

      {/* Pace pill */}
      <div className={`rounded-lg border px-3 py-2 mb-3 ${paceStyle.tone}`}>
        <p className="text-sm leading-snug">
          <span className="mr-1.5">{paceStyle.emoji}</span>
          {data.pace.message}
        </p>
      </div>

      {/* Inline mini-rings: protein + calories progress with target reference */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-white/10 backdrop-blur-sm px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-200">Protein</p>
          <p className="text-lg font-bold text-white leading-tight">
            {data.consumed.protein}<span className="text-[10px] font-normal text-emerald-100/80">g</span>
            <span className="text-[10px] font-normal text-emerald-100/80 ml-1">/ {data.targets.protein}g</span>
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-emerald-300 rounded-full transition-all"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg bg-white/10 backdrop-blur-sm px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-200">Calories</p>
          <p className="text-lg font-bold text-white leading-tight">
            {data.consumed.calories}
            <span className="text-[10px] font-normal text-emerald-100/80 ml-1">/ {data.targets.calories}</span>
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                caloriesPct >= 100 ? "bg-rose-300" : "bg-emerald-300"
              }`}
              style={{ width: `${Math.min(100, caloriesPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Day progress + next-meal hint */}
      {data.next_meal_hint && (
        <div className="rounded-lg border border-white/20 bg-white/95 px-3 py-2 mb-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-0.5">
            Next plate
          </p>
          <p className="text-sm text-gray-900 leading-snug">{data.next_meal_hint}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-[10px] text-emerald-100/70 italic">
          Day progress: {data.day_progress_pct}% · protein at {proteinPct}%, calories at {caloriesPct}%
        </p>
        {onAsk && (
          <button
            onClick={() => {
              // Tailor the seed to whatever Coach Al just flagged. The chat
              // backend already has the same NutritionCoachPayload in
              // context, so the question just has to point Claude at it.
              const seedByKind: Record<string, string> = {
                behind_protein:  "I'm behind on protein for today — what should I eat?",
                over_calories:   "I've gone over my calorie budget — what now?",
                behind_calories: "I've eaten lighter than usual today — is that fine?",
                on_pace:         "Am I on track for my macro targets today?",
                early:           "What should breakfast look like to hit my targets today?",
                late_settled:    "Wrap up my day — anything I should add or skip?",
                no_targets:      "Help me set my daily macro targets.",
              };
              const seed = seedByKind[data.pace.kind] ?? "Walk me through where I am on macros today.";
              onAsk(seed);
            }}
            className="shrink-0 text-[11px] font-semibold text-emerald-100 hover:text-white hover:underline transition-colors"
          >
            💬 Ask Coach Al
          </button>
        )}
      </div>
    </section>
  );
}
