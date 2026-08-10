"use client";

/**
 * BackfillDatePicker — shared "log for a past day" chip used across every
 * logging surface (Stack Adherence, Meals, Workouts, CPAP).
 *
 * UX: compact dropdown that reads "Log for: Today ▾". Tap to open a
 * short list of the last N days (default 7). Selecting a past day
 * re-scopes the surrounding form to that date; the parent's onChange
 * receives the new ISO date string (YYYY-MM-DD).
 *
 * Constraints:
 *   - Never lets the user pick a date more than `maxDaysBack` old
 *     (default 7). Beyond that, retrospective logging is guesswork
 *     more than signal, so we don't offer it.
 *   - Never lets the user pick a future date (there's nothing to log
 *     that hasn't happened yet).
 *   - Uses the user's LOCAL date (not UTC), so "today" matches what
 *     they see on their phone.
 *
 * David 2026-08-07.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Currently selected date (YYYY-MM-DD). */
  value: string;
  /** Called with the new date when the user picks one. */
  onChange: (date: string) => void;
  /** Max days back to allow. Default 7. */
  maxDaysBack?: number;
  /** Optional label prefix shown before the date. Default "Log for:". */
  label?: string;
}

function localTodayIso(): string {
  const d = new Date();
  // toISOString would give UTC; slice off after building a local ISO.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function displayFor(iso: string): string {
  const today = localTodayIso();
  const yesterday = daysAgo(1);
  if (iso === today) return "Today";
  if (iso === yesterday) return "Yesterday";
  const d = new Date(iso + "T12:00:00"); // noon-local so weekday is stable
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

export default function BackfillDatePicker({
  value,
  onChange,
  maxDaysBack = 7,
  label = "Log for:",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPast = value !== localTodayIso();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const options = Array.from({ length: maxDaysBack + 1 }, (_, i) => daysAgo(i));

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
          isPast
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
        }`}
        title="Change which day this entry counts toward"
      >
        <span className="opacity-70">{label}</span>
        <span>{displayFor(value)}</span>
        <span className="opacity-60 text-[9px]">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 min-w-[10rem] rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
          {options.map(iso => (
            <button
              key={iso}
              type="button"
              onClick={() => { onChange(iso); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 ${
                iso === value ? "bg-emerald-50 font-semibold text-emerald-900" : "text-gray-800"
              }`}
            >
              {displayFor(iso)}
              <span className="ml-2 text-[10px] text-gray-500">{iso}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
