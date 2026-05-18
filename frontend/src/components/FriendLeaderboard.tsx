"use client";

/**
 * FriendLeaderboard — daily social-pressure strip on the Scorecard.
 *
 * Ranks you + your friends on a single rotating metric (steps / sleep score /
 * activity score). Each row shows the value, rank emoji, and a one-tap 👏
 * cheer button for friends you haven't cheered yet today.
 *
 * Silent if you have no friends connected. The Pulse feed handles that empty
 * state with its own invite CTA, no need to duplicate.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type LeaderboardEntry, type LeaderboardMetric } from "@/lib/api";

const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: "steps",    label: "Steps"    },
  { value: "sleep",    label: "Sleep"    },
  { value: "activity", label: "Activity" },
];

function rankEmoji(rank: number, hasValue: boolean): string {
  if (!hasValue) return "—";
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function fmtValue(value: number | null, metric: LeaderboardMetric): string {
  if (value == null) return "no data";
  if (metric === "steps") return value.toLocaleString();
  return String(Math.round(value)); // scores
}

function freshnessLabel(anchor: string, todayStr: string): string | null {
  if (!anchor || anchor === todayStr) return null;
  // Different day — show how stale the value is.
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

export default function FriendLeaderboard() {
  const [metric,  setMetric]  = useState<LeaderboardMetric>("steps");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [cheeringIds, setCheeringIds] = useState<Set<string>>(new Set());

  const [todayStr, setTodayStr] = useState<string>("");

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
    // Optimistic flip
    setEntries(prev => prev.map(e =>
      e.user_id === friend_user_id ? { ...e, i_cheered: true } : e
    ));
    try {
      await api.friends.cheer(friend_user_id);
    } catch {
      // Roll back on failure
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

  // Silent if you have no friends — entries will only contain yourself.
  const friendCount = entries.filter(e => !e.is_me).length;
  if (!loading && friendCount === 0) return null;

  if (loading && entries.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Today&apos;s Leaderboard
        </h3>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-8 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Today&apos;s Leaderboard
        </h3>
        {/* Metric selector */}
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
        {entries.map((e, idx) => {
          const rank = idx + 1;
          const hasValue = e.value != null;
          // Highlight the user's own row with a subtle background
          const rowBg = e.is_me ? "bg-[#1B3829]/5" : idx % 2 === 0 ? "bg-white" : "bg-gray-50/60";
          return (
            <div
              key={e.user_id}
              className={`flex items-center gap-2 px-3 py-2 ${rowBg} border-b border-gray-100 last:border-b-0`}
            >
              <span className={`text-sm font-bold shrink-0 w-7 text-center ${
                hasValue ? "" : "text-gray-300"
              }`}>
                {rankEmoji(rank, hasValue)}
              </span>
              <span className="w-7 h-7 rounded-full bg-[#1B3829] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                {(e.name || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${e.is_me ? "text-[#1B3829]" : "text-gray-900"}`}>
                  {e.is_me ? "You" : e.name}
                </p>
                <p className={`text-[11px] ${hasValue ? "text-gray-500" : "text-gray-300 italic"}`}>
                  {fmtValue(e.value, metric)}
                  {hasValue && freshnessLabel(e.anchor, todayStr) && (
                    <span className="text-gray-300 ml-1">· {freshnessLabel(e.anchor, todayStr)}</span>
                  )}
                </p>
              </div>
              {!e.is_me && (
                <button
                  onClick={() => handleCheer(e.user_id)}
                  disabled={e.i_cheered || cheeringIds.has(e.user_id)}
                  className={`shrink-0 text-xs px-2.5 py-1 rounded-lg transition-all border font-semibold ${
                    e.i_cheered
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-white border-[#1B3829]/30 text-[#1B3829] hover:bg-[#1B3829]/5 active:scale-95"
                  }`}
                  title={e.i_cheered ? "You've already cheered today" : `Cheer ${e.name}`}
                >
                  {e.i_cheered ? "✓ 👏" : "👏 Cheer"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-[10px] text-red-500 mt-1 italic">{error}</p>
      )}
    </section>
  );
}
