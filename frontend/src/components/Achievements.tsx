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
import { api, type AchievementsResponse, type Badge, type LevelInfo } from "@/lib/api";

/** Friendly "when earned" label from an ISO timestamp. */
function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Progress ratio for a locked badge (0 when it has no progress meter). */
function ratio(b: Badge): number {
  return b.progress && b.progress.target > 0 ? b.progress.current / b.progress.target : 0;
}

export default function Achievements() {
  const [data, setData]   = useState<AchievementsResponse | null>(null);
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    api.achievements().then(setData).catch(() => {});
  }, []);

  if (!data || data.total === 0) return null;

  const earned = data.badges.filter(b => b.earned);
  const justUnlocked = data.badges.filter(b => data.newly_unlocked.includes(b.id));
  // Most-recent earned first (earned_at desc; nulls last).
  const recent = [...earned].sort((a, b) =>
    (b.earned_at || "").localeCompare(a.earned_at || "")).slice(0, 6);
  const latest = recent[0] ?? null;
  // The locked badge you're closest to unlocking — makes "what's next" feel
  // intentional and shows it's within reach, instead of a wall of mystery badges.
  const locked = data.badges.filter(b => !b.earned);
  const nextUp = locked.length
    ? locked.reduce((best, b) => (ratio(b) > ratio(best) ? b : best))
    : null;
  const remaining = data.total - data.earned_count;
  const level = data.level ?? null;
  const newlyXp = data.newly_xp ?? 0;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Level hero — the gamification centerpiece */}
      <div className="px-4 py-4" style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full bg-white/15 border border-white/30 flex flex-col items-center justify-center shrink-0 leading-none">
              <span className="text-[8px] text-white/70 font-semibold tracking-wider">LVL</span>
              <span className="text-white font-bold text-base">{level?.level ?? 1}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight truncate">{level?.title ?? "Rookie"}</p>
              <p className="text-white/60 text-[10px] uppercase tracking-widest">
                {data.earned_count}/{data.total} badges earned
              </p>
            </div>
          </div>
          <button onClick={() => setOpen(true)} className="text-[11px] text-white/80 font-semibold hover:text-white shrink-0">
            All →
          </button>
        </div>

        {/* XP progress to next level */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-white/70 mb-1">
            <span className="font-semibold">{(level?.xp ?? 0).toLocaleString()} XP</span>
            <span>
              {level?.is_max
                ? "Max level reached 🏅"
                : `${(level?.xp_for_next ?? 0).toLocaleString()} XP to ${level?.next_title ?? "next level"}`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all"
              style={{ width: `${level?.pct ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {justUnlocked.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
          <p className="text-[12px] text-amber-800 font-semibold">
            🎉 Just unlocked: {justUnlocked.map(b => `${b.emoji} ${b.name}`).join(", ")}
            {newlyXp > 0 && <span className="text-amber-700"> &nbsp;+{newlyXp} XP</span>}
          </p>
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        {/* Next up — the closest badge, with its XP reward + progress */}
        {nextUp ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">Next up</p>
              {!!nextUp.xp && (
                <span className="text-[10px] font-bold text-[#2D6A4F] bg-[#2D6A4F]/10 rounded-full px-2 py-0.5">
                  +{nextUp.xp} XP
                </span>
              )}
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none shrink-0 grayscale opacity-50">{nextUp.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-gray-700 truncate">{nextUp.name}</p>
                <p className="text-[11px] text-gray-500 leading-snug">{nextUp.description}</p>
                {nextUp.progress && nextUp.progress.target > 0 && (
                  <div className="mt-1.5">
                    <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-full rounded-full bg-[#2D6A4F]"
                        style={{ width: `${Math.min(100, Math.round(ratio(nextUp) * 100))}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {nextUp.progress.current} / {nextUp.progress.target}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          earned.length > 0 && (
            <p className="text-[12px] text-[#2D6A4F] font-semibold">🎉 Every badge unlocked — you&apos;ve done it all.</p>
          )
        )}

        {/* Latest unlock */}
        {latest && (
          <div className="flex items-center gap-3 rounded-xl bg-[#1B3829]/5 border border-[#1B3829]/10 px-3 py-2">
            <span className="text-xl leading-none shrink-0">{latest.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gray-900 truncate">Latest: {latest.name}</p>
              <p className="text-[10px] text-gray-400 truncate">{latest.description}</p>
            </div>
            <span className="text-[10px] text-[#2D6A4F] font-semibold shrink-0">
              ✓ {whenLabel(latest.earned_at) || "done"}
            </span>
          </div>
        )}

        {remaining > 0 && (
          <p className="text-[11px] text-gray-400">
            {remaining} more to unlock · <button onClick={() => setOpen(true)} className="text-[#1B3829] font-semibold hover:underline">see them all</button>
          </p>
        )}
      </div>

      {open && <AchievementsModal data={data} onClose={() => setOpen(false)} />}
    </section>
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
            <p className="text-[11px] text-gray-400">
              {data.earned_count} of {data.total} unlocked
              {data.level ? ` · ${data.level.xp.toLocaleString()} XP` : ""}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {Object.entries(grouped).map(([cat, badges]) => (
            <div key={cat}>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">{cat}</p>
              <div className="grid grid-cols-2 gap-2">
                {badges.map(b => (
                  <div key={b.id}
                    className={`rounded-xl border p-3 ${b.earned ? "border-[#1B3829]/20 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"}`}>
                    <div className="flex items-start gap-2">
                      <span className={`text-2xl leading-none ${b.earned ? "" : "grayscale opacity-40"}`}>{b.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`text-[13px] font-semibold leading-tight ${b.earned ? "text-gray-900" : "text-gray-500"}`}>{b.name}</p>
                          {!!b.xp && (
                            <span className={`text-[9px] font-bold shrink-0 rounded-full px-1.5 py-0.5 ${b.earned ? "text-[#2D6A4F] bg-[#2D6A4F]/10" : "text-gray-400 bg-gray-200"}`}>
                              {b.xp} XP
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{b.description}</p>
                      </div>
                    </div>
                    {!b.earned && b.progress && b.progress.target > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full bg-[#2D6A4F]"
                            style={{ width: `${Math.min(100, Math.round((b.progress.current / b.progress.target) * 100))}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{b.progress.current} / {b.progress.target}</p>
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
