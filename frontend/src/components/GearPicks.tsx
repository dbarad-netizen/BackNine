"use client";

/**
 * GearPicks — two product recommendations on the Scorecard, chosen by detecting
 * gaps in the user's tracked data.
 *
 * Priority order of gaps (highest first):
 *   1. No Oura connected      → Oura Ring Gen 4
 *   2. No body fat % data     → InBody scale
 *   3. No VO2 max data        → Apple Watch
 * Fallback (no gaps): two editor's picks from the catalog.
 *
 * Tap a card to jump to the Gear tab.
 */

import GEAR, { type GearItem } from "@/lib/gearData";

interface Props {
  /** True if the user has connected an Oura Ring. */
  hasOura: boolean;
  /** Keys of scored longevity components, e.g. ["hrv","rhr","vo2_max","sleep","body_fat","steps"]. */
  longevityKeys: string[];
  /** Callback when a card is tapped — usually setSection("gear"). */
  onJump?: () => void;
}

// Flatten the catalog into a single map of id → item for quick lookups.
const ALL_ITEMS: Record<string, GearItem> = (() => {
  const out: Record<string, GearItem> = {};
  for (const cat of GEAR) for (const item of cat.items) out[item.id] = item;
  return out;
})();

function pickByGaps(hasOura: boolean, lonKeys: string[]): GearItem[] {
  const picked: GearItem[] = [];
  const has = (k: string) => lonKeys.includes(k);

  if (!hasOura && ALL_ITEMS["oura-ring"]) picked.push(ALL_ITEMS["oura-ring"]);
  if (picked.length < 2 && !has("body_fat") && ALL_ITEMS["inbody-scale"]) picked.push(ALL_ITEMS["inbody-scale"]);
  if (picked.length < 2 && !has("vo2_max") && ALL_ITEMS["apple-watch"])  picked.push(ALL_ITEMS["apple-watch"]);

  // Fallback: editor's picks the user doesn't already have implied
  const fallback: string[] = ["creatine", "mag-glycinate", "foam-roller"];
  for (const id of fallback) {
    if (picked.length >= 2) break;
    if (ALL_ITEMS[id] && !picked.some(p => p.id === id)) picked.push(ALL_ITEMS[id]);
  }
  return picked.slice(0, 2);
}

// Pick a contextual "why" line for each gap-driven recommendation.
function whyFor(item: GearItem, hasOura: boolean, lonKeys: string[]): string {
  if (item.id === "oura-ring" && !hasOura) {
    return "Unlock recovery, sleep, and HRV tracking";
  }
  if (item.id === "inbody-scale" && !lonKeys.includes("body_fat")) {
    return "+10 longevity pts — adds body composition";
  }
  if (item.id === "apple-watch" && !lonKeys.includes("vo2_max")) {
    return "+20 longevity pts — adds VO2 Max + HRV";
  }
  if (item.id === "creatine") return "Most-researched performance supplement";
  if (item.id === "mag-glycinate") return "Supports deeper, more restorative sleep";
  if (item.id === "foam-roller") return "A daily recovery staple";
  return item.description.split(".")[0];
}

export default function GearPicks({ hasOura, longevityKeys, onJump }: Props) {
  const picks = pickByGaps(hasOura, longevityKeys);
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
        {picks.map(item => (
          <button
            key={item.id}
            onClick={onJump}
            className="text-left rounded-2xl border border-gray-200 bg-white p-3 hover:border-[#1B3829]/30 hover:shadow-sm transition-all flex flex-col gap-1.5"
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
            <p className="text-[11px] text-gray-500 leading-snug flex-1">
              {whyFor(item, hasOura, longevityKeys)}
            </p>
            <p className="text-[11px] font-semibold text-[#1B3829] mt-1">{item.price}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
