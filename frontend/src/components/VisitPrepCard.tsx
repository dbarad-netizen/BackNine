"use client";

/**
 * VisitPrepCard — appears on the Scorecard when a doctor visit is within
 * the next 14 days OR was within the last 21 days (post-visit capture
 * window). Self-hides when there's nothing active.
 *
 * Timeline phases the backend returns:
 *   t_minus_14  → "Your visit is 2 weeks out — let's start prepping."
 *   t_minus_3   → "Three days out — review your draft questions."
 *   t_minus_1   → "Visit tomorrow — packet is ready."
 *   visit_day   → "Visit today — bring your packet."
 *   post_visit  → "Just back from your visit — 3 quick captures."
 *
 * Each phase surfaces a different primary CTA. All navigate into the
 * dedicated Doctor Visits page for the full workflow.
 */

import { useEffect, useState } from "react";
import { api, type DoctorVisit, type VisitPrepPhase } from "@/lib/api";

interface Props {
  /** Parent hook to navigate into the Doctor Visits page. */
  onOpen?: (visitId: string) => void;
}

const PROVIDER_LABEL: Record<DoctorVisit["provider_type"], string> = {
  primary_care:   "Primary care",
  cardiology:     "Cardiology",
  urology:        "Urology",
  endocrinology:  "Endocrinology",
  dermatology:    "Dermatology",
  orthopedics:    "Orthopedics",
  other:          "Other",
};

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function phaseCopy(phase: VisitPrepPhase, days: number): { title: string; body: string; cta: string } {
  switch (phase) {
    case "t_minus_14":
      return {
        title: `Your visit is in ${days} day${days === 1 ? "" : "s"}`,
        body:  "Let's start prepping. Take BP readings on 5 of the next 14 days — it's the gap doctors flag most.",
        cta:   "Open prep",
      };
    case "t_minus_3":
      return {
        title: `Three days out`,
        body:  "Draft questions are ready. Review, edit, and add anything you want to raise.",
        cta:   "Review questions",
      };
    case "t_minus_1":
      return {
        title: `Visit tomorrow`,
        body:  "Your packet is ready — print it or share the link with your doctor's office.",
        cta:   "Open packet",
      };
    case "visit_day":
      return {
        title: `Visit today`,
        body:  "Bring your packet. Good luck — capture the outcome tomorrow.",
        cta:   "Open packet",
      };
    case "post_visit":
      return {
        title: `How did the visit go?`,
        body:  "3 quick captures: upload new labs, update meds, add a note. All optional.",
        cta:   "Capture outcome",
      };
    default:
      return { title: "Doctor visit", body: "", cta: "Open" };
  }
}

export default function VisitPrepCard({ onOpen }: Props) {
  const [visit,  setVisit]  = useState<DoctorVisit | null>(null);
  const [phase,  setPhase]  = useState<VisitPrepPhase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.activeVisit();
        if (!cancelled) {
          setVisit(r.visit || null);
          setPhase(r.prep_phase || null);
        }
      } catch { if (!cancelled) setVisit(null); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !visit || !phase || phase === "closed" || phase === "future") return null;

  const days   = daysUntil(visit.visit_date);
  const copy   = phaseCopy(phase, Math.max(1, days));
  const ptype  = PROVIDER_LABEL[visit.provider_type] || "Visit";
  const isPost = phase === "post_visit";

  return (
    <section
      className={`rounded-2xl border shadow-sm p-4 space-y-2 ${
        isPost
          ? "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white"
          : "border-[#1B3829]/25 bg-gradient-to-br from-white via-white to-[#F4F1EA]"
      }`}
      aria-label="Doctor visit prep"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-widest ${
            isPost ? "text-amber-800" : "text-[#2D6A4F]"
          }`}>
            🩺 {ptype}
          </p>
          <h3 className="text-base font-bold text-[#1B3829] mt-0.5 leading-tight">
            {copy.title}
          </h3>
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-gray-600">
          {new Date(visit.visit_date + "T00:00:00").toLocaleDateString(undefined, {
            month: "short", day: "numeric",
          })}
        </span>
      </div>

      {copy.body && (
        <p className="text-[12px] text-gray-700 leading-snug">{copy.body}</p>
      )}

      <button
        onClick={() => onOpen?.(visit.id)}
        className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${
          isPost
            ? "bg-amber-600 hover:bg-amber-700 text-white"
            : "bg-[#1B3829] hover:bg-[#2D6A4F] text-white"
        }`}
      >
        {copy.cta}
      </button>
    </section>
  );
}
