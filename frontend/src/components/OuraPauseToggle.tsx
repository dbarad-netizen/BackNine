"use client";

/**
 * OuraPauseToggle — user-controlled "I'm taking a break from the ring"
 * switch. When paused, the data-freshness banner + AI staleness advisory
 * treat Oura as inactive and stop nagging the user to reconnect.
 *
 * Chris (David's beta user) surfaced the need: former Oura wearer now
 * on Fitbit + Apple Watch + manual entries. Every dashboard load told
 * him his data was old — his Oura data was, but his actual health data
 * wasn't. This toggle lets him tell the app "I know, stop bringing it
 * up."
 *
 * Not a disconnect: tokens stay valid, the ring can be re-worn any day
 * and resumed with one tap. This is a UX signal, not a state change on
 * the Oura side.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const days = Math.round((now - then) / 86400000);
  if (days < 1)  return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export default function OuraPauseToggle() {
  const [paused,   setPaused]   = useState<boolean | null>(null);
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.ouraStatus()
      .then(r => { if (!cancelled) { setPaused(r.paused); setPausedAt(r.paused_at); } })
      .catch(() => { if (!cancelled) setPaused(false); });
    return () => { cancelled = true; };
  }, []);

  if (paused === null) return null;   // brief loading state — render nothing

  const toggle = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (paused) {
        const r = await api.resumeOura();
        setPaused(false); setPausedAt(r.paused_at);
      } else {
        const r = await api.pauseOura();
        setPaused(true);  setPausedAt(r.paused_at);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update.");
    } finally { setBusy(false); }
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${
      paused
        ? "border-amber-200 bg-amber-50/60"
        : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-900 leading-tight">
            {paused ? "Oura is paused" : "Oura is active"}
          </p>
          <p className="text-[11px] text-gray-600 leading-snug mt-0.5">
            {paused
              ? <>Freshness banners are muted for Oura. {pausedAt && <>Paused {timeAgo(pausedAt)}. </>}Tap to resume.</>
              : <>Taking a break from the ring? Pausing mutes the &ldquo;data is old&rdquo; banner without disconnecting.</>}
          </p>
        </div>

        <button
          onClick={toggle}
          disabled={busy}
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
            paused
              ? "bg-[#1B3829] hover:bg-[#2D6A4F] text-white"
              : "border border-gray-300 text-gray-700 hover:border-gray-500 hover:text-gray-900"
          }`}
          aria-pressed={paused}
        >
          {busy ? "…" : paused ? "Resume" : "Pause"}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1 mt-1.5">{error}</p>
      )}
    </div>
  );
}
