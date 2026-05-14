"use client";

/**
 * PulseFeed — horizontal-scrolling strip on the Scorecard showing what your
 * friends have been up to. Reads from /api/friends/events, filters out your
 * own events (so the feed is purely social), and shows reaction chips on
 * each card.
 *
 * Three emoji vocabulary: 🔥 (crushed it) 💪 (respect) 👀 (noted). Tapping a
 * chip toggles your reaction. You can't react to your own events.
 *
 * Empty states are quiet, not loud:
 *   • No friends connected     → invite prompt
 *   • Friends but no events    → small "no recent activity" line
 *   • Loading first time       → skeleton card
 *
 * The strip self-fetches once on mount. We don't auto-refresh — the data
 * isn't real-time-critical and avoiding background polling keeps Render
 * costs low. Tap "Refresh" in the header to pull fresh data.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type FriendActivityEvent, type ReactionSummary } from "@/lib/api";

const REACTIONS = ["🔥", "💪", "👀"] as const;

interface Props {
  /** Callback when the empty-state "Invite a friend" button is tapped. Opens the Profile modal Friends tab. */
  onInviteFriend?: () => void;
}

// ── Time-ago formatter ────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60)         return "just now";
  if (secs < 3600)       return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400)     return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Map event_type → emoji on the avatar ring
function eventEmoji(t: string): string {
  switch (t) {
    case "workout_logged":      return "🏋️";
    case "weight_logged":       return "⚖️";
    case "challenge_joined":    return "🏆";
    case "challenge_completed": return "🎉";
    case "streak_milestone":    return "🔥";
    case "great_sleep":         return "😴";
    case "great_readiness":     return "💚";
    case "great_activity":      return "💪";
    case "hrv_rebound":         return "📈";
    case "personal_best_sleep": return "🏅";
    case "prediction_streak":   return "🔥";
    default:                    return "✨";
  }
}

// Milestone events deserve a visual lift — these are "wins" worth celebrating.
const MILESTONE_TYPES = new Set([
  "great_sleep",
  "great_readiness",
  "great_activity",
  "hrv_rebound",
  "personal_best_sleep",
  "prediction_streak",
  "streak_milestone",
  "challenge_completed",
]);

// Build the array of stat pills shown under the summary. Each pill is a tiny
// label+value box. Order matters — most important pill first.
function statPills(eventType: string, payload: Record<string, unknown>): { label: string; value: string }[] {
  const get = (k: string) => payload[k];
  const num = (k: string) => {
    const v = get(k);
    return typeof v === "number" ? v : null;
  };

  switch (eventType) {
    case "great_sleep":         return [{ label: "Sleep",     value: String(num("score") ?? "—") }];
    case "great_readiness":     return [{ label: "Readiness", value: String(num("score") ?? "—") }];
    case "great_activity":      return [{ label: "Activity",  value: String(num("score") ?? "—") }];
    case "hrv_rebound": {
      const h = num("hrv");
      const d = num("delta");
      const pills = [{ label: "HRV", value: String(h ?? "—") }];
      if (d) pills.push({ label: "vs yesterday", value: `+${d}` });
      return pills;
    }
    case "personal_best_sleep": {
      const s = num("score");
      const prev = num("previous");
      const pills = [{ label: "Sleep", value: String(s ?? "—") }];
      if (prev) pills.push({ label: "prev best", value: String(prev) });
      return pills;
    }
    case "prediction_streak":
    case "streak_milestone": {
      const n = num("streak") ?? num("days");
      return n ? [{ label: "Streak", value: `${n} days` }] : [];
    }
    case "workout_logged": {
      const dur = num("duration_min");
      return dur ? [{ label: "Duration", value: `${Math.round(dur)} min` }] : [];
    }
    case "weight_logged": {
      const lbs = num("weight_lbs");
      const bf  = num("body_fat_pct");
      const pills = [];
      if (lbs) pills.push({ label: "Weight",  value: `${lbs} lbs` });
      if (bf)  pills.push({ label: "Body fat", value: `${bf}%` });
      return pills;
    }
    case "challenge_joined":
    case "challenge_completed": {
      const name = typeof get("challenge_name") === "string" ? (get("challenge_name") as string) : null;
      return name ? [{ label: "Challenge", value: name }] : [];
    }
    default: return [];
  }
}

export default function PulseFeed({ onInviteFriend }: Props) {
  const [events,  setEvents]  = useState<FriendActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasFriends, setHasFriends] = useState<boolean | null>(null); // null = unknown
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const [evRes, frRes] = await Promise.all([
        api.friends.events(30),
        api.friends.list(),
      ]);
      // Filter self events — the feed is for friends' activity
      setEvents(evRes.events.filter(e => !e.is_me));
      setHasFriends(frRes.friends.length > 0);
    } catch {
      setEvents([]);
      setHasFriends(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Optimistic reaction toggle — flip locally first, then reconcile from server.
  const handleReact = async (eventId: string, emoji: string) => {
    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const existing = e.reactions.find(r => r.emoji === emoji);
      let reactions: ReactionSummary[];
      if (existing) {
        if (existing.i_reacted) {
          // Removing
          reactions = existing.count <= 1
            ? e.reactions.filter(r => r.emoji !== emoji)
            : e.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count - 1, i_reacted: false } : r);
        } else {
          // Adding (was already there from others)
          reactions = e.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, i_reacted: true } : r);
        }
      } else {
        // First reaction with this emoji
        reactions = [...e.reactions, { emoji, count: 1, i_reacted: true }];
      }
      return { ...e, reactions };
    }));

    try {
      const res = await api.friends.react(eventId, emoji);
      // Reconcile with server truth
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, reactions: res.reactions } : e));
    } catch {
      // Roll back by reloading on failure (rare path)
      load(true);
    }
  };

  // ── Loading skeleton (first paint only) ──
  if (loading) {
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Friend Pulse
        </h3>
        <div className="flex gap-2 overflow-hidden">
          {[0, 1].map(i => (
            <div key={i} className="shrink-0 w-56 h-28 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  // ── Empty: no friends ──
  if (hasFriends === false) {
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Friend Pulse
        </h3>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-5 text-center">
          <p className="text-sm text-gray-600 font-medium mb-1">🤝 Better with friends</p>
          <p className="text-[11px] text-gray-400 mb-3 leading-snug">
            Invite a friend to see their workouts, weigh-ins, and challenge milestones here.
          </p>
          {onInviteFriend && (
            <button
              onClick={onInviteFriend}
              className="text-xs font-semibold text-[#1B3829] hover:text-[#2D6A4F] transition-colors"
            >
              Invite a friend →
            </button>
          )}
        </div>
      </section>
    );
  }

  // ── Empty: has friends, no recent events ──
  if (events.length === 0) {
    return (
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Friend Pulse
          </h3>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-[11px] text-gray-400 hover:text-[#1B3829] transition-colors font-medium"
          >
            {refreshing ? "…" : "Refresh"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 italic px-1">
          No recent activity from your friends. Check back soon.
        </p>
      </section>
    );
  }

  // ── Normal feed ──
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Friend Pulse
        </h3>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className={`text-[11px] text-gray-400 hover:text-[#1B3829] transition-colors font-medium ${refreshing ? "animate-pulse" : ""}`}
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        {events.map(e => {
          const isMilestone = MILESTONE_TYPES.has(e.event_type);
          const pills = statPills(e.event_type, e.payload);
          return (
            <article
              key={e.id}
              className={`shrink-0 w-64 rounded-2xl p-3 flex flex-col gap-2 border ${
                isMilestone
                  ? "border-green-200 bg-gradient-to-br from-green-50/60 to-white"
                  : "border-gray-200 bg-white"
              }`}
            >
              {/* Top row: avatar + name + time */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative shrink-0">
                  <span className="w-8 h-8 rounded-full bg-[#1B3829] text-white text-xs font-semibold flex items-center justify-center">
                    {(e.user_name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="absolute -bottom-1 -right-1 text-[11px] bg-white rounded-full px-0.5 leading-none">
                    {eventEmoji(e.event_type)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-900 truncate">{e.user_name || "Friend"}</p>
                  <p className="text-[10px] text-gray-400">{timeAgo(e.created_at)}</p>
                </div>
              </div>

              {/* Summary */}
              <p className="text-[12px] text-gray-700 leading-snug line-clamp-2">
                {e.summary}
              </p>

              {/* Stat pills — prominent numeric badges from event payload */}
              {pills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pills.map((p, i) => (
                    <div
                      key={i}
                      className={`rounded-lg px-2 py-1 ${
                        isMilestone
                          ? "bg-green-100/80 border border-green-200/80"
                          : "bg-gray-50 border border-gray-200"
                      }`}
                    >
                      <p className={`text-[8px] uppercase tracking-wide font-semibold leading-none ${
                        isMilestone ? "text-green-700" : "text-gray-400"
                      }`}>
                        {p.label}
                      </p>
                      <p className={`text-[12px] font-bold leading-tight mt-0.5 ${
                        isMilestone ? "text-green-900" : "text-gray-800"
                      }`}>
                        {p.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex-1" />

              {/* Reaction chips */}
            <div className="flex items-center gap-1 flex-wrap">
              {REACTIONS.map(emoji => {
                const r = e.reactions.find(x => x.emoji === emoji);
                const count = r?.count ?? 0;
                const mine  = r?.i_reacted ?? false;
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReact(e.id, emoji)}
                    className={`text-[11px] rounded-full px-2 py-0.5 transition-all border ${
                      mine
                        ? "bg-[#1B3829]/10 border-[#1B3829]/30 text-[#1B3829]"
                        : "bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-400"
                    }`}
                    style={mine ? { backgroundColor: "rgba(27,56,41,0.10)", borderColor: "rgba(27,56,41,0.3)" } : undefined}
                  >
                    <span>{emoji}</span>
                    {count > 0 && <span className="ml-1 text-[10px] font-semibold">{count}</span>}
                  </button>
                );
              })}
              {/* Show any non-vocabulary emoji that came back from server (future-proofing) */}
              {e.reactions
                .filter(r => !REACTIONS.includes(r.emoji as typeof REACTIONS[number]))
                .map(r => (
                  <span key={r.emoji} className="text-[11px] rounded-full px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-500">
                    {r.emoji} <span className="text-[10px] font-semibold">{r.count}</span>
                  </span>
                ))}
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}
