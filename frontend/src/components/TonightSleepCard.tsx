"use client";

/**
 * TonightSleepCard — Tonight's Sleep prescription for the Scorecard (Sleep
 * view).
 *
 * Forward-looking companion to the Morning Briefing's backward-looking
 * recap. Answers "what should I do tonight?" with three concrete things:
 *
 *   1. A bedtime window (wind-down → lights-out → expected wake)
 *   2. Where you stand on sleep debt + streak — context that influences how
 *      hard to lean into the recommendation
 *   3. A one-line Coach Al voice note tying it all together
 *
 * Renders nothing if Oura history is sparse — we'd rather not say anything
 * than fabricate a bedtime from no data. Mirrors the Today's Workout +
 * NutritionCoachCard visual treatment so coaching surfaces feel of-a-piece.
 */

import { useEffect, useState } from "react";
import { api, type TonightSleepPayload } from "@/lib/api";

interface Props {
  /** Optional — when provided, an "Ask Coach Al" link appears in the
   *  card footer and opens the chat drawer pre-seeded with a contextual
   *  question about tonight's bedtime, sleep debt, or the streak. */
  onAsk?: (seed: string) => void;
}

export default function TonightSleepCard({ onAsk }: Props = {}) {
  const [data,    setData]    = useState<TonightSleepPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.tonightSleep()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  // If neither bedtime, streak, debt, nor last-night data exist, the card
  // would say nothing useful — skip it entirely.
  const hasContent =
    !!data.bedtime || data.streak_nights > 0 || data.sleep_debt_hours !== null || !!data.last_night;
  if (!hasContent) return null;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#0f172a] to-[#1e3a5f] p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">
            Coach Al · tonight&apos;s sleep
          </p>
          <h3 className="text-base font-bold text-white leading-tight mt-0.5">
            {data.bedtime
              ? <>Lights out by {data.bedtime.lights_out}</>
              : <>Aim for {data.target_hours.toFixed(0)}h tonight</>}
          </h3>
        </div>
        {data.streak_nights > 1 && (
          <span
            className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/90 text-amber-900"
            title={`${data.streak_nights} consecutive nights ≥ 7h and ≥85% efficiency`}
          >
            🔥 {data.streak_nights} night streak
          </span>
        )}
      </div>

      {/* Bedtime window */}
      {data.bedtime && (
        <div className="rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-2.5 mb-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Wind down</p>
              <p className="text-sm font-bold text-white">{data.bedtime.wind_down_start}</p>
            </div>
            <span className="text-indigo-200/60 shrink-0">→</span>
            <div className="flex-1 min-w-0 text-center">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Lights out</p>
              <p className="text-sm font-bold text-white">{data.bedtime.lights_out}</p>
            </div>
            <span className="text-indigo-200/60 shrink-0">→</span>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Wake</p>
              <p className="text-sm font-bold text-white">{data.bedtime.target_wake}</p>
            </div>
          </div>
          {data.bedtime.earlier_for_training && (
            <p className="text-[10px] text-amber-200 italic mt-1.5">
              Shifted 30 min earlier — heavy training tomorrow.
            </p>
          )}
        </div>
      )}

      {/* Context chips: debt + last night */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.sleep_debt_hours !== null && data.sleep_debt_hours > 0.5 && (
          <span
            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-rose-100 text-rose-800 border border-rose-200"
            title="Sum of (target − actual) over the last 7 nights"
          >
            💤 {data.sleep_debt_hours.toFixed(1)}h sleep debt
          </span>
        )}
        {data.sleep_debt_hours !== null && data.sleep_debt_hours <= 0.5 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
            ✓ Debt-free week
          </span>
        )}
        {data.last_night && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-lg bg-white/15 text-white border border-white/20">
            Last night: {data.last_night.hours.toFixed(1)}h
            {data.last_night.efficiency !== null && ` · ${data.last_night.efficiency}% eff`}
          </span>
        )}
        {data.tomorrow_intensity && data.tomorrow_intensity !== "rest" && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-lg bg-indigo-100 text-indigo-900 border border-indigo-200 capitalize">
            Tomorrow: {data.tomorrow_intensity}
          </span>
        )}
      </div>

      {/* Coach voice note + Ask Coach Al handoff */}
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm text-white leading-snug italic flex-1">
          &ldquo;{data.coach_note}&rdquo;
        </p>
        {onAsk && (
          <button
            onClick={() => {
              // Seed the chat with whichever angle is most useful: heavy
              // debt → debt question, training tomorrow → why earlier,
              // streak → keep it going, otherwise just open with the
              // bedtime question.
              let seed = "What should tonight's sleep look like for me?";
              if (data.sleep_debt_hours !== null && data.sleep_debt_hours >= 3) {
                seed = `I'm carrying ${data.sleep_debt_hours.toFixed(1)}h of sleep debt — how do I climb out?`;
              } else if (data.bedtime?.earlier_for_training) {
                seed = "Why is tonight's lights-out earlier than usual?";
              } else if (data.streak_nights >= 3) {
                seed = `I'm on a ${data.streak_nights}-night sleep streak — anything I should change tonight?`;
              } else if (data.bedtime?.lights_out) {
                seed = `Why ${data.bedtime.lights_out} as tonight's lights-out?`;
              }
              onAsk(seed);
            }}
            className="shrink-0 text-[11px] font-semibold text-indigo-200 hover:text-white hover:underline transition-colors whitespace-nowrap"
          >
            💬 Ask Coach Al
          </button>
        )}
      </div>
    </section>
  );
}
