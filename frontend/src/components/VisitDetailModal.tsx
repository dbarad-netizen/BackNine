"use client";

/**
 * VisitDetailModal — the prep workflow surface. Called from the
 * VisitPrepCard (Scorecard) and the future Doctor Visits section on
 * the Reports tab.
 *
 * Sections (progressive disclosure — sections not relevant to the
 * current timeline phase are collapsed):
 *   • Visit basics — date, provider type, reason
 *   • Questions for your doctor — AI-drafted list with edit/regenerate
 *   • Packet — shortcut to open the Doctor Handoff, share link, print
 *   • Post-visit capture — upload new labs + med changes + notes
 *   • Cancel / reschedule
 *
 * This is intentionally a modal rather than a full page — Phase 1
 * ships fast and validates the flow. A dedicated Doctor Visits page
 * with a history timeline is P1 per the PRD.
 */

import { useEffect, useState } from "react";
import { api, type DoctorVisit, type VisitQuestion } from "@/lib/api";

interface Props {
  visitId: string;
  onClose: () => void;
  /** Optional — parent can open the Doctor Handoff (packet) in a different modal. */
  onOpenHandoff?: () => void;
}

const PROVIDER_OPTIONS: { value: DoctorVisit["provider_type"]; label: string }[] = [
  { value: "primary_care",  label: "Primary care" },
  { value: "cardiology",    label: "Cardiology" },
  { value: "urology",       label: "Urology" },
  { value: "endocrinology", label: "Endocrinology" },
  { value: "dermatology",   label: "Dermatology" },
  { value: "orthopedics",   label: "Orthopedics" },
  { value: "other",         label: "Other" },
];

export default function VisitDetailModal({ visitId, onClose, onOpenHandoff }: Props) {
  const [visit, setVisit]   = useState<DoctorVisit | null>(null);
  const [busy,  setBusy]    = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [notes, setNotes]   = useState("");
  const [outcome, setOutcome] = useState("");
  const [editingQid, setEditingQid] = useState<string | null>(null);
  const [draftText,  setDraftText]  = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getVisit(visitId);
        if (!cancelled) {
          setVisit(r.visit);
          setNotes(r.visit.post_visit_notes || "");
          setOutcome(r.visit.outcome_summary || "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load visit.");
      }
    })();
    return () => { cancelled = true; };
  }, [visitId]);

  const reload = async () => {
    const r = await api.getVisit(visitId);
    setVisit(r.visit);
  };

  const setField = async (patch: Partial<DoctorVisit>) => {
    setBusy("save"); setError(null);
    try {
      const r = await api.updateVisit(visitId, patch);
      setVisit(r.visit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally { setBusy(null); }
  };

  const handleGenerate = async () => {
    setBusy("gen"); setError(null);
    try {
      await api.generateVisitQuestions(visitId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate questions.");
    } finally { setBusy(null); }
  };

  const updateQuestions = async (next: VisitQuestion[]) => {
    await setField({ question_drafts: next });
  };

  const handleEditQuestion = (q: VisitQuestion) => {
    setEditingQid(q.id);
    setDraftText(q.text);
  };

  const saveEditedQuestion = async () => {
    if (!visit || !editingQid) return;
    const next = visit.question_drafts.map(q =>
      q.id === editingQid
        ? { ...q, text: draftText.trim(), user_edited: true }
        : q
    );
    setEditingQid(null);
    await updateQuestions(next);
  };

  const deleteQuestion = async (qid: string) => {
    if (!visit) return;
    await updateQuestions(visit.question_drafts.filter(q => q.id !== qid));
  };

  const addQuestion = async () => {
    if (!visit) return;
    const next: VisitQuestion = {
      id:              Math.random().toString(36).slice(2, 10),
      text:            "New question — write it here.",
      source_data:     "User-added.",
      provider_scope:  visit.provider_type,
      user_edited:     true,
    };
    await updateQuestions([...visit.question_drafts, next]);
    setEditingQid(next.id);
    setDraftText(next.text);
  };

  const handleComplete = async () => {
    setBusy("complete"); setError(null);
    try {
      await api.completeVisit(visitId, { notes, outcome_summary: outcome });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete visit.");
    } finally { setBusy(null); }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel this visit? You can always create a new one later.")) return;
    setBusy("cancel"); setError(null);
    try {
      await api.cancelVisit(visitId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel visit.");
    } finally { setBusy(null); }
  };

  if (!visit) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div className="bg-white rounded-2xl px-6 py-4 shadow-xl pointer-events-auto">
            <p className="text-sm text-gray-700">{error || "Loading…"}</p>
          </div>
        </div>
      </>
    );
  }

  const isUpcoming  = visit.status === "upcoming";
  const isCompleted = visit.status === "completed";
  const dateLabel   = new Date(visit.visit_date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 pointer-events-none overflow-y-auto">
        <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl w-full max-w-md my-6 flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2D6A4F]">
                🩺 Doctor visit prep
              </p>
              <h2 className="text-base font-bold text-[#1B3829] mt-0.5">{dateLabel}</h2>
            </div>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900 text-xl leading-none">×</button>
          </div>

          <div className="overflow-y-auto p-5 space-y-5">
            {/* Basics */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Basics</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-600">
                  Date
                  <input
                    type="date"
                    value={visit.visit_date}
                    onChange={e => setField({ visit_date: e.target.value })}
                    className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2 py-1.5"
                  />
                </label>
                <label className="text-[11px] text-gray-600">
                  Provider type
                  <select
                    value={visit.provider_type}
                    onChange={e => setField({ provider_type: e.target.value as DoctorVisit["provider_type"] })}
                    className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2 py-1.5 bg-white"
                  >
                    {PROVIDER_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-[11px] text-gray-600">
                Reason (optional)
                <input
                  type="text"
                  value={visit.reason || ""}
                  onChange={e => setField({ reason: e.target.value })}
                  placeholder="e.g. annual physical, BP check, PSA follow-up"
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5"
                />
              </label>
            </section>

            {/* Questions */}
            {isUpcoming && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Questions for your doctor
                  </p>
                  <button
                    onClick={handleGenerate}
                    disabled={busy === "gen"}
                    className="text-[11px] font-semibold text-[#1B3829] hover:underline disabled:opacity-40"
                  >
                    {busy === "gen"
                      ? "Drafting…"
                      : visit.question_drafts.length > 0 ? "Regenerate" : "Draft from my data"}
                  </button>
                </div>

                {visit.question_drafts.length === 0 && (
                  <p className="text-[12px] text-gray-600 leading-snug">
                    Nothing drafted yet. Tap &ldquo;Draft from my data&rdquo; and Coach Al will pull
                    the values worth asking about.
                  </p>
                )}

                <ul className="space-y-2">
                  {visit.question_drafts.map((q, i) => (
                    <li key={q.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                      {editingQid === q.id ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={draftText}
                            onChange={e => setDraftText(e.target.value)}
                            rows={3}
                            className="w-full text-[13px] rounded-lg border border-gray-200 px-2 py-1.5"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={saveEditedQuestion}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#1B3829] text-white"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingQid(null)}
                              className="text-[11px] font-medium text-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-[13px] text-gray-900 leading-snug">
                            <span className="text-gray-500 mr-1">{i + 1}.</span>{q.text}
                          </p>
                          {q.source_data && (
                            <p className="text-[10px] text-gray-500 mt-1">
                              Based on: {q.source_data}
                            </p>
                          )}
                          <div className="flex gap-3 mt-1">
                            <button
                              onClick={() => handleEditQuestion(q)}
                              className="text-[10px] text-gray-600 hover:text-[#1B3829]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteQuestion(q.id)}
                              className="text-[10px] text-gray-600 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={addQuestion}
                  className="text-[11px] font-semibold text-[#1B3829] hover:underline"
                >
                  + Add my own question
                </button>
              </section>
            )}

            {/* Packet */}
            {isUpcoming && onOpenHandoff && (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Packet for your visit
                </p>
                <p className="text-[12px] text-gray-700 leading-snug">
                  Your one-page Doctor Handoff plus this question list. Print
                  it or share the link — your doctor sees your real trends.
                </p>
                <button
                  onClick={onOpenHandoff}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white"
                >
                  Open the packet
                </button>
              </section>
            )}

            {/* Post-visit capture */}
            {(isUpcoming || isCompleted) && (
              <section className="space-y-2 pt-2 border-t border-gray-100">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  {isCompleted ? "Post-visit notes" : "After the visit"}
                </p>
                <label className="block text-[11px] text-gray-600">
                  What did the doctor say? (private — for you only)
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Free-form notes. Skip if you don't want to write anything."
                    className="mt-1 w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-1.5"
                  />
                </label>
                <label className="block text-[11px] text-gray-600">
                  Outcome summary (one sentence)
                  <input
                    type="text"
                    value={outcome}
                    onChange={e => setOutcome(e.target.value)}
                    placeholder="e.g. Increased losartan to 100mg; recheck labs in 8 weeks."
                    className="mt-1 w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-1.5"
                  />
                </label>
                <p className="text-[10px] text-gray-500 leading-snug">
                  For new labs or med changes, use the labs importer or the Meds
                  editor — they roll into your record automatically.
                </p>
                {isUpcoming && (
                  <button
                    onClick={handleComplete}
                    disabled={busy === "complete"}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
                  >
                    {busy === "complete" ? "Saving…" : "Mark visit complete"}
                  </button>
                )}
                {isCompleted && (
                  <button
                    onClick={() => setField({ post_visit_notes: notes, outcome_summary: outcome })}
                    disabled={busy === "save"}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40"
                  >
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                )}
              </section>
            )}

            {/* Cancel */}
            {isUpcoming && (
              <section className="pt-2 border-t border-gray-100">
                <button
                  onClick={handleCancel}
                  disabled={busy === "cancel"}
                  className="text-[11px] font-medium text-red-700 hover:text-red-800 disabled:opacity-40"
                >
                  {busy === "cancel" ? "Canceling…" : "Cancel this visit"}
                </button>
              </section>
            )}

            {error && (
              <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
