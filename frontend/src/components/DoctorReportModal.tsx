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

import { useCallback, useEffect, useState } from "react";
import { api, type BPTimeOfDay, type DoctorReportPayload, type DoctorReportSeries } from "@/lib/api";

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

  // Loader extracted so the inline BP-entry form can refetch after saving
  // a new reading, without having to close and reopen the modal.
  const loadReport = useCallback(() => {
    setLoading(true);
    setError(null);
    return api.doctorReport({ days })
      .then(r => { setData(r); })
      .catch(e => { setError(e instanceof Error ? e.message : "Couldn't load"); })
      .finally(() => { setLoading(false); });
  }, [days]);

  // Refetch whenever the modal opens or the range changes.
  useEffect(() => {
    if (!open) return;
    loadReport();
  }, [open, loadReport]);

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
            <ReportBody data={data} onBpSaved={loadReport} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReportBody({ data, onBpSaved }: { data: DoctorReportPayload; onBpSaved: () => void }) {
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
        <div className="flex items-center justify-between mb-2 print:block">
          <h2 className="text-base font-semibold text-gray-900">Blood Pressure</h2>
          <InlineBpEntry onSaved={onBpSaved} />
        </div>
        {bp.readings_count === 0 ? (
          <p className="text-xs text-gray-600 italic">No readings in this window. Tap &quot;+ Add reading&quot; above to log one.</p>
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

            {bp.readings.length >= 2 && (
              <div className="mb-3 border border-gray-200 rounded-lg p-2 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1">Trend</p>
                <TrendChart
                  series={[
                    { label: "Systolic",  color: "#dc2626", points: [...bp.readings].reverse().map(r => ({ date: r.date, value: r.systolic })) },
                    { label: "Diastolic", color: "#2563eb", points: [...bp.readings].reverse().map(r => ({ date: r.date, value: r.diastolic })) },
                  ]}
                  references={[
                    { value: 120, label: "120", color: "#94a3b8" },
                    { value: 80,  label: "80",  color: "#94a3b8" },
                  ]}
                />
              </div>
            )}

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

            {sf.nights.length >= 2 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="border border-gray-200 rounded-lg p-2 bg-white">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1">Efficiency trend</p>
                  <TrendChart
                    series={[{
                      label: "Efficiency %",
                      color: "#059669",
                      points: [...sf.nights].reverse()
                        .filter(n => n.efficiency !== null && n.efficiency !== undefined)
                        .map(n => ({ date: n.date, value: n.efficiency as number })),
                    }]}
                    references={[{ value: 85, label: "85% normal", color: "#94a3b8" }]}
                    yMax={100}
                  />
                </div>
                <div className="border border-gray-200 rounded-lg p-2 bg-white">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1">WASO trend (min)</p>
                  <TrendChart
                    series={[{
                      label: "WASO",
                      color: "#d97706",
                      points: [...sf.nights].reverse()
                        .filter(n => n.awake_min !== null && n.awake_min !== undefined)
                        .map(n => ({ date: n.date, value: n.awake_min as number })),
                    }]}
                    references={[{ value: 30, label: "30 min", color: "#94a3b8" }]}
                    yMin={0}
                  />
                </div>
              </div>
            )}

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
            {weight.entries.length >= 2 && (
              <div className="mb-3 border border-gray-200 rounded-lg p-2 bg-white">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1">Weight trend</p>
                <TrendChart
                  series={[{
                    label: "Weight (lbs)",
                    color: "#0891b2",
                    points: weight.entries
                      .filter(e => e.weight_lbs !== null && e.weight_lbs !== undefined)
                      .map(e => ({ date: e.date, value: e.weight_lbs as number })),
                  }]}
                />
              </div>
            )}

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

// ── TrendChart ─────────────────────────────────────────────────────────────
// Pure inline-SVG line chart used in the Doctor's Report. Designed to print
// cleanly (no chart library, no canvas, no JS execution required after the
// SVG is in the DOM — Chrome's print routine just rasterizes the vector).
//
// Conventions:
//  - Each series points are rendered left-to-right in array order. Caller
//    is responsible for sorting chronologically (oldest first).
//  - Y-axis range auto-fits unless yMin/yMax explicitly passed.
//  - Reference lines render BEHIND the data lines, dashed, with a label
//    pinned to the right edge.
//  - A small dot highlights the last data point of each series.

interface TrendSeries {
  label:  string;
  color:  string;
  points: Array<{ date: string; value: number }>;
}
interface TrendReference {
  value: number;
  label: string;
  color: string;
}

function TrendChart({
  series, references, height = 140, yMin, yMax,
}: {
  series:      TrendSeries[];
  references?: TrendReference[];
  height?:     number;
  yMin?:       number;
  yMax?:       number;
}) {
  const allValues = series.flatMap(s => s.points.map(p => p.value));
  const refValues = (references ?? []).map(r => r.value);
  if (allValues.length === 0) {
    return <p className="text-xs text-gray-600 italic">No data to chart.</p>;
  }

  const dataMin = yMin ?? Math.min(...allValues, ...refValues);
  const dataMax = yMax ?? Math.max(...allValues, ...refValues);
  const pad     = (dataMax - dataMin) * 0.1 || 1;
  const lo      = dataMin - pad;
  const hi      = dataMax + pad;

  const margin  = { top: 10, right: 60, bottom: 26, left: 36 };
  const width   = 600;
  const innerW  = width  - margin.left - margin.right;
  const innerH  = height - margin.top  - margin.bottom;

  const nPoints = Math.max(...series.map(s => s.points.length), 1);
  const xFor    = (i: number) => margin.left + (i / Math.max(1, nPoints - 1)) * innerW;
  const yFor    = (v: number) => margin.top  + (1 - (v - lo) / (hi - lo)) * innerH;

  const fmtShort = (iso: string): string => {
    try {
      const d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return iso; }
  };

  const firstDate = series[0]?.points[0]?.date;
  const lastDate  = series[0]?.points[series[0].points.length - 1]?.date;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {/* Y-axis line */}
      <line
        x1={margin.left} y1={margin.top}
        x2={margin.left} y2={margin.top + innerH}
        stroke="#d1d5db" strokeWidth="0.5"
      />
      {/* X-axis line */}
      <line
        x1={margin.left}            y1={margin.top + innerH}
        x2={margin.left + innerW}   y2={margin.top + innerH}
        stroke="#d1d5db" strokeWidth="0.5"
      />

      {/* Y-axis tick labels (hi / lo) */}
      <text x={margin.left - 4} y={margin.top + 4}        textAnchor="end" fontSize="9" fill="#6b7280">{Math.round(hi)}</text>
      <text x={margin.left - 4} y={margin.top + innerH}   textAnchor="end" fontSize="9" fill="#6b7280">{Math.round(lo)}</text>

      {/* Reference lines (drawn first so they sit behind data) */}
      {(references ?? []).map((r, i) => (
        <g key={`ref-${i}`}>
          <line
            x1={margin.left}             y1={yFor(r.value)}
            x2={margin.left + innerW}    y2={yFor(r.value)}
            stroke={r.color} strokeWidth="0.75" strokeDasharray="3,3"
          />
          <text
            x={margin.left + innerW + 4} y={yFor(r.value) + 3}
            fontSize="9" fill={r.color}
          >{r.label}</text>
        </g>
      ))}

      {/* Data lines */}
      {series.map((s, sIdx) => {
        if (s.points.length === 0) return null;
        const polyline = s.points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(" ");
        const last     = s.points[s.points.length - 1];
        return (
          <g key={`s-${sIdx}`}>
            <polyline fill="none" stroke={s.color} strokeWidth="1.5" points={polyline} />
            <circle cx={xFor(s.points.length - 1)} cy={yFor(last.value)} r="2.5" fill={s.color} />
          </g>
        );
      })}

      {/* X-axis: first + last date stamps */}
      {firstDate && (
        <text x={margin.left}              y={margin.top + innerH + 14} fontSize="9" fill="#6b7280">{fmtShort(firstDate)}</text>
      )}
      {lastDate && firstDate !== lastDate && (
        <text x={margin.left + innerW}     y={margin.top + innerH + 14} textAnchor="end" fontSize="9" fill="#6b7280">{fmtShort(lastDate)}</text>
      )}

      {/* Legend — only if multiple series */}
      {series.length > 1 && (
        <g transform={`translate(${margin.left}, ${height - 4})`}>
          {series.map((s, i) => (
            <g key={`legend-${i}`} transform={`translate(${i * 100}, 0)`}>
              <line x1={0} y1={-3} x2={10} y2={-3} stroke={s.color} strokeWidth="1.5" />
              <text x={14} y={0} fontSize="9" fill="#374151">{s.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}


// ── InlineBpEntry ─────────────────────────────────────────────────────────
// Compact BP-entry form embedded in the report's Blood Pressure section so
// users can log a fresh reading without closing the report. On save, calls
// the parent's onSaved callback (which refetches the whole report payload)
// so the new reading flows into the summary tiles + trend chart + table
// instantly. `print:hidden` on both the button and the form keeps the
// printed PDF clean — only the static report content prints.
function InlineBpEntry({ onSaved }: { onSaved: () => void }) {
  const TIMES: { value: BPTimeOfDay; label: string }[] = [
    { value: "morning", label: "Morning" },
    { value: "midday",  label: "Midday"  },
    { value: "evening", label: "Evening" },
    { value: "other",   label: "Other"   },
  ];
  const inp =
    "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  const [open, setOpen]   = useState(false);
  const [sys, setSys]     = useState("");
  const [dia, setDia]     = useState("");
  const [pulse, setPulse] = useState("");
  const [time, setTime]   = useState<BPTimeOfDay>("morning");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const reset = () => {
    setSys(""); setDia(""); setPulse(""); setTime("morning"); setNotes(""); setError(null);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const handleSubmit = async () => {
    const sysN = parseInt(sys, 10);
    const diaN = parseInt(dia, 10);
    if (!sysN || !diaN) {
      setError("Enter both systolic and diastolic");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.bpLog({
        systolic:    sysN,
        diastolic:   diaN,
        pulse:       pulse ? parseInt(pulse, 10) : undefined,
        time_of_day: time,
        notes:       notes.trim() || undefined,
      });
      reset();
      setOpen(false);
      onSaved();   // refetch the report so the new reading shows up
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors print:hidden"
      >
        + Add reading
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-[#1B3829]/40 bg-[#1B3829]/5 p-3 mb-3 space-y-2 print:hidden">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <p className="text-[10px] text-gray-600 mb-1 uppercase tracking-wide">Systolic</p>
          <input
            inputMode="numeric" type="number" min={50} max={300}
            placeholder="120"
            value={sys}
            onChange={e => setSys(e.target.value)}
            className={inp}
          />
        </div>
        <div className="text-gray-600 font-bold text-xl pb-2">/</div>
        <div className="flex-1">
          <p className="text-[10px] text-gray-600 mb-1 uppercase tracking-wide">Diastolic</p>
          <input
            inputMode="numeric" type="number" min={30} max={200}
            placeholder="80"
            value={dia}
            onChange={e => setDia(e.target.value)}
            className={inp}
          />
        </div>
        <div className="w-20">
          <p className="text-[10px] text-gray-600 mb-1 uppercase tracking-wide">Pulse</p>
          <input
            inputMode="numeric" type="number" min={25} max={250}
            placeholder="72"
            value={pulse}
            onChange={e => setPulse(e.target.value)}
            className={inp}
          />
        </div>
      </div>
      <div className="flex gap-1.5">
        {TIMES.map(t => (
          <button
            key={t.value}
            onClick={() => setTime(t.value)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              time === t.value
                ? "bg-[#1B3829] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        placeholder="Notes (optional — meds, stress, before exercise)"
        maxLength={500}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className={inp}
      />
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={saving || !sys.trim() || !dia.trim()}
          className="px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save reading"}
        </button>
        <button
          onClick={close}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
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
