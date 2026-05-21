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
import { api, type LeagueResponse, type LeagueBreakdownItem } from "@/lib/api";

interface Props {
  /** Open the share/invite sheet — surfaced when the league is sparse. */
  onInvite?: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

/** Shown when the backend hasn't returned a personal breakdown (older API or
 * soft-fail). Same point values as backend/leagues.py — keep in sync. */
const FALLBACK_RULES: LeagueBreakdownItem[] = [
  { key: "checkin", label: "Daily check-in", icon: "✅", per: 10, per_unit: "day",      count: 0, points: 0 },
  { key: "workout", label: "Log a workout",  icon: "💪", per: 20, per_unit: "day",      count: 0, points: 0 },
  { key: "meal",    label: "Log a meal",     icon: "🍳", per: 5,  per_unit: "day",      count: 0, points: 0 },
  { key: "weighin", label: "Log a weigh-in", icon: "⚖️", per: 10, per_unit: "day",      count: 0, points: 0 },
  { key: "steps",   label: "Steps (Oura)",   icon: "👟", per: 1,  per_unit: "1k steps", count: 0, points: 0 },
];

/** Pick the single highest-value daily habit the user hasn't earned yet this
 * week — the "quickest win" to climb the standings. Steps are excluded (they're
 * a tracker-only volume bonus, not a tap-to-earn action). */
function quickestWin(items: LeagueBreakdownItem[]): LeagueBreakdownItem | null {
  const untapped = items.filter(i => i.key !== "steps" && i.count === 0);
  if (!untapped.length) return null;
  return untapped.reduce((best, i) => (i.per > best.per ? i : best));
}

export default function WeeklyLeague({ onInvite }: Props) {
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showScoring, setShowScoring] = useState(false);

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

  const { league, standings, me_rank, days_left, member_count, my_breakdown } = data;
  const soloOrTiny = member_count <= 1;
  const breakdown = my_breakdown ?? null;
  const win = breakdown ? quickestWin(breakdown.items) : null;

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

      {/* How scoring works — expandable */}
      <button
        onClick={() => setShowScoring(v => !v)}
        className="w-full px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        aria-expanded={showScoring}
      >
        <span className="text-xs font-semibold text-[#1B3829] flex items-center gap-1.5">
          <span>📊</span> How scoring works
        </span>
        <span className={`text-gray-400 text-xs transition-transform ${showScoring ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {showScoring && (
        <div className="px-4 pb-4 pt-1 bg-gray-50/60 border-t border-gray-100">
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
            You earn points every day this week for the habits below.
            {breakdown ? " Here's where yours came from so far:" : " Log them to climb the standings:"}
          </p>

          <div className="space-y-1.5">
            {(breakdown?.items ?? FALLBACK_RULES).map(item => {
              const earned = item.points > 0;
              return (
                <div
                  key={item.key}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                    earned ? "bg-white border border-gray-100" : "bg-white/40 border border-dashed border-gray-200"
                  }`}
                >
                  <span className="text-base leading-none shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{item.label}</p>
                    <p className="text-[10px] text-gray-400">
                      +{item.per} per {item.per_unit}
                      {breakdown && item.count > 0 && (
                        <span className="text-gray-500"> · {item.count} {item.per_unit}{item.count === 1 ? "" : "s"} so far</span>
                      )}
                    </p>
                  </div>
                  {breakdown && (
                    <span className={`text-sm font-bold shrink-0 ${earned ? "text-[#1B3829]" : "text-gray-300"}`}>
                      {earned ? `+${item.points}` : "0"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {breakdown && (
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-200">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Your points this week</span>
              <span className="text-sm font-bold text-[#1B3829]">{breakdown.total.toLocaleString()}</span>
            </div>
          )}

          {win && (
            <div className="mt-3 rounded-lg bg-[#1B3829]/5 border border-[#1B3829]/10 px-3 py-2.5">
              <p className="text-[11px] text-[#1B3829] leading-relaxed">
                <span className="font-semibold">💡 Quickest win:</span> {win.label.toLowerCase()} today for{" "}
                <span className="font-semibold">+{win.per} pts</span>.
              </p>
            </div>
          )}
          {breakdown && !win && (
            <p className="mt-3 text-[11px] text-[#1B3829] leading-relaxed">
              🔥 You&apos;re earning in every category this week — keep the streak alive to hold your spot.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
