"use client";

/**
 * MedicationsCard — active prescription stack on the Nutrition tab.
 *
 * Same structural pattern as Supplements / Peptides — separate column on
 * user_profiles so clinicians scanning the Doctor's Report can clearly tell
 * Rx items from OTC supplements and peptides. Coach Al never recommends Rx
 * changes; this card is read-only context for him.
 *
 * Renders a tight list (name + dose/timing + optional notes) with inline add
 * / edit / delete. Designed to live alongside SupplementsCard and PeptidesCard
 * in the Nutrition tab so users build a complete stack in one place.
 */

import { useState } from "react";
import type { Medication } from "@/lib/api";

interface Props {
  medications: Medication[];
  onSave: (next: Medication[]) => Promise<void>;
}

type Draft = { name: string; dose: string; timing: string; notes: string };
const EMPTY_DRAFT: Draft = { name: "", dose: "", timing: "", notes: "" };

const inp =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

export default function MedicationsCard({ medications, onSave }: Props) {
  // Editing index: null = closed, -1 = adding new, ≥0 = editing existing.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft]     = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const openAdd = () => {
    setEditing(-1);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const openEdit = (i: number) => {
    const m = medications[i];
    setEditing(i);
    setDraft({
      name:   m.name   ?? "",
      dose:   m.dose   ?? "",
      timing: m.timing ?? "",
      notes:  m.notes  ?? "",
    });
    setError(null);
  };

  const closeForm = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const persist = async (next: Medication[]) => {
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
    const clean: Medication = {
      name,
      dose:   draft.dose.trim()   || undefined,
      timing: draft.timing.trim() || undefined,
      notes:  draft.notes.trim()  || undefined,
    };
    const next = [...medications];
    if (editing === -1) next.push(clean);
    else if (typeof editing === "number" && editing >= 0) next[editing] = clean;
    await persist(next);
  };

  const handleDelete = async (i: number) => {
    const next = medications.filter((_, idx) => idx !== i);
    await persist(next);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Medications</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Prescriptions you're taking. Surfaced in your Doctor&apos;s Report.
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

      {medications.length === 0 && editing === null && (
        <p className="text-xs text-gray-600 italic">
          No medications added yet. Tap Add to start tracking.
        </p>
      )}

      {medications.length > 0 && (
        <ul className="space-y-1.5">
          {medications.map((m, i) => (
            <li
              key={`${m.name}-${i}`}
              className={`rounded-xl border px-3 py-2 ${
                editing === i ? "border-[#1B3829]/40 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"
              }`}
            >
              {editing === i ? (
                <MedicationForm
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
                    <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                    <p className="text-[11px] text-gray-600 truncate">
                      {[m.dose, m.timing].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {m.notes && (
                      <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{m.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(i)}
                      className="text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors"
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(i)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-base leading-none"
                      title="Remove"
                      aria-label={`Remove ${m.name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing === -1 && (
        <div className="mt-3 rounded-xl border border-[#1B3829]/40 bg-[#1B3829]/5 px-3 py-2.5">
          <MedicationForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            saving={saving}
            error={error}
            submitLabel="Add medication"
          />
        </div>
      )}
    </section>
  );
}

function MedicationForm({
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
        placeholder="Name (e.g. Lisinopril)"
        maxLength={80}
        value={draft.name}
        onChange={e => setDraft({ ...draft, name: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          className={inp}
          placeholder="Dose (e.g. 10mg)"
          maxLength={40}
          value={draft.dose}
          onChange={e => setDraft({ ...draft, dose: e.target.value })}
        />
        <input
          className={inp}
          placeholder="Timing (e.g. morning)"
          maxLength={40}
          value={draft.timing}
          onChange={e => setDraft({ ...draft, timing: e.target.value })}
        />
      </div>
      <input
        className={inp}
        placeholder="Notes (prescriber, condition, etc.)"
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
