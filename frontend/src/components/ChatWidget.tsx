"use client";

/**
 * ChatWidget — floating AI health coach button + slide-up drawer.
 *
 * Mount once inside the dashboard layout. The widget sits in a fixed
 * bottom-right position over all content.
 */

import { useState, useRef, useEffect } from "react";
import { api, type ChatMessage } from "@/lib/api";

export default function ChatWidget() {
  const [open,    setOpen]    = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to newest message
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const { reply } = await api.chat(text, messages);
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

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Open AI health coach"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-[#1B3829] shadow-lg hover:bg-[#2D6A4F] transition-colors flex items-center justify-center text-white text-2xl"
        style={{ boxShadow: "0 4px 20px rgba(27,56,41,0.35)" }}
      >
        {open ? "✕" : "💬"}
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
        className={`fixed bottom-24 right-4 z-40 w-[calc(100vw-2rem)] sm:w-96 rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{ maxHeight: "70vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#1B3829] flex items-center justify-center text-white text-sm">🧬</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">BackNine AI</p>
            <p className="text-[10px] text-gray-400">Your personal health coach</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-6">
              <p className="text-2xl mb-2">👋</p>
              <p className="text-sm text-gray-600 font-medium">Ask me about your health data</p>
              <p className="text-xs text-gray-400 mt-1">I have access to your live metrics, trends, and coaching insights.</p>
              <div className="mt-4 flex flex-col gap-2">
                {[
                  "How was my sleep this week?",
                  "What does my HRV say about recovery?",
                  "What should I focus on today?",
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="w-full text-left text-xs text-[#1B3829] bg-[#1B3829]/5 hover:bg-[#1B3829]/10 rounded-xl px-3 py-2 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#1B3829] text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
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
            placeholder="Ask about your health…"
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
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-white shrink-0"
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
