"use client";

/**
 * FriendLeaderboard — multi-metric daily matchup with trash-talk presets.
 *
 * Each person gets one card showing all three metrics (Steps / Sleep /
 * Activity) inline with a 🏅 medal beside whichever metric they're winning.
 * Friend cards include a row of preset taunts (👏 Cheer / 🔥 Catch me /
 * 💪 Race me / 🐌 Slow today) — one tap fires a message into their Pulse
 * feed. One taunt per friend per day; once sent, the row collapses to a
 * "✓ Sent 🔥 Catch me" confirmation.
 *
 * Silent if no friends connected — Pulse handles that empty state.
 */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type TauntKind,
} from "@/lib/api";
import FriendDmDrawer from "@/components/FriendDmDrawer";


// ── Constants ────────────────────────────────────────────────────────────────

const TAUNTS: { kind: TauntKind; emoji: string; label: string; sentLabel: string }[] = [
  { kind: "cheer",      emoji: "👏", label: "Cheer",     sentLabel: "Cheered" },
  { kind: "catch_me",   emoji: "🔥", label: "Catch me",  sentLabel: "Sent catch-me" },
  { kind: "race_me",    emoji: "💪", label: "Race me",   sentLabel: "Sent race-me" },
  { kind: "slow_today", emoji: "🐌", label: "Slow today", sentLabel: "Sent slow" },
];

const METRIC_LABELS = { steps: "Steps", sleep: "Sleep", activity: "Activity" } as const;
type MetricKey = keyof typeof METRIC_LABELS;


// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMetric(value: number | null, metric: MetricKey): string {
  if (value == null || value <= 0) return "—";
  if (metric === "steps") return value.toLocaleString();
  return String(Math.round(value));
}

function freshnessLabel(anchor: string, todayStr: string): string | null {
  if (!anchor || anchor === todayStr) return null;
  try {
    const a = new Date(anchor + "T12:00:00Z").getTime();
    const t = new Date(todayStr + "T12:00:00Z").getTime();
    const diffDays = Math.round((t - a) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return "y";
    if (diffDays > 1)   return `${diffDays}d`;
    return null;
  } catch {
    return null;
  }
}

/** Count of metrics each entry is leading. Returns map of user_id → count. */
function leaderTally(leaders: LeaderboardResponse["leaders"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.values(leaders)) {
    if (!id) continue;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}


// ── Component ────────────────────────────────────────────────────────────────

export default function FriendLeaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  /** Tracks in-flight taunts per friend so double-taps don't fire twice. */
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  /** Currently-open DM friend, or null when the drawer is closed. */
  const [dmFriend, setDmFriend] = useState<{ user_id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.friends.leaderboard();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load leaderboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTaunt = async (friend_user_id: string, kind: TauntKind) => {
    if (sendingIds.has(friend_user_id) || !data) return;
    setSendingIds(prev => new Set(prev).add(friend_user_id));
    // Optimistic update
    setData(d => d ? {
      ...d,
      entries: d.entries.map(e =>
        e.user_id === friend_user_id ? { ...e, taunt_sent: kind } : e
      ),
    } : d);
    try {
      await api.friends.cheer(friend_user_id, kind);
    } catch {
      // Roll back if the call fails
      setData(d => d ? {
        ...d,
        entries: d.entries.map(e =>
          e.user_id === friend_user_id ? { ...e, taunt_sent: null } : e
        ),
      } : d);
    } finally {
      setSendingIds(prev => {
        const next = new Set(prev);
        next.delete(friend_user_id);
        return next;
      });
    }
  };

  // Silent if no friends connected
  const friendCount = (data?.entries || []).filter(e => !e.is_me).length;
  if (!loading && friendCount === 0) return null;

  if (loading || !data) {
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Today&apos;s Matchup
        </h3>
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3">
          {[0, 1].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  const tally = leaderTally(data.leaders);

  // ── Header line: how many metrics am I leading? ──
  const me = data.entries.find(e => e.is_me);
  const myWins = me ? (tally[me.user_id] ?? 0) : 0;
  const totalContested = Object.values(data.leaders).filter(Boolean).length;
  const headerLine = totalContested > 0
    ? `You're leading in ${myWins} of ${totalContested} today`
    : "Waiting on data — check back later";

  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Today&apos;s Matchup
        </h3>
        <button
          onClick={() => load()}
          className="text-[11px] text-gray-400 hover:text-[#1B3829] font-medium transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {/* Top banner: how you stack up across all three metrics */}
        <div className="px-4 py-2.5 bg-gradient-to-r from-[#1B3829]/8 via-transparent to-transparent border-b border-gray-100">
          <p className="text-[13px] font-semibold text-gray-800 leading-snug">{headerLine}</p>
        </div>

        {/* One row per person — all share the same plain background so the
            container reads as one card. "You" is differentiated by the name
            color + a small YOU pill, not a full-row tint that creates the
            "two cards stacked" illusion. */}
        <div className="divide-y divide-gray-200">
          {data.entries.map(e => {
            const winsCount = tally[e.user_id] ?? 0;
            const sending   = sendingIds.has(e.user_id);
            return (
              <div key={e.user_id} className="px-4 py-2.5">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-7 h-7 rounded-full bg-[#1B3829] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                    {(e.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <p className={`flex-1 min-w-0 text-sm font-semibold truncate ${
                    e.is_me ? "text-[#1B3829]" : "text-gray-900"
                  }`}>
                    {e.is_me ? "You" : e.name}
                  </p>
                  {e.is_me && (
                    <span className="text-[9px] bg-[#1B3829]/10 border border-[#1B3829]/20 text-[#1B3829] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                      You
                    </span>
                  )}
                  {winsCount > 0 && (
                    <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      🏅 {winsCount}/{totalContested || 3}
                    </span>
                  )}
                </div>

                {/* Weekly head-to-head — only for friend rows */}
                {!e.is_me && e.head_to_head && (() => {
                  const h2h = e.head_to_head;
                  const cell = (label: string, tally: { w: number; l: number; t: number }) => {
                    const total = tally.w + tally.l + tally.t;
                    if (total === 0) return null;
                    const outcome = tally.w > tally.l ? "w" : tally.l > tally.w ? "l" : "t";
                    const color = outcome === "w" ? "text-green-700" : outcome === "l" ? "text-red-600" : "text-gray-400";
                    const tag   = outcome === "w" ? "W" : outcome === "l" ? "L" : "T";
                    return (
                      <span key={label} className="inline-flex items-center gap-1">
                        <span className="text-gray-400">{label}</span>
                        <span className={`font-semibold ${color}`}>{tally.w}–{tally.l}</span>
                        <span className={`text-[9px] font-bold ${color}`}>{tag}</span>
                      </span>
                    );
                  };
                  const cells = [
                    cell("Steps",    h2h.steps),
                    cell("Sleep",    h2h.sleep),
                    cell("Activity", h2h.activity),
                  ].filter(Boolean);
                  if (cells.length === 0) return null;
                  return (
                    <p className="text-[10px] text-gray-500 mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="text-gray-400 italic">This week:</span>
                      {cells}
                    </p>
                  );
                })()}

                {/* Three metrics inline */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {(["steps", "sleep", "activity"] as MetricKey[]).map(m => {
                    const mv = e[m];
                    const isLeader = data.leaders[m] === e.user_id;
                    const has = mv.value != null && mv.value > 0;
                    const fresh = has ? freshnessLabel(mv.anchor, data.date) : null;
                    return (
                      <div
                        key={m}
                        className={`rounded-lg px-2 py-1.5 border ${
                          isLeader
                            ? "bg-amber-50 border-amber-200"
                            : "bg-gray-50 border-gray-100"
                        }`}
                      >
                        <p className={`text-[9px] uppercase tracking-wide font-semibold ${
                          isLeader ? "text-amber-700" : "text-gray-400"
                        }`}>
                          {METRIC_LABELS[m]}
                          {isLeader && " 🏅"}
                          {fresh && <span className="ml-1 text-gray-300 italic">·{fresh}</span>}
                        </p>
                        <p className={`text-[13px] font-bold leading-tight tabular-nums ${
                          isLeader ? "text-amber-900" : has ? "text-gray-800" : "text-gray-300"
                        }`}>
                          {fmtMetric(mv.value, m)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Taunts + chat — only for friends. One compact action row. */}
                {!e.is_me && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.taunt_sent ? (
                      <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-flex items-center gap-1 font-semibold">
                        ✓ {TAUNTS.find(t => t.kind === e.taunt_sent)?.emoji}{" "}
                        {TAUNTS.find(t => t.kind === e.taunt_sent)?.sentLabel}
                      </span>
                    ) : (
                      TAUNTS.map(t => (
                        <button
                          key={t.kind}
                          onClick={() => handleTaunt(e.user_id, t.kind)}
                          disabled={sending}
                          className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:border-[#1B3829]/40 hover:bg-[#1B3829]/5 active:scale-95 transition-all disabled:opacity-50"
                          title={`Send ${t.emoji} ${t.label} to ${e.name}`}
                        >
                          <span>{t.emoji}</span>
                          <span className="ml-1">{t.label}</span>
                        </button>
                      ))
                    )}
                    {/* Chat — private 1:1 DM thread (always available, sits at end) */}
                    <button
                      onClick={() => setDmFriend({ user_id: e.user_id, name: e.name })}
                      className="text-[11px] px-2 py-1 rounded-lg border border-[#1B3829]/30 bg-white text-[#1B3829] font-semibold hover:bg-[#1B3829]/5 active:scale-95 transition-all inline-flex items-center gap-1"
                      title={`Open private chat with ${e.name}`}
                    >
                      💬 Chat
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-red-500 mt-1 italic">{error}</p>
      )}

      {/* Private 1:1 chat drawer — fixed-positioned, overlays the page */}
      <FriendDmDrawer friend={dmFriend} onClose={() => setDmFriend(null)} />
    </section>
  );
}
