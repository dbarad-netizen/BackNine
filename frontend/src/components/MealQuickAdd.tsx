"use client";

/**
 * MealQuickAdd — low-friction meal logging.
 *
 *  • Natural language: type "2 eggs, toast, a banana" → Claude drafts items.
 *  • Photo: snap a meal → Claude vision drafts items.
 *  • Recents: one-tap re-log of foods you've had before.
 *
 * AI results land as an editable DRAFT you confirm, then batch-log. Calls
 * onLogged() after anything is saved so the parent refreshes today's totals.
 */

import { useEffect, useRef, useState } from "react";
import { api, type MealDraftItem } from "@/lib/api";

interface Props {
  date?: string;
  onLogged: () => void;
}

export default function MealQuickAdd({ date, onLogged }: Props) {
  const [text, setText]       = useState("");
  const [parsing, setParsing] = useState<"text" | "photo" | null>(null);
  const [draft, setDraft]     = useState<MealDraftItem[] | null>(null);
  const [recents, setRecents] = useState<MealDraftItem[]>([]);
  const [logging, setLogging] = useState(false);
  const [loggedFlash, setLoggedFlash] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.recentFoods().then(r => setRecents(r.foods)).catch(() => {});
  }, []);

  const flash = (msg: string) => {
    setLoggedFlash(msg);
    setTimeout(() => setLoggedFlash(f => (f === msg ? null : f)), 2500);
  };

  const refreshRecents = () => api.recentFoods().then(r => setRecents(r.foods)).catch(() => {});

  const parseText = async () => {
    const t = text.trim();
    if (!t || parsing) return;
    setParsing("text"); setError(null);
    try {
      const r = await api.parseMealText(t);
      if (r.items.length === 0) setError("Couldn't find any foods in that — try rephrasing.");
      else setDraft(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't parse that meal");
    } finally { setParsing(null); }
  };

  const onPhoto = async (file: File) => {
    setParsing("photo"); setError(null); setDraft(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const r = await api.parseMealPhoto(base64, file.type || "image/jpeg");
      if (r.items.length === 0) setError("Couldn't identify food in that photo — try a clearer shot.");
      else setDraft(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo");
    } finally {
      setParsing(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const updateDraft = (i: number, field: keyof MealDraftItem, val: string) => {
    setDraft(prev => prev ? prev.map((it, j) =>
      j === i ? { ...it, [field]: field === "name" ? val : (parseFloat(val) || 0) } : it) : prev);
  };
  const removeDraft = (i: number) => setDraft(prev => prev ? prev.filter((_, j) => j !== i) : prev);

  const logDraft = async () => {
    if (!draft || draft.length === 0 || logging) return;
    setLogging(true); setError(null);
    try {
      await api.logMealsBatch(draft, date);
      flash(`Logged ${draft.length} item${draft.length !== 1 ? "s" : ""}`);
      setDraft(null); setText("");
      onLogged();
      refreshRecents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log those items");
    } finally { setLogging(false); }
  };

  const logRecent = async (food: MealDraftItem) => {
    if (logging) return;
    setLogging(true); setError(null);
    try {
      await api.logMealsBatch([food], date);
      flash(`Logged ${food.name}`);
      onLogged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that");
    } finally { setLogging(false); }
  };

  const draftTotal = (draft || []).reduce((a, b) => a + (b.calories || 0), 0);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Quick add a meal</p>

      {/* Natural language + photo */}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") parseText(); }}
          placeholder="e.g. 2 eggs, toast with butter, a banana"
          className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#2D6A4F]"
        />
        <button onClick={parseText} disabled={!text.trim() || parsing !== null}
          className="shrink-0 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40">
          {parsing === "text" ? "…" : "Add"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={parsing !== null}
          title="Snap a photo of your meal"
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-base hover:bg-gray-50 transition-colors disabled:opacity-40">
          {parsing === "photo" ? "…" : "📷"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} />
      </div>
      <p className="text-[10px] text-gray-400 -mt-1">
        Describe it or snap a photo — Coach Al estimates the calories &amp; macros for you to confirm.
      </p>

      {parsing && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="h-4 w-4 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
          {parsing === "photo" ? "Reading your photo…" : "Working out the macros…"}
        </div>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {loggedFlash && <p className="text-[11px] text-green-600 font-medium">✓ {loggedFlash}</p>}

      {/* Draft review */}
      {draft && draft.length > 0 && (
        <div className="rounded-xl border border-[#2D6A4F]/30 bg-[#2D6A4F]/5 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-[#1B3829] uppercase tracking-wide">
            Review &amp; confirm · {draftTotal} kcal
          </p>
          {draft.map((it, i) => (
            <div key={i} className="rounded-lg bg-white border border-gray-200 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <input value={it.name} onChange={e => updateDraft(i, "name", e.target.value)}
                  className="flex-1 min-w-0 text-sm text-gray-900 bg-transparent focus:outline-none" />
                <button onClick={() => removeDraft(i)} className="text-gray-300 hover:text-red-400 text-base leading-none shrink-0">×</button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {([["calories", "kcal"], ["protein", "P"], ["carbs", "C"], ["fat", "F"]] as const).map(([f, lbl]) => (
                  <label key={f} className="flex items-center gap-1 text-[10px] text-gray-400">
                    <input type="number" min="0" value={it[f] || ""} onChange={e => updateDraft(i, f, e.target.value)}
                      className="w-14 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs text-gray-900 text-center focus:outline-none focus:border-[#2D6A4F]" />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={logDraft} disabled={logging}
              className="flex-1 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40">
              {logging ? "Logging…" : `Log ${draft.length} item${draft.length !== 1 ? "s" : ""}`}
            </button>
            <button onClick={() => setDraft(null)} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {/* Recents */}
      {recents.length > 0 && !draft && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Tap to re-log</p>
          <div className="flex flex-wrap gap-1.5">
            {recents.map((f, i) => (
              <button key={`${f.name}-${i}`} onClick={() => logRecent(f)} disabled={logging}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 hover:bg-gray-200 px-2.5 py-1 text-xs text-gray-700 transition-colors disabled:opacity-40"
                title={`${f.calories} kcal`}>
                <span className="capitalize">{f.name}</span>
                <span className="text-gray-400">+{f.calories}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
