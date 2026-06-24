"use client";

/**
 * StackEfficacyCard — Phase 4 of the Insight pillar.
 *
 * For each currently-active supplement / peptide / medication with at
 * least 14 days of post-start data, compares before-vs-after averages
 * across sleep, HRV, RHR, breath, SpO2, and readiness. Top deltas
 * highlight what (if anything) actually changed after the user added
 * the item.
 *
 * Pure observational — labeled clearly as such. The point isn't to make
 * efficacy claims; it's to give the longevity-experimenter persona a
 * data-grounded read on whether their experiments are doing something.
 *
 * Lives on the Nutrition tab, after the Supplements / Peptides /
 * Medications cards.
 */

import { useEffect, useState } from "react";
import { api, type StackEfficacyItem } from "@/lib/api";

const CLASS_BADGE: Record<StackEfficacyItem["class"], { label: string; emoji: string; bg: string; fg: string }> = {
  supplement: { label: "Supplement", emoji: "💊", bg: "bg-emerald-100", fg: "text-emerald-800" },
  peptide:    { label: "Peptide",    emoji: "🧬", bg: "bg-purple-100",  fg: "text-purple-800"  },
  medication: { label: "Medication", emoji: "🩹", bg: "bg-rose-100",    fg: "text-rose-800"    },
};

export default function StackEfficacyCard() {
  const [items, setItems]     = useState<StackEfficacyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stackEfficacy()
      .then(r => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <p className="text-sm font-semibold text-gray-900">🔬 Stack Efficacy</p>
        <p className="text-[11px] text-gray-600 mt-0.5">
          Did your stack experiments do anything? Per-item before-vs-after across sleep, HRV, RHR, and other recovery signals. Observational only.
        </p>
      </div>

      <ul className="space-y-2.5">
        {items.map(item => {
          const badge = CLASS_BADGE[item.class] ?? CLASS_BADGE.supplement;
          const topDeltas = item.deltas.slice(0, 4);
          return (
            <li key={`${item.class}-${item.item_name}`} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 truncate">{item.display_name}</p>
                    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${badge.bg} ${badge.fg}`}>
                      {badge.emoji} {badge.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    {item.dose && <span>{item.dose} · </span>}
                    Started {item.started_on} · {item.days_since_start} day{item.days_since_start === 1 ? "" : "s"} ago
                  </p>
                </div>
              </div>

              {item.note && (
                <p className="text-[11px] text-gray-600 italic">{item.note}</p>
              )}

              {topDeltas.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 mt-2 mb-1">
                    Top changes — {item.before_window?.start}…{item.before_window?.end} vs {item.after_window?.start}…{item.after_window?.end}
                  </p>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-200">
                        <th className="py-1.5 pr-2 font-semibold">Metric</th>
                        <th className="py-1.5 pr-2 font-semibold text-right">Before</th>
                        <th className="py-1.5 pr-2 font-semibold text-right">After</th>
                        <th className="py-1.5 font-semibold text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topDeltas.map(d => (
                        <tr key={d.metric} className="border-b border-gray-100">
                          <td className="py-1 pr-2">{d.label}</td>
                          <td className="py-1 pr-2 text-right font-mono text-gray-700">{d.before_avg}{d.unit ? ` ${d.unit}` : ""}</td>
                          <td className={`py-1 pr-2 text-right font-mono ${
                            d.helpful === true  ? "text-emerald-700 font-semibold" :
                            d.helpful === false ? "text-rose-700 font-semibold"    :
                                                  "text-gray-800"
                          }`}>
                            {d.after_avg}{d.unit ? ` ${d.unit}` : ""}
                          </td>
                          <td className={`py-1 text-right font-mono ${
                            d.helpful === true  ? "text-emerald-700 font-semibold" :
                            d.helpful === false ? "text-rose-700 font-semibold"    :
                                                  "text-gray-700"
                          }`}>
                            {d.delta > 0 ? "+" : ""}{d.delta} ({d.abs_delta_pct}%)
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-gray-600 italic mt-3">
        Correlation only — many things change at once in real life. Treat as one signal among several when deciding what to keep, drop, or talk to your doctor about.
      </p>
    </section>
  );
}
