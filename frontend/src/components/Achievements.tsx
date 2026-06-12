"use client";

/**
 * Achievements — Scorecard card + full-grid modal of unlockable badges.
 *
 * Pulls /api/achievements (which also persists any newly-earned badges). The
 * card shows your earned count + most recent badges and celebrates anything
 * just unlocked; "View all" opens the full grid grouped by category, with
 * progress bars on locked tiered badges.
 */

import { useEffect, useMemo, useState } from "react";
import { api, type AchievementsResponse, type Badge } from "@/lib/api";

export default function Achievements() {
  const [data, setData]   = useState<AchievementsResponse | null>(null);
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    api.achievements().then(setData).catch(() => {});
  }, []);

  // "Next up" — the locked badge closest to unlocking. Picks the one with the
  // highest progress ratio so the user sees an attainable goal, not a moonshot.
  // Falls back to null if no locked badges have measurable progress (early
  // user with no streaks / counts yet, or all badges already unlocked).
  //
  // IMPORTANT: this useMemo must run on every render of this component,
  // BEFORE any conditional early return — Rules of Hooks. The previous
  // version had the early return on top, which made React throw "rendered
  // more hooks than during the previous render" once `data` populated and
  // crashed the whole dashboard. Don't move this back below the early return.
  const nextUp = useMemo(() => {
    if (!data) return null;
    const candidates = data.badges.filter(b =>
      !b.earned
      && b.progress
      && b.progress.target > 0
      && b.progress.current < b.progress.target
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const ra = (a.progress!.current / a.progress!.target);
      const rb = (b.progress!.current / b.progress!.target);
      return rb - ra;
    });
    return candidates[0];
  }, [data]);

  if (!data || data.total === 0) return null;

  const justUnlocked = data.badges.filter(b => data.newly_unlocked.includes(b.id));
  const level = data.level ?? null;
  const newlyXp = data.newly_xp ?? 0;

  return (
    <>
      {/* Just-unlocked celebration stays — the moment matters. */}
      {justUnlocked.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm">
          <p className="text-[12px] text-amber-800 font-semibold text-center">
            🎉 Just unlocked: {justUnlocked.map(b => `${b.emoji} ${b.name}`).join(", ")}
            {newlyXp > 0 && <span className="text-amber-700"> &nbsp;+{newlyXp} XP</span>}
          </p>
        </div>
      )}

      {/* Scorecard card — "Next up" view. Gives a concrete goal (badge + how
          many more of X) rather than a vague badge count. Tap to open the
          full grid in the modal. */}
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-2xl border border-[#1B3829]/15 bg-white p-4 hover:bg-[#1B3829]/5 transition-colors shadow-sm"
        aria-label="Open achievements"
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">
            Next up
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {level && (
              <span className="text-[10px] font-bold text-[#1B3829] bg-[#1B3829]/10 rounded px-1.5 py-0.5">
                Lv {level.level}{level.title ? ` · ${level.title}` : ""}
              </span>
            )}
            <span className="text-[10px] text-gray-500">{data.earned_count}/{data.total}</span>
          </div>
        </div>

        {nextUp && nextUp.progress ? (() => {
          const { current, target } = nextUp.progress;
          const pct       = Math.min(100, Math.round((current / target) * 100));
          const remaining = Math.max(0, target - current);
          // Tighter, action-flavored copy than the raw `description` field, but
          // fall through to the description if we can't extract a unit cleanly.
          const action = nextUp.description || `${remaining} more to unlock`;
          return (
            <>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-2xl shrink-0" aria-hidden>{nextUp.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{nextUp.name}</p>
                  <p className="text-[11px] text-gray-600 truncate">{action}</p>
                </div>
                <span className="text-[11px] font-semibold text-[#1B3829] tabular-nums shrink-0">
                  {current}/{target}
                </span>
              </div>
              {/* Badge progress bar */}
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#2D6A4F] to-[#3a8a63] transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {level && !level.is_max && (
                <p className="text-[10px] text-gray-500 mt-1.5">
                  {level.xp_for_next.toLocaleString()} XP to Level {level.level + 1}
                  {level.next_title ? ` · ${level.next_title}` : ""}
                </p>
              )}
            </>
          );
        })() : level && !level.is_max ? (
          // No tiered-badge progress to highlight — fall back to level progress.
          <>
            <p className="text-sm font-semibold text-gray-900 mb-1.5">
              {level.xp_for_next.toLocaleString()} XP to Level {level.level + 1}
              {level.next_title ? <span className="text-gray-600 font-normal"> · {level.next_title}</span> : null}
            </p>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#2D6A4F] to-[#3a8a63] transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, level.pct))}%` }}
              />
            </div>
          </>
        ) : (
          // Edge case: max level + no in-progress badges. Just acknowledge.
          <p className="text-sm font-semibold text-gray-900">
            🏆 You&apos;ve unlocked every badge available. Look at you.
          </p>
        )}
      </button>

      {open && <AchievementsModal data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function AchievementsModal({ data, onClose }: { data: AchievementsResponse; onClose: () => void }) {
  const grouped = useMemo(() => {
    const g: Record<string, Badge[]> = {};
    for (const b of data.badges) (g[b.category] ||= []).push(b);
    return g;
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">
              {data.level ? `Level ${data.level.level} · ${data.level.title}` : "Achievements"}
            </h2>
            <p className="text-[11px] text-gray-600">
              {data.earned_count} of {data.total} unlocked
              {data.level ? ` · ${data.level.xp.toLocaleString()} XP` : ""}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 hover:text-gray-700 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {Object.entries(grouped).map(([cat, badges]) => (
            <div key={cat}>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">{cat}</p>
              <div className="grid grid-cols-2 gap-2">
                {badges.map(b => (
                  <div key={b.id}
                    className={`rounded-xl border p-3 ${b.earned ? "border-[#1B3829]/20 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"}`}>
                    <div className="flex items-start gap-2">
                      <span className={`text-2xl leading-none ${b.earned ? "" : "grayscale opacity-40"}`}>{b.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`text-[13px] font-semibold leading-tight ${b.earned ? "text-gray-900" : "text-gray-600"}`}>{b.name}</p>
                          {!!b.xp && (
                            <span className={`text-[9px] font-bold shrink-0 rounded-full px-1.5 py-0.5 ${b.earned ? "text-[#2D6A4F] bg-[#2D6A4F]/10" : "text-gray-600 bg-gray-200"}`}>
                              {b.xp} XP
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-600 leading-snug mt-0.5">{b.description}</p>
                      </div>
                    </div>
                    {!b.earned && b.progress && b.progress.target > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full bg-[#2D6A4F]"
                            style={{ width: `${Math.min(100, Math.round((b.progress.current / b.progress.target) * 100))}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-600 mt-0.5">{b.progress.current} / {b.progress.target}</p>
                      </div>
                    )}
                    {b.earned && (
                      <p className="text-[10px] text-[#2D6A4F] font-semibold mt-2">✓ Unlocked</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
