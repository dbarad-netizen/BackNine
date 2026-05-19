"use client";

/**
 * NotificationBell — bell icon for the dashboard top nav with unread-count
 * badge. Tap opens a slide-up panel listing recent social events: DMs
 * received, taunts received, comments on your events, reactions on your
 * events. Auto-marks all read when the panel opens.
 *
 * Reads from /api/notifications on mount + polls every 30s while idle so
 * the badge stays roughly current without aggressive polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Notification } from "@/lib/api";

function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now  = Date.now();
    const secs = Math.max(0, Math.floor((now - then) / 1000));
    if (secs < 60)         return "just now";
    if (secs < 3600)       return `${Math.floor(secs / 60)}m`;
    if (secs < 86_400)     return `${Math.floor(secs / 3600)}h`;
    if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)}d`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function summarize(n: Notification): string {
  if (n.kind === "dm") {
    return `${n.actor_name} sent you a message`;
  }
  if (n.kind.startsWith("taunt:")) {
    const kind = n.kind.split(":")[1] || "cheer";
    if (kind === "catch_me")   return `${n.actor_name} told you to catch up 🔥`;
    if (kind === "race_me")    return `${n.actor_name} challenged you to a race 💪`;
    if (kind === "slow_today") return `${n.actor_name} called you out for being slow 🐌`;
    return `${n.actor_name} cheered you 👏`;
  }
  if (n.kind === "comment")  return `${n.actor_name} commented on your event`;
  if (n.kind === "reaction") return `${n.actor_name} reacted with ${n.preview}`;
  return `${n.actor_name} did something`;
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.notifications.list();
      setItems(res.notifications);
      setUnread(res.unread_count);
    } catch {
      // Silent failure — bell just won't show a badge
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + low-frequency poll
  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Auto-mark-read when the panel opens
  useEffect(() => {
    if (open && unread > 0) {
      api.notifications.markRead().catch(() => {});
      // Optimistic local flip — badge clears immediately
      setUnread(0);
      setItems(prev => prev.map(n => ({ ...n, unread: false })));
    }
  }, [open, unread]);

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Notifications"
        className="relative text-gray-400 hover:text-gray-700 transition-colors text-base leading-none"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel — fixed top-right, mobile gets full width */}
      <div
        className={`fixed top-14 right-4 left-4 sm:left-auto sm:w-[24rem] z-40 rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-200 ${
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
        style={{ maxHeight: "70vh" }}
      >
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">Notifications</p>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-gray-700 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="text-xs text-gray-400 italic text-center py-8 px-4">
              No activity yet. Friend messages, comments, taunts, and reactions show up here.
            </p>
          )}
          <ul className="divide-y divide-gray-100">
            {items.map(n => (
              <li key={n.id} className={`px-4 py-2.5 ${n.unread ? "bg-blue-50/40" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-[#1B3829] text-white text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    {(n.actor_name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-gray-800 leading-snug">{summarize(n)}</p>
                    {n.preview && n.kind === "dm" && (
                      <p className="text-[11px] text-gray-500 italic truncate mt-0.5">
                        &ldquo;{n.preview}&rdquo;
                      </p>
                    )}
                    {n.preview && n.kind === "comment" && (
                      <p className="text-[11px] text-gray-500 italic truncate mt-0.5">
                        &ldquo;{n.preview}&rdquo;
                      </p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                  {n.unread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2.5" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
