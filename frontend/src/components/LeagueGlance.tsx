"use client";

/**
 * LeagueGlance — compact one-row summary of this week's league standings,
 * meant for the Scorecard. The full WeeklyLeague (with per-category grid,
 * scoring explainer, etc.) lives in the Clubhouse tab; this is just the
 * "where do I stand, how much time left, can I climb" peek.
 *
 * Tier names ladder: Bronze → Silver → Gold → Platinum → Diamond → Legend.
 * Everyone starts in Bronze. Top finishers each week get promoted.
 */

import { useEffect, useState } from "react";
import { api, type LeagueResponse } from "@/lib/api";

interface Props {
  /** Tap → navigate to the Clubhouse tab. */
  onOpen?: () => void;
}

const TIER_STYLES: Record<string, { bg: string; ring: string; ink: string; icon: string }> = {
  Bronze:   { bg: "#fdf4e7", ring: "#c08951", ink: "#7a4e1c", icon: "🥉" },
  Silver:   { bg: "#f3f4f6", ring: "#9ca3af", ink: "#374151", icon: "🥈" },
  Gold:     { bg: "#fef9c3", ring: "#eab308", ink: "#854d0e", icon: "🥇" },
  Platinum: { bg: "#e0f2fe", ring: "#0ea5e9", ink: "#0c4a6e", icon: "💎" },
  Diamond:  { bg: "#ede9fe", ring: "#8b5cf6", ink: "#5b21b6", icon: "💠" },
  Legend:   { bg: "#fce7f3", ring: "#ec4899", ink: "#9d174d", icon: "🏆" },
};

export default function LeagueGlance({ onOpen }: Props) {
  const [data, setData] = useState<LeagueResponse | null>(null);

  useEffect(() => {
    api.friends.league().then(setData).catch(() => setData(null));
  }, []);

  if (!data || !data.league) return null;

  const tier = TIER_STYLES[data.league.tier_name] ?? TIER_STYLES.Bronze;
  const me   = data.standings.find(s => s.is_me);
  const top  = data.standings[0];
  const ptsBehind = top && me && me.user_id !== top.user_id ? top.score - me.score : 0;

  // Tier ladder for the "climb to <next>" subtitle. Legend is the top — no
  // "climb to" line when already there.
  const TIER_LADDER = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Legend"];
  const tierIdx  = TIER_LADDER.indexOf(data.league.tier_name);
  const nextTier = tierIdx >= 0 && tierIdx < TIER_LADDER.length - 1 ? TIER_LADDER[tierIdx + 1] : null;
  const tierSubtitle = nextTier
    ? (tierIdx === 0 ? `starting tier · climb to ${nextTier}` : `climb to ${nextTier}`)
    : "top tier";

  // Standings line. The league auto-groups everyone on BackNine into cohorts
  // (Duolingo-style) — not friend-based. When a cohort is small (often early
  // on), we say so honestly rather than blaming the user for "not inviting
  // friends" (which doesn't affect cohort population).
  let stand: string;
  if (data.member_count <= 1) {
    stand = "You're the only one in this cohort right now — more users get added as they join";
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
      aria-label="Open league standings"
    >
      <div className="flex items-center gap-3">
        {/* Tier badge */}
        <div
          className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg ring-2"
          style={{ background: tier.bg, color: tier.ink, borderColor: tier.ring, boxShadow: `inset 0 0 0 2px ${tier.ring}33` }}
          aria-hidden
        >
          {tier.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-gray-900 truncate">
              {data.league.tier_name} League
              <span className="text-[10px] font-normal text-gray-500 ml-1.5">{tierSubtitle}</span>
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
