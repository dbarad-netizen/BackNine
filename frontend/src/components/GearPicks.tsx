"use client";

/**
 * GearPicks — personalized product recommendations on the Scorecard.
 *
 * Every card explains WHY it's recommended, and the "why" pulls in the user's
 * actual data wherever a relevant signal exists:
 *   • Gap-driven picks ("Why this for you") cite a missing Longevity Score
 *     component or absent data source.
 *   • Catalog picks become data-aware too ("Why this for you") when a metric
 *     applies — e.g. low sleep average for a sleep product, high training load
 *     for a recovery tool, low steps for fitness gear.
 *   • Only when no signal applies does a card fall back to a category
 *     rationale ("Why we suggest this").
 *
 * Controls: per-card ✕ dismiss (persisted, stays in shop) + "Give me more
 * suggestions" to page through the full catalog.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import GEAR, { type GearItem } from "@/lib/gearData";

const PAGE = 4;

export interface GearSignals {
  hasOura:          boolean;
  longevityKeys:    string[];
  sleepScoreAvg7d:  number | null;
  sleepHrsAvg7d:    number | null;
  stepsAvg7d:       number | null;
  hrvDirection:     "rising" | "falling" | "stable" | null;
  rhrAvg7d:         number | null;
  readinessAvg7d:   number | null;
  trainingLoadZone: string | null;
}

/** Which tab the picks are showing on. Controls which categories are
 *  considered relevant:
 *    scorecard → everything (general health surface)
 *    nutrition → Nutrition + Supplements only
 *    training  → Fitness Equipment + Recovery + Wearables only
 *  Default is "scorecard" so existing call sites stay unchanged. */
export type GearContext = "scorecard" | "nutrition" | "training";

const CONTEXT_CATEGORIES: Record<GearContext, Set<string> | null> = {
  scorecard: null, // null = no filter
  nutrition: new Set(["Nutrition", "Supplements"]),
  training:  new Set(["Fitness Equipment", "Recovery", "Wearables"]),
};

interface Props {
  signals: GearSignals;
  onJump?: () => void;
  /** Where this card is rendered — filters picks to relevant categories. */
  context?: GearContext;
}

interface Recommendation {
  item:         GearItem;
  reason:       string;
  personalized: boolean;
}

const ALL_ITEMS: Record<string, GearItem> = {};
const ITEM_CATEGORY: Record<string, string> = {};
for (const cat of GEAR) {
  for (const item of cat.items) {
    ALL_ITEMS[item.id] = item;
    ITEM_CATEGORY[item.id] = cat.label;
  }
}

const CATEGORY_REASON: Record<string, string> = {
  "Supplements":       "A foundational supplement most people benefit from.",
  "Sleep":             "Better sleep is the highest-leverage recovery investment.",
  "Recovery":          "Helps your body bounce back between hard training days.",
  "Fitness Equipment": "Expands what you can train without a gym.",
  "Wearables":         "More data sources give Coach Al a fuller picture of your health.",
  "Nutrition":         "Makes it easier to hit your daily nutrition targets.",
};

/**
 * Data-aware "why" for a catalog item, or null if no relevant signal applies.
 * Uses the user's real 7-day metrics so the rationale feels earned.
 */
function personalizedReason(item: GearItem, category: string, s: GearSignals): string | null {
  const sleepRelated = category === "Sleep" || item.id === "mag-glycinate" || item.id === "magtech";
  if (sleepRelated) {
    if (s.sleepHrsAvg7d != null && s.sleepHrsAvg7d < 7) {
      return `You've averaged ${s.sleepHrsAvg7d.toFixed(1)}h of sleep this week — below the 7h+ that supports recovery. This can help.`;
    }
    if (s.sleepScoreAvg7d != null && s.sleepScoreAvg7d < 75) {
      return `Your sleep score has averaged ${Math.round(s.sleepScoreAvg7d)} this week — room to improve, and this is a proven lever.`;
    }
  }

  if (category === "Recovery") {
    if (s.trainingLoadZone === "caution" || s.trainingLoadZone === "danger") {
      return "Your training load is running high right now — recovery tools help you absorb it without burning out.";
    }
    if (s.hrvDirection === "falling") {
      return "Your HRV has been trending down lately — extra recovery could help it rebound.";
    }
  }

  if (category === "Fitness Equipment") {
    if (item.id === "rower" && !s.longevityKeys.includes("vo2_max")) {
      return "Cardio builds VO2 Max — the biggest Longevity Score component you haven't unlocked yet.";
    }
    if (s.stepsAvg7d != null && s.stepsAvg7d < 7000) {
      return `You've averaged ${Math.round(s.stepsAvg7d).toLocaleString()} steps/day this week — an easy way to add movement at home.`;
    }
  }

  if (category === "Nutrition" && (item.id === "whey-protein" || item.id === "protein-bars")) {
    if (["optimal", "caution", "danger"].includes(s.trainingLoadZone || "")) {
      return "You're training regularly — protein is what turns that work into muscle.";
    }
  }

  // Resting heart rate elevated → nudge cardio gear
  if (item.id === "polar-h10" && s.rhrAvg7d != null && s.rhrAvg7d > 65) {
    return `Your resting heart rate has averaged ${Math.round(s.rhrAvg7d)} bpm — Zone 2 cardio (tracked accurately here) is the fix.`;
  }

  return null;
}

function computeRecommendations(s: GearSignals): Recommendation[] {
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  const has  = (k: string) => s.longevityKeys.includes(k);
  const push = (id: string, reason: string, personalized: boolean) => {
    if (ALL_ITEMS[id] && !seen.has(id)) {
      seen.add(id);
      out.push({ item: ALL_ITEMS[id], reason, personalized });
    }
  };

  // ── Gap-driven, personalized (highest priority) ──
  if (!s.hasOura) {
    push("oura-ring", "You haven't connected a recovery tracker yet — this unlocks HRV, sleep, and readiness.", true);
  }
  if (!has("body_fat")) {
    push("inbody-scale", "Your Longevity Score is missing Body Fat (+10 pts available). This scale auto-syncs it.", true);
  }
  if (!has("vo2_max")) {
    push("apple-watch", "Your Longevity Score is missing VO2 Max — the biggest single component at +20 pts.", true);
  }
  if (s.sleepScoreAvg7d != null && s.sleepScoreAvg7d < 70) {
    push("mag-glycinate", `Your 7-day sleep score is ${Math.round(s.sleepScoreAvg7d)} — magnesium supports deeper sleep.`, true);
    push("sleep-mask", `Your 7-day sleep score is ${Math.round(s.sleepScoreAvg7d)} — a blackout mask is an easy environment fix.`, true);
  }
  if (!s.hasOura) {
    push("withings-bp", "No blood-pressure source connected — this monitor unlocks the BP signal in your Longevity Score.", true);
  }

  // ── Everything else — data-aware where possible, category rationale otherwise ──
  const remaining = Object.values(ALL_ITEMS).filter(it => !seen.has(it.id));
  remaining.sort((a, b) => (a.badge ? 0 : 1) - (b.badge ? 0 : 1));
  for (const it of remaining) {
    const cat = ITEM_CATEGORY[it.id];
    const dataReason = personalizedReason(it, cat, s);
    if (dataReason) {
      push(it.id, dataReason, true);
    } else {
      push(it.id, CATEGORY_REASON[cat] || "An editor's pick worth a look.", false);
    }
  }

  // Re-sort so data-aware (personalized) picks bubble above purely generic ones,
  // but keep gap-driven ones (already at the front) in place.
  return out;
}

export default function GearPicks({ signals, onJump, context = "scorecard" }: Props) {
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
    setDismissed(prev => new Set(prev).add(itemId));
    try { await api.gear.dismiss(itemId); } catch { /* stays hidden locally regardless */ }
  };

  // Filter by context (tab placement) so the Nutrition tab doesn't show
  // foam rollers and the Training tab doesn't show protein bars stranded.
  // Scorecard keeps the full list. The relevance whitelist is in
  // CONTEXT_CATEGORIES above — edit there if you want to broaden a tab.
  const allowed = CONTEXT_CATEGORIES[context];
  const all     = computeRecommendations(signals)
    .filter(r => !allowed || allowed.has(ITEM_CATEGORY[r.item.id] || ""));
  const visible = all.filter(r => !dismissed.has(r.item.id));
  const picks   = visible.slice(0, visibleCount);
  if (picks.length === 0) return null;

  const moreAvailable = visibleCount < visible.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600">
          Picked For You
        </h3>
        {onJump && (
          <button
            onClick={onJump}
            className="text-[11px] text-gray-600 hover:text-[#1B3829] transition-colors font-medium"
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
              <p className="text-[10px] text-gray-600 uppercase tracking-wide">{item.brand}</p>

              <div className="rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5 my-0.5">
                <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wide mb-0.5">
                  💡 {personalized ? "Why this for you" : "Why we suggest this"}
                </p>
                <p className="text-[11px] text-amber-900 leading-snug">{reason}</p>
              </div>

              <p className="text-[11px] text-gray-600 leading-snug flex-1">{item.description}</p>

              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[11px] font-semibold text-[#1B3829]">{item.price}</p>
                <span className="text-[10px] text-gray-600" title="Opens in a new tab">↗</span>
              </div>
            </a>

            <button
              onClick={() => handleDismiss(item.id)}
              className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 border border-gray-200 text-gray-600 hover:text-red-500 hover:border-red-200 text-[11px] leading-none flex items-center justify-center transition-colors shadow-sm"
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
