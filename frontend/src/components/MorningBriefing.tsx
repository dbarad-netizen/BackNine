"use client";

/**
 * MorningBriefing — Coach Al's once-per-day proactive note for the user.
 *
 * Renders at the top of the Scorecard. Pulls /api/briefing/today on mount.
 * The first call of the day generates the briefing (one Anthropic call);
 * subsequent calls return the cached row.
 */

import { useEffect, useState } from "react";
import { api, type BriefingResponse, type Mood } from "@/lib/api";
import CoachAlAvatar from "@/components/CoachAlAvatar";

const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: "great", emoji: "😊", label: "Great" },
  { value: "good",  emoji: "🙂", label: "Good"  },
  { value: "okay",  emoji: "😐", label: "Okay"  },
  { value: "tired", emoji: "😴", label: "Tired" },
  { value: "off",   emoji: "😣", label: "Off"   },
];

interface Props {
  /** Optional callback to open the main Coach Al chat drawer. */
  onOpenChat?: () => void;
}

export default function MorningBriefing({ onOpenChat }: Props) {
  const [data,    setData]    = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Today's check-in. null = not yet loaded, undefined = loaded but not logged.
  const [todayMood, setTodayMood] = useState<Mood | null | undefined>(null);
  const [savingMood, setSavingMood] = useState(false);
  // 'saved' shows ✓ briefly; 'error' shows a retry hint. Cleared after ~2s.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([api.briefing(), api.getCheckinToday()])
      .then(([brRes, ckRes]) => {
        if (cancelled) return;
        if (brRes.status === "fulfilled") setData(brRes.value);
        else setError(brRes.reason instanceof Error ? brRes.reason.message : "Briefing unavailable");
        if (ckRes.status === "fulfilled") {
          setTodayMood(ckRes.value.today?.mood ?? undefined);
        } else {
          setTodayMood(undefined);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleMoodTap = async (mood: Mood) => {
    if (savingMood) return;
    setSavingMood(true);
    setSaveStatus("idle");
    const prev = todayMood;
    // Optimistic local update so the highlighted emoji shows immediately.
    setTodayMood(mood);
    try {
      await api.postCheckin(mood);
      setSaveStatus("saved");
      // Clear the "✓ Saved" indicator after a beat so it doesn't linger.
      setTimeout(() => setSaveStatus(prevStatus => prevStatus === "saved" ? "idle" : prevStatus), 2000);
    } catch {
      // Roll back the optimistic selection and surface a retry hint.
      setTodayMood(prev);
      setSaveStatus("error");
    } finally {
      setSavingMood(false);
    }
  };

  // Force-regenerate using ?refresh=1. Useful when the cached briefing was
  // generated with stale data (e.g. before today's Oura sync finished) or
  // when the user wants a fresh take after logging something new.
  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const fresh = await api.briefing(true);
      setData(fresh);
    } catch {
      // Keep the old briefing visible if regenerate fails
    } finally {
      setRegenerating(false);
    }
  };

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

  const predictionStreak = data.prediction_streak ?? 0;
  const showPredictionStreak = predictionStreak >= 3;
  const appStreak = data.app_streak ?? 0;
  const showAppStreak = appStreak >= 2;
  const moodLogged = todayMood !== undefined && todayMood !== null;

  return (
    <section
      className="rounded-2xl overflow-hidden shadow-sm"
      style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 65%, #3a8a63 100%)" }}
    >
      <div className="px-5 pt-5 pb-4 flex items-start gap-4">
        <CoachAlAvatar size={52} className="rounded-full ring-2 ring-white/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="text-[10px] text-white/60 uppercase tracking-widest font-semibold">
              Coach Al · Today&apos;s Briefing
            </p>
            {showAppStreak && (
              <span
                className="text-[10px] text-white bg-orange-500/40 backdrop-blur-sm rounded-full px-2 py-0.5 font-semibold flex items-center gap-1 border border-orange-300/30"
                title={`You've opened BackNine ${appStreak} days in a row`}
              >
                <span>🔥</span>
                <span>{appStreak}-day streak</span>
              </span>
            )}
            {showPredictionStreak && (
              <span
                className="text-[10px] text-white bg-white/15 backdrop-blur-sm rounded-full px-2 py-0.5 font-semibold flex items-center gap-1"
                title={
                  data.prediction_accuracy != null
                    ? `${data.prediction_accuracy}% prediction accuracy`
                    : "Daily prediction streak"
                }
              >
                <span>🎯</span>
                <span>{predictionStreak}d predicting</span>
              </span>
            )}
          </div>

          {/* Daily check-in — always visible. Selected emoji stays highlighted
              with a strong contrast pill so the tap registers clearly.
              Tapping a different one updates the selection in place. */}
          <div className="mb-3 rounded-xl bg-white/10 border border-white/15 px-3 py-2.5">
            <p className="text-[11px] text-white/70 mb-1.5">
              {moodLogged ? "How you're feeling today" : "How are you feeling this morning?"}
            </p>
            <div className="flex gap-1.5">
              {MOODS.map(m => {
                const selected = todayMood === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => handleMoodTap(m.value)}
                    disabled={savingMood}
                    className={`flex-1 rounded-lg py-2 transition-all flex flex-col items-center gap-0.5 disabled:opacity-60 ${
                      selected
                        ? "bg-white text-[#1B3829] ring-2 ring-white shadow-lg scale-105"
                        : "bg-white/5 hover:bg-white/15 active:scale-95"
                    }`}
                    title={m.label}
                  >
                    <span className="text-lg leading-none">{m.emoji}</span>
                    <span className={`text-[9px] font-semibold uppercase tracking-wide ${
                      selected ? "text-[#1B3829]" : "text-white/70"
                    }`}>
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Save status — small confirmation/error line below the row */}
            <p className="text-[10px] text-white/60 mt-1.5 min-h-[1em]">
              {savingMood && "Saving…"}
              {!savingMood && saveStatus === "saved" && "✓ Saved · Coach Al will use this in tomorrow's note"}
              {!savingMood && saveStatus === "error" && (
                <span className="text-red-200">Couldn&apos;t save — tap again to retry</span>
              )}
            </p>
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
      <div className="border-t border-white/10 px-5 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-[11px] text-white/50 truncate">
            {data.cached ? "Generated earlier today" : "Just generated"}
          </p>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className={`text-[11px] text-white/60 hover:text-white/90 transition-colors underline-offset-2 hover:underline disabled:opacity-40 shrink-0 ${
              regenerating ? "animate-pulse" : ""
            }`}
            title="Force a fresh briefing (skips today's cache)"
          >
            {regenerating ? "Refreshing…" : "Regenerate"}
          </button>
        </div>
        {onOpenChat && (
          <button
            onClick={onOpenChat}
            className="text-[11px] text-white/80 hover:text-white font-semibold flex items-center gap-1 transition-colors shrink-0"
          >
            Talk to Coach Al →
          </button>
        )}
      </div>
    </section>
  );
}
