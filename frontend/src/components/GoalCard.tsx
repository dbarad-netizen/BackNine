"use client";

/**
 * GoalCard — Coach Al's goal/program on the Scorecard.
 *
 * Shows your single active goal: a Coach-Al-generated multi-week plan, a live
 * progress bar (baseline → current → target), this week's focus, and the full
 * plan. When there's no goal, it offers a create flow (pick a metric → target →
 * duration → Coach Al builds the plan).
 */

import { useEffect, useState } from "react";
import { api, type Goal, type GoalMetricOption } from "@/lib/api";
import CoachAlAvatar from "@/components/CoachAlAvatar";

interface Props {
  onOpenChat?: (seed?: string) => void;
  /** Fires whenever we learn whether the user has an active goal, so the
   *  dashboard can hoist this card above the Weekly Insight when one exists. */
  onActiveChange?: (active: boolean) => void;
}

const DURATIONS = [4, 6, 8, 12];

// Pace banner colors keyed by Coach Al's tone.
const PACE_TONE: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  win:     { bg: "bg-green-50",     border: "border-green-200",     text: "text-green-800",  dot: "bg-green-500" },
  good:    { bg: "bg-[#1B3829]/5",  border: "border-[#1B3829]/15",  text: "text-[#1B3829]",  dot: "bg-[#2D6A4F]" },
  warn:    { bg: "bg-amber-50",     border: "border-amber-200",     text: "text-amber-800",  dot: "bg-amber-500" },
  neutral: { bg: "bg-gray-50",      border: "border-gray-200",      text: "text-gray-600",   dot: "bg-gray-400" },
};

function fmt(v: number | null, unit: string): string {
  if (v == null) return "—";
  const n = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  return `${n}${unit}`;
}

export default function GoalCard({ onOpenChat, onActiveChange }: Props) {
  const [goal, setGoal]       = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [metrics, setMetrics] = useState<GoalMetricOption[] | null>(null);
  const [selMetric, setSelMetric] = useState<string | null>(null);
  const [target, setTarget]   = useState("");
  const [duration, setDuration] = useState(6);
  const [building, setBuilding] = useState(false);
  const [expandPlan, setExpandPlan] = useState(false);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    api.goal.active()
      .then(r => { setGoal(r.goal); onActiveChange?.(!!r.goal); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // onActiveChange is a stable setter from the parent; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCreate = () => {
    setCreating(true);
    setError(null);
    if (!metrics) api.goal.metrics().then(r => setMetrics(r.metrics)).catch(() => setMetrics([]));
  };

  const submitCreate = async () => {
    if (!selMetric || !target.trim() || building) return;
    setBuilding(true);
    setError(null);
    try {
      const g = await api.goal.create(selMetric, parseFloat(target), duration);
      setGoal(g);
      onActiveChange?.(true);
      setCreating(false);
      setSelMetric(null); setTarget("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the goal");
    } finally {
      setBuilding(false);
    }
  };

  const handleComplete = async () => {
    if (!goal) return;
    try { await api.goal.complete(goal.id); } catch { /* ignore */ }
    setGoal(null);
    onActiveChange?.(false);
  };

  const handleAbandon = async () => {
    if (!goal) return;
    if (!abandonConfirm) {
      setAbandonConfirm(true);
      setTimeout(() => setAbandonConfirm(false), 3000);
      return;
    }
    try { await api.goal.remove(goal.id); } catch { /* ignore */ }
    setGoal(null);
    onActiveChange?.(false);
    setAbandonConfirm(false);
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-3 w-full bg-gray-50 rounded animate-pulse" />
      </section>
    );
  }

  const selOpt = metrics?.find(m => m.metric === selMetric) || null;

  // ── Active goal view ──
  if (goal) {
    const pct = goal.progress_pct ?? 0;
    return (
      <section className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: "#1B382944" }}>
        <div className="h-1" style={{ backgroundColor: "#1B3829" }} />
        <div className="p-5">
          <div className="flex items-start gap-3">
            <CoachAlAvatar size={44} className="rounded-full ring-2 ring-gray-100 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Coach Al · Your Goal</p>
                <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#1B3829]/10 text-[#1B3829]">
                  Wk {goal.week}/{goal.total_weeks}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 text-[16px] leading-snug">
                {goal.headline || `${goal.label} goal`}
              </h3>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-semibold text-gray-900">
                {fmt(goal.current, goal.unit)}
                <span className="text-xs text-gray-600 font-normal"> now</span>
              </span>
              <span className="text-xs text-gray-600">Goal: {fmt(goal.target, goal.unit)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#22c55e" : "#1B3829" }} />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-gray-600">
                {goal.baseline != null ? `Started at ${fmt(goal.baseline, goal.unit)}` : "Tracking from now"}
              </span>
              <span className="text-[10px] text-gray-600">
                {goal.progress_pct != null ? `${pct}%` : "—"} · {goal.days_left}d left
              </span>
            </div>
          </div>

          {/* Pace — are you tracking to target? Coach Al's at-a-glance read. */}
          {goal.pace && goal.pace.status !== "no_data" && (() => {
            const t = PACE_TONE[goal.pace.tone] || PACE_TONE.neutral;
            const d = goal.pace.delta_pct;
            const showDelta = d != null && goal.pace.status !== "reached" && goal.pace.status !== "starting";
            return (
              <div className={`mt-3 rounded-xl border ${t.bg} ${t.border} px-3.5 py-2.5`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${t.dot} shrink-0`} />
                  <p className={`text-[12px] font-bold ${t.text}`}>{goal.pace.label}</p>
                  {showDelta && (
                    <span className={`text-[10px] font-semibold ${t.text} opacity-70`}>
                      {d! > 0 ? `+${d}` : d}% vs pace
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-gray-600 leading-snug mt-1">{goal.pace.message}</p>
              </div>
            );
          })()}

          {/* This week's focus */}
          {goal.this_week && (
            <div className="mt-4 rounded-xl bg-[#1B3829]/5 border border-[#1B3829]/10 px-4 py-3">
              <p className="text-[10px] text-[#1B3829] font-semibold uppercase tracking-wide mb-1">
                This week · {goal.this_week.focus}
              </p>
              <ul className="space-y-1">
                {goal.this_week.actions.map((a, i) => (
                  <li key={i} className="text-[13px] text-gray-700 leading-snug flex gap-1.5">
                    <span className="text-[#2D6A4F]">›</span><span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Full plan toggle */}
          {goal.weeks.length > 0 && (
            <button onClick={() => setExpandPlan(e => !e)}
              className="mt-3 text-[11px] font-medium text-gray-600 hover:text-gray-800">
              {expandPlan ? "▲ Hide full plan" : `▼ See the full ${goal.total_weeks}-week plan`}
            </button>
          )}
          {expandPlan && (
            <div className="mt-2 space-y-2">
              {goal.overview && <p className="text-[12px] text-gray-600 leading-relaxed">{goal.overview}</p>}
              {goal.weeks.map(w => (
                <div key={w.week} className={`rounded-lg px-3 py-2 border ${w.week === goal.week ? "border-[#1B3829]/30 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"}`}>
                  <p className="text-[11px] font-semibold text-gray-700">Week {w.week}: {w.focus}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {w.actions.map((a, i) => (
                      <li key={i} className="text-[11px] text-gray-600 leading-snug">• {a}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-50 px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button onClick={handleComplete} className="text-[11px] font-semibold text-green-600 hover:underline">
              ✓ Mark complete
            </button>
            <button onClick={handleAbandon}
              className={`text-[11px] transition-colors ${abandonConfirm ? "text-red-500 font-semibold" : "text-gray-600 hover:text-gray-600"}`}>
              {abandonConfirm ? "Confirm?" : "Abandon"}
            </button>
          </div>
          {onOpenChat && (
            <button
              onClick={() => onOpenChat(`Let's talk about my goal: ${goal.headline || goal.label}. I'm at ${fmt(goal.current, goal.unit)} aiming for ${fmt(goal.target, goal.unit)} (week ${goal.week} of ${goal.total_weeks}). How am I doing and what should I focus on?`)}
              className="text-[11px] font-semibold text-[#1B3829] hover:underline">
              Ask Coach Al →
            </button>
          )}
        </div>
      </section>
    );
  }

  // ── Create flow ──
  if (creating) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CoachAlAvatar size={32} className="rounded-full ring-2 ring-gray-100 shrink-0" />
          <p className="text-sm font-bold text-gray-900">Set a goal — I&apos;ll build your plan</p>
        </div>

        {metrics === null ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-[11px] text-gray-600 uppercase tracking-widest mb-1.5">What do you want to improve?</p>
            <div className="space-y-1.5 mb-3">
              {metrics.map(m => (
                <button key={m.metric} onClick={() => setSelMetric(m.metric)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors ${
                    selMetric === m.metric ? "border-[#1B3829] bg-[#1B3829]/5" : "border-gray-200 hover:bg-gray-50"
                  }`}>
                  <span className="text-sm font-medium text-gray-800">{m.label}</span>
                  <span className="text-[11px] text-gray-600">
                    {m.current != null ? `Now: ${fmt(m.current, m.unit)}` : "no data yet"}
                  </span>
                </button>
              ))}
            </div>

            {selMetric && (
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 w-20 shrink-0">Target</label>
                  <input type="number" step="any" value={target} onChange={e => setTarget(e.target.value)}
                    placeholder={selOpt?.current != null ? `e.g. ${selOpt.current}` : "target value"}
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]" />
                  <span className="text-xs text-gray-600">{selOpt?.unit?.trim() || ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 w-20 shrink-0">Timeframe</label>
                  <div className="flex gap-1.5">
                    {DURATIONS.map(d => (
                      <button key={d} onClick={() => setDuration(d)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          duration === d ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-600 hover:text-gray-800"
                        }`}>{d} wk</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-4">
              <button onClick={submitCreate} disabled={!selMetric || !target.trim() || building}
                className="flex-1 py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-40">
                {building ? "Coach Al is building your plan…" : "Build my plan"}
              </button>
              <button onClick={() => { setCreating(false); setSelMetric(null); setTarget(""); setError(null); }}
                className="px-3 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  // ── Empty state ──
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CoachAlAvatar size={40} className="rounded-full ring-2 ring-gray-100 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Coach Al · Your Goal</p>
          <p className="font-bold text-gray-900 text-[15px] leading-snug">Pick a goal and I&apos;ll coach you to it</p>
          <p className="text-[13px] text-gray-600 leading-relaxed mt-1">
            Choose something to improve — your Longevity Score, body fat, VO₂ max, a training habit — and I&apos;ll build a week-by-week plan and track your progress.
          </p>
          <button onClick={startCreate}
            className="mt-3 py-2 px-4 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">
            Set a goal
          </button>
        </div>
      </div>
    </section>
  );
}
