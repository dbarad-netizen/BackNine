"use client";

/**
 * NudgeCard — the one Coach Al nudge for today.
 *
 * David 2026-07-23 (Fable competitive brief): parity with Bevel's
 * proactive Intelligence check-ins and Aveil's "only when worth acting
 * on" tone, without becoming noisy. The backend enforces a hard cap of
 * one nudge per user per day at the schema level (UNIQUE constraint on
 * user_id + date), so the client can't accidentally spam.
 *
 * Self-hides when there's no nudge today OR the user dismissed it.
 * Never renders a placeholder — silence is a valid state.
 */

import { useEffect, useState } from "react";
import { api, type Nudge } from "@/lib/api";

interface Props {
  /** Parent-controlled section switch — used when the nudge's
   *  action_target names a dashboard section ("training", "sleep",
   *  "nutrition", etc.) so the CTA can jump the user there. */
  onJump?: (section: string) => void;
}

const KIND_EMOJI: Record<Nudge["kind"], string> = {
  bp_high:         "🩸",
  hrv_drop:        "❤️",
  sleep_debt:      "😴",
  adherence_dip:   "💊",
  training_gap:    "🏋️",
  alcohol_pattern: "🍷",
  weight_trend:    "⚖️",
  goal_stalled:    "🎯",
};

export default function NudgeCard({ onJump }: Props) {
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.todayNudge()
      .then(r => { if (!cancelled) setNudge(r.nudge); })
      .catch(() => { /* silent — card just hides */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const dismiss = async () => {
    if (!nudge) return;
    setDismissing(true);
    try {
      await api.dismissNudge(nudge.id);
      setNudge(null);
    } finally {
      setDismissing(false);
    }
  };

  const act = async () => {
    if (!nudge) return;
    // Fire-and-forget analytics
    api.actedNudge(nudge.id).catch(() => { /* silent */ });
    if (nudge.action_target && onJump) onJump(nudge.action_target);
  };

  if (loading) return null;
  if (!nudge) return null;
  if (nudge.dismissed_at) return null;

  const emoji = KIND_EMOJI[nudge.kind] || "💡";

  return (
    <section className="rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-50 to-white shadow-sm p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0" aria-hidden>{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800">
              Coach Al · one nudge
            </p>
            <button
              onClick={dismiss}
              disabled={dismissing}
              className="shrink-0 text-gray-400 hover:text-gray-700 text-lg leading-none px-1 -mt-0.5"
              aria-label="Dismiss"
              title="Dismiss today's nudge"
            >×</button>
          </div>
          <p className="text-[14px] font-bold text-gray-900 leading-tight mt-0.5">
            {nudge.title}
          </p>
          <p className="text-[13px] text-gray-700 leading-relaxed mt-1">
            {nudge.body}
          </p>
          {nudge.action_label && nudge.action_target && (
            <button
              onClick={act}
              className="mt-2.5 text-[11px] font-semibold text-white bg-[#1B3829] hover:bg-[#2D6A4F] px-3 py-1.5 rounded-lg transition-colors"
            >
              {nudge.action_label} →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
