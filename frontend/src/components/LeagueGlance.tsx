"use client";

/**
 * LeagueGlance — compact one-row summary of this week's leaderboard.
 *
 * Previously framed as a Duolingo-style tier-and-promotion system (Bronze →
 * Silver → Gold…), but the promotion mechanic was never implemented and the
 * tier metaphor created false expectations. Dropped to a clean weekly
 * leaderboard. Real competition lives in the friend matchups + engagement
 * points — this card is just the at-a-glance "how am I doing this week?"
 *
 * The backend still returns `tier_name`; we intentionally ignore it.
 */

import { useEffect, useState } from "react";
import { api, type LeagueResponse } from "@/lib/api";

interface Props {
  /** Tap → navigate to the Clubhouse tab. */
  onOpen?: () => void;
}

export default function LeagueGlance({ onOpen }: Props) {
  const [data, setData] = useState<LeagueResponse | null>(null);

  useEffect(() => {
    api.friends.league().then(setData).catch(() => setData(null));
  }, []);

  if (!data || !data.league) return null;

  const me   = data.standings.find(s => s.is_me);
  const top  = data.standings[0];
  const ptsBehind = top && me && me.user_id !== top.user_id ? top.score - me.score : 0;

  // Standings line. The leaderboard ranks everyone on BackNine this week by
  // engagement points. Honest framing when the field is small.
  let stand: string;
  if (data.member_count <= 1) {
    stand = "You're the only player ranked so far — more join in as they earn points";
  } else if (me?.user_id === top?.user_id) {
    stand = `You're #1 of ${data.member_count} this week`;
  } else if (me) {
    stand = `You're #${data.me_rank ?? "?"} of ${data.member_count}${ptsBehind > 0 ? ` · ${ptsBehind} pts behind 1st` : ""}`;
  } else {
    stand = `${data.member_count} competing this week`;
  }

  const daysLeftLine = data.days_left == null
    ? ""
    : data.days_left === 0
      ? "Last day"
      : data.days_left === 1
        ? "1 day left"
        : `${data.days_left} days left`;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:border-[#1B3829]/30 transition-colors"
      aria-label="Open weekly leaderboard"
    >
      <div className="flex items-center gap-3">
        {/* Trophy mark — neutral, no tier baggage */}
        <div
          className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg bg-[#1B3829]/8 text-[#1B3829] ring-1 ring-[#1B3829]/15"
          aria-hidden
        >
          🏆
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-gray-900 truncate">
              Weekly Leaderboard
              <span className="text-[10px] font-normal text-gray-500 ml-1.5">engagement points</span>
            </p>
            {daysLeftLine && (
              <p className="text-[10px] text-gray-600 shrink-0">{daysLeftLine}</p>
            )}
          </div>
          <p className="text-[12px] text-gray-700 mt-0.5 truncate">{stand}</p>
        </div>
        <span className="text-[#1B3829] text-sm font-semibold shrink-0" aria-hidden>→</span>
      </div>
    </button>
  );
}
