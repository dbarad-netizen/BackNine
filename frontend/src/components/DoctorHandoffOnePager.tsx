"use client";

/**
 * DoctorHandoffOnePager — the primary, marketable doctor handoff.
 *
 * Fable IMPROVE #1: doctors give a printout ~30 seconds. This is the
 * one-page clinical summary — trends, flags, meds/supplements, patient
 * reported symptoms, latest labs. The seven detailed tab reports remain
 * available behind it as specialty views.
 *
 * Design principles enforced in code:
 *   1. Ruthlessly one-page — each section is capped.
 *   2. Trends as directional arrows (↑/↓/→) with a magnitude, not raw
 *      charts. Doctors spot direction in seconds.
 *   3. Flags are objective, threshold-driven. No AI narration on the
 *      one-pager itself.
 *
 * Print-friendly: uses the same #bn-doctor-report-print id + @media
 * print CSS trick as the existing seven-tab modal so "print" works.
 */

import { useEffect, useState } from "react";
import { api, type DoctorOnePagerPayload } from "@/lib/api";

function ArrowSpan({ arrow }: { arrow: "↑" | "↓" | "→" }) {
  const tone =
    arrow === "↑" ? "text-rose-600"
    : arrow === "↓" ? "text-emerald-600"
    : "text-gray-500";
  return <span className={`font-mono ${tone}`}>{arrow}</span>;
}

// Same helper for lower-is-better metrics (RHR, BP) — a rising arrow is
// worse in those columns. For HRV and sleep, up is good.
function ArrowSpanLowerBetter({ arrow }: { arrow: "↑" | "↓" | "→" }) {
  const tone =
    arrow === "↑" ? "text-rose-600"
    : arrow === "↓" ? "text-emerald-600"
    : "text-gray-500";
  return <span className={`font-mono ${tone}`}>{arrow}</span>;
}
function ArrowSpanHigherBetter({ arrow }: { arrow: "↑" | "↓" | "→" }) {
  const tone =
    arrow === "↑" ? "text-emerald-600"
    : arrow === "↓" ? "text-rose-600"
    : "text-gray-500";
  return <span className={`font-mono ${tone}`}>{arrow}</span>;
}

export default function DoctorHandoffOnePager() {
  const [data,    setData]    = useState<DoctorOnePagerPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.doctorOnePager()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-gray-600 italic">Couldn&apos;t load the one-pager. Try refreshing.</p>;
  }

  const { snapshot, vitals, flags, stack, patient_reported, labs } = data;

  return (
    <article id="bn-doctor-report-print" className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-900">
      {/* Print title */}
      <header className="border-b border-gray-200 pb-3 mb-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Doctor Handoff · One-page summary</p>
        <div className="flex items-baseline justify-between gap-3 mt-1">
          <h2 className="text-lg font-bold">
            {snapshot.name ?? "Patient"}
            {snapshot.age != null && <span className="text-sm text-gray-700 font-normal ml-2">Age {snapshot.age}</span>}
            {snapshot.biological_sex && <span className="text-sm text-gray-700 font-normal ml-1">· {snapshot.biological_sex}</span>}
          </h2>
          <span className="text-[11px] text-gray-600">As of {snapshot.report_date} · {snapshot.window_days}-day window</span>
        </div>
        <p className="text-[11px] text-gray-700 mt-1">
          {snapshot.height && <>Height: {snapshot.height} · </>}
          {snapshot.weight_lbs != null && <>Weight: {snapshot.weight_lbs.toFixed(1)} lbs</>}
        </p>
      </header>

      {/* Flags — bold at the top when present so a busy doctor sees them first */}
      {flags.length > 0 && (
        <section className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-rose-800 mb-1">⚠ Flags for review</p>
          <ul className="text-sm text-rose-900 space-y-0.5">
            {flags.map((f, i) => (
              <li key={i} className="leading-snug">• {f}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Vitals — the "at a glance" numbers, all with directional arrows */}
      <section className="mb-3">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1.5">Vitals (30-day averages, trend vs prior 30d)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-gray-200 px-2.5 py-1.5">
            <p className="text-[10px] text-gray-600 font-semibold">Systolic BP</p>
            <p className="text-sm font-bold">
              {vitals.bp.systolic_now != null ? vitals.bp.systolic_now : "—"}
              {vitals.bp.systolic_now != null && <span className="text-[10px] text-gray-500 font-normal"> mmHg</span>}
              <span className="ml-1"><ArrowSpanLowerBetter arrow={vitals.bp.systolic_trend} /></span>
            </p>
          </div>
          <div className="rounded border border-gray-200 px-2.5 py-1.5">
            <p className="text-[10px] text-gray-600 font-semibold">Diastolic BP</p>
            <p className="text-sm font-bold">
              {vitals.bp.diastolic_now != null ? vitals.bp.diastolic_now : "—"}
              {vitals.bp.diastolic_now != null && <span className="text-[10px] text-gray-500 font-normal"> mmHg</span>}
              <span className="ml-1"><ArrowSpanLowerBetter arrow={vitals.bp.diastolic_trend} /></span>
            </p>
          </div>
          <div className="rounded border border-gray-200 px-2.5 py-1.5">
            <p className="text-[10px] text-gray-600 font-semibold">Resting HR</p>
            <p className="text-sm font-bold">
              {vitals.oura.rhr_now ?? "—"}
              {vitals.oura.rhr_now != null && <span className="text-[10px] text-gray-500 font-normal"> bpm</span>}
              <span className="ml-1"><ArrowSpanLowerBetter arrow={vitals.oura.rhr_trend} /></span>
            </p>
          </div>
          <div className="rounded border border-gray-200 px-2.5 py-1.5">
            <p className="text-[10px] text-gray-600 font-semibold">HRV (overnight)</p>
            <p className="text-sm font-bold">
              {vitals.oura.hrv_now ?? "—"}
              {vitals.oura.hrv_now != null && <span className="text-[10px] text-gray-500 font-normal"> ms</span>}
              <span className="ml-1"><ArrowSpanHigherBetter arrow={vitals.oura.hrv_trend} /></span>
            </p>
          </div>
          <div className="rounded border border-gray-200 px-2.5 py-1.5">
            <p className="text-[10px] text-gray-600 font-semibold">Sleep</p>
            <p className="text-sm font-bold">
              {vitals.oura.sleep_h_now != null ? vitals.oura.sleep_h_now.toFixed(1) : "—"}
              {vitals.oura.sleep_h_now != null && <span className="text-[10px] text-gray-500 font-normal"> h/night</span>}
              <span className="ml-1"><ArrowSpanHigherBetter arrow={vitals.oura.sleep_trend} /></span>
            </p>
          </div>
        </div>
      </section>

      {/* Current stack — meds first (doctor cares most about interactions) */}
      <section className="mb-3">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1">Current stack</p>
        <div className="text-xs space-y-0.5">
          {stack.medications.length > 0 && (
            <p><span className="font-semibold">Medications:</span> {stack.medications.join(", ")}</p>
          )}
          {stack.supplements.length > 0 && (
            <p><span className="font-semibold">Supplements:</span> {stack.supplements.join(", ")}</p>
          )}
          {stack.peptides.length > 0 && (
            <p><span className="font-semibold">Peptides:</span> {stack.peptides.join(", ")}</p>
          )}
          {stack.medications.length + stack.supplements.length + stack.peptides.length === 0 && (
            <p className="text-gray-500 italic">None recorded.</p>
          )}
        </div>
      </section>

      {/* Patient-reported: symptoms + medical/injury memory */}
      <section className="mb-3">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1">Patient-reported</p>
        <div className="text-xs space-y-0.5">
          {patient_reported.memory_flags.length > 0 && patient_reported.memory_flags.map((m, i) => (
            <p key={`mem-${i}`} className="leading-snug">• {m}</p>
          ))}
          {patient_reported.recent_symptoms.length > 0 && (
            <p className="leading-snug">
              <span className="font-semibold">Recent symptoms (14d):</span>{" "}
              {patient_reported.recent_symptoms.slice(0, 6).map((s, i) => (
                <span key={i}>
                  {s.symptoms?.join(", ") || "—"}
                  {s.severity && ` (${s.severity})`}
                  {i < Math.min(5, patient_reported.recent_symptoms.length - 1) ? "; " : ""}
                </span>
              ))}
            </p>
          )}
          {patient_reported.memory_flags.length === 0 && patient_reported.recent_symptoms.length === 0 && (
            <p className="text-gray-500 italic">Nothing to report.</p>
          )}
        </div>
      </section>

      {/* Latest labs */}
      {labs.length > 0 && (
        <section className="mb-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700 mb-1">Latest labs</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
            {labs.slice(0, 12).map((l, i) => (
              <p key={i} className="leading-snug">
                <span className="font-semibold capitalize">{l.metric}:</span> {l.value}{l.unit ? ` ${l.unit}` : ""}
                <span className="text-gray-500 text-[10px]"> · {l.date}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-3 pt-2 border-t border-gray-200 text-[10px] text-gray-500 italic">
        Observational data from BackNine, not a clinical diagnosis. Full detail available in the seven-tab specialty views (Sleep, Cardiometabolic, Pre-Procedure, Training &amp; Recovery, Nutrition &amp; Body Comp, Goal Progress, Annual Physical).
      </footer>
    </article>
  );
}
