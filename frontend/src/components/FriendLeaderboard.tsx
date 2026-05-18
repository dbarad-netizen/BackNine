"use client";

/**
 * FriendLeaderboard — daily social-pressure strip on the Scorecard.
 *
 * Visual model: each ranked row has a horizontal progress bar filled to
 * value/leader_value so the gap between people is immediately readable as
 * a length. Above the list, a one-line narrative ("You're 1,200 behind
 * Sarah 👀") tells the story of the standings so the section has
 * personality, not just data. The 👏 Cheer CTA on friend rows is the
 * one-tap daily action — sends a cheer event into their Pulse feed and
 * locks until tomorrow.
 *
 * Silent if you have no friends connected — Pulse feed handles that
 * empty state with its own invite CTA.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type LeaderboardEntry, type LeaderboardMetric } from "@/lib/api";

const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: "steps",    label: "Steps"    },
  { value: "sleep",    label: "Sleep"    },
  { value: "activity", label: "Activity" },
];

const METRIC_UNITS: Record<LeaderboardMetric, string> = {
  steps:    "steps",
  sleep:    "pts",
  activity: "pts",
};


// ── Helpers ──────────────────────────────────────────────────────────────────

function rankEmoji(rank: number, hasValue: boolean): string {
  if (!hasValue) return "—";
  if (rank === 1) return "👑";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function fmtValue(value: number | null, metric: LeaderboardMetric): string {
  if (value == null) return "—";
  if (metric === "steps") return value.toLocaleString();
  return String(Math.round(value));
}

function fmtGap(gap: number, metric: LeaderboardMetric): string {
  if (metric === "steps") return Math.abs(gap).toLocaleString() + " steps";
  return Math.abs(Math.round(gap)) + " pts";
}

function freshnessLabel(anchor: string, todayStr: string): string | null {
  if (!anchor || anchor === todayStr) return null;
  try {
    const a = new Date(anchor + "T12:00:00Z").getTime();
    const t = new Date(todayStr + "T12:00:00Z").getTime();
    const diffDays = Math.round((t - a) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return "yesterday";
    if (diffDays > 1)   return `${diffDays}d ago`;
    return null;
  } catch {
    return null;
  }
}

/** Build the narrative line above the list. Returns null if too little data. */
function buildNarrative(entries: LeaderboardEntry[], metric: LeaderboardMetric): string | null {
  const ranked = entries.filter(e => e.value != null && e.value > 0);
  if (ranked.length < 2) return null;
  const me = ranked.find(e => e.is_me);
  if (!me) return null;
  const meIdx  = ranked.indexOf(me);
  const leader = ranked[0];
  const last   = ranked[ranked.length - 1];

  // You're #1
  if (me === leader) {
    const next = ranked[1];
    const gap  = (me.value ?? 0) - (next.value ?? 0);
    if (gap < 1 && metric === "steps") return `Neck and neck with ${next.name} 🤝`;
    return `Crushing it — ${fmtGap(gap, metric)} ahead of ${next.name} 🔥`;
  }

  // You're last (and there's at least 3)
  if (me === last && ranked.length >= 3) {
    const gap = (leader.value ?? 0) - (me.value ?? 0);
    return `${fmtGap(gap, metric)} behind ${leader.name} — time to move 👟`;
  }

  // Middle of pack — closest to which?
  const ahead   = ranked[meIdx - 1];
  const aheadGap   = (ahead.value ?? 0) - (me.value ?? 0);
  if (aheadGap < 200 && metric === "steps") {
    return `Just ${fmtGap(aheadGap, metric)} behind ${ahead.name} — push for it 💪`;
  }
  return `${fmtGap(aheadGap, metric)} behind ${ahead.name} 👀`;
}


// ── Component ────────────────────────────────────────────────────────────────

export default function FriendLeaderboard() {
  const [metric,  setMetric]  = useState<LeaderboardMetric>("steps");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [todayStr, setTodayStr] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [cheeringIds, setCheeringIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (m: LeaderboardMetric) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.friends.leaderboard(m);
      setEntries(res.entries);
      setTodayStr(res.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load leaderboard");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(metric); }, [metric, load]);

  const handleCheer = async (friend_user_id: string) => {
    if (cheeringIds.has(friend_user_id)) return;
    setCheeringIds(prev => new Set(prev).add(friend_user_id));
    setEntries(prev => prev.map(e =>
      e.user_id === friend_user_id ? { ...e, i_cheered: true } : e
    ));
    try {
      await api.friends.cheer(friend_user_id);
    } catch {
      setEntries(prev => prev.map(e =>
        e.user_id === friend_user_id ? { ...e, i_cheered: false } : e
      ));
    } finally {
      setCheeringIds(prev => {
        const next = new Set(prev);
        next.delete(friend_user_id);
        return next;
      });
    }
  };

  // Silent if no friends connected
  const friendCount = entries.filter(e => !e.is_me).length;
  if (!loading && friendCount === 0) return null;

  if (loading && entries.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Today&apos;s Leaderboard
        </h3>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  // Leader's value drives the bar scale (rows without values get nothing)
  const leaderValue = entries.find(e => e.value != null && e.value > 0)?.value ?? 0;
  const narrative   = buildNarrative(entries, metric);

  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Today&apos;s Leaderboard
        </h3>
        <div className="flex gap-1">
          {METRICS.map(m => (
            <button
              key={m.value}
              onClick={() => setMetric(m.value)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors font-semibold ${
                metric === m.value
                  ? "bg-[#1B3829] text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {/* Narrative header */}
        {narrative && (
          <div className="px-4 py-2.5 bg-gradient-to-r from-[#1B3829]/5 via-transparent to-transparent border-b border-gray-100">
            <p className="text-[13px] font-semibold text-gray-800 leading-snug">{narrative}</p>
          </div>
        )}

        {/* Ranked rows with progress bars */}
        <div className="divide-y divide-gray-100">
          {entries.map((e, idx) => {
            const rank      = idx + 1;
            const hasValue  = e.value != null && e.value > 0;
            const isLeader  = rank === 1 && hasValue;
            const pct       = hasValue && leaderValue > 0
              ? Math.max(8, Math.min(100, Math.round(((e.value ?? 0) / leaderValue) * 100)))
              : 0;

            // Bar color: gold for leader, green for you, gray for everyone else.
            const barColor = isLeader
              ? "bg-amber-400/80"
              : e.is_me
                ? "bg-[#1B3829]/80"
                : "bg-gray-300";

            const rowBg = e.is_me
              ? "bg-[#1B3829]/5"
              : isLeader
                ? "bg-amber-50/40"
                : "bg-white";

            const fresh = hasValue ? freshnessLabel(e.anchor, todayStr) : null;

            return (
              <div key={e.user_id} className={`px-4 py-2.5 ${rowBg}`}>
                {/* Row header: rank + name + value */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-base leading-none w-7 shrink-0 ${
                    hasValue ? "" : "text-gray-300"
                  }`}>
                    {rankEmoji(rank, hasValue)}
                  </span>
                  <span className="w-7 h-7 rounded-full bg-[#1B3829] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                    {(e.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <p className={`flex-1 min-w-0 text-sm font-semibold truncate ${
                    e.is_me ? "text-[#1B3829]" : "text-gray-900"
                  }`}>
                    {e.is_me ? "You" : e.name}
                    {isLeader && hasValue && (
                      <span className="ml-1 text-[10px] text-amber-700 font-bold uppercase tracking-wide">Leader</span>
                    )}
                  </p>
                  <p className={`text-sm font-bold shrink-0 tabular-nums ${
                    hasValue ? (e.is_me ? "text-[#1B3829]" : "text-gray-900") : "text-gray-300"
                  }`}>
                    {fmtValue(e.value, metric)}
                  </p>
                </div>

                {/* Progress bar + freshness/cheer row */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    {hasValue && (
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                  {fresh && (
                    <span className="text-[9px] text-gray-300 italic shrink-0">{fresh}</span>
                  )}
                  {!e.is_me && hasValue && (
                    <button
                      onClick={() => handleCheer(e.user_id)}
                      disabled={e.i_cheered || cheeringIds.has(e.user_id)}
                      className={`shrink-0 text-[11px] px-2.5 py-1 rounded-lg transition-all border font-semibold ${
                        e.i_cheered
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-[#1B3829] border-[#1B3829] text-white hover:bg-[#2D6A4F] active:scale-95 shadow-sm"
                      }`}
                      title={e.i_cheered ? "You've cheered today" : `Cheer ${e.name}`}
                    >
                      {e.i_cheered ? "✓ Cheered" : "👏 Cheer"}
                    </button>
                  )}
                </div>
                {/* Unit hint — small, only show below your row to anchor scale */}
                {e.is_me && hasValue && (
                  <p className="text-[9px] text-gray-400 mt-1">{METRIC_UNITS[metric]} today</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-red-500 mt-1 italic">{error}</p>
      )}
    </section>
  );
}
