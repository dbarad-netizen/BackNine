"use client";

/**
 * FriendDetailModal — peer profile drill-down.
 *
 * Opens when you tap a friend on the Today's Leaderboard. Shows their 7-day
 * sparklines (steps, sleep, HRV, RHR), latest longevity score, recent workouts,
 * and latest weigh-in — so you can actually have a conversation about what
 * the data shows. The "Ask about this" button opens the DM drawer prefilled
 * with a topical message so the dialog starts somewhere concrete.
 *
 * Privacy posture: confirmed friends only. The backend enforces this with a
 * 403 if you try to fetch a non-friend's profile.
 */

import { useEffect, useState } from "react";
import { api, type FriendProfile, type SparkPoint } from "@/lib/api";

interface Props {
  friendUserId: string;
  friendName: string;
  onClose: () => void;
  /** When set, the user tapped a metric chip — opens DM with a topical prefill. */
  onOpenDm: (friendUserId: string, friendName: string, seed?: string) => void;
}

// ── Comparison chart — friend's series vs yours, same y-scale, no deps ──
//
// Replaces a single-line sparkline so the user actually SEES the comparison
// over time, not just "their trend next to one of my numbers." Friend = solid
// in the metric color; you = solid gray. Both autoscale to a shared y-range
// so the visual contrast is real (one line above the other = leading on that
// metric over the window).
function ComparisonChart({
  friendPoints, youPoints, color, height = 44,
}: {
  friendPoints: SparkPoint[];
  youPoints?:   SparkPoint[];
  color:        string;
  height?:      number;
}) {
  const toVals = (pts: SparkPoint[] | undefined): (number | null)[] =>
    (pts || []).map(p => (typeof p.value === "number" ? p.value : null));

  const friendVals = toVals(friendPoints);
  const youVals    = toVals(youPoints);

  // Both series share the same x-axis (one point per day, oldest left).
  // We treat the friend's length as the canonical window — backend produces
  // 14 entries for both. If the viewer hasn't data for some days, those
  // appear as gaps in the gray line, not a flat zero.
  const len = friendVals.length;
  const realAll = [...friendVals, ...youVals].filter((v): v is number => v != null);
  if (realAll.length < 2 || len < 2) {
    return (
      <div className="text-[10px] text-gray-500 italic h-11 flex items-center">
        Not enough data yet
      </div>
    );
  }

  const max  = Math.max(...realAll);
  const min  = Math.min(...realAll);
  const span = max - min || 1;
  const W    = 100;          // viewBox width — scaled by CSS
  const H    = height;

  // Build a piecewise SVG path for any series of (date-indexed) values.
  // Nulls break the line so missing days don't draw a straight slope across them.
  const buildPath = (vals: (number | null)[]): { d: string[]; xs: number[]; ys: (number | null)[]; lastIdx: number } => {
    const xs = vals.map((_, i) => (vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W));
    const ys = vals.map(v => (v == null ? null : H - ((v - min) / span) * (H - 6) - 3));
    const d: string[] = [];
    let cur = "";
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null) {
        if (cur) { d.push(cur); cur = ""; }
        continue;
      }
      cur += `${cur ? "L" : "M"}${xs[i]},${ys[i]}`;
    }
    if (cur) d.push(cur);
    let lastIdx = -1;
    for (let i = vals.length - 1; i >= 0; i--) { if (vals[i] != null) { lastIdx = i; break; } }
    return { d, xs, ys, lastIdx };
  };

  // Align the viewer's series to the friend's length: pad with leading nulls
  // if shorter (rare, but possible if the friend has more history than you).
  const youAligned = youVals.length === len ? youVals : Array(Math.max(0, len - youVals.length)).fill(null).concat(youVals).slice(-len);
  const friend = buildPath(friendVals);
  const you    = youVals.length > 0 ? buildPath(youAligned) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-11">
      {/* You — drawn first so the friend's color sits on top */}
      {you && you.d.map((seg, i) => (
        <path key={`y-${i}`} d={seg} fill="none" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      ))}
      {you && you.lastIdx >= 0 && you.ys[you.lastIdx] != null && (
        <circle cx={you.xs[you.lastIdx]} cy={you.ys[you.lastIdx] as number} r="1.6" fill="#9ca3af" />
      )}
      {/* Friend — primary color */}
      {friend.d.map((seg, i) => (
        <path key={`f-${i}`} d={seg} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {friend.lastIdx >= 0 && friend.ys[friend.lastIdx] != null && (
        <circle cx={friend.xs[friend.lastIdx]} cy={friend.ys[friend.lastIdx] as number} r="2" fill={color} />
      )}
    </svg>
  );
}

function fmtNumber(v: number | null, suffix = ""): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString()}${suffix}`;
}

function lastValue(points: SparkPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (typeof points[i].value === "number") return points[i].value;
  }
  return null;
}

function avgValue(points: SparkPoint[]): number | null {
  const vals = points.map(p => p.value).filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function FriendDetailModal({ friendUserId, friendName, onClose, onOpenDm }: Props) {
  const [data, setData]       = useState<FriendProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    api.friends.profile(friendUserId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load"))
      .finally(() => setLoading(false));
  }, [friendUserId]);

  const dm = (seed?: string) => onOpenDm(friendUserId, data?.name || friendName, seed);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#1B3829] text-white flex items-center justify-center text-sm font-bold shrink-0">
              {(data?.name || friendName).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 truncate">{data?.name || friendName}</h2>
              <p className="text-[11px] text-gray-600">
                {data?.level != null ? `Level ${data.level} · ` : ""}Friend profile
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 hover:text-gray-900 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <p className="text-sm text-gray-600 text-center py-8">Loading…</p>
          )}
          {!loading && error && (
            <p className="text-sm text-red-500 text-center py-4">{error}</p>
          )}

          {!loading && !error && data && (
            <>
              {/* 14-day comparison chart for the four headline metrics —
                  two overlaid series per tile (friend in color, you in gray)
                  on a shared y-scale. Trends, not single readings. */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">
                    Last 14 days
                  </p>
                  {data.you && (
                    <p className="text-[10px] text-gray-500 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-0.5 rounded-full bg-gray-900" />
                        {data.name.split(" ")[0]}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-0.5 rounded-full bg-gray-400" />
                        you
                      </span>
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "steps", label: "Steps",      color: "#22c55e", higherIsBetter: true,  fmt: (v: number | null) => fmtNumber(v) },
                    { key: "sleep", label: "Sleep score", color: "#6366f1", higherIsBetter: true,  fmt: (v: number | null) => v == null ? "—" : `${Math.round(v)}` },
                    { key: "hrv",   label: "HRV",         color: "#f59e0b", higherIsBetter: true,  fmt: (v: number | null) => fmtNumber(v, " ms") },
                    { key: "rhr",   label: "Resting HR",  color: "#ef4444", higherIsBetter: false, fmt: (v: number | null) => fmtNumber(v, " bpm") },
                  ] as const).map(({ key, label, color, higherIsBetter, fmt }) => {
                    const series      = data.series[key];
                    const friendLatest= lastValue(series);
                    const friendAvg   = avgValue(series);
                    const youSeries   = data.you?.series[key];
                    const youLatest   = youSeries ? lastValue(youSeries) : null;
                    // Compare against most-recent values. Direction matters:
                    // lower RHR is better; everything else higher is better.
                    let leader: "friend" | "you" | null = null;
                    let delta: number | null = null;
                    if (friendLatest != null && youLatest != null) {
                      delta = friendLatest - youLatest;
                      if (Math.abs(delta) > 0.5) {
                        const friendAhead = higherIsBetter ? delta > 0 : delta < 0;
                        leader = friendAhead ? "friend" : "you";
                      }
                    }
                    const friendFirst = data.name.split(" ")[0];
                    const seed = (friendLatest != null && youLatest != null)
                      ? `Your ${label.toLowerCase()} today is ${fmt(friendLatest)} — mine is ${fmt(youLatest)}. How are you feeling about it?`
                      : `Quick one — how's your ${label.toLowerCase()} been this week?`;
                    return (
                      <button key={key} onClick={() => dm(seed)}
                        className="text-left rounded-xl bg-gray-50 border border-gray-100 p-3 hover:border-[#1B3829]/30 transition-colors">
                        <div className="flex items-baseline justify-between mb-1">
                          <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">{label}</p>
                          <p className="text-[10px] text-gray-600">avg {fmt(friendAvg)}</p>
                        </div>
                        {/* Friend value (primary — this is the friend's profile) */}
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-sm font-bold text-gray-900 tabular-nums">{fmt(friendLatest)}</p>
                          <p className="text-[10px] text-gray-500 truncate">{friendFirst}</p>
                          {leader === "friend" && (
                            <span className="text-[9px] font-semibold text-green-700 ml-auto shrink-0">↑ ahead</span>
                          )}
                        </div>
                        {/* Viewer value — only show when we have a number to compare */}
                        {data.you && (
                          <div className="flex items-baseline gap-1.5 mt-0.5 mb-1.5">
                            <p className="text-xs font-semibold text-gray-700 tabular-nums">{fmt(youLatest)}</p>
                            <p className="text-[10px] text-gray-500">you</p>
                            {leader === "you" && (
                              <span className="text-[9px] font-semibold text-green-700 ml-auto shrink-0">↑ ahead</span>
                            )}
                          </div>
                        )}
                        <ComparisonChart friendPoints={series} youPoints={youSeries} color={color} />
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Longevity score — side-by-side */}
              {data.longevity.score != null && (
                <section className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">Longevity Score</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-500 mb-0.5">{data.name.split(" ")[0]}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {data.longevity.score}<span className="text-sm text-gray-600 font-normal">/100</span>
                      </p>
                      {data.longevity.grade && (
                        <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1B3829]/10 text-[#1B3829] mt-1">
                          {data.longevity.grade}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 mb-0.5">You</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {data.you?.longevity.score != null
                          ? <>{data.you.longevity.score}<span className="text-sm text-gray-600 font-normal">/100</span></>
                          : <span className="text-gray-400 text-base font-normal">—</span>}
                      </p>
                      {data.you?.longevity.grade && (
                        <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 mt-1">
                          {data.you.longevity.grade}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => dm(
                    data.you?.longevity.score != null
                      ? `Your Longevity Score is ${data.longevity.score} (${data.longevity.grade}). Mine is ${data.you.longevity.score}. What's been working for you?`
                      : `Your Longevity Score is ${data.longevity.score} (${data.longevity.grade}) — what's been working for you?`
                  )}
                    className="mt-3 text-[11px] font-semibold text-[#1B3829] hover:underline">
                    Ask about this →
                  </button>
                </section>
              )}

              {/* Supplement stack — side-by-side, only render if either side
                  has anything. Highlight shared supplements (matched by lowercase
                  name) so the conversation can start with "we both take X". */}
              {((data.supplements?.length ?? 0) > 0 || (data.you?.supplements?.length ?? 0) > 0) && (() => {
                const friendStack = data.supplements ?? [];
                const yourStack   = data.you?.supplements ?? [];
                const friendNames = new Set(friendStack.map(s => s.name.toLowerCase()));
                const yourNames   = new Set(yourStack.map(s => s.name.toLowerCase()));
                const shared      = friendStack.filter(s => yourNames.has(s.name.toLowerCase()));
                const dmSeed = shared.length > 0
                  ? `Saw we both take ${shared.slice(0, 3).map(s => s.name).join(", ")}. How's it working for you?`
                  : friendStack.length > 0
                    ? `Curious about your stack — ${friendStack.slice(0, 2).map(s => s.name).join(" + ")}${friendStack.length > 2 ? " and others" : ""}. What's it doing for you?`
                    : "What supplements are you taking these days?";
                return (
                  <section className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-baseline justify-between mb-2">
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Supplement stack</p>
                      {shared.length > 0 && (
                        <span className="text-[10px] text-emerald-700 font-semibold">
                          {shared.length} shared
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">{data.name.split(" ")[0]}</p>
                        {friendStack.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">No stack shared</p>
                        ) : (
                          <ul className="space-y-1">
                            {friendStack.map((s, i) => {
                              const isShared = yourNames.has(s.name.toLowerCase());
                              return (
                                <li key={`f-${i}`} className={`text-xs ${isShared ? "text-emerald-800 font-semibold" : "text-gray-900"}`}>
                                  {isShared && <span className="mr-1">✓</span>}
                                  {s.name}
                                  {s.dose && <span className="text-gray-600 font-normal"> · {s.dose}</span>}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">You</p>
                        {yourStack.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">No stack logged yet</p>
                        ) : (
                          <ul className="space-y-1">
                            {yourStack.map((s, i) => {
                              const isShared = friendNames.has(s.name.toLowerCase());
                              return (
                                <li key={`y-${i}`} className={`text-xs ${isShared ? "text-emerald-800 font-semibold" : "text-gray-900"}`}>
                                  {isShared && <span className="mr-1">✓</span>}
                                  {s.name}
                                  {s.dose && <span className="text-gray-600 font-normal"> · {s.dose}</span>}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                    {friendStack.length > 0 && (
                      <button onClick={() => dm(dmSeed)}
                        className="mt-3 text-[11px] font-semibold text-[#1B3829] hover:underline">
                        Ask about this →
                      </button>
                    )}
                  </section>
                );
              })()}

              {/* Recent workouts */}
              {data.recent_workouts.length > 0 && (
                <section>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
                    Recent workouts
                  </p>
                  <ul className="space-y-1.5">
                    {data.recent_workouts.map(w => (
                      <li key={w.id} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 capitalize truncate">{w.type}</p>
                          <p className="text-[11px] text-gray-600">
                            {w.date}{w.duration_min ? ` · ${w.duration_min} min` : ""}
                            {w.distance_meters ? ` · ${(w.distance_meters / 1609.34).toFixed(2)} mi` : ""}
                          </p>
                        </div>
                        {w.source === "oura" && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 shrink-0">💍 Oura</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Latest weigh-in — side-by-side (only when at least one side has data) */}
              {(data.latest_weight?.weight_lbs != null || data.you?.latest_weight?.weight_lbs != null) && (
                <section className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">Latest weigh-in</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-500 mb-0.5">{data.name.split(" ")[0]}</p>
                      {data.latest_weight?.weight_lbs != null ? (
                        <>
                          <p className="text-sm font-bold text-gray-900">{data.latest_weight.weight_lbs} lbs</p>
                          {data.latest_weight.body_fat_pct != null && (
                            <p className="text-[10px] text-gray-600">{data.latest_weight.body_fat_pct}% fat</p>
                          )}
                          <p className="text-[10px] text-gray-500 mt-0.5">{data.latest_weight.date}</p>
                        </>
                      ) : <p className="text-sm text-gray-400">—</p>}
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 mb-0.5">You</p>
                      {data.you?.latest_weight?.weight_lbs != null ? (
                        <>
                          <p className="text-sm font-bold text-gray-900">{data.you.latest_weight.weight_lbs} lbs</p>
                          {data.you.latest_weight.body_fat_pct != null && (
                            <p className="text-[10px] text-gray-600">{data.you.latest_weight.body_fat_pct}% fat</p>
                          )}
                          <p className="text-[10px] text-gray-500 mt-0.5">{data.you.latest_weight.date}</p>
                        </>
                      ) : <p className="text-sm text-gray-400">—</p>}
                    </div>
                  </div>
                </section>
              )}

              {/* General DM CTA */}
              <button onClick={() => dm()}
                className="w-full py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">
                💬 Message {data.name.split(" ")[0]}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
