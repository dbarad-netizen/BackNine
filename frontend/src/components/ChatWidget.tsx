"use client";

/**
 * ChatWidget — Coach Al floating pill + slide-up drawer.
 *
 * Week 2 upgrades:
 *   • History loads from the server on mount, so refresh doesn't reset the
 *     conversation. Backend (/api/chat) is the source of truth for history;
 *     this component just maintains an optimistic local copy.
 *   • If Coach Al has proactive observations waiting (HRV drop, prediction
 *     streak, top insight), the freshest one appears as his opening message
 *     when the drawer opens, and an unread badge appears on the floating pill.
 *   • A "Clear conversation" link in the drawer header overflow.
 *
 * Mount once inside the dashboard layout. The widget sits fixed bottom-right
 * over all content. The exported `onRegisterOpen` ref lets other components
 * (the Scorecard Coach Al teaser, MorningBriefing) open it programmatically.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { api, type ChatMessage, type CoachObservation } from "@/lib/api";
import CoachAlAvatar from "@/components/CoachAlAvatar";

function AlAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const px = { sm: 28, md: 36, lg: 48 };
  return <CoachAlAvatar size={px[size]} className="shrink-0 rounded-full" />;
}

interface Props {
  onRegisterOpen?: (opener: () => void) => void;
}

export default function ChatWidget({ onRegisterOpen }: Props) {
  const [open,         setOpen]         = useState(false);
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [observation,  setObservation]  = useState<CoachObservation | null>(null);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);   // sending a message
  const [hydrating,    setHydrating]    = useState(true);    // initial history+obs load
  const [error,        setError]        = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const openDrawer = useCallback(() => setOpen(true), []);
  useEffect(() => { onRegisterOpen?.(openDrawer); }, [onRegisterOpen, openDrawer]);

  // ── Hydrate from server on mount ──
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.chatHistory(50), api.observations.list()])
      .then(([histRes, obsRes]) => {
        if (cancelled) return;
        if (histRes.status === "fulfilled") setMessages(histRes.value.messages);
        if (obsRes.status === "fulfilled") {
          const fresh = obsRes.value.observations.find(o => !o.read && !o.dismissed) ?? null;
          setObservation(fresh);
        }
      })
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Mark observation as read the first time the drawer is opened ──
  useEffect(() => {
    if (!open || !observation || observation.read) return;
    const id = observation.id;
    api.observations.markRead(id).catch(() => {});
    setObservation(prev => prev && prev.id === id ? { ...prev, read: true } : prev);
  }, [open, observation]);

  // ── Auto-scroll to newest ──
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: ChatMessage = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      // Server is the source of truth for history. We still send the local
      // history for backwards compatibility, but the backend will ignore it.
      const { reply } = await api.chat(msg, messages);
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestion = (s: string) => {
    setOpen(true);
    setTimeout(() => sendMessage(s), 200);
  };

  const handleClear = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    try {
      await api.clearChat();
      setMessages([]);
      setClearConfirm(false);
    } catch {}
  };

  const handleDismissObservation = async () => {
    if (!observation) return;
    const id = observation.id;
    setObservation(null);
    try { await api.observations.dismiss(id); } catch {}
  };

  // ── Pill badge ── show numeric "1" when there's an unseen observation, else
  //                 the existing green pulsing dot.
  const showUnreadBadge = observation && !observation.read;

  return (
    <>
      {/* ── Floating pill ── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Chat with Coach Al"
        className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full pl-1.5 pr-4 py-1.5 text-white text-sm font-semibold shadow-lg transition-all hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)",
          boxShadow:  "0 4px 20px rgba(27,56,41,0.4)",
        }}
      >
        <CoachAlAvatar size={34} className="rounded-full ring-2 ring-white/30" />
        <span className={open ? "hidden sm:inline" : undefined}>
          {open ? "Close" : "Ask Coach Al"}
        </span>
        {!open && (showUnreadBadge ? (
          <span
            className="flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold shrink-0"
            title="Coach Al has something new for you"
          >
            1
          </span>
        ) : (
          <span className="flex h-2 w-2 shrink-0 relative">
            <span className="animate-ping absolute h-2 w-2 rounded-full bg-green-400 opacity-75" />
            <span className="relative h-2 w-2 rounded-full bg-green-500" />
          </span>
        ))}
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/20 sm:hidden" onClick={() => setOpen(false)} />
      )}

      {/* ── Drawer ── */}
      <div
        className={`fixed bottom-20 right-4 z-40 w-[calc(100vw-2rem)] sm:w-[26rem] rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{ maxHeight: "72vh" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 shrink-0 rounded-t-2xl"
          style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
        >
          <AlAvatar size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-tight">Coach Al</p>
            <p className="text-[11px] text-white/60">Your BackNine AI health coach</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className={`text-[10px] mr-2 px-2 py-1 rounded-md transition-colors ${
                clearConfirm
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "text-white/50 hover:text-white hover:bg-white/10"
              }`}
              title={clearConfirm ? "Tap again to confirm" : "Clear conversation"}
            >
              {clearConfirm ? "Confirm?" : "Clear"}
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-white/60 hover:text-white text-xl leading-none ml-1"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {hydrating && (
            <div className="flex items-center justify-center py-10">
              <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          )}

          {/* Observation as Coach Al's opener — only when there's no prior history yet */}
          {!hydrating && observation && (
            <div className="flex items-start gap-2.5">
              <AlAvatar size="sm" />
              <div className="flex-1 min-w-0">
                <div className="rounded-2xl rounded-tl-sm bg-amber-50 border border-amber-200/70 px-3.5 py-2.5 text-sm text-amber-950 leading-relaxed">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
                    💡 Heads up
                  </p>
                  {observation.message}
                </div>
                <button
                  onClick={handleDismissObservation}
                  className="text-[10px] text-gray-400 hover:text-gray-600 mt-1 pl-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {!hydrating && messages.length === 0 && !observation && (
            <div className="py-4 space-y-4">
              <div className="flex items-start gap-2.5">
                <AlAvatar size="sm" />
                <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800 leading-relaxed max-w-[85%]">
                  Hey! I&apos;m Coach Al 👋 I&apos;ve got your latest health data in front of me. What do you want to work on today?
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pl-9">
                {[
                  "How's my recovery looking?",
                  "What should I focus on today?",
                  "Break down my sleep last night.",
                  "Am I trending in the right direction?",
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => handleSuggestion(s)}
                    className="text-left text-xs px-3 py-2 rounded-xl border border-[#1B3829]/20 text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && <AlAvatar size="sm" />}
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}
                style={msg.role === "user" ? { background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" } : undefined}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-end gap-2 justify-start">
              <AlAvatar size="sm" />
              <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-500">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex items-end gap-2 px-3 py-3 border-t border-gray-100 shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Coach Al anything…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20 leading-snug"
            style={{ maxHeight: "120px", overflowY: "auto" }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 flex items-center justify-center text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: "rotate(90deg)" }}>
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
