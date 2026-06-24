"use client";

/**
 * ExerciseHistoryModal — tap any exercise on Recent Workouts to see the full
 * trajectory of that lift.
 *
 * Shows:
 *   • Headline: lift name + lifetime PR pill
 *   • Trendline: estimated 1RM across every logged session (inline SVG so it
 *     prints cleanly and needs zero dependencies)
 *   • Session list: date + top set + e1RM + total volume, newest-first
 *   • Streak: "you've benched 4 weeks in a row" framing when applicable
 *
 * Why this exists: the PR badges on the Recent Workouts list answer "did I
 * make progress this session?". This modal answers the natural follow-on
 * "how have I been trending?" without making the user pivot to a separate
 * report or chart. Pairs with the Your PRs panel — that's the leaderboard,
 * this is the per-lift dossier.
 */

import { useEffect, useMemo, useState } from "react";
import { api, type ExerciseHistory } from "@/lib/api";

interface Props {
  exerciseName: string | null;
  onClose:      () => void;
}

// Tiny inline SVG line chart for the e1RM trendline. Self-contained so the
// modal works in a print preview and stays zero-dep. Auto-scales to data
// range with a 5% padding so the trend is always readable, never flatlined.
function Trendline({ values, dates }: { values: number[]; dates: string[] }) {
  if (values.length < 2) {
    return (
      <div className="text-[11px] text-gray-600 italic py-2 px-3 bg-gray-50 rounded-lg text-center">
        Log this exercise at least twice to see a trendline.
      </div>
    );
  }
  const W = 320;
  const H = 80;
  const PAD_X = 6;
  const PAD_Y = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const xStep = (W - PAD_X * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = PAD_X + i * xStep;
    const y = PAD_Y + (H - PAD_Y * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // Area fill under the line for visual weight.
  const areaPath = `${path} L ${points[points.length - 1][0].toFixed(1)} ${H - PAD_Y} L ${points[0][0].toFixed(1)} ${H - PAD_Y} Z`;
  const first = values[0];
  const last  = values[values.length - 1];
  const delta = last - first;
  const trendUp = delta > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700">Estimated 1RM trend</p>
        <p className={`text-[11px] font-semibold ${trendUp ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-gray-600"}`}>
          {trendUp ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta).toFixed(0)} lb {trendUp ? "gained" : delta < 0 ? "lost" : "no change"}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
        <path d={areaPath} fill="#1B3829" fillOpacity="0.08" />
        <path d={path} stroke="#1B3829" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#1B3829" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-0.5 font-mono">
        <span>{dates[0]}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </div>
  );
}

export default function ExerciseHistoryModal({ exerciseName, onClose }: Props) {
  const [data,    setData]    = useState<ExerciseHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!exerciseName) { setData(null); return; }
    setLoading(true); setError(null);
    api.exerciseHistory(exerciseName)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load history"))
      .finally(() => setLoading(false));
  }, [exerciseName]);

  // ESC closes the modal — small nicety, matches the other modals.
  useEffect(() => {
    if (!exerciseName) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exerciseName, onClose]);

  const sessionsNewestFirst = useMemo(
    () => data?.sessions ? [...data.sessions].reverse() : [],
    [data?.sessions],
  );

  if (!exerciseName) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829]">Exercise history</p>
            <h2 className="text-lg font-bold text-gray-900 capitalize truncate">
              {data?.display || exerciseName}
            </h2>
            {data && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {data.pr && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                    🏆 {data.pr.e1rm_lbs} lb e1RM
                  </span>
                )}
                {data.current_streak_weeks > 1 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                    🔥 {data.current_streak_weeks} weeks in a row
                  </span>
                )}
                <span className="text-[11px] text-gray-600">
                  {data.sessions.length} session{data.sessions.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-gray-900 text-2xl leading-none px-1"
            aria-label="Close"
          >×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          )}

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {data && data.sessions.length === 0 && !loading && (
            <p className="text-sm text-gray-600 italic">
              No sessions found for this exercise in the last 365 days.
            </p>
          )}

          {data && data.sessions.length > 0 && (
            <>
              <Trendline
                values={data.sessions.map(s => s.e1rm_lbs)}
                dates={data.sessions.map(s => s.date)}
              />

              {/* Session list — newest-first so the most recent is at the
                  top of the scroll. PR session gets a soft highlight. */}
              <div>
                <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1.5">
                  All sessions
                </p>
                <ul className="space-y-1.5">
                  {sessionsNewestFirst.map((s, i) => {
                    const isPr = data.pr && s.date === data.pr.date && s.e1rm_lbs === data.pr.e1rm_lbs;
                    return (
                      <li
                        key={`${s.date}-${i}`}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                          isPr ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {isPr && <span className="mr-1">🏆</span>}
                            {s.date}
                          </p>
                          <p className="text-[11px] text-gray-600">
                            Top set: {s.top_weight_lbs} lb × {s.top_reps}
                            {s.volume_lbs > 0 && ` · ${s.volume_lbs.toLocaleString()} lb total`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold text-[#1B3829]">
                            {s.e1rm_lbs} <span className="text-[10px] font-normal text-gray-600">lb e1RM</span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <p className="text-[10px] text-gray-500 italic pt-1">
                e1RM uses Epley (weight × (1 + reps/30)). Trend is across all logged sessions in the last 365 days.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
