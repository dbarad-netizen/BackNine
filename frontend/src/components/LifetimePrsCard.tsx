"use client";

/**
 * LifetimePrsCard — "Your PRs" panel for the Training tab.
 *
 * Reads from /api/training/lifetime-prs. The endpoint returns the user's
 * single best estimated-1RM session for each exercise they've logged in the
 * last 365 days, sorted by recency of the PR. We render a horizontal-scroll
 * strip of chips so a guy with 12 PRs to brag about doesn't push the rest of
 * the Training tab off-screen.
 *
 * Renders nothing while loading or when the user has no lifting history yet
 * — the Training tab stays clean for new users. The PR badges on individual
 * sessions still call out a 🏆 PR even before this panel populates, so the
 * progression motivation loop is intact from day one.
 */

import { useEffect, useState } from "react";
import { api, type LifetimePr } from "@/lib/api";

function relativeDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0)   return "today";
  if (days === 1)  return "yesterday";
  if (days < 7)    return `${days}d ago`;
  if (days < 30)   return `${Math.floor(days / 7)}w ago`;
  if (days < 365)  return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function LifetimePrsCard() {
  const [prs,     setPrs]     = useState<LifetimePr[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.lifetimePrs(12)
      .then(r => setPrs(r.prs || []))
      .catch(() => setPrs([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (prs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800">Your PRs</p>
          <h3 className="text-sm font-bold text-gray-900">Lifetime bests · estimated 1RM</h3>
        </div>
        <span className="text-[10px] text-gray-600">{prs.length} {prs.length === 1 ? "lift" : "lifts"}</span>
      </div>

      {/* Horizontal scroll strip — feels native on mobile and keeps the
          Training tab from getting a 12-row PR brag list. Most-recent PRs
          come first per the server sort. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
        {prs.map((p, i) => (
          <div
            key={`${p.exercise}-${i}`}
            className="snap-start shrink-0 w-40 rounded-xl border border-amber-200 bg-white p-3"
            title={`Set on ${p.date}`}
          >
            <p className="text-sm font-semibold text-gray-900 capitalize truncate">
              🏆 {p.exercise}
            </p>
            <p className="text-lg font-bold text-amber-800 leading-tight mt-1">
              {p.e1rm_lbs} <span className="text-xs font-medium text-gray-600">lb e1RM</span>
            </p>
            <p className="text-[11px] text-gray-700 mt-0.5">
              {p.top_weight_lbs} lb × {p.top_reps}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">{relativeDate(p.date)}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-600 italic mt-2">
        e1RM uses Epley (weight × (1 + reps/30)). Beat any number above and Coach Al will tag it 🏆.
      </p>
    </section>
  );
}
