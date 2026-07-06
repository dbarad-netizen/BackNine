"use client";

/**
 * TrainingFlagCard — "something's off today" flag for the Training tab.
 *
 * Compact by default (a "🚑 Log injury / discomfort" pill). Taps to
 * expand into a quick form: flag type + body area + severity 1-3 + notes.
 *
 * Once a flag is set for today, the pill turns into an active-flag
 * banner ("Recovery day active — right shoulder / severity 2") that the
 * user can dismiss to remove the flag.
 *
 * Flows into today_workout's injury directive AND ai_context, so:
 *   • Today's workout will pivot to a recovery/mobility session for
 *     severity 2+ or injury/illness.
 *   • Coach Al acknowledges the flag by name in chat + briefing.
 */

import { useEffect, useState } from "react";
import { api, type TrainingFlag } from "@/lib/api";

const FLAG_TYPES: { value: TrainingFlag["flag_type"]; label: string; emoji: string }[] = [
  { value: "discomfort", label: "Discomfort", emoji: "😬" },
  { value: "injury",     label: "Injury",     emoji: "🚑" },
  { value: "illness",    label: "Sick",       emoji: "🤒" },
  { value: "fatigue",    label: "Fatigue",    emoji: "😴" },
];

const SEVERITY_LABEL: Record<number, string> = { 1: "Mild", 2: "Moderate", 3: "Severe" };

export default function TrainingFlagCard() {
  const [today, setToday] = useState<TrainingFlag | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [flagType, setFlagType] = useState<TrainingFlag["flag_type"]>("discomfort");
  const [bodyArea, setBodyArea] = useState("");
  const [severity, setSeverity] = useState<number>(1);
  const [notes, setNotes]       = useState("");

  useEffect(() => {
    let cancelled = false;
    api.todayTrainingFlag()
      .then(r => { if (!cancelled) setToday(r.flag); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.createTrainingFlag({
        flag_type: flagType,
        body_area: bodyArea.trim() || undefined,
        severity,
        notes: notes.trim() || undefined,
      });
      setToday(r.flag);
      setExpanded(false);
      // Reset form
      setBodyArea(""); setNotes(""); setSeverity(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!today) return;
    setBusy(true); setError(null);
    try {
      await api.deleteTrainingFlag(today.id);
      setToday(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't clear.");
    } finally { setBusy(false); }
  };

  // Active flag today → banner
  if (today) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800">
              🚑 Recovery mode
            </p>
            <p className="text-sm font-semibold text-amber-900 mt-0.5 leading-tight">
              {FLAG_TYPES.find(f => f.value === today.flag_type)?.label ?? today.flag_type}
              {today.body_area && <> · {today.body_area}</>}
              {today.severity != null && <> · {SEVERITY_LABEL[today.severity]}</>}
            </p>
            {today.notes && (
              <p className="text-[11px] text-amber-800 leading-snug mt-1 italic">{today.notes}</p>
            )}
            <p className="text-[11px] text-amber-800 leading-snug mt-1">
              Coach Al will steer clear of this area today.
            </p>
          </div>
          <button
            onClick={clear}
            disabled={busy}
            className="shrink-0 text-[11px] font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-2 disabled:opacity-40"
          >
            {busy ? "…" : "Clear"}
          </button>
        </div>
      </section>
    );
  }

  // Compact pill
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full py-2.5 rounded-2xl border border-amber-200 bg-white text-sm font-semibold text-amber-800 hover:bg-amber-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <span className="text-base leading-none">🚑</span>
        Log injury / discomfort today
      </button>
    );
  }

  // Expanded form
  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800">
            Today's flag
          </p>
          <h3 className="text-sm font-bold text-gray-900 mt-0.5">What's going on?</h3>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-gray-500 hover:text-gray-900 text-lg leading-none px-1"
        >×</button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {FLAG_TYPES.map(f => (
          <button
            key={f.value}
            onClick={() => setFlagType(f.value)}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[11px] font-medium border transition-colors ${
              flagType === f.value
                ? "bg-amber-50 border-amber-300 text-amber-900"
                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            <span className="text-base leading-none">{f.emoji}</span>
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      <label className="block text-[11px] text-gray-600">
        Body area (optional)
        <input
          type="text"
          value={bodyArea}
          onChange={e => setBodyArea(e.target.value)}
          placeholder="e.g. right shoulder, lower back"
          className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5"
        />
      </label>

      <div>
        <p className="text-[11px] text-gray-600 mb-1">Severity</p>
        <div className="flex gap-1.5">
          {[1, 2, 3].map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold ${
                severity === s
                  ? "bg-amber-50 border-amber-300 text-amber-900"
                  : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-[11px] text-gray-600">
        Notes (optional)
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. tweaked it yesterday deadlifting"
          className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5"
        />
      </label>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">{error}</p>
      )}

      <button
        onClick={submit}
        disabled={busy}
        className="w-full text-sm font-semibold py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Flag today"}
      </button>
    </section>
  );
}
