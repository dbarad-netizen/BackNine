"use client";

/**
 * CoachReactionToast — one-line Coach Al reaction after a logged action.
 *
 * The dashboard owns a single `reactionText` state. After a meal / workout /
 * weigh-in is logged successfully, the parent fires api.coachReact(...) and
 * sets the resulting text. This component renders a small, dismissable card
 * at the bottom-right (above the chat widget) for ~12 seconds, then auto-
 * dismisses. Tapping the chat icon on the card opens Coach Al pre-seeded
 * with the user's logged value as a follow-up question.
 *
 * Render nothing when text is null/empty — soft fail.
 */

import { useEffect, useState } from "react";
import CoachAlAvatar from "@/components/CoachAlAvatar";

interface Props {
  text:        string | null;
  onDismiss:   () => void;
  /** Optional — tapping the chat icon on the toast opens the chat with a seed. */
  onOpenChat?: (seed: string) => void;
}

export default function CoachReactionToast({ text, onDismiss, onOpenChat }: Props) {
  const [closing, setClosing] = useState(false);

  // Auto-dismiss after ~12s so the toast doesn't linger forever. Tied to
  // `text` so each new reaction restarts the timer.
  useEffect(() => {
    if (!text) return;
    setClosing(false);
    const t = setTimeout(() => {
      setClosing(true);
      // Wait for the fade-out animation to finish before clearing parent state.
      setTimeout(onDismiss, 220);
    }, 12000);
    return () => clearTimeout(t);
  }, [text, onDismiss]);

  if (!text) return null;

  return (
    <div
      className={`fixed bottom-20 right-3 sm:right-6 z-40 max-w-[280px] sm:max-w-xs rounded-2xl shadow-xl border border-[#1B3829]/20 bg-white transition-all duration-200 ${
        closing ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
      }`}
      style={{ background: "linear-gradient(135deg, #ffffff 0%, #f0f7f3 100%)" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5 p-3">
        <CoachAlAvatar size={32} className="rounded-full ring-2 ring-[#1B3829]/15 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#1B3829]/70 font-semibold">
            Coach Al
          </p>
          <p className="text-[13px] text-gray-900 leading-snug mt-0.5">{text}</p>
          {onOpenChat && (
            <button
              onClick={() => {
                onOpenChat(`Tell me more about: "${text}"`);
                onDismiss();
              }}
              className="mt-1.5 text-[11px] font-semibold text-[#1B3829] hover:underline"
            >
              Talk about it →
            </button>
          )}
        </div>
        <button
          onClick={() => { setClosing(true); setTimeout(onDismiss, 220); }}
          className="text-gray-400 hover:text-gray-700 text-sm leading-none px-1 shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
