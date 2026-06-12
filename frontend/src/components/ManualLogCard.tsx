"use client";

/**
 * ManualLogCard — type-in-your-numbers daily log for users without a
 * connected device. Bridges the gap between "Apple Health auto-sync via HAE
 * or the Shortcut" (automated but requires setup) and "no data at all"
 * (useless). For users who'd rather just type in their iPhone Health numbers
 * each morning, this is the path.
 *
 * Partial submissions are fine — leave fields blank, only the ones with
 * values get sent.
 */

import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  /** Called after a successful log so the parent can refetch the dashboard. */
  onLogged?: () => void;
}

interface Draft {
  steps:               string;
  sleep_hours:         string;
  weight_lbs:          string;
  resting_hr:          string;
  hrv:                 string;
  active_calories:     string;
  body_fat_percentage: string;
}

const EMPTY: Draft = {
  steps: "", sleep_hours: "", weight_lbs: "",
  resting_hr: "", hrv: "", active_calories: "", body_fat_percentage: "",
};

const FIELDS: Array<{ key: keyof Draft; label: string; placeholder: string; step?: string }> = [
  { key: "steps",               label: "Steps",            placeholder: "8500" },
  { key: "sleep_hours",         label: "Sleep (hrs)",      placeholder: "7.5",   step: "0.1" },
  { key: "weight_lbs",          label: "Weight (lbs)",     placeholder: "182.3", step: "0.1" },
  { key: "resting_hr",          label: "Resting HR",       placeholder: "58" },
  { key: "hrv",                 label: "HRV (ms)",         placeholder: "42" },
  { key: "active_calories",     label: "Active cal",       placeholder: "420" },
  { key: "body_fat_percentage", label: "Body fat (%)",     placeholder: "18.2",  step: "0.1" },
];

export default function ManualLogCard({ onLogged }: Props) {
  const [open,    setOpen]    = useState(false);
  const [draft,   setDraft]   = useState<Draft>(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState<string | null>(null);   // success message
  const [error,   setError]   = useState<string | null>(null);

  const handleSubmit = async () => {
    // Coerce non-blank fields to numbers; skip anything left empty so the
    // user can log just steps and nothing else.
    const payload: Parameters<typeof api.manualLog>[0] = {};
    let count = 0;
    for (const f of FIELDS) {
      const raw = draft[f.key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (isNaN(n)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload as any)[f.key] = n;
      count++;
    }
    if (count === 0) {
      setError("Enter at least one value");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await api.manualLog(payload);
      setSaved(`✓ Logged ${res.fields_logged.length} value${res.fields_logged.length === 1 ? "" : "s"}`);
      setDraft(EMPTY);
      onLogged?.();
      // Auto-close after success so it doesn't sit half-open.
      setTimeout(() => { setSaved(null); setOpen(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  // Collapsed view — a single pill that matches the other Scorecard quick-actions.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-2xl border border-[#1B3829]/25 bg-white text-sm font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <span className="text-base leading-none">✏️</span>
        Log today&apos;s stats
        <span className="text-[10px] font-normal text-[#1B3829]/50">· no device needed</span>
      </button>
    );
  }

  // Expanded form
  return (
    <section className="rounded-2xl border border-[#1B3829]/25 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">Log today&apos;s stats</p>
          <p className="text-[11px] text-gray-600">Fill in what you know — anything blank is skipped.</p>
        </div>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-gray-500 hover:text-gray-900 text-base leading-none px-1"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(f => (
          <label key={f.key} className="block">
            <span className="text-[10px] text-gray-600 uppercase tracking-wide">{f.label}</span>
            <input
              type="number"
              inputMode="decimal"
              step={f.step || "1"}
              placeholder={f.placeholder}
              value={draft[f.key]}
              onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500"
            />
          </label>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-emerald-700 font-semibold">{saved}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setDraft(EMPTY)}
          disabled={saving}
          className="flex-1 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-900 text-sm font-medium"
        >
          Clear
        </button>
      </div>

      <p className="text-[10px] text-gray-500">
        Tip: open the iPhone Health app and copy today&apos;s numbers across. Takes 30 seconds.
      </p>
    </section>
  );
}
