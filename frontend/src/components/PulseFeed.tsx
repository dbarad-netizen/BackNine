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

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FriendActivityEvent, type ReactionSummary, type EventComment, type Friend } from "@/lib/api";

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
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasFriends, setHasFriends] = useState<boolean | null>(null); // null = unknown
  const [refreshing, setRefreshing] = useState(false);

  // Set of event IDs whose comment thread is currently expanded. Events with
  // at least one comment auto-expand on load so existing conversations are
  // visible without an extra tap; cards with zero comments stay collapsed
  // until the user opens them.
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  // When a notification deep-links here, we set this to the event_id so the
  // matching CommentThread can focus its reply input. Cleared after.
  const [focusEventId, setFocusEventId] = useState<string | null>(null);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const [evRes, frRes] = await Promise.all([
        api.friends.events(30),
        api.friends.list(),
      ]);
      // Hide your own events by default (your Pulse is your friends' wins) BUT
      // keep your own events that have at least one comment — those are active
      // conversations. Without this exception, notifications about Chris
      // commenting on your event deep-linked to a card the feed had filtered
      // out, and "Tap to reply" silently did nothing.
      const visible = evRes.events.filter(e => !e.is_me || (e.comment_count ?? 0) > 0);
      setEvents(visible);
      setFriends(frRes.friends);
      setHasFriends(frRes.friends.length > 0);
      // Auto-expand any card that already has comments — surface the
      // conversation by default rather than hiding it behind a 💬 tap.
      setOpenComments(prev => {
        const next = new Set(prev);
        for (const ev of visible) {
          if (ev.comment_count > 0) next.add(ev.id);
        }
        return next;
      });
    } catch {
      setEvents([]);
      setFriends([]);
      setHasFriends(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const toggleCommentThread = (eventId: string) => {
    setOpenComments(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  useEffect(() => { load(false); }, [load]);

  // Hash-driven deep-link from the notifications bell:
  //   #pulse-{event_id}  → expand the matching event's thread, scroll it into
  //   view, and signal its reply input to focus. This is what makes the bell
  //   feel like a real conversation surface instead of a dead-end inbox.
  useEffect(() => {
    const handleHash = () => {
      const m = (typeof window !== "undefined" ? window.location.hash : "").match(/^#pulse-([\w-]+)/);
      if (!m) return;
      const id = m[1];
      setOpenComments(prev => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setFocusEventId(id);
      // Wait one tick so the article is rendered, then scroll it into view.
      requestAnimationFrame(() => {
        const el = document.getElementById(`pulse-event-${id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Clear the hash so a manual reload doesn't keep re-triggering this.
        try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
      });
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

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
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-2">
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
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-2">
          Friend Pulse
        </h3>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-5 text-center">
          <p className="text-sm text-gray-600 font-medium mb-1">🤝 Better with friends</p>
          <p className="text-[11px] text-gray-600 mb-3 leading-snug">
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
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600">
            Friend Pulse
          </h3>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors font-medium"
          >
            {refreshing ? "…" : "Refresh"}
          </button>
        </div>
        <p className="text-[11px] text-gray-600 italic px-1">
          No recent activity from your friends. Check back soon.
        </p>
      </section>
    );
  }

  // Friend names worth showing in the section header — skip generic "Friend"
  // entries that just mean "this person hasn't set their display name yet".
  const namedFriends = friends
    .map(f => (f.name || "").trim())
    .filter(n => n && n !== "Friend" && n !== "BackNine user");

  // ── Normal feed ──
  return (
    <section>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600 truncate">
          Friend Pulse
          {namedFriends.length > 0 && (
            <span className="ml-1 normal-case font-normal text-gray-600">
              · with <span className="text-[#1B3829] font-semibold">
                {namedFriends.length === 1 ? namedFriends[0] : namedFriends.length <= 3 ? namedFriends.join(", ") : `${namedFriends[0]} +${namedFriends.length - 1}`}
              </span>
            </span>
          )}
          {namedFriends.length === 0 && friends.length > 0 && (
            <span className="ml-1 normal-case font-normal text-gray-500">
              · {friends.length} {friends.length === 1 ? "friend" : "friends"}
            </span>
          )}
        </h3>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className={`shrink-0 text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors font-medium ${refreshing ? "animate-pulse" : ""}`}
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
              id={`pulse-event-${e.id}`}
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
                  <p className="text-[10px] text-gray-600">{timeAgo(e.created_at)}</p>
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
                        isMilestone ? "text-green-700" : "text-gray-600"
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

              {/* Reaction chips + comment toggle */}
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
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"
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
                  <span key={r.emoji} className="text-[11px] rounded-full px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-600">
                    {r.emoji} <span className="text-[10px] font-semibold">{r.count}</span>
                  </span>
                ))}

              {/* Comment toggle */}
              <button
                onClick={() => toggleCommentThread(e.id)}
                className={`text-[11px] rounded-full px-2 py-0.5 transition-all border ml-auto ${
                  openComments.has(e.id)
                    ? "bg-[#1B3829]/10 border-[#1B3829]/30 text-[#1B3829]"
                    : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"
                }`}
                title={openComments.has(e.id) ? "Hide comments" : "Show comments"}
              >
                💬
                {e.comment_count > 0 && (
                  <span className="ml-1 text-[10px] font-semibold">{e.comment_count}</span>
                )}
              </button>
            </div>

            {/* Expandable comment thread */}
            {openComments.has(e.id) && (
              <CommentThread
                eventId={e.id}
                shouldFocus={focusEventId === e.id}
                onFocused={() => setFocusEventId(prev => prev === e.id ? null : prev)}
                onCountChange={(n) => {
                  // Reflect the new count locally so the chip stays in sync
                  setEvents(prev => prev.map(ev =>
                    ev.id === e.id ? { ...ev, comment_count: n } : ev
                  ));
                }}
              />
            )}
          </article>
          );
        })}
      </div>
    </section>
  );
}


// ── Inline comment thread shown when a Pulse card is expanded ───────────────
function CommentThread({
  eventId,
  onCountChange,
  shouldFocus = false,
  onFocused,
}: {
  eventId: string;
  onCountChange: (n: number) => void;
  /** Set when the user deep-linked here from a notification — auto-focus the
   *  reply input so they can start typing immediately. */
  shouldFocus?: boolean;
  onFocused?: () => void;
}) {
  const [comments, setComments] = useState<EventComment[] | null>(null);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const bottomRef               = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLInputElement | null>(null);
  // When shouldFocus flips true, focus the input and let the parent know we
  // consumed the signal (so it doesn't keep re-firing).
  useEffect(() => {
    if (shouldFocus) {
      // Small delay lets the parent's scrollIntoView finish before we steal focus.
      const t = setTimeout(() => {
        inputRef.current?.focus();
        onFocused?.();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [shouldFocus, onFocused]);
  // Only follow the thread once the user has posted in it. Without this, the
  // initial fetch populating the list fires scrollIntoView and yanks the whole
  // page down to this thread on first load.
  const followThread            = useRef(false);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    api.friends.comments(eventId)
      .then(res => {
        if (cancelled) return;
        setComments(res.comments);
        onCountChange(res.comments.length);
      })
      .catch(() => { if (!cancelled) setComments([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Auto-scroll to the newest comment ONLY after the user posts — never on the
  // initial load (that would scroll the page down to this thread). block:"nearest"
  // keeps the movement to the minimum needed.
  useEffect(() => {
    if (!followThread.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [comments?.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await api.friends.postComment(eventId, t);
      followThread.current = true;  // now it's OK to scroll to the newest comment
      setComments(prev => {
        const next = [...(prev || []), { ...created, is_me: true }];
        onCountChange(next.length);
        return next;
      });
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="mt-2 border-t border-gray-100 pt-2 space-y-2">
      {/* Comment list */}
      <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
        {comments === null && (
          <p className="text-[11px] text-gray-600 italic">Loading…</p>
        )}
        {comments !== null && comments.length === 0 && (
          <p className="text-[11px] text-gray-600 italic">Be the first to say something.</p>
        )}
        {comments?.map(c => (
          <div key={c.id} className={`flex flex-col ${c.is_me ? "items-end" : "items-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-2.5 py-1.5 text-[12px] leading-snug break-words ${
              c.is_me
                ? "bg-[#1B3829] text-white rounded-br-sm"
                : "bg-gray-100 text-gray-800 rounded-bl-sm"
            }`}>
              {c.text}
            </div>
            <p className="text-[9px] text-gray-600 mt-0.5 px-0.5">
              {c.is_me ? "You" : (c.user_name || "Friend")} · {fmt(c.created_at)}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Reply…"
          maxLength={500}
          className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-40 text-white text-[11px] font-semibold px-3 transition-colors"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
      {error && (
        <p className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1">{error}</p>
      )}
    </div>
  );
}
