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
  const [tags, setTags]           = useState<OuraTag[]>([]);
  const [totalRecent, setTotalRecent] = useState<number>(0);
  const [loading, setLoading]     = useState(true);
  const [dismissedHint, setDismissedHint] = useState(false);

  useEffect(() => {
    api.ouraTags(30)
      .then(r => {
        setTags(r.today || []);
        setTotalRecent((r.tags || []).length);
      })
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
    // Discovery hint dismissal is remembered locally so we don't nag
    // once a user has seen it. Once they log ANY tag we hide it
    // permanently anyway (below).
    if (typeof window !== "undefined") {
      setDismissedHint(window.localStorage.getItem("bn_tags_hint_dismissed") === "1");
    }
  }, []);

  if (loading) return null;

  // Discovery hint: David 2026-07-09 — "I don't see where things
  // tagged in Oura are showing up." Root cause was 0 tag rows because
  // he hadn't used the tag feature in Oura yet. The card was silently
  // invisible, so the feature felt broken. When we have zero tags in
  // the last 30 days, show a compact "How to tag your day" hint the
  // first time, dismissible.
  if (tags.length === 0 && totalRecent === 0 && !dismissedHint) {
    return (
      <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-sky-800 mb-1">
              💡 Where&rsquo;s my Oura tag data?
            </p>
            <p className="text-[12px] text-gray-800 leading-snug">
              Tags come from the Oura app — open it, tap the sun icon on
              any day, and log things like sauna, alcohol, or late meal.
              BackNine picks them up on the next sync and correlates
              them with your sleep + HRV automatically.
            </p>
          </div>
          <button
            onClick={() => {
              setDismissedHint(true);
              try { window.localStorage.setItem("bn_tags_hint_dismissed", "1"); } catch {}
            }}
            className="shrink-0 text-gray-500 hover:text-gray-900 text-lg leading-none px-1"
            title="Got it — hide"
            aria-label="Dismiss tag hint"
          >×</button>
        </div>
      </section>
    );
  }

  if (tags.length === 0) return null;

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
