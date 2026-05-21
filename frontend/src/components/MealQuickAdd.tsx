"use client";

/**
 * MealQuickAdd — the single "Add a meal" card. Low-friction first:
 *   • Natural language: "2 eggs, toast, a banana" → Claude drafts items.
 *   • Photo: take a photo (camera by default on mobile) or upload one.
 *   • Recents: one-tap re-log of foods you've had before.
 * Plus a tucked-away "Search / custom" for precise database or manual entry.
 *
 * Everything funnels through one batch-log + onLogged() refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type MealDraftItem, type FoodItem } from "@/lib/api";

interface Props {
  date?: string;
  onLogged: () => void;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export default function MealQuickAdd({ date, onLogged }: Props) {
  const [text, setText]       = useState("");
  const [parsing, setParsing] = useState<"text" | "photo" | null>(null);
  const [draft, setDraft]     = useState<MealDraftItem[] | null>(null);
  const [recents, setRecents] = useState<MealDraftItem[]>([]);
  const [logging, setLogging] = useState(false);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // Manual (search / custom) — tucked away
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMode, setManualMode] = useState<"search" | "custom">("search");
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [qty, setQty]         = useState("1");
  const [custom, setCustom]   = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });

  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.recentFoods().then(r => setRecents(r.foods)).catch(() => {});
  }, []);

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(f => (f === msg ? null : f)), 2500);
  };
  const refreshRecents = () => api.recentFoods().then(r => setRecents(r.foods)).catch(() => {});

  const logItems = async (items: MealDraftItem[], label: string): Promise<boolean> => {
    if (items.length === 0 || logging) return false;
    setLogging(true); setError(null);
    try {
      await api.logMealsBatch(items, date);
      flash(label);
      onLogged();
      refreshRecents();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that");
      return false;
    } finally {
      setLogging(false);
    }
  };

  // ── Natural language ──
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

  // ── Photo ──
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
      if (cameraRef.current) cameraRef.current.value = "";
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  // ── Draft review edits ──
  const updateDraft = (i: number, field: keyof MealDraftItem, val: string) => {
    setDraft(prev => prev ? prev.map((it, j) =>
      j === i ? { ...it, [field]: field === "name" ? val : (parseFloat(val) || 0) } : it) : prev);
  };
  const removeDraft = (i: number) => setDraft(prev => prev ? prev.filter((_, j) => j !== i) : prev);
  const logDraft = async () => {
    if (!draft) return;
    const ok = await logItems(draft, `Logged ${draft.length} item${draft.length !== 1 ? "s" : ""}`);
    if (ok) { setDraft(null); setText(""); }
  };

  // ── Manual: search ──
  const doSearch = useCallback((q: string) => {
    clearTimeout(searchDebounce.current);
    if (!q.trim()) { setResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      try { setResults((await api.searchFoods(q)).results); } catch { setResults([]); }
    }, 300);
  }, []);
  const addSearch = async () => {
    if (!selected) return;
    const q = parseFloat(qty) || 1;
    const ok = await logItems([{
      name:     `${selected.name} (${q} × ${selected.unit})`,
      calories: Math.round(selected.calories * q),
      protein:  r1(selected.protein * q),
      carbs:    r1(selected.carbs * q),
      fat:      r1(selected.fat * q),
    }], `Logged ${selected.name}`);
    if (ok) { setSelected(null); setQuery(""); setQty("1"); setResults([]); }
  };

  // ── Manual: custom ──
  const addCustom = async () => {
    if (!custom.name || !custom.calories) return;
    const ok = await logItems([{
      name:     custom.name,
      calories: parseFloat(custom.calories) || 0,
      protein:  parseFloat(custom.protein) || 0,
      carbs:    parseFloat(custom.carbs) || 0,
      fat:      parseFloat(custom.fat) || 0,
    }], `Logged ${custom.name}`);
    if (ok) setCustom({ name: "", calories: "", protein: "", carbs: "", fat: "" });
  };

  const inp = "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#2D6A4F]";
  const draftTotal = (draft || []).reduce((a, b) => a + (b.calories || 0), 0);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Add a meal</p>

      {/* Natural language */}
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
      </div>

      {/* Photo: camera by default, upload as fallback */}
      <div className="flex items-center gap-2">
        <button onClick={() => cameraRef.current?.click()} disabled={parsing !== null}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
          <span className="text-base leading-none">📷</span>
          {parsing === "photo" ? "Reading…" : "Take a photo of your meal"}
        </button>
        <button onClick={() => uploadRef.current?.click()} disabled={parsing !== null}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-40">
          Upload
        </button>
        {/* Mobile: capture opens the rear camera directly. Desktop ignores it. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} />
        <input ref={uploadRef} type="file" accept="image/*" className="hidden"
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
      {flashMsg && <p className="text-[11px] text-green-600 font-medium">✓ {flashMsg}</p>}

      {/* Draft review (NL / photo) */}
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
              <button key={`${f.name}-${i}`} onClick={() => logItems([f], `Logged ${f.name}`)} disabled={logging}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 hover:bg-gray-200 px-2.5 py-1 text-xs text-gray-700 transition-colors disabled:opacity-40"
                title={`${f.calories} kcal`}>
                <span className="capitalize">{f.name}</span>
                <span className="text-gray-400">+{f.calories}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual: search / custom (tucked away) */}
      <div className="border-t border-gray-50 pt-2">
        <button onClick={() => setManualOpen(o => !o)} className="text-[11px] font-medium text-gray-500 hover:text-gray-800">
          {manualOpen ? "▲ Hide" : "▼ Search the food database or enter it manually"}
        </button>
        {manualOpen && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              {(["search", "custom"] as const).map(m => (
                <button key={m} onClick={() => setManualMode(m)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${manualMode === m ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-500 hover:text-gray-800"}`}>
                  {m === "search" ? "Search food" : "Custom"}
                </button>
              ))}
            </div>

            {manualMode === "search" ? (
              <div className="space-y-2">
                <div className="relative">
                  <input className={inp} placeholder="Search: chicken, rice, banana…" value={query}
                    onChange={e => { setQuery(e.target.value); setSelected(null); doSearch(e.target.value); }} />
                  {results.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                      {results.map(f => (
                        <button key={f.name} onClick={() => { setSelected(f); setQuery(f.name); setResults([]); setQty("1"); }}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left transition-colors">
                          <span className="text-sm text-gray-900 capitalize">{f.name}</span>
                          <span className="text-xs text-gray-400">{f.calories} kcal · {f.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selected && (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <p className="text-xs text-gray-400 mb-1">Servings ({selected.unit})</p>
                      <input className={inp} type="number" min="0.25" step="0.25" value={qty} onChange={e => setQty(e.target.value)} />
                    </div>
                    <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      <p className="text-gray-900 font-medium capitalize">{selected.name}</p>
                      <p>{Math.round(selected.calories * (parseFloat(qty) || 1))} kcal</p>
                    </div>
                  </div>
                )}
                <button disabled={!selected || logging} onClick={addSearch}
                  className="w-full py-2 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-xs font-semibold transition-colors">
                  + Add to log
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input className={inp} placeholder="Food name" value={custom.name}
                  onChange={e => setCustom({ ...custom, name: e.target.value })} />
                <div className="grid grid-cols-4 gap-2">
                  {([["calories", "kcal"], ["protein", "P (g)"], ["carbs", "C (g)"], ["fat", "F (g)"]] as const).map(([f, lbl]) => (
                    <div key={f}>
                      <p className="text-[10px] text-gray-400 mb-1">{lbl}</p>
                      <input className={inp} type="number" value={custom[f]}
                        onChange={e => setCustom({ ...custom, [f]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <button disabled={!custom.name || !custom.calories || logging} onClick={addCustom}
                  className="w-full py-2 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-xs font-semibold transition-colors">
                  + Add to log
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
