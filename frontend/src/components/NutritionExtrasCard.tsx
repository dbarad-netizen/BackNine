"use client";

/**
 * NutritionExtrasCard — combined Vices + Hydration on the Nutrition tab.
 *
 * David batch (2026-07-06):
 *   • Vices — alcohol/nicotine/weed/etc. Compact chip picker. Every
 *     log stamps `date` (defaults to today) so weekly patterns become
 *     correlatable with sleep/HRV/mood.
 *   • Hydration — optional, per David's ask. Fluid ounces + source
 *     dropdown. Water/electrolyte count for hydration; coffee/tea/other
 *     get logged too so we have the full picture.
 *
 * Both are episodic — no streaks, no scores. Just capture and let the
 * insight engine correlate.
 */

import { useEffect, useState } from "react";
import { api, type NutritionVice, type HydrationEntry } from "@/lib/api";

const VICES: { value: NutritionVice["vice_type"]; label: string; emoji: string }[] = [
  { value: "alcohol",    label: "Alcohol",    emoji: "🍺" },
  { value: "nicotine",   label: "Nicotine",   emoji: "🚬" },
  { value: "weed",       label: "Weed",       emoji: "🌿" },
  { value: "edibles",    label: "Edibles",    emoji: "🍪" },
  { value: "processed",  label: "Processed",  emoji: "🍟" },
  { value: "sugar",      label: "Sugar",      emoji: "🍫" },
  { value: "caffeine",   label: "Caffeine",   emoji: "☕" },
  { value: "other",      label: "Other",      emoji: "🎈" },
];

const HYDRATION_SOURCES = [
  { value: "water",       label: "Water"       },
  { value: "electrolyte", label: "Electrolyte" },
  { value: "coffee",      label: "Coffee"      },
  { value: "tea",         label: "Tea"         },
  { value: "other",       label: "Other"       },
];

export default function NutritionExtrasCard() {
  const [vices, setVices]           = useState<NutritionVice[]>([]);
  const [hydration, setHydration]   = useState<{ entries: HydrationEntry[]; total_oz: number } | null>(null);
  const [busy, setBusy]             = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  // Vice quick-add
  const [pickedVice, setPickedVice] = useState<NutritionVice["vice_type"] | null>(null);
  const [viceAmount, setViceAmount] = useState("");

  // Hydration quick-add
  const [waterOz,      setWaterOz]      = useState("");
  const [waterSource,  setWaterSource]  = useState("water");

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listVices(7), api.getHydration()])
      .then(([v, h]) => {
        if (cancelled) return;
        setVices(v.vices);
        setHydration({ entries: h.entries, total_oz: h.total_oz });
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  const submitVice = async () => {
    if (!pickedVice) return;
    setBusy("vice"); setError(null);
    try {
      const r = await api.createVice({
        vice_type: pickedVice,
        amount:    viceAmount.trim() || undefined,
      });
      setVices(prev => [r.vice, ...prev]);
      setPickedVice(null); setViceAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(null); }
  };

  const removeVice = async (id: string) => {
    try { await api.deleteVice(id); setVices(prev => prev.filter(v => v.id !== id)); }
    catch { /* silent */ }
  };

  const submitWater = async () => {
    const oz = parseFloat(waterOz);
    if (isNaN(oz) || oz <= 0) { setError("Enter ounces > 0"); return; }
    setBusy("water"); setError(null);
    try {
      const r = await api.logHydration({ volume_oz: oz, source: waterSource });
      setHydration(prev => ({
        entries: [r.entry, ...(prev?.entries ?? [])],
        total_oz: Math.round(((prev?.total_oz ?? 0) + oz) * 10) / 10,
      }));
      setWaterOz("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(null); }
  };

  const removeWater = async (id: string, oz: number) => {
    try {
      await api.deleteHydration(id);
      setHydration(prev => prev ? {
        entries: prev.entries.filter(e => e.id !== id),
        total_oz: Math.max(0, Math.round((prev.total_oz - oz) * 10) / 10),
      } : prev);
    } catch { /* silent */ }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
      {/* Vices */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
            Vices
          </p>
          <span className="text-[11px] text-gray-500">
            {vices.length > 0 ? `${vices.length} in the last 7 days` : "None this week"}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {VICES.map(v => (
            <button
              key={v.value}
              onClick={() => setPickedVice(pickedVice === v.value ? null : v.value)}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[11px] font-medium border transition-colors ${
                pickedVice === v.value
                  ? "bg-[#1B3829]/8 border-[#1B3829]/40 text-[#1B3829]"
                  : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              <span className="text-base leading-none">{v.emoji}</span>
              <span>{v.label}</span>
            </button>
          ))}
        </div>

        {pickedVice && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={viceAmount}
              onChange={e => setViceAmount(e.target.value)}
              placeholder="Amount (optional) — e.g. 2 beers"
              className="flex-1 text-sm rounded-lg border border-gray-200 px-2.5 py-1.5"
            />
            <button
              onClick={submitVice}
              disabled={busy === "vice"}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40"
            >
              {busy === "vice" ? "…" : "Log"}
            </button>
          </div>
        )}

        {vices.length > 0 && (
          <ul className="mt-2 space-y-1">
            {vices.slice(0, 5).map(v => (
              <li key={v.id} className="flex items-center justify-between text-[11px] text-gray-700">
                <span>
                  <span className="text-gray-500">{v.date} · </span>
                  <span className="font-medium capitalize">{v.vice_type}</span>
                  {v.amount && <> · <span className="italic">{v.amount}</span></>}
                </span>
                <button
                  onClick={() => removeVice(v.id)}
                  className="text-gray-400 hover:text-red-600"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Hydration */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
            Fluids today
          </p>
          <span className="text-[11px] text-gray-500">
            {hydration && hydration.total_oz > 0
              ? <><span className="font-semibold text-gray-900">{hydration.total_oz} oz</span> logged</>
              : "Nothing logged"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            step="1"
            min="0"
            max="200"
            value={waterOz}
            onChange={e => setWaterOz(e.target.value)}
            placeholder="oz"
            className="w-20 text-sm rounded-lg border border-gray-200 px-2.5 py-1.5"
          />
          <select
            value={waterSource}
            onChange={e => setWaterSource(e.target.value)}
            className="flex-1 text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white"
          >
            {HYDRATION_SOURCES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={submitWater}
            disabled={busy === "water" || !waterOz}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40"
          >
            {busy === "water" ? "…" : "Log"}
          </button>
        </div>

        {hydration && hydration.entries.length > 0 && (
          <ul className="mt-2 space-y-1">
            {hydration.entries.slice(0, 4).map(e => (
              <li key={e.id} className="flex items-center justify-between text-[11px] text-gray-700">
                <span>
                  <span className="font-medium">{e.volume_oz} oz</span>
                  <span className="text-gray-500"> · {e.source ?? "water"}</span>
                </span>
                <button
                  onClick={() => removeWater(e.id, e.volume_oz)}
                  className="text-gray-400 hover:text-red-600"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">{error}</p>
      )}
    </section>
  );
}
