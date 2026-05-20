"use client";

/**
 * WeeklyLeague — Duolingo-style weekly competition on the Scorecard.
 *
 * Everyone is auto-grouped into a league for the Mon–Sun week and ranked by
 * engagement points (daily check-in, logging workouts/meals/weigh-ins, plus a
 * step bonus for tracker users). Pulls /api/leagues/current on mount (which
 * also joins the user into the week's league). Gives even a friendless user
 * with no wearable a live, refreshing race — the community cold-start fix.
 */

import { useEffect, useState } from "react";
import { api, type LeagueResponse } from "@/lib/api";

interface Props {
  /** Open the share/invite sheet — surfaced when the league is sparse. */
  onInvite?: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function WeeklyLeague({ onInvite }: Props) {
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.friends.league()
      .then(res => { if (!cancelled) setData(res); })
      .catch(() => { /* soft-fail */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />)}
        </div>
      </section>
    );
  }

  if (!data || !data.league) return null;

  const { league, standings, me_rank, days_left, member_count } = data;
  const soloOrTiny = member_count <= 1;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-3.5 flex items-center justify-between"
        style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl leading-none">🏆</span>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">{league.tier_name} League</p>
            <p className="text-white/60 text-[10px] uppercase tracking-widest">
              {member_count} {member_count === 1 ? "player" : "players"} · this week
            </p>
          </div>
        </div>
        {days_left != null && (
          <span className="text-[10px] text-white bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1 font-semibold shrink-0">
            {days_left === 0 ? "Final day" : `${days_left}d left`}
          </span>
        )}
      </div>

      {/* Standings */}
      <div className="divide-y divide-gray-50">
        {standings.slice(0, 12).map(s => {
          const top3 = s.rank <= 3;
          return (
            <div
              key={s.user_id}
              className={`flex items-center gap-3 px-4 py-2.5 ${s.is_me ? "bg-[#1B3829]/5" : ""}`}
            >
              <span className={`w-7 text-center text-sm font-bold shrink-0 ${top3 ? "" : "text-gray-400"}`}>
                {top3 ? MEDAL[s.rank - 1] : s.rank}
              </span>
              <span className={`flex-1 text-sm truncate ${s.is_me ? "font-bold text-[#1B3829]" : "text-gray-700"}`}>
                {s.is_me ? "You" : s.name}
              </span>
              <span className="text-sm font-semibold text-gray-900 shrink-0">
                {s.score.toLocaleString()}
              </span>
              <span className="text-[11px] text-gray-400 shrink-0">pts</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          {me_rank != null
            ? soloOrTiny
              ? "You're first in — invite friends to make it a race"
              : `You're #${me_rank} of ${member_count} · check in & log to earn points`
            : "Earn points: check in, log workouts, meals & weigh-ins"}
        </p>
        {onInvite && soloOrTiny && (
          <button
            onClick={onInvite}
            className="text-[11px] font-semibold text-[#1B3829] hover:underline shrink-0"
          >
            Invite →
          </button>
        )}
      </div>
    </section>
  );
}
