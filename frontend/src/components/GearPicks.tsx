"use client";

/**
 * GearPicks — up to four product recommendations on the Scorecard, each with a
 * transparent "why this for you" explanation and a "not for me" dismiss.
 *
 * Every recommendation has two parts:
 *   • trigger — the specific signal in the user's data that made this relevant
 *   • benefit — what the product unlocks for them
 *
 * Dismissing a card hides it from the Scorecard picks (persisted per-user) and
 * the next candidate slides in. Dismissed items still appear in the Gear shop.
 *
 * Priority order of gap-driven picks (highest first):
 *   1. No Oura connected          → Oura Ring
 *   2. No body fat in longevity   → InBody scale
 *   3. No VO2 Max in longevity    → Apple Watch
 *   4. 7-day sleep avg < 70       → Magnesium, then Sleep Mask
 * Then a broad pool of editor's picks fills the rest (and absorbs dismissals).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import GEAR, { type GearItem } from "@/lib/gearData";

interface Props {
  hasOura: boolean;
  longevityKeys: string[];
  sleepAvg7d?: number | null;
  onJump?: () => void;
}

interface Recommendation {
  item:    GearItem;
  trigger: string;
  benefit: string;
}

const ALL_ITEMS: Record<string, GearItem> = (() => {
  const out: Record<string, GearItem> = {};
  for (const cat of GEAR) for (const item of cat.items) out[item.id] = item;
  return out;
})();

// Editor's-pick fallback pool — broad enough to always fill 4 cards and
// absorb dismissals. Each carries its own "why" copy.
const FALLBACK_POOL: Array<{ id: string; benefit: string }> = [
  { id: "creatine",     benefit: "One of the most-researched performance supplements — 5g daily." },
  { id: "mag-glycinate", benefit: "Supports deeper, more restorative sleep." },
  { id: "omega3",       benefit: "High-potency EPA/DHA for cardiovascular health and inflammation." },
  { id: "foam-roller",  benefit: "Multi-density surface for targeted myofascial release." },
  { id: "vitamin-d",    benefit: "Immune function, bone density, and mood — most people run low." },
  { id: "massage-gun",  benefit: "Percussive therapy for soreness and post-workout recovery." },
  { id: "whoop",        benefit: "24/7 strain & recovery tracking if you'd rather not wear a ring." },
  { id: "kettlebell",   benefit: "One tool, full-body conditioning — swings, get-ups, carries." },
];

function computeRecommendations(
  hasOura: boolean,
  lonKeys: string[],
  sleepAvg7d: number | null | undefined,
): Recommendation[] {
  const out: Recommendation[] = [];
  const has  = (k: string) => lonKeys.includes(k);
  const push = (id: string, trigger: string, benefit: string) => {
    if (ALL_ITEMS[id] && !out.some(r => r.item.id === id)) {
      out.push({ item: ALL_ITEMS[id], trigger, benefit });
    }
  };

  // Gap-driven picks first
  if (!hasOura) {
    push("oura-ring", "You haven't connected a recovery tracker yet.",
      "Unlocks HRV, sleep stages, and the readiness score Coach Al relies on.");
  }
  if (!has("body_fat")) {
    push("inbody-scale", "Your Longevity Score is missing the Body Fat component (+10 pts available).",
      "Clinical-grade body composition at home, auto-syncs to Apple Health.");
  }
  if (!has("vo2_max")) {
    push("apple-watch", "Your Longevity Score is missing VO2 Max — the single biggest component at +20 pts.",
      "Tracks VO2 Max during workouts, plus HRV and steps.");
  }
  if (sleepAvg7d != null && sleepAvg7d < 70) {
    push("mag-glycinate", `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — below the 70 we'd want to see.`,
      "Magnesium glycinate supports deeper sleep and muscle recovery.");
    push("sleep-mask", `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — environment matters more than people think.`,
      "100% blackout, zero eye pressure — a measurable sleep-quality lift.");
  }

  // Fill the rest from the editor's-pick pool
  for (const { id, benefit } of FALLBACK_POOL) {
    push(id, "No specific gap in your data — this is an editor's pick.", benefit);
  }

  return out;
}

export default function GearPicks({ hasOura, longevityKeys, sleepAvg7d, onJump }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Load the user's dismissed items so they don't reappear.
  useEffect(() => {
    let cancelled = false;
    api.gear.dismissed()
      .then(res => { if (!cancelled) setDismissed(new Set(res.dismissed)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = async (itemId: string) => {
    // Optimistic — hide immediately, next candidate fills in
    setDismissed(prev => new Set(prev).add(itemId));
    try { await api.gear.dismiss(itemId); } catch { /* stays hidden locally regardless */ }
  };

  const all   = computeRecommendations(hasOura, longevityKeys, sleepAvg7d);
  const picks = all.filter(r => !dismissed.has(r.item.id)).slice(0, 4);
  if (picks.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Picked For You
        </h3>
        {onJump && (
          <button
            onClick={onJump}
            className="text-[11px] text-gray-400 hover:text-[#1B3829] transition-colors font-medium"
          >
            Browse all →
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {picks.map(({ item, trigger, benefit }) => (
          <div key={item.id} className="relative">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-left rounded-2xl border border-gray-200 bg-white p-3 pr-7 hover:border-[#1B3829]/30 hover:shadow-sm transition-all flex flex-col gap-1.5 no-underline h-full"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-gray-900 leading-snug">{item.name}</p>
                {item.badge && (
                  <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                    {item.badge}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{item.brand}</p>

              <div className="rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5 my-0.5">
                <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wide mb-0.5">
                  💡 Why this for you
                </p>
                <p className="text-[11px] text-amber-900 leading-snug">{trigger}</p>
              </div>

              <p className="text-[11px] text-gray-500 leading-snug flex-1">{benefit}</p>

              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[11px] font-semibold text-[#1B3829]">{item.price}</p>
                <span className="text-[10px] text-gray-400" title="Opens in a new tab">↗</span>
              </div>
            </a>

            {/* Dismiss — sibling of the <a>, not nested, so HTML stays valid */}
            <button
              onClick={() => handleDismiss(item.id)}
              className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 text-[11px] leading-none flex items-center justify-center transition-colors shadow-sm"
              title="Not for me — hide from my picks (stays in the Gear shop)"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
