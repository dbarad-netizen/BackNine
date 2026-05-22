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

      {/* Pill — matches the meal / workout / body & weight quick actions. */}
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-2xl border border-[#1B3829]/25 bg-white text-sm font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <span className="text-base leading-none">🏅</span>
        Achievements
        {level && (
          <span className="text-[10px] font-bold text-[#1B3829] bg-[#1B3829]/10 rounded px-1.5 py-0.5 whitespace-nowrap">
            Lv {level.level}
          </span>
        )}
        <span className="text-xs font-normal text-[#1B3829]/50">· {data.earned_count}/{data.total}</span>
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
