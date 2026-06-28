"use client";

/**
 * JournalCard — private daily reflection log on the Scorecard.
 *
 * One entry per day (re-saving overwrites). Optional tags (work, family,
 * stress, sleep, training, etc.) feed the existing correlation engine so
 * Coach Al can connect "you wrote about work stress on 4 of 5 short-sleep
 * nights" — qualitative + quantitative.
 *
 * Privacy contract surfaced explicitly in the UI: the card body
 * acknowledges the entry is private; the footer references 988 as a
 * passive support resource (no active crisis detection).
 *
 * Mounted on the Scorecard near the Daily Check-in card.
 */

import { useEffect, useState } from "react";
import { api, type JournalEntry } from "@/lib/api";

export default function JournalCard() {
  const [entry,        setEntry]        = useState<JournalEntry | null>(null);
  const [streak,       setStreak]       = useState(0);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [text,         setText]         = useState("");
  const [tags,         setTags]         = useState<Set<string>>(new Set());
  const [customTag,    setCustomTag]    = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [expanded,     setExpanded]     = useState(false);

  // Load today's entry on mount.
  useEffect(() => {
    api.journalToday()
      .then(r => {
        setEntry(r.entry);
        setStreak(r.streak_days);
        setSuggestedTags(r.suggested_tags || []);
        setText(r.entry?.text || "");
        setTags(new Set(r.entry?.tags || []));
        // Auto-expand if there's existing text — so the user can see what
        // they wrote without an extra tap.
        if (r.entry?.text) setExpanded(true);
      })
      .catch(() => { /* silent — card stays in empty state */ });
  }, []);

  const toggleTag = (t: string) => {
    setTags(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else if (next.size < 6) next.add(t);
      return next;
    });
    setSaved(false);
  };

  const addCustomTag = () => {
    const t = customTag.trim().toLowerCase();
    if (!t) return;
    if (tags.size >= 6) return;
    setTags(prev => new Set(prev).add(t));
    setCustomTag("");
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const r = await api.saveJournal({ text, tags: Array.from(tags) });
      setEntry(r.entry);
      setStreak(r.streak_days);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  const handleClear = async () => {
    if (saving) return;
    if (!entry && !text.trim()) {
      setText(""); setTags(new Set()); return;
    }
    setSaving(true);
    try {
      // Empty text → server deletes the row.
      const r = await api.saveJournal({ text: "", tags: [] });
      setEntry(r.entry);
      setStreak(r.streak_days);
      setText(""); setTags(new Set());
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  const hasContent = text.trim().length > 0 || tags.size > 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">📓 Journal</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            A private place. Only you see it; Coach Al sees recent entries inside this chat to spot patterns.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {streak > 1 && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200"
              title={`${streak} consecutive days journaled`}
            >
              🔥 {streak}
            </span>
          )}
          {saved && (
            <span className="text-[11px] font-semibold text-emerald-700">✓ Saved</span>
          )}
        </div>
      </div>

      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left rounded-xl border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500 hover:border-[#1B3829] hover:text-gray-700 transition-colors"
        >
          What&apos;s on your mind today?
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); }}
            placeholder="What's on your mind today? Write as much or as little as you want — anchor it to whatever feels worth capturing."
            maxLength={5000}
            rows={4}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20 leading-snug resize-y"
          />

          <div>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 mb-1">
              Tag this entry <span className="font-normal lowercase text-gray-500">(optional — drives pattern insights)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedTags.map(t => {
                const on = tags.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      on
                        ? "bg-[#1B3829] text-white border-[#1B3829]"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
              {/* Show selected custom tags not in the suggested list. */}
              {Array.from(tags).filter(t => !suggestedTags.includes(t)).map(t => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-full border bg-[#1B3829] text-white border-[#1B3829]"
                >
                  {t} ×
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <input
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                placeholder="+ custom tag"
                maxLength={40}
                className="flex-1 text-[12px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
              />
              <button
                onClick={addCustomTag}
                disabled={!customTag.trim() || tags.size >= 6}
                className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {tags.size >= 6 && (
              <p className="text-[10px] text-gray-500 mt-1">Maximum 6 tags per entry.</p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !hasContent}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors disabled:opacity-40"
            >
              {saving ? "Saving…" : entry ? "Update" : "Save entry"}
            </button>
            {(entry || hasContent) && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="text-xs font-medium text-gray-600 hover:text-rose-600 transition-colors"
              >
                {entry ? "Remove today" : "Reset"}
              </button>
            )}
            <span className="ml-auto text-[10px] text-gray-500 italic">
              Private to you. Never shared with friends.
            </span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-3 leading-snug">
        BackNine is a wellness tool, not a substitute for mental health care.
        If you&apos;re struggling, the 988 Suicide &amp; Crisis Lifeline is available 24/7 by call or text in the US.
      </p>
    </section>
  );
}
