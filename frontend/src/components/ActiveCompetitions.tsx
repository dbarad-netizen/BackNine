"use client";

/**
 * ActiveCompetitions — compact strip on the Scorecard showing your live
 * challenges. Pulls /api/challenges/me, filters to is_active, surfaces up to
 * two with your current rank and days-hit, and tap-to-jump to the Compete tab.
 *
 * Silent when you have no active challenges — no empty state, no clutter.
 */

import { useEffect, useState } from "react";
import { api, type Challenge } from "@/lib/api";

interface Props {
  /** Called when the user taps a competition — usually setSection("challenges"). */
  onJump?: () => void;
}

function rankBadge(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function fmt(value: number, metric: string) {
  if (metric === "steps") return value.toLocaleString();
  return String(Math.round(value));
}

export default function ActiveCompetitions({ onJump }: Props) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.myChallenges()
      .then(res => {
        if (cancelled) return;
        const active = (res.challenges || []).filter(c => c.is_active);
        // Sort: most-recently-started first
        active.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
        setChallenges(active.slice(0, 2));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Silent if no active challenges. No skeleton either — keeps the page calm.
  if (loading || challenges.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600">
          Active Competitions
        </h3>
        {onJump && (
          <button
            onClick={onJump}
            className="text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors font-medium"
          >
            View all →
          </button>
        )}
      </div>
      <div className="space-y-2">
        {challenges.map(c => {
          const sorted = [...c.participants].sort(
            (a, b) => b.days_hit - a.days_hit || b.total_value - a.total_value
          );
          const myRank = sorted.findIndex(p => p.is_me) + 1;
          const me = sorted.find(p => p.is_me);
          const top = sorted[0];

          // Today indicator — green dot if user already hit target today
          const hitToday = (me?.today_value ?? 0) >= c.target;

          return (
            <button
              key={c.id}
              onClick={onJump}
              className="w-full text-left rounded-2xl border border-gray-200 bg-white p-3 hover:border-[#1B3829]/30 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0">{c.type_info.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                    {hitToday && (
                      <span
                        className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium shrink-0"
                        title="You hit today's target"
                      >
                        ✓ today
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-600">
                    <span>
                      <span className="font-semibold text-gray-700">{me?.days_hit ?? 0}</span>
                      /{c.elapsed_days} days hit
                    </span>
                    <span>·</span>
                    <span>{c.days_left}d left</span>
                    {me?.streak && me.streak > 1 && (
                      <>
                        <span>·</span>
                        <span className="text-orange-500 font-medium">{me.streak}🔥</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold text-gray-900 leading-none">
                    {myRank > 0 ? rankBadge(myRank) : "—"}
                  </p>
                  {top && !me?.is_me && myRank > 1 && (
                    <p className="text-[10px] text-gray-600 mt-1">
                      {fmt(top.total_value - (me?.total_value ?? 0), c.metric)} behind
                    </p>
                  )}
                  {myRank === 1 && top && sorted[1] && (
                    <p className="text-[10px] text-gray-600 mt-1">
                      +{fmt((me?.total_value ?? 0) - sorted[1].total_value, c.metric)}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
