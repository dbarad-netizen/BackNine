"use client";

/**
 * WeeklyLeague — global weekly engagement-point leaderboard, shown in the
 * Clubhouse. Was originally framed as a Duolingo-style tier system
 * (Bronze/Silver/Gold/…) but the promotion mechanic was never implemented,
 * so we dropped the tier metaphor and use the universal "Weekly Leaderboard"
 * label. Real competition lives in the friend matchups + engagement points.
 *
 * Everyone is auto-grouped into a league for the Mon–Sun week and ranked by
 * engagement points (daily check-in, logging workouts/meals/weigh-ins, plus a
 * step bonus for tracker users). Pulls /api/leagues/current on mount (which
 * also joins the user into the week's league). Gives even a friendless user
 * with no wearable a live, refreshing race — the community cold-start fix.
 */

import { useEffect, useState } from "react";
import { api, type LeagueResponse, type LeagueBreakdownItem, type LeagueCategory } from "@/lib/api";

interface Props {
  /** Open the share/invite sheet — surfaced when the league is sparse. */
  onInvite?: () => void;
  /** When set, renders a "See full Clubhouse →" link in the header so this
   *  card on the Scorecard surface always has a clear path back to the
   *  rest of the social hub (Pulse, groups, challenges). No link rendered
   *  when undefined (Clubhouse placement, where the card already IS the
   *  destination). */
  onSeeMore?: () => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];

/** Compact column labels for the per-task grid header / legend chips. */
const SHORT: Record<string, string> = {
  checkin: "Check-in", workout: "Workout", meal: "Meal", weighin: "Weigh-in",
  goal_pace: "Goal pace", steps: "Steps",
};

/** Shown when the backend hasn't returned a personal breakdown (older API or
 * soft-fail). Same point values as backend/leagues.py — keep in sync. */
const FALLBACK_RULES: LeagueBreakdownItem[] = [
  { key: "checkin",   label: "Daily check-in", icon: "✅", per: 10, per_unit: "day",       count: 0, points: 0 },
  { key: "workout",   label: "Workouts",       icon: "💪", per: 20, per_unit: "first/day", count: 0, points: 0,
    tier: { extra_per: 5, max_per_day: 3 } },
  { key: "meal",      label: "Log a meal",     icon: "🍳", per: 5,  per_unit: "day",       count: 0, points: 0 },
  { key: "weighin",   label: "Log a weigh-in", icon: "⚖️", per: 5,  per_unit: "day",       count: 0, points: 0 },
  { key: "goal_pace", label: "Goal pace",      icon: "🎯", per: 15, per_unit: "week",      count: 0, points: 0,
    tier: { behind_pts: 5 } },
  { key: "steps",     label: "Steps (Oura)",   icon: "👟", per: 1,  per_unit: "1k steps",  count: 0, points: 0 },
];

/** Render the points rule for a category as compact text for the pill row.
 *  Handles both tiered shapes:
 *    - workouts: `{ extra_per, max_per_day }` (additional points per repeat action)
 *    - goal pace: `{ behind_pts }` (alternate value for the behind-pace bucket)
 */
function ruleLabel(c: { key?: string; per: number; per_unit: string; tier?: { extra_per?: number; max_per_day?: number; behind_pts?: number } }): string {
  if (c.tier?.behind_pts != null) {
    return `+${c.per} on pace · +${c.tier.behind_pts} behind`;
  }
  if (c.tier?.extra_per != null && c.tier?.max_per_day != null) {
    return `+${c.per} 1st · +${c.tier.extra_per} each more (max ${c.tier.max_per_day}/day)`;
  }
  if (c.per_unit === "1k steps") return `+${c.per}/1k`;
  return `+${c.per}/${c.per_unit}`;
}

/** Pick the single highest-value daily habit the user hasn't earned yet this
 * week — the "quickest win" to climb the standings. Steps are excluded (they're
 * a tracker-only volume bonus, not a tap-to-earn action). */
function quickestWin(items: LeagueBreakdownItem[]): LeagueBreakdownItem | null {
  const untapped = items.filter(i => i.key !== "steps" && i.count === 0);
  if (!untapped.length) return null;
  return untapped.reduce((best, i) => (i.per > best.per ? i : best));
}

export default function WeeklyLeague({ onInvite, onSeeMore }: Props) {
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

  // Column defs for the per-task grid (backend metadata, else local fallback).
  const cats: LeagueCategory[] =
    data.categories && data.categories.length
      ? data.categories
      : FALLBACK_RULES.map(({ key, label, icon, per, per_unit, tier }) => ({ key, label, icon, per, per_unit, tier }));
  // The grid needs per-member category points; show it once the backend supplies them.
  const hasGrid = standings.some(s => s.points_by_cat && Object.keys(s.points_by_cat).length > 0);

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
            {/* Tier metaphor (Bronze/Silver/Gold…) was dropped because the
                promotion mechanic was never built — see LeagueGlance.tsx. We
                ignore league.tier_name and render the universal "Weekly
                Leaderboard" header instead. */}
            <p className="text-white font-bold text-sm leading-tight truncate">Weekly Leaderboard</p>
            <p className="text-white/60 text-[10px] uppercase tracking-widest">
              {member_count} {member_count === 1 ? "player" : "players"} · this week
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {days_left != null && (
            <span className="text-[10px] text-white bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1 font-semibold">
              {days_left === 0 ? "Final day" : `${days_left}d left`}
            </span>
          )}
          {onSeeMore && (
            <button
              onClick={onSeeMore}
              className="text-[10px] text-white/90 hover:text-white font-semibold underline-offset-2 hover:underline"
            >
              Clubhouse →
            </button>
          )}
        </div>
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
              <span className={`w-7 text-center text-sm font-bold shrink-0 ${top3 ? "" : "text-gray-600"}`}>
                {top3 ? MEDAL[s.rank - 1] : s.rank}
              </span>
              <span className={`flex-1 text-sm truncate flex items-center gap-1.5 ${s.is_me ? "font-bold text-[#1B3829]" : "text-gray-700"}`}>
                <span className="truncate">{s.is_me ? "You" : s.name}</span>
                {/* Level chip removed — gamification layer was killed. */}
              </span>
              {/* Primary metric: Weekly Health Span Score (David
                  2026-08-11). Engagement points demoted to a small
                  secondary chip. Members without a snapshot this week
                  show an em-dash. */}
              {s.healthspan != null ? (
                <span
                  className="text-sm font-semibold text-gray-900 shrink-0"
                  title="Weekly Health Span Score — sleep, movement, adherence & consistency this week"
                >
                  {s.healthspan}
                </span>
              ) : (
                <span className="text-sm font-semibold text-gray-400 shrink-0" title="No Health Span Score yet this week">
                  —
                </span>
              )}
              <span className="text-[11px] text-gray-600 shrink-0">HS</span>
              <span
                className="text-[10px] text-gray-500 shrink-0 w-12 text-right"
                title="Weekly engagement points (secondary)"
              >
                {s.score.toLocaleString()} pts
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-600">
          {me_rank != null
            ? soloOrTiny
              ? "You're first in — invite friends to make it a race"
              : `You're #${me_rank} of ${member_count} · ranked by Weekly Health Span Score`
            : "Ranked by Weekly Health Span Score — sleep, steps & movement, straight from your wearable"}
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
        <span className={`text-gray-600 text-xs transition-transform ${showScoring ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {showScoring && (
        <div className="px-4 pb-4 pt-1 bg-gray-50/60 border-t border-gray-100">
          {/* ── Primary: Health Span Score (updated for v2 sensor-only,
              David 2026-08-28 — the old explainer described engagement
              points as "how scoring works", which stopped being true
              when ranking moved to Health Span). ── */}
          <p className="text-[11px] text-gray-600 mb-2 leading-relaxed">
            <span className="font-semibold text-gray-800">Ranked by Weekly Health Span Score</span> —
            built automatically from your wearable. Nothing you log (or forget to log) changes it:
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {[
              { icon: "😴", label: "Sleep hours",  rule: "7–9 h avg · up to 15" },
              { icon: "🕐", label: "Sleep timing", rule: "±30 min bedtime · up to 10" },
              { icon: "👟", label: "Daily steps",  rule: "7–8k avg · up to 10" },
              { icon: "🏃", label: "Active days",  rule: "4+ days moving · up to 15" },
            ].map(b => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px]"
              >
                <span>{b.icon}</span>
                <span className="font-medium text-gray-700">{b.label}</span>
                <span className="font-semibold text-[#1B3829]">{b.rule}</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
            Normalized to 100 across whichever bands your devices provide — Oura and
            Apple Health users compete on equal footing. Walks, classes, and detected
            activity all count toward active days.
          </p>

          {/* Engagement-points tiebreaker section removed entirely
              (David 2026-08-31): the points machinery still breaks exact
              Health Span ties server-side, but explaining it here dragged
              the panel back into "log stuff for points" territory the
              sensor-only score was built to escape. */}
        </div>
      )}
    </section>
  );
}
