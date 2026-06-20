"use client";

/**
 * DoctorReportModal — print-friendly clinical report.
 *
 * Pure presentation of the /api/doctor-report payload. No interpretation, no
 * scoring, no Coach Al commentary. The user picks a date range, the modal
 * paints the data in a clinic-friendly layout, and "Print / save as PDF"
 * fires window.print() — which gives them a real PDF without us shipping a
 * PDF library.
 *
 * Layout rules:
 *  - On screen: standard modal with close + date-range + print controls.
 *  - On print: controls hidden, sections flow naturally, page-breaks
 *    avoided inside individual data blocks.
 *
 * Sections in order — patient header → BP → cardio → AH (non-Oura users)
 * → weight → medications → supplements → peptides → observational disclaimer.
 */

import { useEffect, useState } from "react";
import { api, type DoctorReportPayload, type DoctorReportSeries } from "@/lib/api";

interface Props {
  open:    boolean;
  onClose: () => void;
}

const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 30,  label: "30 days"  },
  { value: 60,  label: "60 days"  },
  { value: 90,  label: "90 days"  },
  { value: 180, label: "6 months" },
];

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
};

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

const numOrDash = (v: number | null | undefined, digits = 0): string => {
  if (v === null || v === undefined) return "—";
  return digits ? v.toFixed(digits) : String(v);
};

// ── Section helpers ─────────────────────────────────────────────────────────

function SeriesStat({ label, series, digits = 0 }: { label: string; series: DoctorReportSeries; digits?: number }) {
  const n = series.trend.length;
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
      <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-lg font-bold text-gray-900 leading-tight">
        {numOrDash(series.average, digits)}
        {series.unit && series.average !== null && (
          <span className="text-[11px] text-gray-600 font-normal ml-1">{series.unit}</span>
        )}
      </p>
      <p className="text-[10px] text-gray-600">{n > 0 ? `across ${n} day${n === 1 ? "" : "s"}` : "no data"}</p>
    </div>
  );
}

export default function DoctorReportModal({ open, onClose }: Props) {
  const [days, setDays]       = useState<number>(30);
  const [data, setData]       = useState<DoctorReportPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError]     = useState<string | null>(null);

  // Refetch whenever the modal opens or the range changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.doctorReport({ days })
      .then(r => { if (!cancelled) setData(r); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, days]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center p-2 sm:p-6 print:bg-white print:p-0 print:static print:inset-auto">
      {/* Print-only CSS: when the user hits Print / save as PDF, hide
          everything in the page EXCEPT the report article inside this
          modal. The classic "print only this element" pattern using
          visibility (not display) so layout is preserved during the
          browser's print routine. Without this, the underlying dashboard
          (Coach Al, leaderboard, gear picks, etc.) prints after the
          report — which is bad for a clinical handoff. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #bn-doctor-report-print,
          #bn-doctor-report-print * { visibility: visible !important; }
          #bn-doctor-report-print {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: white !important;
          }
        }
      `}</style>
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[95vh] print:max-h-none print:shadow-none print:rounded-none">

        {/* Controls — hidden in print */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 print:hidden bg-gray-50">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">Doctor&apos;s Report</p>
            <div className="flex gap-1">
              {RANGE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setDays(o.value)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    days === o.value
                      ? "bg-[#1B3829] text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              disabled={loading || !!error || !data}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors disabled:opacity-40"
            >
              Print / save as PDF
            </button>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 text-xl leading-none px-2"
              aria-label="Close"
            >×</button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto print:overflow-visible">
          {loading && (
            <div className="p-8 text-center text-sm text-gray-600">Building report…</div>
          )}
          {error && (
            <div className="p-8 text-center text-sm text-red-500">Couldn&apos;t load report: {error}</div>
          )}
          {!loading && !error && data && (
            <ReportBody data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReportBody({ data }: { data: DoctorReportPayload }) {
  const { patient, blood_pressure: bp, sleep_cardio: sc, sleep_fragmentation: sf, apple_health: ah, weight, stack, range, generated_at } = data;

  // Are we Oura-blank? When the user has no Oura connection none of the
  // cardio series have data; render the AH summary instead (or, when neither
  // is available, a quiet empty state).
  const hasCardioData =
    (sc.sleep_hours.trend.length + sc.hrv.trend.length + sc.rhr.trend.length + sc.breathing_rate.trend.length + sc.spo2.trend.length) > 0;
  const hasAH = !!ah && ((ah.days_synced ?? 0) > 0 || Object.keys(ah.today).length > 0);

  return (
    <article id="bn-doctor-report-print" className="p-5 sm:p-8 text-sm text-gray-900 print:p-6">
      {/* ── Patient header ──────────────────────────────────────────────── */}
      <header className="mb-6 pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Personal Health Report</h1>
        <p className="text-xs text-gray-600">
          Reporting window: {fmtDate(range.start)} – {fmtDate(range.end)}
          {" · "}
          Generated {fmtDateTime(generated_at)}
        </p>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <div><dt className="text-gray-600 uppercase tracking-wide">Name</dt><dd className="font-semibold">{patient.name || "—"}</dd></div>
          <div><dt className="text-gray-600 uppercase tracking-wide">DOB</dt><dd className="font-semibold">{fmtDate(patient.birthdate)}{patient.age !== null && <span className="text-gray-600 font-normal"> (age {patient.age})</span>}</dd></div>
          <div><dt className="text-gray-600 uppercase tracking-wide">Sex</dt><dd className="font-semibold capitalize">{patient.biological_sex || "—"}</dd></div>
          <div><dt className="text-gray-600 uppercase tracking-wide">Height</dt><dd className="font-semibold">{patient.height_cm ? `${patient.height_cm} cm` : "—"}</dd></div>
        </dl>
      </header>

      {/* ── Blood pressure ─────────────────────────────────────────────── */}
      <section className="mb-6 print:break-inside-avoid">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Blood Pressure</h2>
        {bp.readings_count === 0 ? (
          <p className="text-xs text-gray-600 italic">No readings in this window.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Average</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">
                  {numOrDash(bp.summary.average?.systolic)}<span className="text-gray-600 font-normal">/</span>{numOrDash(bp.summary.average?.diastolic)}
                </p>
                <p className="text-[10px] text-gray-600">{bp.summary.count} readings · last {bp.summary.days}d</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Morning avg</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">
                  {numOrDash(bp.summary.morning?.systolic)}<span className="text-gray-600 font-normal">/</span>{numOrDash(bp.summary.morning?.diastolic)}
                </p>
                <p className="text-[10px] text-gray-600">n = {bp.summary.morning?.n ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Evening avg</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">
                  {numOrDash(bp.summary.evening?.systolic)}<span className="text-gray-600 font-normal">/</span>{numOrDash(bp.summary.evening?.diastolic)}
                </p>
                <p className="text-[10px] text-gray-600">n = {bp.summary.evening?.n ?? 0}</p>
              </div>
            </div>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-200">
                  <th className="py-1.5 pr-2 font-semibold">Date</th>
                  <th className="py-1.5 pr-2 font-semibold">When</th>
                  <th className="py-1.5 pr-2 font-semibold">SYS / DIA</th>
                  <th className="py-1.5 pr-2 font-semibold">Pulse</th>
                  <th className="py-1.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {bp.readings.map(r => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-1 pr-2">{fmtDate(r.date)}</td>
                    <td className="py-1 pr-2 capitalize">{r.time_of_day}</td>
                    <td className="py-1 pr-2 font-mono">{r.systolic}/{r.diastolic}</td>
                    <td className="py-1 pr-2 font-mono">{r.pulse ?? "—"}</td>
                    <td className="py-1 text-gray-600 italic truncate max-w-[16rem]">{r.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── Sleep & cardio ─────────────────────────────────────────────── */}
      <section className="mb-6 print:break-inside-avoid">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Sleep &amp; Cardiovascular Signals</h2>
        {hasCardioData ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <SeriesStat label="Sleep" series={{ ...sc.sleep_hours, unit: "hrs" }} digits={1} />
            <SeriesStat label="Sleep score" series={sc.sleep_score} />
            <SeriesStat label="HRV" series={sc.hrv} />
            <SeriesStat label="Resting HR" series={sc.rhr} />
            <SeriesStat label="Breathing rate" series={sc.breathing_rate} digits={1} />
            <SeriesStat label="O₂ saturation" series={sc.spo2} digits={1} />
          </div>
        ) : hasAH && ah ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(ah.averages).slice(0, 8).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">{k.replace(/_/g, " ")}</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">{numOrDash(v as number | null, 1)}</p>
                <p className="text-[10px] text-gray-600">avg · {ah.days_synced ?? 0} days</p>
              </div>
            ))}
            <p className="col-span-full text-[10px] text-gray-600 mt-1">Source: Apple Health</p>
          </div>
        ) : (
          <p className="text-xs text-gray-600 italic">No sleep or cardio data in this window.</p>
        )}
      </section>

      {/* ── Sleep Quality & Fragmentation ──────────────────────────────
          Surfaces the sleep-fragmentation signals Oura's public API
          exposes (BDI is app-only): efficiency, awake time, restless
          events, plus cardio context. Per-night Restful/Variable/
          Fragmented classification based on efficiency thresholds we
          control transparently. Strictly observational. */}
      <section className="mb-6 print:break-inside-avoid">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Sleep Quality &amp; Fragmentation</h2>
        <p className="text-[11px] text-gray-600 mb-2 leading-snug">{sf.note}</p>
        {sf.nights.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No sleep data in this window.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Mean efficiency</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">{numOrDash(sf.mean_efficiency)}<span className="text-[11px] text-gray-600 font-normal ml-1">%</span></p>
                <p className="text-[10px] text-gray-600">≥85% normal</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Avg WASO</p>
                <p className="text-lg font-bold text-gray-900 leading-tight">{numOrDash(sf.mean_waso_min, 1)}<span className="text-[11px] text-gray-600 font-normal ml-1">min</span></p>
                <p className="text-[10px] text-gray-600">&lt;30 min normal</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2.5 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Night classifications</p>
                <div className="flex gap-2 mt-0.5 text-[11px] flex-wrap">
                  <span><span className="font-bold text-gray-900">{sf.classification?.["Normal"] ?? 0}</span> <span className="text-gray-600">Normal</span></span>
                  <span><span className="font-bold text-gray-900">{sf.classification?.["Borderline"] ?? 0}</span> <span className="text-gray-600">Borderline</span></span>
                  <span><span className="font-bold text-gray-900">{sf.classification?.["Poor"] ?? 0}</span> <span className="text-gray-600">Poor</span></span>
                </div>
              </div>
            </div>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-200">
                  <th className="py-1.5 pr-2 font-semibold">Night</th>
                  <th className="py-1.5 pr-2 font-semibold">Eff %</th>
                  <th className="py-1.5 pr-2 font-semibold">Label</th>
                  <th className="py-1.5 pr-2 font-semibold" title="Wake After Sleep Onset, in minutes">WASO</th>
                  <th className="py-1.5 pr-2 font-semibold">Breath</th>
                  <th className="py-1.5 pr-2 font-semibold">Avg HR</th>
                  <th className="py-1.5 pr-2 font-semibold">Low HR</th>
                  <th className="py-1.5 font-semibold">SpO₂</th>
                </tr>
              </thead>
              <tbody>
                {sf.nights.map(n => (
                  <tr key={n.date} className="border-b border-gray-100">
                    <td className="py-1 pr-2">{fmtDate(n.date)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(n.efficiency)}</td>
                    <td className={`py-1 pr-2 ${n.label === "Poor" ? "text-red-600 font-semibold" : n.label === "Borderline" ? "text-amber-700 font-medium" : "text-gray-700"}`}>
                      {n.label ?? "—"}
                    </td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(n.awake_min, 1)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(n.breath, 1)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(n.avg_hr)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(n.rhr)}</td>
                    <td className="py-1 font-mono">{numOrDash(n.spo2, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── Weight ───────────────────────────────────────────────────── */}
      <section className="mb-6 print:break-inside-avoid">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Weight</h2>
        {weight.entries.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No weight entries in this window.</p>
        ) : (
          <>
            <p className="text-xs text-gray-700 mb-2">
              {weight.entries.length} entries
              {weight.delta_lbs !== null && (
                <span className="ml-2">
                  · Net change: <span className="font-semibold">{weight.delta_lbs > 0 ? "+" : ""}{weight.delta_lbs} lbs</span>
                </span>
              )}
            </p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-200">
                  <th className="py-1.5 pr-2 font-semibold">Date</th>
                  <th className="py-1.5 pr-2 font-semibold">Weight (lbs)</th>
                  <th className="py-1.5 pr-2 font-semibold">Body fat %</th>
                  <th className="py-1.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...weight.entries].reverse().map((e, i) => (
                  <tr key={`${e.date}-${i}`} className="border-b border-gray-100">
                    <td className="py-1 pr-2">{fmtDate(e.date)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(e.weight_lbs, 1)}</td>
                    <td className="py-1 pr-2 font-mono">{numOrDash(e.body_fat_pct, 1)}</td>
                    <td className="py-1 text-gray-600 italic truncate max-w-[16rem]">{e.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── Medications / Supplements / Peptides ─────────────────────── */}
      <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 print:break-inside-avoid">
        <StackBlock title="Medications" items={stack.medications} empty="No medications listed." />
        <StackBlock title="Supplements" items={stack.supplements} empty="No supplements listed." />
        <StackBlock title="Peptides"    items={stack.peptides}    empty="No peptides listed." />
      </section>

      {/* ── Disclaimer ──────────────────────────────────────────────── */}
      <footer className="mt-6 pt-3 border-t border-gray-200 text-[10px] text-gray-600 leading-snug">
        <p className="font-semibold text-gray-700 mb-1">For discussion with your physician.</p>
        <p>
          This report is observational only. It contains self-reported values and wearable
          measurements that have not been validated for clinical decision-making. BackNine
          does not provide medical advice, diagnoses, or treatment recommendations. Please
          discuss any findings with your doctor before changing medications, supplements,
          or treatment plans.
        </p>
      </footer>
    </article>
  );
}

function StackBlock({ title, items, empty }: { title: string; items: { name: string; dose?: string; timing?: string; notes?: string }[]; empty: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-white">
      <p className="text-xs font-semibold text-gray-900 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-600 italic">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="text-[11px] leading-snug">
              <span className="font-semibold text-gray-900">{it.name}</span>
              {(it.dose || it.timing) && (
                <span className="text-gray-700"> — {[it.dose, it.timing].filter(Boolean).join(", ")}</span>
              )}
              {it.notes && (
                <p className="text-[10px] text-gray-600 italic">{it.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
