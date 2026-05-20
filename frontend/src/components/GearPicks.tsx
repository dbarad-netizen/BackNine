"use client";

/**
 * GearPicks — personalized product recommendations on the Scorecard.
 *
 * Every card explains WHY it's recommended:
 *   • Gap-driven picks ("Why this for you") cite the exact signal in the
 *     user's data — missing VO2 Max, low sleep average, no tracker, etc.
 *   • Catalog picks ("Why we suggest this") give an honest category-based
 *     rationale rather than a fake data claim.
 *
 * Controls:
 *   • ✕ on each card — "not for me": hides it from the Scorecard (persisted
 *     per-user) while leaving it in the Gear shop. Next candidate slides in.
 *   • "Give me more suggestions" — reveals the next batch from the full shop.
 *
 * Gap-driven priority (most personalized first):
 *   1. No Oura connected          → Oura Ring
 *   2. No body fat in longevity   → InBody scale
 *   3. No VO2 Max in longevity    → Apple Watch
 *   4. 7-day sleep avg < 70       → Magnesium, then Sleep Mask
 * Then every other catalog item, ordered by category rationale.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import GEAR, { type GearItem } from "@/lib/gearData";

const PAGE = 4;

interface Props {
  hasOura: boolean;
  longevityKeys: string[];
  sleepAvg7d?: number | null;
  onJump?: () => void;
}

interface Recommendation {
  item:          GearItem;
  reason:        string;
  personalized:  boolean;   // true = data-gap reason, false = category rationale
}

// Flatten the catalog + remember each item's category label.
const ALL_ITEMS: Record<string, GearItem> = {};
const ITEM_CATEGORY: Record<string, string> = {};
for (const cat of GEAR) {
  for (const item of cat.items) {
    ALL_ITEMS[item.id] = item;
    ITEM_CATEGORY[item.id] = cat.label;
  }
}

// Honest, category-based "why" for catalog items that don't map to a data gap.
const CATEGORY_REASON: Record<string, string> = {
  "Supplements":       "A foundational supplement most people benefit from.",
  "Sleep":             "Better sleep is the highest-leverage recovery investment.",
  "Recovery":          "Helps your body bounce back between hard training days.",
  "Fitness Equipment": "Expands what you can train without a gym.",
  "Wearables":         "More data sources give Coach Al a fuller picture of your health.",
  "Nutrition":         "Makes it easier to hit your daily nutrition targets.",
};

function computeRecommendations(
  hasOura: boolean,
  lonKeys: string[],
  sleepAvg7d: number | null | undefined,
): Recommendation[] {
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  const has  = (k: string) => lonKeys.includes(k);
  const push = (id: string, reason: string, personalized: boolean) => {
    if (ALL_ITEMS[id] && !seen.has(id)) {
      seen.add(id);
      out.push({ item: ALL_ITEMS[id], reason, personalized });
    }
  };

  // ── Gap-driven, personalized ──
  if (!hasOura) {
    push("oura-ring", "You haven't connected a recovery tracker yet — this unlocks HRV, sleep, and readiness.", true);
  }
  if (!has("body_fat")) {
    push("inbody-scale", "Your Longevity Score is missing Body Fat (+10 pts available). This scale auto-syncs it.", true);
  }
  if (!has("vo2_max")) {
    push("apple-watch", "Your Longevity Score is missing VO2 Max — the biggest single component at +20 pts.", true);
  }
  if (sleepAvg7d != null && sleepAvg7d < 70) {
    push("mag-glycinate", `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — magnesium supports deeper sleep.`, true);
    push("sleep-mask", `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — a blackout mask is an easy environment fix.`, true);
  }
  if (!hasOura) {
    // Blood pressure isn't tracked without a connected source — surface the BP monitor.
    push("withings-bp", "No blood-pressure source connected — this monitor unlocks the BP signal in your Longevity Score.", true);
  }

  // ── Everything else — honest category rationale ──
  const remaining = Object.values(ALL_ITEMS).filter(it => !seen.has(it.id));
  remaining.sort((a, b) => (a.badge ? 0 : 1) - (b.badge ? 0 : 1));
  for (const it of remaining) {
    push(it.id, CATEGORY_REASON[ITEM_CATEGORY[it.id]] || "An editor's pick worth a look.", false);
  }

  return out;
}

export default function GearPicks({ hasOura, longevityKeys, sleepAvg7d, onJump }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    api.gear.dismissed()
      .then(res => { if (!cancelled) setDismissed(new Set(res.dismissed)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = async (itemId: string) => {
    setDismissed(prev => new Set(prev).add(itemId)); // optimistic
    try { await api.gear.dismiss(itemId); } catch { /* stays hidden locally regardless */ }
  };

  const all     = computeRecommendations(hasOura, longevityKeys, sleepAvg7d);
  const visible = all.filter(r => !dismissed.has(r.item.id));
  const picks   = visible.slice(0, visibleCount);
  if (picks.length === 0) return null;

  const moreAvailable = visibleCount < visible.length;

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
        {picks.map(({ item, reason, personalized }) => (
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

              {/* Why — present on EVERY card */}
              <div className="rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5 my-0.5">
                <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wide mb-0.5">
                  💡 {personalized ? "Why this for you" : "Why we suggest this"}
                </p>
                <p className="text-[11px] text-amber-900 leading-snug">{reason}</p>
              </div>

              <p className="text-[11px] text-gray-500 leading-snug flex-1">
                {item.description}
              </p>

              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[11px] font-semibold text-[#1B3829]">{item.price}</p>
                <span className="text-[10px] text-gray-400" title="Opens in a new tab">↗</span>
              </div>
            </a>

            {/* Dismiss — sibling of the <a>, keeps HTML valid */}
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

      <button
        onClick={() => {
          if (moreAvailable) setVisibleCount(c => c + PAGE);
          else onJump?.();
        }}
        className="mt-2 w-full py-2 rounded-xl border border-[#1B3829]/25 text-[12px] font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors"
      >
        {moreAvailable ? "Give me more suggestions ↓" : "Browse the full shop →"}
      </button>
    </section>
  );
}
