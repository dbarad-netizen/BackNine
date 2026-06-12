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
  // Collapse the briefing card once the user has acknowledged it (typically by
  // logging today's mood). They've already read the long-form note — keep the
  // chrome around so they can re-expand, but free up the scroll real estate.
  const [collapsed, setCollapsed] = useState(false);
  // 'saved' shows ✓ briefly; 'error' shows a retry hint. Cleared after ~2s.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  // Re-checking / overriding the "waiting for last night's sleep" state.
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([api.briefing(), api.getCheckinToday()])
      .then(([brRes, ckRes]) => {
        if (cancelled) return;
        if (brRes.status === "fulfilled") setData(brRes.value);
        else setError(brRes.reason instanceof Error ? brRes.reason.message : "Briefing unavailable");
        if (ckRes.status === "fulfilled") {
          const m = ckRes.value.today?.mood ?? undefined;
          setTodayMood(m);
          // Returning later in the day: if today's mood was already logged
          // (so they've engaged with the briefing earlier), start collapsed.
          if (m) setCollapsed(true);
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
      // Intentionally NOT auto-collapsing here — picking a mood is an
      // acknowledgment that they SAW the briefing, not that they're done
      // reading it. Folding the card away mid-read frustrates users. The
      // briefing collapses on the NEXT page load (if today's mood is already
      // logged), and the user can manually fold it via the ✕ button.
    } catch {
      // Roll back the optimistic selection and surface a retry hint.
      setTodayMood(prev);
      setSaveStatus("error");
    } finally {
      setSavingMood(false);
    }
  };

  // "Waiting for last night's sleep" actions. Check again re-pulls (Oura may have
  // synced since); brief-without-sleep is the escape hatch for a no-ring night.
  const handleCheckAgain = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const fresh = await api.briefing();
      setData(fresh);
    } catch {
      /* keep showing the syncing state */
    } finally {
      setChecking(false);
    }
  };

  const handleBriefNoSleep = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const fresh = await api.briefing(false, undefined, true);
      setData(fresh);
    } catch {
      /* keep showing the syncing state */
    } finally {
      setChecking(false);
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

  const appStreak = data.app_streak ?? 0;
  const showAppStreak = appStreak >= 2;
  const moodLogged = todayMood !== undefined && todayMood !== null;
  // Last night's Oura sleep hasn't synced yet — show a "syncing" state instead
  // of building the briefing on an older night's data.
  const pending = data.sleep_status === "pending";

  // ─── Collapsed mode ────────────────────────────────────────────────────────
  // Once the user has acknowledged today's briefing (typically by logging a
  // mood), fold the long narrative away to free up dashboard real estate. The
  // chrome stays so they can re-expand at any time.
  if (collapsed) {
    const moodEmoji = MOODS.find(m => m.value === todayMood)?.emoji;
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-full rounded-2xl overflow-hidden shadow-sm text-left transition-transform hover:scale-[1.005] active:scale-[0.998]"
        style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
        aria-label="Expand today's briefing"
      >
        <div className="px-4 py-3 flex items-center gap-3">
          <CoachAlAvatar size={36} className="rounded-full ring-2 ring-white/30 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-white/60 uppercase tracking-widest font-semibold">
              Coach Al · Today&apos;s Briefing
            </p>
            <p className="text-[12px] text-white/85 truncate">
              {moodEmoji && <span className="mr-1">{moodEmoji}</span>}
              You&apos;ve read today&apos;s note — tap to re-open
            </p>
          </div>
          {showAppStreak && (
            <span
              className="text-[10px] text-white bg-orange-500/40 rounded-full px-2 py-0.5 font-semibold flex items-center gap-1 border border-orange-300/30 shrink-0"
              title={`You've opened BackNine ${appStreak} days in a row`}
            >
              <span>🔥</span><span>{appStreak}</span>
            </span>
          )}
          <span className="text-white/60 text-sm shrink-0" aria-hidden>▼</span>
        </div>
      </button>
    );
  }

  return (
    <section
      className="rounded-2xl overflow-hidden shadow-sm relative"
      style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 65%, #3a8a63 100%)" }}
    >
      {/* Upper-right Hide button — folds the briefing back to its compact
          collapsed state. Sits in the corner so it doesn't compete with the
          title row but stays trivially discoverable. */}
      <button
        onClick={() => setCollapsed(true)}
        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/25 text-white/80 hover:text-white text-xs flex items-center justify-center transition-colors z-10"
        title="Hide briefing — tap the header to reopen"
        aria-label="Collapse briefing"
      >
        ✕
      </button>
      <div className="px-5 pt-5 pb-4 flex items-start gap-4">
        <CoachAlAvatar size={52} className="rounded-full ring-2 ring-white/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] text-white/60 uppercase tracking-widest font-semibold truncate min-w-0">
              Coach Al · Today&apos;s Briefing
            </p>
            {showAppStreak && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className="text-[10px] text-white bg-orange-500/40 backdrop-blur-sm rounded-full px-2 py-0.5 font-semibold flex items-center gap-1 border border-orange-300/30 whitespace-nowrap"
                  title={`You've opened BackNine ${appStreak} days in a row`}
                >
                  <span>🔥</span>
                  <span>{appStreak}-day streak</span>
                </span>
              </div>
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

          {pending ? (
            <div className="rounded-xl bg-white/10 border border-white/15 px-3 py-3">
              <p className="text-white text-[13.5px] leading-relaxed font-semibold mb-1">
                🌙 Syncing last night&apos;s sleep…
              </p>
              <p className="text-white/80 text-[12.5px] leading-relaxed">
                Last night&apos;s Oura data hasn&apos;t reached us yet. I&apos;ll have your full briefing the
                moment it lands — usually a few minutes after you wake. Opening the Oura app can nudge the sync along.
              </p>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleCheckAgain}
                  disabled={checking}
                  className="text-[12px] font-semibold bg-white text-[#1B3829] rounded-lg px-3 py-1.5 disabled:opacity-60"
                >
                  {checking ? "Checking…" : "Check again"}
                </button>
                <button
                  onClick={handleBriefNoSleep}
                  disabled={checking}
                  className="text-[12px] text-white/80 hover:text-white underline-offset-2 hover:underline disabled:opacity-60"
                >
                  Brief me without sleep
                </button>
              </div>
            </div>
          ) : (
            paragraphs.map((p, i) => (
              <p
                key={i}
                className={`text-white text-[13.5px] leading-relaxed ${i > 0 ? "mt-2" : ""}`}
              >
                {p}
              </p>
            ))
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="border-t border-white/10 px-5 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* In the no-data welcome state there's nothing to regenerate, so
              hide the timestamp + Regenerate link and just keep the chat CTA. */}
          {data.has_data !== false && !pending && (
            <>
              <p className="text-[11px] text-white/60 truncate">
                {data.generated_at
                  ? `From ${new Date(data.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : data.cached ? "Generated earlier today" : "Just generated"}
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
            </>
          )}
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
