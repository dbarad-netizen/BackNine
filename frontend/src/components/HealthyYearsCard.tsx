"use client";

/**
 * HealthyYearsCard — the QYL Index ("Quality Years Left"), the HORIZON
 * stop and terminal card of the Scorecard spine.
 *
 * David 2026-09-06 ("could we add a death date?"); named by Chris
 * 2026-09-10 — QYL deliberately echoes QALY, the health-economics term.
 * Deliberately NOT a death date: framed as projected ACTIVE years
 * (actuarial baseline × healthy fraction, evaluated at biological age),
 * with an honest range and a bonus line showing what the user's markers
 * buy them. The name of the app is the thesis: play the back nine well.
 *
 * Option B spine redesign (2026-09-10): this card carries the spine's
 * ONLY accent border — everything upstream funnels into this number.
 * The "How is this computed?" expander moved to the shared
 * SpineBreakdown drawer; the share button moved HERE from Bio Age
 * (QYL-led sharing per the QYL Index experiment).
 */

import type { BiologicalAge } from "@/lib/api";

interface Props {
  bio: BiologicalAge;
  /** Opens the ShareCardModal (pre-set to the QYL card, its first tab). */
  onShare?: () => void;
}

export default function HealthyYearsCard({ bio, onShare }: Props) {
  const hy = bio.healthy_years;
  if (!hy || hy.years == null) return null;

  const bonus = hy.bonus_years ?? 0;

  return (
    <section className="rounded-2xl border-2 border-[#1B3829]/50 bg-gradient-to-br from-white via-white to-[#1B3829]/[0.05] p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 flex items-center gap-1.5">
          ⛳ Quality years left
          <span className="normal-case tracking-normal text-[9px] font-bold text-[#1B3829] bg-[#1B3829]/10 rounded px-1.5 py-0.5">
            QYL Index
          </span>
        </p>
        <span className="text-[10px] text-gray-500">likely {hy.low}–{hy.high}</span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-bold text-[#1B3829] leading-none">
          ~{Math.round(hy.years)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">
            quality years projected — active and independent
          </p>
          <p className="text-[12px] text-gray-600 leading-tight mt-0.5">
            {bonus > 0.05 ? (
              <>your Bio Age is buying you <span className="font-semibold text-[#1B3829]">+{bonus.toFixed(1)}</span> of them</>
            ) : bonus < -0.05 ? (
              <>your Bio Age is costing <span className="font-semibold text-amber-700">{Math.abs(bonus).toFixed(1)}</span> of them — that&apos;s recoverable</>
            ) : (
              <>right at the average for your age — every marker you move adds time</>
            )}
          </p>
        </div>
      </div>

      {onShare && (
        <div className="flex justify-end">
          <button
            onClick={onShare}
            className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors"
            title="Share your QYL Index"
          >
            📣 Share
          </button>
        </div>
      )}
    </section>
  );
}
