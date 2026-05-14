"use client";

/**
 * GearPicks — two product recommendations on the Scorecard, each with a
 * transparent "why this for you" explanation.
 *
 * Every recommendation has two parts:
 *   • trigger — the specific signal in the user's data that made this relevant
 *                (e.g. "Your Longevity Score is missing VO2 Max")
 *   • benefit — what the product unlocks for them
 *                (e.g. "Tracks VO2 Max + HRV during workouts")
 *
 * Both lines are visible on the card so the user always knows why we picked
 * this for them — recommendations that explain themselves get trusted.
 *
 * Priority order:
 *   1. No Oura connected          → Oura Ring  (recovery/sleep/HRV gap)
 *   2. No body fat in longevity   → InBody scale  (+10 pts available)
 *   3. No VO2 Max in longevity    → Apple Watch  (+20 pts available)
 *   4. 7-day sleep avg < 70       → Magnesium Glycinate  (sleep-quality gap)
 *   5. Fallback (no gaps detected) → editor's picks marked as such
 */

import GEAR, { type GearItem } from "@/lib/gearData";

interface Props {
  /** True if the user has connected an Oura Ring. */
  hasOura: boolean;
  /** Keys of scored longevity components, e.g. ["hrv","rhr","vo2_max","sleep","body_fat","steps"]. */
  longevityKeys: string[];
  /** 7-day average sleep score (0–100), if available. */
  sleepAvg7d?: number | null;
  /** Callback when a card is tapped — usually setSection("gear"). */
  onJump?: () => void;
}

interface Recommendation {
  item:    GearItem;
  trigger: string;   // why this is relevant to THIS user's data
  benefit: string;   // what the product does for them
}

// Flatten the catalog into a single map for quick lookups.
const ALL_ITEMS: Record<string, GearItem> = (() => {
  const out: Record<string, GearItem> = {};
  for (const cat of GEAR) for (const item of cat.items) out[item.id] = item;
  return out;
})();


function computeRecommendations(
  hasOura: boolean,
  lonKeys: string[],
  sleepAvg7d: number | null | undefined,
): Recommendation[] {
  const out: Recommendation[] = [];
  const has = (k: string) => lonKeys.includes(k);

  // 1. Oura Ring — if no recovery tracker connected
  if (!hasOura && ALL_ITEMS["oura-ring"]) {
    out.push({
      item:    ALL_ITEMS["oura-ring"],
      trigger: "You haven't connected a recovery tracker yet.",
      benefit: "Unlocks HRV, sleep stages, and the readiness score Coach Al relies on.",
    });
  }

  // 2. InBody scale — if Longevity Score has no Body Fat component
  if (out.length < 2 && !has("body_fat") && ALL_ITEMS["inbody-scale"]) {
    out.push({
      item:    ALL_ITEMS["inbody-scale"],
      trigger: "Your Longevity Score is missing the Body Fat component (+10 pts available).",
      benefit: "Clinical-grade body composition at home, auto-syncs to Apple Health.",
    });
  }

  // 3. Apple Watch — if Longevity Score has no VO2 Max
  if (out.length < 2 && !has("vo2_max") && ALL_ITEMS["apple-watch"]) {
    out.push({
      item:    ALL_ITEMS["apple-watch"],
      trigger: "Your Longevity Score is missing VO2 Max — the single biggest component at +20 pts.",
      benefit: "Tracks VO2 Max during workouts, plus HRV and steps.",
    });
  }

  // 4. Magnesium — if 7-day sleep score is below 70
  if (out.length < 2 && sleepAvg7d != null && sleepAvg7d < 70 && ALL_ITEMS["mag-glycinate"]) {
    out.push({
      item:    ALL_ITEMS["mag-glycinate"],
      trigger: `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — below the 70 we'd want to see.`,
      benefit: "Magnesium glycinate supports deeper sleep and muscle recovery.",
    });
  }

  // 5. Sleep Mask — also for low sleep, as a non-supplement option
  if (out.length < 2 && sleepAvg7d != null && sleepAvg7d < 70 && ALL_ITEMS["sleep-mask"]) {
    out.push({
      item:    ALL_ITEMS["sleep-mask"],
      trigger: `Your 7-day sleep average is ${Math.round(sleepAvg7d)} — environment matters more than people think.`,
      benefit: "100% blackout, zero eye pressure — measurable sleep-quality lift in any room.",
    });
  }

  // 6. Editor's-pick fallbacks (honest about being defaults)
  const fallback: Array<{ id: string; benefit: string }> = [
    {
      id: "creatine",
      benefit: "One of the most-researched performance supplements — 5g daily.",
    },
    {
      id: "foam-roller",
      benefit: "Multi-density surface for targeted myofascial release.",
    },
    {
      id: "omega3",
      benefit: "High-potency EPA/DHA for cardiovascular health and inflammation.",
    },
  ];
  for (const { id, benefit } of fallback) {
    if (out.length >= 2) break;
    if (ALL_ITEMS[id] && !out.some(r => r.item.id === id)) {
      out.push({
        item:    ALL_ITEMS[id],
        trigger: "No specific gap in your data — this is an editor's pick.",
        benefit,
      });
    }
  }

  return out.slice(0, 2);
}


export default function GearPicks({ hasOura, longevityKeys, sleepAvg7d, onJump }: Props) {
  const picks = computeRecommendations(hasOura, longevityKeys, sleepAvg7d);
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

            {/* Why this for you — the explicit reason */}
            <div className="rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5 my-0.5">
              <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wide mb-0.5">
                💡 Why this for you
              </p>
              <p className="text-[11px] text-amber-900 leading-snug">{trigger}</p>
            </div>

            {/* Benefit — what the product does */}
            <p className="text-[11px] text-gray-500 leading-snug flex-1">{benefit}</p>

            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[11px] font-semibold text-[#1B3829]">{item.price}</p>
              <span className="text-[10px] text-gray-400" title="Opens in a new tab">↗</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
