"use client";

/**
 * VisitCreateModal — simple "tell BackNine when your next visit is."
 * Two fields: date + provider type. Reason is optional.
 *
 * Kept intentionally small — the prep workflow lives in VisitDetailModal
 * that opens after the visit is created.
 */

import { useState } from "react";
import { api, localToday, type DoctorVisit } from "@/lib/api";

interface Props {
  onClose:   () => void;
  onCreated: (visit: DoctorVisit) => void;
}

const PROVIDER_OPTIONS: { value: DoctorVisit["provider_type"]; label: string }[] = [
  { value: "primary_care",  label: "Primary care" },
  { value: "cardiology",    label: "Cardiology" },
  { value: "urology",       label: "Urology" },
  { value: "endocrinology", label: "Endocrinology" },
  { value: "dermatology",   label: "Dermatology" },
  { value: "orthopedics",   label: "Orthopedics" },
  { value: "other",         label: "Other" },
];

export default function VisitCreateModal({ onClose, onCreated }: Props) {
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);   // sensible default: two weeks out
    return d.toISOString().slice(0, 10);
  });
  const [providerType, setProviderType] =
    useState<DoctorVisit["provider_type"]>("primary_care");
  const [reason, setReason] = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.createVisit({
        visit_date:    date,
        provider_type: providerType,
        reason:        reason.trim() || undefined,
      });
      onCreated(r.visit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create visit.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2D6A4F]">
                🩺 New doctor visit
              </p>
              <h2 className="text-base font-bold text-[#1B3829] mt-0.5">
                Tell BackNine when it&rsquo;s scheduled
              </h2>
            </div>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900 text-xl leading-none">×</button>
          </div>

          <div className="space-y-3">
            <label className="block text-[11px] text-gray-600">
              Visit date
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                min={localToday()}
                className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-2"
              />
            </label>
            <label className="block text-[11px] text-gray-600">
              Provider type
              <select
                value={providerType}
                onChange={e => setProviderType(e.target.value as DoctorVisit["provider_type"])}
                className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-2 bg-white"
              >
                {PROVIDER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-gray-600">
              Reason (optional)
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. annual physical, BP check, follow-up on cholesterol"
                className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-2"
              />
            </label>

            {error && (
              <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 text-sm font-medium py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="flex-1 text-sm font-semibold py-2 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40"
              >
                {busy ? "Creating…" : "Create visit"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
