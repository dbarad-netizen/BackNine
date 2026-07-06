"use client";

/**
 * SleepQuickLogCard — empty-state manual sleep entry for users whose
 * device isn't on the direct integration list (Whoop, Garmin, Fitbit,
 * Polar, etc.).
 *
 * Design principles (from Fable v2 + the manual-entry decision):
 *   • Only appears when we have NO sleep data for last night from any
 *     source. The moment any device syncs, the card disappears and
 *     never nags.
 *   • Two fields only: hours + how it felt (1–5). NO HRV / RHR /
 *     sleep-score entry — those aren't cross-device comparable and
 *     would corrupt the Longevity Score.
 *   • Optional device tag ("from my Whoop" / etc.) is informational
 *     only. Helps us understand which devices are underserved.
 *   • Framed as a one-tap morning action, not a daily habit.
 *
 * Renders nothing when parent tells us sleep was found — the card
 * self-hides so we never render filler.
 */

import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  /** Parent hides the card when true (sleep data already exists for last night). */
  hasSleepAlready: boolean;
  /** Callback the parent uses to refresh dashboard after a successful save. */
  onSaved?: () => void;
}

const DEVICE_TAGS = [
  { value: "",         label: "Not sure / other" },
  { value: "whoop",    label: "Whoop" },
  { value: "garmin",   label: "Garmin" },
  { value: "fitbit",   label: "Fitbit" },
  { value: "polar",    label: "Polar" },
  { value: "samsung",  label: "Samsung / Galaxy Watch" },
  { value: "pixel",    label: "Google / Pixel Watch" },
  { value: "estimate", label: "Just my own estimate" },
];

const QUALITY_LABELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: "😩", label: "Rough" },
  2: { emoji: "😕", label: "Below par" },
  3: { emoji: "😐", label: "Fine"    },
  4: { emoji: "🙂", label: "Solid"   },
  5: { emoji: "😴", label: "Great"   },
};

export default function SleepQuickLogCard({ hasSleepAlready, onSaved }: Props) {
  const [hours,    setHours]    = useState<string>("");
  const [quality,  setQuality]  = useState<number | null>(null);
  const [device,   setDevice]   = useState<string>("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Compact mode: when sleep data already exists, render as a small
  // "+ Log sleep manually" pill that expands into the full form when
  // tapped. This gives every user a persistent path to manual entry —
  // Chris (the Whoop user David flagged) never found the input because
  // the card was empty-state only. When there's no sleep yet, the form
  // stays open by default (compactMode starts false).
  const [compactMode, setCompactMode] = useState(hasSleepAlready);

  if (dismissed) return null;

  // Compact pill: rendered when sleep already exists for last night.
  // Tap to expand into the full form (useful for backfilling a
  // different night, correcting a bad reading, etc.).
  if (compactMode) {
    return (
      <button
        id="sleep-quick-log"
        onClick={() => setCompactMode(false)}
        className="w-full py-2.5 rounded-2xl border border-sky-200 bg-white text-sm font-semibold text-sky-800 hover:bg-sky-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <span className="text-base leading-none">💤</span>
        Log sleep manually
        <span className="text-xs font-normal text-sky-800/70">
          · from a different device or night
        </span>
      </button>
    );
  }

  const submit = async () => {
    setError(null);
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0 || h > 14) {
      setError("Enter hours between 0.5 and 14.");
      return;
    }
    setBusy(true);
    try {
      await api.logManualSleep({
        hours:      h,
        quality:    quality || undefined,
        device_tag: device || undefined,
      });
      setDismissed(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again in a moment.");
    } finally { setBusy(false); }
  };

  return (
    <section
      id="sleep-quick-log"
      className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white p-4 shadow-sm space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-800">
            💤 No sleep data yet
          </p>
          <h3 className="text-base font-bold text-[#1B3829] mt-0.5 leading-tight">
            Log last night&rsquo;s sleep
          </h3>
          <p className="text-[11px] text-gray-600 leading-snug mt-0.5">
            Uses your Whoop / Garmin / Fitbit / Polar reading. Skip HRV or scores &mdash; we&rsquo;ll pick those
            up automatically when you connect Apple Health or Oura.
          </p>
        </div>
        <button
          onClick={() => hasSleepAlready ? setCompactMode(true) : setDismissed(true)}
          className="shrink-0 text-gray-500 hover:text-gray-900 text-lg leading-none px-1"
          title={hasSleepAlready ? "Collapse this card" : "Hide this card"}
          aria-label="Close sleep log card"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-600">
          Hours slept
          <input
            type="number"
            step="0.25"
            min="0.5"
            max="14"
            placeholder="e.g. 7.25"
            value={hours}
            onChange={e => setHours(e.target.value)}
            className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white"
          />
        </label>
        <label className="text-[11px] text-gray-600">
          From your
          <select
            value={device}
            onChange={e => setDevice(e.target.value)}
            className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white"
          >
            {DEVICE_TAGS.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-[11px] text-gray-600 mb-1">How did it feel? (optional)</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(q => {
            const active = quality === q;
            const meta   = QUALITY_LABELS[q];
            return (
              <button
                key={q}
                onClick={() => setQuality(active ? null : q)}
                title={meta.label}
                className={`flex-1 py-1.5 rounded-lg border transition-colors text-lg ${
                  active
                    ? "border-[#1B3829] bg-[#1B3829]/8"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                {meta.emoji}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !hours}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40 transition-colors"
        >
          {busy ? "Saving…" : "Save last night"}
        </button>
        <p className="text-[10px] text-gray-500 leading-snug">
          Your entry disappears the next time a device syncs.
        </p>
      </div>
    </section>
  );
}
