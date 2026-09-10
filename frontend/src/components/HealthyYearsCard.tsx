"use client";

/**
 * HealthyYearsCard — the QYL Index ("Quality Years Left"), the
 * Scorecard hero that
 * answers the question the whole app orbits: how much good time is
 * left, and is it growing?
 *
 * David 2026-09-06 ("could we add a death date?"); named by Chris
 * 2026-09-10 — QYL deliberately echoes QALY, the health-economics
 * term, which fits the doctor-layer positioning. Deliberately NOT a
 * death date: framed as projected ACTIVE years (actuarial baseline ×
 * healthy fraction, evaluated at biological age), with an honest range
 * and a bonus line showing what the user's markers buy them. The name
 * of the app is the thesis: play the back nine well.
 */

import { useState } from "react";
import type { BiologicalAge } from "@/lib/api";

interface Props {
  bio: BiologicalAge;
}

export default function HealthyYearsCard({ bio }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const hy = bio.healthy_years;
  if (!hy || hy.years == null) return null;

  const bonus = hy.bonus_years ?? 0;

  return (
    <section className="rounded-2xl border border-[#1B3829]/20 bg-gradient-to-br from-white via-white to-[#1B3829]/[0.04] p-5 space-y-3">
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

      <p className="text-[12px] text-gray-700">
        That&apos;s the back nine. Sleep, movement, and the numbers on this
        page are how you play it.
      </p>

      <button
        onClick={() => setShowWhy(v => !v)}
        className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
      >
        {showWhy ? "▲ Hide" : "How is this computed?"}
      </button>
      {showWhy && (
        <p className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl p-3">
          Actuarial life tables for your age and sex, scaled to
          disability-free years (~70% of remaining years for US adults),
          evaluated at your <span className="font-medium">biological</span> age
          of {bio.biological_age} instead of your birthday age
          {bio.chronological_age != null ? ` of ${bio.chronological_age}` : ""}.
          {" "}{hy.caveat}
        </p>
      )}
    </section>
  );
}
