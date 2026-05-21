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

  const earned = data.badges.filter(b => b.earned);
  const justUnlocked = data.badges.filter(b => data.newly_unlocked.includes(b.id));
  // Most-recent earned first (earned_at desc; nulls last).
  const recent = [...earned].sort((a, b) =>
    (b.earned_at || "").localeCompare(a.earned_at || "")).slice(0, 6);

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-50">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Achievements</h3>
          <span className="text-[11px] font-bold text-[#1B3829]">{data.earned_count}/{data.total}</span>
        </div>
        <button onClick={() => setOpen(true)} className="text-[11px] text-[#1B3829] font-semibold hover:underline">
          View all →
        </button>
      </div>

      {justUnlocked.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
          <p className="text-[12px] text-amber-800 font-semibold">
            🎉 Just unlocked: {justUnlocked.map(b => `${b.emoji} ${b.name}`).join(", ")}
          </p>
        </div>
      )}

      <div className="px-4 py-3">
        {earned.length === 0 ? (
          <p className="text-[13px] text-gray-500">
            No badges yet — check in, log a workout, or connect a friend to start unlocking them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recent.map(b => (
              <span key={b.id} title={`${b.name} — ${b.description}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1B3829]/5 border border-[#1B3829]/10 px-2.5 py-1">
                <span className="text-base leading-none">{b.emoji}</span>
                <span className="text-[12px] font-medium text-gray-700">{b.name}</span>
              </span>
            ))}
          </div>
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
            <h2 className="text-sm font-bold text-gray-900">Achievements</h2>
            <p className="text-[11px] text-gray-400">{data.earned_count} of {data.total} unlocked</p>
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
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold leading-tight ${b.earned ? "text-gray-900" : "text-gray-500"}`}>{b.name}</p>
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
