"use client";

/**
 * TrainingLoadCards — three small cards that live on the Training tab,
 * all powered by one /api/training/load fetch:
 *
 *   • DeloadPrompt        (only renders when triggered)
 *   • WeeklyVolumeSparkline
 *   • MuscleBalanceHeatmap
 *
 * Co-located on purpose: they share the same payload and answer related
 * questions about how the user's training week is shaping up. Splitting them
 * into three separate fetches felt wasteful when the backend already
 * computes them off the same query.
 */

import { useEffect, useState } from "react";
import { api, type TrainingLoadPayload, type WeeklyLoadBucket, type MuscleBalance, type DeloadRecommendation } from "@/lib/api";

// ── Deload prompt ─────────────────────────────────────────────────────────

function DeloadPrompt({ rec, onDismiss }: { rec: DeloadRecommendation; onDismiss: () => void }) {
  if (!rec.triggered) return null;
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800">Coach Al · recovery check</p>
          <h3 className="text-base font-bold text-amber-900 leading-tight mt-0.5">
            Consider a deload this week
          </h3>
          {rec.reason && (
            <p className="text-sm text-amber-900 leading-snug mt-1">{rec.reason}.</p>
          )}
          {rec.suggestion && (
            <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 mt-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-0.5">Try this week</p>
              <p className="text-sm text-amber-900 leading-snug">{rec.suggestion}</p>
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-amber-700 hover:text-amber-900 text-lg leading-none px-1"
          aria-label="Dismiss"
          title="Hide this nudge"
        >×</button>
      </div>
    </section>
  );
}

// ── Weekly volume sparkline ───────────────────────────────────────────────

function WeeklyVolumeSparkline({ weekly }: { weekly: WeeklyLoadBucket[] }) {
  const totalSessions = weekly.reduce((acc, w) => acc + w.strength_sessions + w.cardio_sessions, 0);
  if (weekly.length === 0 || totalSessions === 0) return null;

  // Bar height encodes total sessions (strength + cardio) per week so users
  // see overall load. The legend below breaks down the current-week split.
  const W = 320;
  const H = 60;
  const PAD_X = 6;
  const PAD_Y = 4;
  const totals = weekly.map(w => w.strength_sessions + w.cardio_sessions);
  const maxBar = Math.max(...totals, 1);
  const barW = (W - PAD_X * 2) / weekly.length;
  const current = weekly[weekly.length - 1];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700">Training load</p>
          <h3 className="text-sm font-bold text-gray-900">Last {weekly.length} weeks</h3>
        </div>
        <p className="text-[11px] text-gray-600 text-right">
          This week: <span className="font-semibold text-gray-900">{current.strength_sessions + current.cardio_sessions} sessions</span>
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
        {weekly.map((w, i) => {
          const total = w.strength_sessions + w.cardio_sessions;
          const h = total > 0 ? Math.max(2, (H - PAD_Y * 2) * (total / maxBar)) : 0;
          const x = PAD_X + i * barW;
          const y = H - PAD_Y - h;
          const isCurrent = w.is_current;
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, barW - 1.5)}
              height={h}
              fill={isCurrent ? "#2D6A4F" : "#1B3829"}
              opacity={isCurrent ? 1 : 0.55}
              rx={1}
            >
              <title>{`${w.week}: ${w.strength_sessions} strength · ${w.cardio_sessions} cardio${w.volume_lbs ? ` · ${w.volume_lbs.toLocaleString()} lb vol` : ""}${w.cardio_min ? ` · ${w.cardio_min} cardio min` : ""}`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
        <span>{weekly[0].week}</span>
        <span>{current.week}</span>
      </div>

      {/* Breakdown for the current week — the only week the user cares
          about in detail. Hover gives full per-week detail via the <title>
          tooltips above. */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[11px] text-gray-700">
        {current.strength_sessions > 0 && <span>🏋️ {current.strength_sessions} strength</span>}
        {current.cardio_sessions > 0 && <span>🏃 {current.cardio_sessions} cardio · {current.cardio_min} min</span>}
        {current.volume_lbs > 0 && <span>📦 {current.volume_lbs.toLocaleString()} lb volume</span>}
        {(current.strength_sessions + current.cardio_sessions) === 0 && (
          <span className="italic text-gray-500">No sessions logged yet this week.</span>
        )}
      </div>
    </section>
  );
}

// ── Muscle balance heatmap ────────────────────────────────────────────────

const GROUP_LABEL: Record<string, string> = {
  chest: "Chest", back: "Back", legs: "Legs",
  shoulders: "Shoulders", arms: "Arms", core: "Core",
};

function intensityClass(days: number): string {
  // 0 days = gray, 1 = light, 2 = medium, 3+ = heavy emerald.
  if (days <= 0) return "bg-gray-100 text-gray-500 border-gray-200";
  if (days === 1) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (days === 2) return "bg-emerald-200 text-emerald-900 border-emerald-300";
  return "bg-emerald-400 text-white border-emerald-500";
}

function MuscleBalanceHeatmap({ balance }: { balance: MuscleBalance }) {
  if (balance.total_strength_sessions === 0) return null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700">Muscle balance</p>
          <h3 className="text-sm font-bold text-gray-900">Last 7 days · strength coverage</h3>
        </div>
        <p className="text-[11px] text-gray-600">{balance.total_strength_sessions} session{balance.total_strength_sessions === 1 ? "" : "s"}</p>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {balance.groups.map(g => (
          <div
            key={g.name}
            className={`rounded-lg border px-2 py-2 ${intensityClass(g.session_days)}`}
            title={`${GROUP_LABEL[g.name] || g.name}: ${g.session_days} session day${g.session_days === 1 ? "" : "s"} this week`}
          >
            <p className="text-[11px] font-semibold capitalize">{GROUP_LABEL[g.name] || g.name}</p>
            <p className="text-base font-bold leading-tight">{g.session_days}<span className="text-[10px] font-normal opacity-80">d</span></p>
          </div>
        ))}
      </div>

      {balance.imbalance_note && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-0.5">Gap to close</p>
          <p className="text-[11px] text-amber-900 leading-snug">{balance.imbalance_note}</p>
        </div>
      )}

      {/* Transparency footer — explains the credit logic so users who log
          a quick "upper body lifting" freeform session can see that the
          card is reading their notes too, not just the structured
          exercise list. Hidden when every bucket already has coverage. */}
      {balance.groups.some(g => g.session_days === 0) && (
        <p className="text-[10px] text-gray-500 italic mt-2">
          Credit comes from logged exercises + workout notes/type. Naming a session &ldquo;upper body&rdquo; or &ldquo;leg day&rdquo; counts those groups even without itemized exercises.
        </p>
      )}
    </section>
  );
}

// ── Combined container ────────────────────────────────────────────────────

export default function TrainingLoadCards() {
  const [data,    setData]    = useState<TrainingLoadPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [deloadDismissed, setDeloadDismissed] = useState(false);

  useEffect(() => {
    api.trainingLoad()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  return (
    <>
      {!deloadDismissed && (
        <DeloadPrompt
          rec={data.deload_recommendation}
          onDismiss={() => setDeloadDismissed(true)}
        />
      )}
      <WeeklyVolumeSparkline weekly={data.weekly_volume} />
      <MuscleBalanceHeatmap balance={data.muscle_balance} />
    </>
  );
}
