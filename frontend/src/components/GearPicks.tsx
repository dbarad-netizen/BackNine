"use client";

/**
 * GearPicks — personalized product recommendations on the Scorecard.
 *
 * Shows 4 picks up front, ordered by relevance to the user's data. A
 * "Give me more suggestions" button reveals the next batch from a candidate
 * list that spans the whole gear shop — gap-driven picks first (with a
 * "why this for you" explanation), then the rest of the catalog. Once the
 * catalog is exhausted the button becomes "Browse the full shop →".
 *
 * Entirely client-side — no backend, no persistence.
 *
 * Gap-driven priority (most personalized first):
 *   1. No Oura connected          → Oura Ring
 *   2. No body fat in longevity   → InBody scale
 *   3. No VO2 Max in longevity    → Apple Watch
 *   4. 7-day sleep avg < 70       → Magnesium, then Sleep Mask
 * Then every other catalog item, so "more" can surface the entire shop.
 */

import { useState } from "react";
import GEAR, { type GearItem } from "@/lib/gearData";

const PAGE = 4; // how many to reveal at a time

interface Props {
  hasOura: boolean;
  longevityKeys: string[];
  sleepAvg7d?: number | null;
  onJump?: () => void;
}

interface Recommendation {
  item:    GearItem;
  trigger: string | null;   // personalized reason; null = generic catalog pick
  benefit: string;
}

// Flatten the catalog, remembering each item's category label.
const ALL_ITEMS: Record<string, GearItem> = {};
const ITEM_CATEGORY: Record<string, string> = {};
for (const cat of GEAR) {
  for (const item of cat.items) {
    ALL_ITEMS[item.id] = item;
    ITEM_CATEGORY[item.id] = cat.label;
  }
}

function firstSentence(text: string): string {
  const i = text.indexOf(".");
  return i > 0 ? text.slice(0, i + 1) : text;
}

function computeRecommendations(
  hasOura: boolean,
  lonKeys: string[],
  sleepAvg7d: number | null | undefined,
): Recommendation[] {
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  const has  = (k: string) => lonKeys.includes(k);
  const push = (id: string, trigger: string | null, benefit: string) => {
    if (ALL_ITEMS[id] && !seen.has(id)) {
      seen.add(id);
      out.push({ item: ALL_ITEMS[id], trigger, benefit });
    }
  };

  // ── Gap-driven picks first (personalized "why this for you") ──
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

  // ── Then the rest of the catalog (generic — no forced "why") ──
  // Editor's picks bubble up first within the remaining set.
  const remaining = Object.values(ALL_ITEMS).filter(it => !seen.has(it.id));
  remaining.sort((a, b) => (a.badge ? 0 : 1) - (b.badge ? 0 : 1));
  for (const it of remaining) {
    push(it.id, null, firstSentence(it.description));
  }

  return out;
}

export default function GearPicks({ hasOura, longevityKeys, sleepAvg7d, onJump }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE);

  const all   = computeRecommendations(hasOura, longevityKeys, sleepAvg7d);
  const picks = all.slice(0, visibleCount);
  if (picks.length === 0) return null;

  const moreAvailable = visibleCount < all.length;

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
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-left rounded-2xl border border-gray-200 bg-white p-3 hover:border-[#1B3829]/30 hover:shadow-sm transition-all flex flex-col gap-1.5 no-underline"
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

            {trigger ? (
              <div className="rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5 my-0.5">
                <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wide mb-0.5">
                  💡 Why this for you
                </p>
                <p className="text-[11px] text-amber-900 leading-snug">{trigger}</p>
              </div>
            ) : (
              <p className="text-[9px] text-gray-300 uppercase tracking-wide">{ITEM_CATEGORY[item.id]}</p>
            )}

            <p className="text-[11px] text-gray-500 leading-snug flex-1">{benefit}</p>

            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[11px] font-semibold text-[#1B3829]">{item.price}</p>
              <span className="text-[10px] text-gray-400" title="Opens in a new tab">↗</span>
            </div>
          </a>
        ))}
      </div>

      {/* More suggestions / browse-all */}
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
