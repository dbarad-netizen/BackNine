"use client";

/**
 * ActivityTimelineCard — "This Week's Activity" on the Scorecard.
 *
 * The unified feed David asked for repeatedly: everything from Oura +
 * manual logs in one place — detected workouts (walks, Pilates,
 * strength), sessions (meditation, breathing), naps, and lifestyle
 * tags (sauna, cryotherapy, hot bath, CPAP).
 *
 * Grouped by day, newest first. Self-hides when empty.
 * David 2026-08-11, task #184.
 */

import { useEffect, useState } from "react";
import { api, type ActivityTimelineItem } from "@/lib/api";

function dayLabel(iso: string): string {
  const today = new Date();
  const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, "0"),
        d = String(today.getDate()).padStart(2, "0");
  const todayIso = `${y}-${m}-${d}`;
  const yd = new Date(today); yd.setDate(yd.getDate() - 1);
  const ydIso = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
  if (iso === todayIso) return "Today";
  if (iso === ydIso)    return "Yesterday";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function detail(it: ActivityTimelineItem): string {
  const bits: string[] = [];
  if (it.duration_min)    bits.push(`${it.duration_min} min`);
  if (it.distance_meters) bits.push(`${(it.distance_meters / 1609.34).toFixed(1)} mi`);
  if (it.avg_hr)          bits.push(`${it.avg_hr} bpm avg`);
  if (it.calories_kcal)   bits.push(`${it.calories_kcal} kcal`);
  if (it.notes)           bits.push(it.notes);
  return bits.join(" · ");
}

export default function ActivityTimelineCard() {
  const [items, setItems]     = useState<ActivityTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.activityTimeline(7)
      .then(r => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || items.length === 0) return null;

  // Group by date
  const byDay = new Map<string, ActivityTimelineItem[]>();
  for (const it of items) {
    if (!it.date) continue;
    if (!byDay.has(it.date)) byDay.set(it.date, []);
    byDay.get(it.date)!.push(it);
  }
  const days = Array.from(byDay.keys()).sort().reverse();
  const visibleDays = expanded ? days : days.slice(0, 3);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          This Week&rsquo;s Activity
        </p>
        <span className="text-[11px] text-gray-500">
          {items.length} event{items.length !== 1 ? "s" : ""} · 7 days
        </span>
      </div>

      <div className="space-y-3">
        {visibleDays.map(day => (
          <div key={day}>
            <p className="text-[11px] font-semibold text-gray-800 mb-1">{dayLabel(day)}</p>
            <div className="space-y-1">
              {byDay.get(day)!.map((it, i) => (
                <div key={`${day}-${i}`} className="flex items-center gap-2.5 rounded-lg bg-gray-50/70 px-2.5 py-1.5">
                  <span className="text-base leading-none shrink-0" aria-hidden>{it.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-medium text-gray-900">{it.label}</span>
                    {detail(it) && (
                      <span className="text-[11px] text-gray-600"> — {detail(it)}</span>
                    )}
                  </div>
                  <span
                    className="text-[9px] shrink-0 opacity-60"
                    title={it.source === "oura" ? "From your Oura Ring" : "Logged manually"}
                  >
                    {it.source === "oura" ? "💍" : "✍️"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {days.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          {expanded ? "▲ Show less" : `▼ Show all ${days.length} days`}
        </button>
      )}
    </section>
  );
}
