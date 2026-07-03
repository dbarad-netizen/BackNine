"use client";

/**
 * CoachMemoryCard — user-authored persistent facts Coach Al carries
 * across every chat session.
 *
 * Sonar parity move (Fable IMPROVE #2). Right now Coach Al re-reads the
 * dashboard each turn but doesn't remember stated goals, injuries, or
 * preferences from prior conversations. Explicit user-authored memory
 * fixes that with a small piece of UI: add / edit / delete facts,
 * scoped to seven categories (injury, preference, goal, medical,
 * lifestyle, other).
 *
 * Mounted inside the Chat drawer's overflow area — user opens it, tells
 * Coach Al "remember I'm avoiding lunges due to a torn meniscus," clicks
 * save. Next session Coach Al sees that in his system prompt and never
 * prescribes lunges again.
 */

import { useEffect, useState } from "react";
import { api, type CoachMemoryItem, type CoachMemoryCategory, type CoachMemoryCategoryOption } from "@/lib/api";

interface Props {
  /** Called with `true` when the user just saved/deleted something, so
   *  the parent can e.g. show a subtle "Coach Al will remember this next
   *  time" acknowledgement. */
  onChange?: () => void;
}

function categoryClass(cat: CoachMemoryCategory): string {
  switch (cat) {
    case "injury":     return "bg-rose-50 text-rose-800 border-rose-200";
    case "medical":    return "bg-purple-50 text-purple-800 border-purple-200";
    case "goal":       return "bg-amber-50 text-amber-900 border-amber-200";
    case "preference": return "bg-sky-50 text-sky-800 border-sky-200";
    case "lifestyle":  return "bg-emerald-50 text-emerald-800 border-emerald-200";
    default:           return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export default function CoachMemoryCard({ onChange }: Props = {}) {
  const [items,      setItems]      = useState<CoachMemoryItem[]>([]);
  const [categories, setCategories] = useState<CoachMemoryCategoryOption[]>([]);
  const [maxLen,     setMaxLen]     = useState(240);
  const [loading,    setLoading]    = useState(true);
  const [addOpen,    setAddOpen]    = useState(false);
  const [addCat,     setAddCat]     = useState<CoachMemoryCategory>("goal");
  const [addContent, setAddContent] = useState("");
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCat,     setEditCat]     = useState<CoachMemoryCategory>("goal");

  const load = () => {
    setLoading(true);
    api.coachMemory()
      .then(r => {
        setItems(r.memories || []);
        setCategories(r.categories || []);
        setMaxLen(r.max_content_len || 240);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const content = addContent.trim();
    if (!content || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await api.addCoachMemory({ category: addCat, content });
      setItems(prev => [saved, ...prev]);
      setAddContent(""); setAddOpen(false);
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(false); }
  };

  const startEdit = (m: CoachMemoryItem) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditCat(m.category);
  };
  const cancelEdit = () => { setEditingId(null); setEditContent(""); };
  const handleUpdate = async (id: string) => {
    const content = editContent.trim();
    if (!content || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await api.updateCoachMemory(id, { category: editCat, content });
      setItems(prev => prev.map(m => m.id === id ? saved : m));
      cancelEdit();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteCoachMemory(id);
      setItems(prev => prev.filter(m => m.id !== id));
      onChange?.();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">🧠 What Coach Al remembers</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Facts he keeps across every conversation. Add injuries, goals, preferences — he&apos;ll respect them without you having to repeat yourself.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
        </div>
      )}

      {!loading && (
        <>
          {items.length === 0 && !addOpen && (
            <p className="text-xs text-gray-600 italic py-2">
              Nothing saved yet. Add a fact and Coach Al will remember it going forward.
            </p>
          )}

          <ul className="space-y-1.5 mb-2">
            {items.map(m => (
              <li key={m.id} className={`rounded-lg border px-3 py-2 ${categoryClass(m.category)}`}>
                {editingId === m.id ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {categories.map(c => (
                        <button
                          key={c.key}
                          onClick={() => setEditCat(c.key)}
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                            editCat === c.key ? "bg-[#1B3829] text-white border-[#1B3829]" : "bg-white text-gray-700 border-gray-200"
                          }`}
                        >{c.emoji} {c.label}</button>
                      ))}
                    </div>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      maxLength={maxLen}
                      rows={2}
                      className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 focus:outline-none focus:border-[#1B3829]"
                    />
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleUpdate(m.id)} disabled={busy || !editContent.trim()}
                        className="text-xs font-semibold px-2.5 py-1 rounded bg-[#1B3829] text-white disabled:opacity-40">Save</button>
                      <button onClick={cancelEdit} className="text-xs text-gray-600 hover:text-gray-900">Cancel</button>
                      <span className="ml-auto text-[10px] text-gray-500">{editContent.length}/{maxLen}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                        {m.display.emoji} {m.display.label}
                      </p>
                      <p className="text-sm mt-0.5 leading-snug">{m.content}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      <button onClick={() => startEdit(m)} className="text-[10px] font-medium hover:underline">Edit</button>
                      <button onClick={() => handleDelete(m.id)} className="text-[10px] font-medium hover:underline opacity-70">Remove</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {addOpen ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {categories.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setAddCat(c.key)}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                      addCat === c.key ? "bg-[#1B3829] text-white border-[#1B3829]" : "bg-white text-gray-700 border-gray-200"
                    }`}
                  >{c.emoji} {c.label}</button>
                ))}
              </div>
              <textarea
                value={addContent}
                onChange={e => setAddContent(e.target.value)}
                placeholder='e.g. "Avoiding lunges — torn meniscus, cleared for other lower-body work"'
                maxLength={maxLen}
                rows={2}
                className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button onClick={handleAdd} disabled={busy || !addContent.trim()}
                  className="text-xs font-semibold px-3 py-1 rounded bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40">
                  {busy ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setAddOpen(false); setAddContent(""); setError(null); }}
                  className="text-xs text-gray-600 hover:text-gray-900">Cancel</button>
                <span className="ml-auto text-[10px] text-gray-500">{addContent.length}/{maxLen}</span>
              </div>
              {error && <p className="text-[11px] text-rose-700">{error}</p>}
            </div>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              className="w-full text-sm font-semibold px-3 py-2 rounded-lg border border-dashed border-gray-300 text-gray-700 hover:border-[#1B3829] hover:text-[#1B3829] transition-colors"
            >
              ＋ Add a fact for Coach Al to remember
            </button>
          )}
        </>
      )}
    </section>
  );
}
