"use client";

/**
 * ChatWidget — Coach Al floating button + slide-up drawer.
 *
 * Mount once inside the dashboard layout. The widget sits fixed
 * bottom-right over all content. Exported `openChat` ref lets other
 * components (like the teaser card on the Scorecard) open it programmatically.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { api, type ChatMessage } from "@/lib/api";

// Coach Al avatar — initials badge
function AlAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-12 h-12 text-base" };
  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}>
      Al
    </div>
  );
}

interface Props {
  /** Optional: pass a setter to let parent components open the drawer */
  onRegisterOpen?: (opener: () => void) => void;
}

export default function ChatWidget({ onRegisterOpen }: Props) {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  const openDrawer = useCallback(() => setOpen(true), []);

  // Expose openDrawer to parent (e.g. Scorecard teaser card)
  useEffect(() => {
    onRegisterOpen?.(openDrawer);
  }, [onRegisterOpen, openDrawer]);

  // Auto-scroll to newest message
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // Focus input when drawer opens
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
    // small delay so drawer is visible before auto-sending
    setTimeout(() => sendMessage(s), 200);
  };

  return (
    <>
      {/* ── Floating pill button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Chat with Coach Al"
        className="fixed bottom-5 right-4 z-40 flex items-center gap-2.5 rounded-full px-4 py-2.5 text-white text-sm font-semibold shadow-lg transition-all hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)",
          boxShadow: "0 4px 20px rgba(27,56,41,0.4)",
        }}
      >
        <AlAvatar size="sm" />
        <span className={open ? "hidden sm:inline" : undefined}>
          {open ? "Close" : "Ask Coach Al"}
        </span>
        {!open && (
          <span className="flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute h-2 w-2 rounded-full bg-green-400 opacity-75" />
            <span className="relative h-2 w-2 rounded-full bg-green-500" />
          </span>
        )}
      </button>

      {/* ── Backdrop (mobile) ── */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 sm:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Slide-up drawer ── */}
      <div
        className={`fixed bottom-20 right-4 z-40 w-[calc(100vw-2rem)] sm:w-[26rem] rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ${
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{ maxHeight: "72vh" }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 shrink-0 rounded-t-2xl"
          style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
        >
          <AlAvatar size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-tight">Coach Al</p>
            <p className="text-[11px] text-white/60">Your BackNine AI health coach</p>
          </div>
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-[10px] text-white/50">online</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-white/60 hover:text-white text-xl leading-none ml-1"
          >
            ✕
          </button>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="py-4 space-y-4">
              {/* Intro */}
              <div className="flex items-start gap-2.5">
                <AlAvatar size="sm" />
                <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800 leading-relaxed max-w-[85%]">
                  Hey! I&apos;m Coach Al 👋 I&apos;ve got your latest health data in front of me. What do you want to work on today?
                </div>
              </div>
              {/* Suggestion chips */}
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

        {/* ── Input ── */}
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
