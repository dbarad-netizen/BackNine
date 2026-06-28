"use client";

/**
 * FriendDmDrawer — private 1:1 chat with a specific friend.
 *
 * Fixed bottom-right drawer modeled on ChatWidget but scoped to a single
 * friend (not the AI coach). Only the two participants see the thread —
 * server-side authorization enforces the friendship requirement on every
 * read and write.
 *
 * Auto-polls every 8 seconds while open so a reply from the friend shows
 * up without manual refresh. Closes via X, or by clicking the backdrop on
 * mobile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DirectMessage } from "@/lib/api";

interface Props {
  /** Friend to chat with. null means the drawer is closed. */
  friend: { user_id: string; name: string } | null;
  onClose: () => void;
}

export default function FriendDmDrawer({ friend, onClose }: Props) {
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const bottomRef               = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLTextAreaElement>(null);
  const pollRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (friend_user_id: string) => {
    try {
      const res = await api.friends.dm.list(friend_user_id);
      setMessages(res.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load messages");
    }
  }, []);

  // Tell the global Coach Al ChatWidget to hide its floating pill while
  // this drawer is open — otherwise the pill physically overlaps our
  // send button on mobile (both are fixed bottom-right at z-40).
  useEffect(() => {
    const id = "friend-dm";
    window.dispatchEvent(new CustomEvent("bn:drawer-toggle", {
      detail: { id, open: !!friend },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("bn:drawer-toggle", {
        detail: { id, open: false },
      }));
    };
  }, [friend]);

  // Load + start polling whenever we open with a different friend.
  useEffect(() => {
    if (!friend) {
      setMessages(null);
      setText("");
      setError(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    load(friend.user_id);
    pollRef.current = setInterval(() => {
      if (friend) load(friend.user_id);
    }, 8000);
    setTimeout(() => inputRef.current?.focus(), 200);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [friend, load]);

  // Scroll to newest on update
  useEffect(() => {
    if (friend) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, friend]);

  const send = async () => {
    if (!friend) return;
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);

    // Optimistic local push so the input clears + bubble appears instantly.
    const tempMsg: DirectMessage = {
      id:           `tmp-${Date.now()}`,
      sender_id:    "me",
      recipient_id: friend.user_id,
      text:         t,
      created_at:   new Date().toISOString(),
      is_me:        true,
    };
    setMessages(prev => [...(prev || []), tempMsg]);
    setText("");

    try {
      const saved = await api.friends.dm.send(friend.user_id, t);
      // Replace temp with saved version (real id, real timestamp).
      setMessages(prev =>
        (prev || []).map(m => m.id === tempMsg.id ? saved : m)
      );
    } catch (e) {
      // Drop the optimistic bubble + surface error
      setMessages(prev => (prev || []).filter(m => m.id !== tempMsg.id));
      setText(t);
      setError(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const open = !!friend;

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 sm:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:w-[26rem] z-40 rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{ maxHeight: "70vh", right: "1rem" }}
      >
        {open && friend && (
          <>
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3.5 shrink-0 rounded-t-2xl"
              style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
            >
              <span className="w-9 h-9 rounded-full bg-white/20 text-white text-sm font-bold flex items-center justify-center shrink-0">
                {friend.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-tight truncate">{friend.name}</p>
                <p className="text-[11px] text-white/60">Private chat — just you two</p>
              </div>
              <button
                onClick={onClose}
                className="text-white/60 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
              {messages === null && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                </div>
              )}
              {messages?.length === 0 && (
                <p className="text-xs text-gray-600 italic text-center py-6">
                  No messages yet. Say something to start the chat.
                </p>
              )}
              {messages?.map(m => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.is_me ? "items-end" : "items-start"}`}
                >
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                    m.is_me
                      ? "bg-[#1B3829] text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}>
                    {m.text}
                  </div>
                  <p className="text-[9px] text-gray-600 mt-0.5 px-1">
                    {m.is_me ? "You" : (m.user_name || friend.name)} · {fmtTime(m.created_at)}
                  </p>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {error && (
              <div className="mx-3 mb-2 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 text-[11px] text-red-500">
                {error}
              </div>
            )}

            {/* Composer */}
            <div className="flex items-end gap-2 px-3 py-2.5 border-t border-gray-100 shrink-0">
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Message ${friend.name}…`}
                rows={1}
                maxLength={2000}
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20 leading-snug"
                style={{ maxHeight: "110px" }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 110) + "px";
                }}
              />
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                className="w-9 h-9 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 flex items-center justify-center text-white shrink-0"
                style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: "rotate(90deg)" }}>
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
