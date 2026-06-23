"use client";

/**
 * /share/{token} — public-facing view of a shared Health Report.
 *
 * The user generates a tokenized link from inside the Health Reports modal
 * and emails/texts it to their doctor. The doctor opens the URL in any
 * browser and sees the report rendered, with no BackNine account needed.
 *
 * No auth required — the token IS the authorization. Backend enforces
 * expiry (default 30 days) and the user can revoke from their Profile.
 *
 * This page renders a simplified, read-only version of the report payload
 * with the patient header, AI narrative, and a "Print to PDF" affordance.
 * It also flags that the recipient is viewing a shared report (so they
 * know it's not their own data if they happen to have BackNine).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://backnine-hu60.onrender.com";

type ShareResponse = {
  report_type: string;
  shared_by:   string;
  payload:     {
    ai_narrative?: string | null;
    generated_at?: string;
    patient?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

const REPORT_LABELS: Record<string, string> = {
  sleep:     "Personal Health Report",
  annual:    "Annual Physical Snapshot",
  cardio:    "Cardiometabolic Report",
  preproc:   "Pre-Procedure Medication & Supplement Reconciliation",
  training:  "Training & Recovery Report",
  nutrition: "Nutrition & Body Composition Report",
  goal:      "Goal Progress Report",
};

export default function SharedReportPage() {
  const params  = useParams();
  const token   = String(params?.token ?? "");
  const [data, setData]       = useState<ShareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/share/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message || "Couldn't load the shared report"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-sm text-gray-600">Loading shared report…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Couldn&apos;t load the report</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <p className="text-xs text-gray-600 mt-4">
            Share links expire after 30 days, or may have been revoked by the sender.
            Ask them to send you a fresh link.
          </p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const reportLabel = REPORT_LABELS[data.report_type] || "Shared Health Report";
  const patient     = (data.payload?.patient as Record<string, unknown>) ?? {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar — only visible on screen, not print */}
      <div className="bg-white border-b border-gray-200 px-5 py-3 print:hidden">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">
            Shared by {data.shared_by} · {reportLabel}
          </p>
          <button
            onClick={() => window.print()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors"
          >
            Print / save as PDF
          </button>
        </div>
      </div>

      {/* Content — basic, read-only rendering of the report payload. The
          rich tab-aware rendering lives inside DoctorReportModal; here we
          just surface the essentials. Doctor can print to PDF for filing. */}
      <article className="max-w-4xl mx-auto bg-white p-6 sm:p-10 my-6 rounded shadow-sm">
        <header className="mb-6 pb-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">{reportLabel}</h1>
          <p className="text-xs text-gray-600 mt-1">
            Shared by {data.shared_by}
            {data.payload?.generated_at && ` · Generated ${new Date(String(data.payload.generated_at)).toLocaleString()}`}
          </p>
          {Object.keys(patient).length > 0 && (
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
              {(patient.name as string) && (
                <div><dt className="text-gray-600 uppercase tracking-wide">Name</dt><dd className="font-semibold">{String(patient.name)}</dd></div>
              )}
              {(patient.birthdate as string) && (
                <div><dt className="text-gray-600 uppercase tracking-wide">DOB</dt><dd className="font-semibold">{String(patient.birthdate)}{patient.age != null && <span className="text-gray-600 font-normal"> (age {String(patient.age)})</span>}</dd></div>
              )}
              {(patient.biological_sex as string) && (
                <div><dt className="text-gray-600 uppercase tracking-wide">Sex</dt><dd className="font-semibold capitalize">{String(patient.biological_sex)}</dd></div>
              )}
              {patient.height_cm != null && (() => {
                // US-friendly height: stored as cm, displayed as ft/in.
                const cm = Number(patient.height_cm);
                const totalIn = cm / 2.54;
                const ft = Math.floor(totalIn / 12);
                const inches = Math.round(totalIn - ft * 12);
                const display = inches === 12 ? `${ft + 1}' 0"` : `${ft}' ${inches}"`;
                return (
                  <div><dt className="text-gray-600 uppercase tracking-wide">Height</dt><dd className="font-semibold">{display}</dd></div>
                );
              })()}
            </dl>
          )}
        </header>

        {/* AI narrative — Claude's 2-4 sentence "what stands out" intro */}
        {data.payload?.ai_narrative && (
          <section className="mb-6 rounded-xl border border-[#1B3829]/20 bg-[#1B3829]/5 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-1.5">What stands out</p>
            <p className="text-sm text-gray-800 leading-relaxed">{data.payload.ai_narrative}</p>
            <p className="text-[10px] text-gray-600 italic mt-1.5">
              AI-generated summary based on the data. Observational only.
            </p>
          </section>
        )}

        {/* Raw payload dump — readable JSON for now. A richer per-type
            renderer can come later; v1 prioritizes "doctor can see all
            the numbers" over polish. */}
        <section>
          <p className="text-xs uppercase tracking-wide font-semibold text-gray-700 mb-2">Report data</p>
          <pre className="text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(data.payload, null, 2)}
          </pre>
        </section>

        <footer className="mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-600 leading-snug">
          <p>This report is observational data shared by a BackNine user. Not validated for clinical decision-making.</p>
        </footer>
      </article>
    </div>
  );
}
