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
 * ONLY accent border. Share lives here (QYL-led sharing).
 *
 * Provisional mode (2026-09-21, competitive review): a brand-new user
 * with only age/sex gets the actuarial STARTING estimate immediately —
 * labeled as such, no bonus line, no share — so the first minute in
 * BackNine shows a number instead of an empty spine. Swaps to the real
 * projection automatically once Bio Age can compute.
 */

import { useState } from "react";
import type { BiologicalAge, DashboardData } from "@/lib/api";

type Provisional = NonNullable<DashboardData["provisional_qyl"]>;

interface Props {
  bio?: BiologicalAge | null;
  provisional?: Provisional | null;
  /** Opens the ShareCardModal (pre-set to the QYL card, its first tab). */
  onShare?: () => void;
}

export default function HealthyYearsCard({ bio, provisional, onShare }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const real = bio?.healthy_years;
  const isProvisional = !real && !!provisional;
  const hy = real ?? provisional;
  if (!hy || hy.years == null) return null;

  const bonus = hy.bonus_years ?? 0;
  const chronAge = isProvisional ? provisional!.chronological_age : bio?.chronological_age;

  return (
    <section className="rounded-2xl border-2 border-[#1B3829]/50 bg-gradient-to-br from-white via-white to-[#1B3829]/[0.05] p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 flex items-center gap-1.5">
          ⛳ Quality years left
          <span className="normal-case tracking-normal text-[9px] font-bold text-[#1B3829] bg-[#1B3829]/10 rounded px-1.5 py-0.5">
            QYL Index
          </span>
          {isProvisional && (
            <span className="normal-case tracking-normal text-[9px] font-bold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5">
              starting estimate
            </span>
          )}
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
            {isProvisional ? (
              <>the average for a {chronAge}-year-old — connect Apple Health or Oura and this becomes <span className="font-semibold text-[#1B3829]">yours</span></>
            ) : bonus > 0.05 ? (
              <>your Bio Age is buying you <span className="font-semibold text-[#1B3829]">+{bonus.toFixed(1)}</span> of them</>
            ) : bonus < -0.05 ? (
              <>your Bio Age is costing <span className="font-semibold text-amber-700">{Math.abs(bonus).toFixed(1)}</span> of them — that&apos;s recoverable</>
            ) : (
              <>right at the average for your age — every marker you move adds time</>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {/* Under the hood (David 2026-09-21) — methodology restored to
            the card after the shared spine drawer proved too buried. */}
        <button
          onClick={() => setShowWhy(v => !v)}
          className="text-[11px] font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          {showWhy ? "▲ Hide" : "▼ Under the hood"}
        </button>
        {onShare && !isProvisional && (
          <button
            onClick={onShare}
            className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors"
            title="Share your QYL Index"
          >
            📣 Share
          </button>
        )}
      </div>
      {showWhy && (
        <p className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl p-3">
          Actuarial life tables for your age and sex, scaled to
          disability-free years (~70% of remaining years for US adults)
          {isProvisional ? (
            <>. This starting estimate uses your birthday age only. Once BackNine
            has three or more of your markers (HRV, resting heart rate, VO₂ max,
            sleep, blood pressure, labs), it evaluates the same tables at your{" "}
            <span className="font-medium">biological</span> age instead — that&apos;s
            where the number becomes personal.</>
          ) : (
            <>, evaluated at your <span className="font-medium">biological</span> age
            of {bio?.biological_age} instead of your birthday age
            {chronAge != null ? ` of ${chronAge}` : ""}.</>
          )}
          {" "}{hy.caveat}
        </p>
      )}
    </section>
  );
}
