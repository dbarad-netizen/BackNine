"use client";

/**
 * MorningBriefing — Coach Al's once-per-day proactive note for the user.
 *
 * Renders at the top of the Scorecard. Pulls /api/briefing/today on mount.
 * The first call of the day generates the briefing (one Anthropic call);
 * subsequent calls return the cached row.
 */

import { useEffect, useState } from "react";
import { api, type BriefingResponse } from "@/lib/api";
import CoachAlAvatar from "@/components/CoachAlAvatar";

interface Props {
  /** Optional callback to open the main Coach Al chat drawer. */
  onOpenChat?: () => void;
}

export default function MorningBriefing({ onOpenChat }: Props) {
  const [data,    setData]    = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.briefing()
      .then(res => { if (!cancelled) setData(res); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Briefing unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Loading shimmer — keep height stable so the page doesn't jump.
  if (loading) {
    return (
      <section
        className="rounded-2xl overflow-hidden p-5"
        style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
      >
        <div className="flex items-start gap-4">
          <CoachAlAvatar size={52} className="rounded-full ring-2 ring-white/30 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 bg-white/20 rounded animate-pulse" />
            <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-4/6 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
      </section>
    );
  }

  // Soft failure — never block the dashboard if the endpoint is down.
  if (error || !data) {
    return null;
  }

  // Split the narrative into paragraphs. Coach Al is instructed to write 2 paragraphs.
  const paragraphs = data.narrative
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const streak = data.prediction_streak ?? 0;
  const showStreak = streak >= 3;

  return (
    <section
      className="rounded-2xl overflow-hidden shadow-sm"
      style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 65%, #3a8a63 100%)" }}
    >
      <div className="px-5 pt-5 pb-4 flex items-start gap-4">
        <CoachAlAvatar size={52} className="rounded-full ring-2 ring-white/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] text-white/60 uppercase tracking-widest font-semibold">
              Coach Al · Today&apos;s Briefing
            </p>
            {showStreak && (
              <span
                className="text-[10px] text-white bg-white/15 backdrop-blur-sm rounded-full px-2 py-0.5 font-semibold flex items-center gap-1"
                title={
                  data.prediction_accuracy != null
                    ? `${data.prediction_accuracy}% prediction accuracy`
                    : "Daily prediction streak"
                }
              >
                <span>🔥</span>
                <span>{streak}-day streak</span>
              </span>
            )}
          </div>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className={`text-white text-[13.5px] leading-relaxed ${i > 0 ? "mt-2" : ""}`}
            >
              {p}
            </p>
          ))}
        </div>
      </div>

      {/* Action footer */}
      <div className="border-t border-white/10 px-5 py-2.5 flex items-center justify-between">
        <p className="text-[11px] text-white/50">
          {data.cached ? "Generated earlier today" : "Just generated"}
        </p>
        {onOpenChat && (
          <button
            onClick={onOpenChat}
            className="text-[11px] text-white/80 hover:text-white font-semibold flex items-center gap-1 transition-colors"
          >
            Talk to Coach Al →
          </button>
        )}
      </div>
    </section>
  );
}
