"use client";

/**
 * TodayWorkoutCard — top-of-Training-tab prescriptive session card.
 *
 * Answers the question the Training tab was failing to answer: *what
 * should I do today?* Pulls from `/api/training/today` which is
 * Claude-generated based on the user's active goal, recent training
 * history, today's readiness, and the system-template library.
 *
 * Three primary actions:
 *   • Start session — seeds the workout logger with the prescribed
 *     exercises and marks the prescription "started".
 *   • Suggest another — regenerates today's prescription.
 *   • Skip today   — marks "skipped", collapses the card.
 *
 * Always pairs the prescription with a 1-2 sentence "why this today"
 * rationale so it reads as a coaching moment, not a black-box command.
 */

import { useEffect, useState } from "react";
import { api, type TodayWorkout, type TodayWorkoutExercise } from "@/lib/api";

interface Props {
  /** Called when the user taps "Start session". Receives the prescribed
   *  exercises so the parent (TrainingTab) can seed its logger. */
  onStartSession: (sessionName: string, exercises: TodayWorkoutExercise[]) => void;
}

const TYPE_BADGE: Record<NonNullable<TodayWorkout["session_type"]>, { label: string; emoji: string; bg: string; fg: string }> = {
  strength: { label: "Strength", emoji: "🏋️", bg: "bg-emerald-100", fg: "text-emerald-800" },
  cardio:   { label: "Cardio",   emoji: "🏃", bg: "bg-rose-100",    fg: "text-rose-800"    },
  mobility: { label: "Mobility", emoji: "🧘", bg: "bg-sky-100",     fg: "text-sky-800"     },
  rest:     { label: "Rest",     emoji: "😌", bg: "bg-gray-100",    fg: "text-gray-700"    },
};

const INTENSITY_DOT: Record<NonNullable<TodayWorkout["intensity"]>, string> = {
  easy:     "bg-emerald-500",
  moderate: "bg-amber-500",
  heavy:    "bg-rose-500",
  rest:     "bg-gray-400",
};

export default function TodayWorkoutCard({ onStartSession }: Props) {
  const [data, setData]     = useState<TodayWorkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    api.todayWorkout()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const handleStart = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      onStartSession(data.session_name || "Today's session", data.exercises || []);
      await api.todayWorkoutStatus("started");
      setData({ ...data, status: "started" });
    } catch {/* silent */}
    finally { setBusy(false); }
  };

  const handleSkip = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      await api.todayWorkoutStatus("skipped");
      setData({ ...data, status: "skipped" });
    } catch {/* silent */}
    finally { setBusy(false); }
  };

  const handleRegenerate = async () => {
    if (busy) return;
    setBusy(true);
    setLoading(true);
    try {
      const fresh = await api.todayWorkoutRegenerate();
      setData(fresh);
    } catch {/* silent */}
    finally { setBusy(false); setLoading(false); }
  };

  const handleFeedback = async (kind: "up" | "down") => {
    if (!data || busy) return;
    setBusy(true);
    try {
      await api.todayWorkoutFeedback(kind);
      setData({ ...data, feedback: kind });
    } catch {/* silent */}
    finally { setBusy(false); }
  };

  if (loading && !data) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600 italic">Building today&apos;s session…</p>
      </section>
    );
  }
  if (!data) return null;

  // Skipped collapses to a quiet pill so the user can re-show if they
  // change their mind.
  if (data.status === "skipped") {
    return (
      <button
        onClick={() => setData({ ...data, status: "pending" })}
        className="w-full py-2 rounded-2xl border border-gray-200 bg-white text-[11px] text-gray-600 hover:bg-gray-50 transition-colors"
      >
        💪 You skipped today&apos;s session — tap to view
      </button>
    );
  }

  const badge      = (data.session_type && TYPE_BADGE[data.session_type]) || TYPE_BADGE.strength;
  const dotClass   = (data.intensity && INTENSITY_DOT[data.intensity])     || "bg-gray-400";
  const started    = data.status === "started";
  const completed  = data.status === "completed";

  return (
    <section className="rounded-2xl border border-[#1B3829]/30 bg-gradient-to-br from-[#1B3829]/5 to-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${badge.bg} ${badge.fg}`}>
          <span className="mr-1">{badge.emoji}</span>{badge.label}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829]">Coach Al · today&apos;s workout</p>
          <h3 className="text-base font-bold text-gray-900 leading-tight mt-0.5">{data.session_name || "Today's session"}</h3>
          <p className="text-[11px] text-gray-600 mt-0.5 flex items-center gap-2">
            {data.intensity && (
              <span className="flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
                <span className="capitalize">{data.intensity}</span>
              </span>
            )}
            {data.duration_min && <span>· {data.duration_min} min</span>}
            {data.source === "template_fallback" && <span className="text-gray-500 italic">· template suggestion</span>}
          </p>
        </div>
      </div>

      {/* Rationale */}
      {data.rationale && (
        <p className="text-sm text-gray-800 leading-relaxed mb-2 italic">&ldquo;{data.rationale}&rdquo;</p>
      )}

      {/* Exercises list */}
      {data.exercises.length > 0 && (
        <ul className="rounded-lg border border-[#1B3829]/15 bg-white px-3 py-2 mb-3 space-y-1">
          {data.exercises.map((ex, i) => (
            <li key={`${ex.name}-${i}`} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-gray-900 font-medium truncate">{ex.name}</span>
              <span className="text-[11px] text-gray-600 font-mono shrink-0">
                {ex.sets && ex.reps && <span>{ex.sets} × {ex.reps}</span>}
                {ex.duration_sec && <span>{Math.round(ex.duration_sec / 60)} min</span>}
                {!ex.sets && !ex.duration_sec && ex.notes && <span className="italic">{ex.notes}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Primary actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {!completed && data.session_type !== "rest" && (
          <button
            onClick={handleStart}
            disabled={busy}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
              started
                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                : "bg-[#1B3829] hover:bg-[#2D6A4F] text-white"
            }`}
          >
            {started ? "✓ Logging started below" : "▶ Start session"}
          </button>
        )}
        {!started && !completed && (
          <>
            <button
              onClick={handleRegenerate}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              ↻ Suggest another
            </button>
            <button
              onClick={handleSkip}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-40"
            >
              Skip today
            </button>
          </>
        )}

        {/* Feedback chips */}
        {(started || completed) && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-gray-600">Useful?</span>
            <button
              onClick={() => handleFeedback("up")}
              disabled={busy || !!data.feedback}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                data.feedback === "up" ? "bg-emerald-100 text-emerald-800" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Useful"
            >👍</button>
            <button
              onClick={() => handleFeedback("down")}
              disabled={busy || !!data.feedback}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                data.feedback === "down" ? "bg-rose-100 text-rose-800" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Not useful"
            >👎</button>
          </div>
        )}
      </div>
    </section>
  );
}
