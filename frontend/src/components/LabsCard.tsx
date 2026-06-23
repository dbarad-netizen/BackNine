"use client";

/**
 * LabsCard — recent clinical lab results on the Nutrition tab.
 *
 * Holds the lab values a primary-care or specialist visit produces (PSA,
 * lipid panel, A1c, testosterone, TSH, CBC, etc.). Surfaced in the Annual
 * Physical Snapshot report so the user can hand a printed copy to their
 * doctor at the next visit.
 *
 * Shape per entry: { name, value, unit, date, reference_range, notes }.
 * Value is stored as a string so report values like "<0.1" preserve as-is.
 *
 * Default ordering: most recent date first, then alphabetical by name.
 */

import { useMemo, useState } from "react";
import type { LabResult } from "@/lib/api";

interface Props {
  labs:   LabResult[];
  onSave: (next: LabResult[]) => Promise<void>;
}

type Draft = {
  name:            string;
  value:           string;
  unit:            string;
  date:            string;
  reference_range: string;
  notes:           string;
};

const EMPTY_DRAFT: Draft = { name: "", value: "", unit: "", date: "", reference_range: "", notes: "" };

const inp =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

// Common-for-men-50+ lab presets — datalist hints help typing accuracy
// without forcing a fixed schema (users will add labs we didn't predict).
const COMMON_LABS = [
  "PSA", "Total Cholesterol", "LDL", "HDL", "Triglycerides", "Non-HDL",
  "ApoB", "Lp(a)", "HbA1c", "Fasting Glucose", "Insulin", "HOMA-IR",
  "Testosterone (Total)", "Testosterone (Free)", "TSH", "Free T4",
  "Free T3", "Vitamin D", "B12", "Ferritin", "Creatinine", "eGFR",
  "ALT", "AST", "GGT", "CRP (hs-CRP)", "Homocysteine", "Uric Acid",
];

const COMMON_UNITS = [
  "ng/mL", "mg/dL", "%", "ng/dL", "mIU/L", "pg/mL", "IU/mL", "umol/L",
  "U/L", "mmol/L", "mg/L",
];

export default function LabsCard({ labs, onSave }: Props) {
  // Editing index: null = closed, -1 = adding new, ≥0 = editing existing.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft]     = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Sort newest-first by date, with undated falling to the bottom.
  const sorted = useMemo(() => {
    return [...labs].sort((a, b) => {
      const ad = a.date || "0000-00-00";
      const bd = b.date || "0000-00-00";
      if (ad !== bd) return ad < bd ? 1 : -1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [labs]);

  const openAdd = () => {
    setEditing(-1);
    setDraft({ ...EMPTY_DRAFT, date: new Date().toISOString().slice(0, 10) });
    setError(null);
  };

  // We track edits against the ORIGINAL array order; sorted is for display.
  const openEdit = (origIndex: number) => {
    const l = labs[origIndex];
    setEditing(origIndex);
    setDraft({
      name:            l.name            ?? "",
      value:           l.value           ?? "",
      unit:            l.unit            ?? "",
      date:            l.date            ?? "",
      reference_range: l.reference_range ?? "",
      notes:           l.notes           ?? "",
    });
    setError(null);
  };

  const closeForm = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const persist = async (next: LabResult[]) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const name = draft.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    const clean: LabResult = {
      name,
      value:           draft.value.trim()           || undefined,
      unit:            draft.unit.trim()            || undefined,
      date:            draft.date.trim()            || undefined,
      reference_range: draft.reference_range.trim() || undefined,
      notes:           draft.notes.trim()           || undefined,
    };
    const next = [...labs];
    if (editing === -1) next.push(clean);
    else if (typeof editing === "number" && editing >= 0) next[editing] = clean;
    await persist(next);
  };

  const handleDelete = async (origIndex: number) => {
    const next = labs.filter((_, idx) => idx !== origIndex);
    await persist(next);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Labs</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Recent blood work and panel results. Surfaced in the Annual Physical report.
          </p>
        </div>
        {editing === null && (
          <button
            onClick={openAdd}
            className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      {labs.length === 0 && editing === null && (
        <p className="text-xs text-gray-600 italic">
          No labs entered yet. Tap Add and copy the values from your most recent panel.
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="space-y-1.5">
          {sorted.map((l) => {
            const i = labs.indexOf(l);
            return (
              <li
                key={`${l.name}-${l.date ?? ""}-${i}`}
                className={`rounded-xl border px-3 py-2 ${
                  editing === i ? "border-[#1B3829]/40 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"
                }`}
              >
                {editing === i ? (
                  <LabForm
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={handleSubmit}
                    onCancel={closeForm}
                    saving={saving}
                    error={error}
                    submitLabel="Save"
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-semibold">{l.name}</span>
                        {l.value && (
                          <span className="ml-2 font-mono text-gray-900">
                            {l.value}
                            {l.unit && <span className="text-gray-600 ml-0.5">{l.unit}</span>}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-600">
                        {l.date && <span>{l.date}</span>}
                        {l.reference_range && (
                          <span>{l.date ? " · " : ""}ref {l.reference_range}</span>
                        )}
                      </p>
                      {l.notes && (
                        <p className="text-[11px] text-gray-600 mt-0.5 leading-snug italic">{l.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openEdit(i)}
                        className="text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(i)}
                        className="text-gray-600 hover:text-red-400 transition-colors text-base leading-none"
                        title="Remove"
                        aria-label={`Remove ${l.name}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing === -1 && (
        <div className="mt-3 rounded-xl border border-[#1B3829]/40 bg-[#1B3829]/5 px-3 py-2.5">
          <LabForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            saving={saving}
            error={error}
            submitLabel="Add lab"
          />
        </div>
      )}

      {/* Lightweight datalist hints — most common labs / units */}
      <datalist id="labs-name-suggest">
        {COMMON_LABS.map(n => <option key={n} value={n} />)}
      </datalist>
      <datalist id="labs-unit-suggest">
        {COMMON_UNITS.map(u => <option key={u} value={u} />)}
      </datalist>
    </section>
  );
}

function LabForm({
  draft, setDraft, onSubmit, onCancel, saving, error, submitLabel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  submitLabel: string;
}) {
  return (
    <div className="space-y-2">
      <input
        className={inp}
        list="labs-name-suggest"
        placeholder="Name (e.g. PSA, LDL, HbA1c)"
        maxLength={80}
        value={draft.name}
        onChange={e => setDraft({ ...draft, name: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          className={inp}
          placeholder="Value (e.g. 3.2, <0.1)"
          maxLength={40}
          value={draft.value}
          onChange={e => setDraft({ ...draft, value: e.target.value })}
        />
        <input
          className={inp}
          list="labs-unit-suggest"
          placeholder="Unit (e.g. ng/mL)"
          maxLength={20}
          value={draft.unit}
          onChange={e => setDraft({ ...draft, unit: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <input
          className={inp}
          type="date"
          placeholder="Date drawn"
          value={draft.date}
          onChange={e => setDraft({ ...draft, date: e.target.value })}
        />
        <input
          className={inp}
          placeholder="Reference range (e.g. <4.0)"
          maxLength={40}
          value={draft.reference_range}
          onChange={e => setDraft({ ...draft, reference_range: e.target.value })}
        />
      </div>
      <input
        className={inp}
        placeholder="Notes (lab name, doctor, fasting status, etc.)"
        maxLength={200}
        value={draft.notes}
        onChange={e => setDraft({ ...draft, notes: e.target.value })}
      />
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={saving || !draft.name.trim()}
          className="px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
