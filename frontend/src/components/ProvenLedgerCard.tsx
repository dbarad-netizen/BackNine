"use client";

/**
 * ProvenLedgerCard — the "What's proven to work for you" surface.
 *
 * Fable competitive brief 2026-07-05: this is the moat. Every completed
 * experiment shows up here with its delta, its significance label, and
 * an optional user note. Over time it becomes a personal evidence log
 * that no other app in the competitive set has.
 *
 * Deliberately excludes:
 *   • abandoned experiments (user pressed stop — no signal)
 *   • insufficient_data experiments (missing readings — not honest to claim)
 *
 * The ledger is a trust artifact. Publishing a "worse" result is fine
 * (users appreciate honesty and it teaches something too — "stopping
 * caffeine after 2pm didn't help my HRV, actually dropped it 3ms").
 * Publishing a garbage result is not fine.
 *
 * Rendered on the Profile view, and eventually surfaced on shareable
 * Sunday Scorecard cards.
 */

import { useEffect, useState } from "react";
import { api, type Experiment } from "@/lib/api";

const SIG_STYLE = {
  meaningful: { chip: "bg-emerald-100 text-emerald-800 border-emerald-300", label: "Meaningful" },
  notable:    { chip: "bg-amber-100  text-amber-800  border-amber-300",    label: "Notable"    },
  noise:      { chip: "bg-gray-100   text-gray-600   border-gray-300",     label: "No change"  },
} as const;

const DIR_EMOJI: Record<NonNullable<Experiment["direction"]>, string> = {
  better:    "✅",
  worse:     "❌",
  no_change: "➖",
};

export default function ProvenLedgerCard() {
  const [items, setItems]     = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteText, setNoteText]   = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.provenLedger(50)
      .then(r => setItems(r.ledger || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const saveNote = async (id: string) => {
    setBusy(true);
    try {
      await api.saveExperimentNote(id, noteText);
      setItems(prev => prev.map(x => x.id === id ? { ...x, user_note: noteText } : x));
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  // Empty state — encourages the loop instead of hiding silently.
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">
          Proven for you
        </p>
        <p className="text-[13px] text-gray-700 leading-relaxed">
          Your personal evidence ledger. When a Daily Insight suggests
          something to try, tap <strong>Test for a week</strong> — after
          seven days we&rsquo;ll check the result against your baseline and
          save what actually moved for you here.
        </p>
      </section>
    );
  }

  const provenCount = items.filter(x => x.proven).length;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Proven for you
        </p>
        <span className="text-[10px] text-gray-500">
          {provenCount} proven &middot; {items.length} tested
        </span>
      </div>

      <ul className="space-y-3">
        {items.map(exp => {
          const sigKey = (exp.significance || "noise") as keyof typeof SIG_STYLE;
          const sigStyle = SIG_STYLE[sigKey];
          const emoji = exp.direction ? DIR_EMOJI[exp.direction] : "➖";
          const isEditing = editingId === exp.id;
          return (
            <li key={exp.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="flex items-start gap-2 mb-1.5">
                <span className="text-base leading-tight shrink-0" aria-hidden>{emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 leading-tight">
                    {exp.action}
                  </p>
                  {exp.hypothesis && (
                    <p className="text-[11px] text-gray-500 italic mt-0.5 leading-tight">
                      {exp.hypothesis}
                    </p>
                  )}
                </div>
              </div>

              {/* Result row */}
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {exp.headline && (
                  <span className="text-[12px] font-semibold text-gray-800">
                    {exp.headline.split("·")[0].trim()}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sigStyle.chip}`}>
                  {sigStyle.label}
                </span>
              </div>

              {/* Baseline → test */}
              <p className="text-[11px] text-gray-500 leading-snug">
                {exp.metric_label}: {exp.baseline_avg}{exp.unit} → {exp.test_avg}{exp.unit}
                {exp.completed_at && (
                  <span className="text-gray-400">
                    {" "}&middot; {new Date(exp.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </p>

              {/* User note */}
              {isEditing ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="A note to your future self about this result..."
                    maxLength={400}
                    className="w-full text-[12px] rounded-lg border border-gray-300 px-2 py-1.5 bg-white focus:outline-none focus:border-[#1B3829] resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveNote(exp.id)}
                      disabled={busy}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md bg-[#1B3829] text-white hover:bg-[#2D6A4F] disabled:opacity-50"
                    >
                      {busy ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : exp.user_note ? (
                <button
                  onClick={() => { setEditingId(exp.id); setNoteText(exp.user_note || ""); }}
                  className="text-left mt-1.5 w-full block text-[11px] text-gray-600 italic hover:text-gray-900 leading-snug"
                >
                  &ldquo;{exp.user_note}&rdquo;
                </button>
              ) : (
                <button
                  onClick={() => { setEditingId(exp.id); setNoteText(""); }}
                  className="mt-1.5 text-[10px] text-[#1B3829] hover:underline"
                >
                  + Add a note
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
