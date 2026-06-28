"use client";

/**
 * TodaysTagsCard — small pill row of Oura tags logged today.
 *
 * Tags come from Oura's enhanced_tag system: sauna, ice bath, meditation,
 * alcohol, caffeine after 2pm, late meal, stressful day, travel, etc.
 * Renders as a single-row chip strip at the top of the Scorecard, just
 * above the Daily Check-in card. Renders nothing when no tags exist for
 * today — keeps the Scorecard clean for new / non-tag-using users.
 */

import { useEffect, useState } from "react";
import { api, type OuraTag } from "@/lib/api";

// Privacy-sensitive categories get a slightly muted treatment so the
// user doesn't feel like alcohol / period / intimacy are being broadcast.
// (None of these tag types are auto-posted to friends — see SAFE_TAGS
// in backend/oura_tags.py — but visual softness reinforces it.)
function chipClass(category: string): string {
  switch (category) {
    case "recovery": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "lifestyle":return "bg-amber-100 text-amber-900 border-amber-200";
    case "life":     return "bg-indigo-100 text-indigo-800 border-indigo-200";
    case "health":   return "bg-rose-100 text-rose-800 border-rose-200";
    case "private":  return "bg-pink-50 text-pink-800 border-pink-200";
    case "tracking": return "bg-sky-100 text-sky-800 border-sky-200";
    default:         return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export default function TodaysTagsCard() {
  const [tags, setTags]   = useState<OuraTag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.ouraTags(7)
      .then(r => setTags(r.today || []))
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading || tags.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1.5">
        Today&apos;s Oura tags
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(t => (
          <span
            key={t.id}
            className={`inline-flex items-center text-[11px] font-medium px-2 py-1 rounded-full border ${chipClass(t.display.category)}`}
            title={t.comment || t.display.label}
          >
            <span className="mr-1">{t.display.emoji}</span>
            {t.display.label}
            {t.comment && <span className="ml-1 opacity-70 italic">· {t.comment.slice(0, 40)}</span>}
          </span>
        ))}
      </div>
    </section>
  );
}
