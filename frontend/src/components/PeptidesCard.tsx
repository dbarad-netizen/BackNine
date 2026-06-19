"use client";

/**
 * PeptidesCard — your active peptide stack on the Nutrition tab.
 *
 * Same shape and UX as SupplementsCard (name, dose, timing, optional notes),
 * separate column on user_profiles. Peptides are a distinct category for
 * users — they're not supplements in their mental model — and we may want
 * different Coach Al handling here later (more cautious wording, regulatory
 * caveats). For v1 the structure is intentionally identical.
 */

import { useState } from "react";
import type { Peptide } from "@/lib/api";

interface Props {
  peptides: Peptide[];
  onSave: (next: Peptide[]) => Promise<void>;
}

type Draft = { name: string; dose: string; timing: string; notes: string };
const EMPTY_DRAFT: Draft = { name: "", dose: "", timing: "", notes: "" };

const inp =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

export default function PeptidesCard({ peptides, onSave }: Props) {
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
    const p = peptides[i];
    setEditing(i);
    setDraft({
      name:   p.name   ?? "",
      dose:   p.dose   ?? "",
      timing: p.timing ?? "",
      notes:  p.notes  ?? "",
    });
    setError(null);
  };

  const closeForm = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const persist = async (next: Peptide[]) => {
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
    const clean: Peptide = {
      name,
      dose:   draft.dose.trim()   || undefined,
      timing: draft.timing.trim() || undefined,
      notes:  draft.notes.trim()  || undefined,
    };
    const next = [...peptides];
    if (editing === -1) next.push(clean);
    else if (typeof editing === "number" && editing >= 0) next[editing] = clean;
    await persist(next);
  };

  const handleDelete = async (i: number) => {
    const next = peptides.filter((_, idx) => idx !== i);
    await persist(next);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Peptides</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Track your peptide stack — name, dose, and timing. Private to you.
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

      {peptides.length === 0 && editing === null && (
        <p className="text-xs text-gray-600 italic">
          No peptides added yet. Tap Add to start tracking.
        </p>
      )}

      {peptides.length > 0 && (
        <ul className="space-y-1.5">
          {peptides.map((p, i) => (
            <li
              key={`${p.name}-${i}`}
              className={`rounded-xl border px-3 py-2 ${
                editing === i ? "border-[#1B3829]/40 bg-[#1B3829]/5" : "border-gray-100 bg-gray-50"
              }`}
            >
              {editing === i ? (
                <PeptideForm
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
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-600 truncate">
                      {[p.dose, p.timing].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {p.notes && (
                      <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{p.notes}</p>
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
                      aria-label={`Remove ${p.name}`}
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
          <PeptideForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            saving={saving}
            error={error}
            submitLabel="Add peptide"
          />
        </div>
      )}
    </section>
  );
}

function PeptideForm({
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
        placeholder="Name (e.g. BPC-157)"
        maxLength={80}
        value={draft.name}
        onChange={e => setDraft({ ...draft, name: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          className={inp}
          placeholder="Dose (e.g. 250mcg)"
          maxLength={40}
          value={draft.dose}
          onChange={e => setDraft({ ...draft, dose: e.target.value })}
        />
        <input
          className={inp}
          placeholder="Timing (e.g. morning, SubQ)"
          maxLength={40}
          value={draft.timing}
          onChange={e => setDraft({ ...draft, timing: e.target.value })}
        />
      </div>
      <input
        className={inp}
        placeholder="Notes (cycle, source, etc.)"
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
