"use client";

/**
 * DataFreshnessBadge — visible staleness stamp for dashboard tiles.
 *
 * Fable IMPROVE #2, applied at the UI layer. Without this, tiles
 * silently rendered 9-day-old numbers labeled "today" — the exact
 * credibility killer flagged in the re-eval.
 *
 * Renders NOTHING when data is fresh (< 12h). Renders a muted "as of
 * yesterday" line in the yellow zone (12-48h). Renders an amber pill
 * when stale (> 48h) so the user sees at a glance that this number
 * doesn't reflect right now.
 *
 * The badge takes just the freshness stamp; source-labeling ("Oura")
 * is the caller's responsibility.
 */

import type { DataFreshnessSource } from "@/lib/api";

interface Props {
  freshness?: DataFreshnessSource | null;
  className?: string;
  /** Style override — 'inline' for a small in-tile chip, 'block' for
   *  a full-width warning line. Defaults to inline. */
  variant?: "inline" | "block";
}

function humanizeAge(hours: number): string {
  if (hours < 1)  return "just now";
  if (hours < 2)  return "1h ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7)   return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return "1 week ago";
  return `${weeks} weeks ago`;
}

export default function DataFreshnessBadge({ freshness, className, variant = "inline" }: Props) {
  if (!freshness || freshness.data_age_hours == null) return null;
  if (freshness.is_fresh) return null;   // silent when fresh

  const label = humanizeAge(freshness.data_age_hours);

  if (variant === "block" && freshness.is_stale) {
    return (
      <div className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-snug ${className || ""}`}>
        ⚠ These numbers are from <strong>{label}</strong>. Reconnect or check your device sync before treating them as current.
      </div>
    );
  }

  // Inline chip — either a soft "as of yesterday" for yellow zone, or an
  // amber "stale" chip for >48h.
  const tone = freshness.is_stale
    ? "bg-amber-100 text-amber-900 border-amber-300"
    : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap ${tone} ${className || ""}`}
      title={freshness.is_stale
        ? "This data is more than 48h old. Reconnect your device or sync manually."
        : "This data is between 12h and 48h old."}
    >
      as of {label}
    </span>
  );
}
