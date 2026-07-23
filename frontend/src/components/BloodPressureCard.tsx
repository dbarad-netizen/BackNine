"use client";

/**
 * BloodPressureCard — manual BP log + summary on the Scorecard.
 *
 * Patterned after the weigh-in card: a hero row showing the latest reading +
 * 30-day average, an inline form to add a new reading, and a collapsible list
 * of recent entries with delete. Morning vs. evening pattern matters
 * clinically (BP is typically higher AM), so we capture time_of_day and
 * report the split in the summary.
 *
 * Apple Health Withings/Omron syncs flow through the same table later via the
 * AH sync path; this card stays the manual entry point regardless.
 *
 * No interpretation, no traffic-lighting against medical thresholds — that's
 * the doctor's call. We surface the numbers honestly and let the Doctor's
 * Report PDF do the cross-signal work.
 */

import { useEffect, useState } from "react";
import { api, type BPReading, type BPSummary, type BPTimeOfDay } from "@/lib/api";
import DoctorReportModal from "./DoctorReportModal";

const TIMES: { value: BPTimeOfDay; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "midday",  label: "Midday"  },
  { value: "evening", label: "Evening" },
  { value: "other",   label: "Other"   },
];

const inp =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

export default function BloodPressureCard() {
  const [readings, setReadings] = useState<BPReading[]>([]);
  const [summary, setSummary]   = useState<BPSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [showAll, setShowAll]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Draft for the inline form
  const [sys, setSys]   = useState<string>("");
  const [dia, setDia]   = useState<string>("");
  const [pulse, setPulse] = useState<string>("");
  const [time, setTime] = useState<BPTimeOfDay>("morning");
  const [notes, setNotes] = useState<string>("");

  const load = () => {
    setLoading(true);
    api.bpList(90)
      .then(r => { setReadings(r.readings); setSummary(r.summary); })
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setSys(""); setDia(""); setPulse(""); setTime("morning"); setNotes("");
    setError(null);
  };

  const handleSubmit = async () => {
    const sysN = parseInt(sys, 10);
    const diaN = parseInt(dia, 10);
    const plsN = pulse ? parseInt(pulse, 10) : undefined;
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
        pulse:       plsN,
        time_of_day: time,
        notes:       notes.trim() || undefined,
      });
      resetForm();
      setAdding(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.bpDelete(id);
      load();
    } catch { /* silent — list will refresh on next open */ }
  };

  const fmtMMM = (iso: string): string => {
    try {
      const d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  };

  const visibleReadings = showAll ? readings : readings.slice(0, 5);

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Blood Pressure</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Track your readings — morning and evening if you can.
          </p>
        </div>
        {!adding && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowReport(true)}
              className="text-[11px] font-medium text-gray-600 hover:text-[#1B3829] underline-offset-2 hover:underline transition-colors"
              title="Open the print-friendly clinical report"
            >
              Doctor&apos;s report
            </button>
            <button
              onClick={() => { resetForm(); setAdding(true); }}
              className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors"
            >
              + Add reading
            </button>
          </div>
        )}
      </div>

      <DoctorReportModal open={showReport} onClose={() => setShowReport(false)} />

      {/* Summary row — only if we have any readings */}
      {summary && summary.count > 0 && summary.latest && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Latest</p>
            <p className="text-base font-bold text-gray-900 leading-tight">
              {summary.latest.systolic}<span className="text-gray-600 font-normal">/</span>{summary.latest.diastolic}
            </p>
            <p className="text-[10px] text-gray-600 capitalize">{summary.latest.time} · {fmtMMM(summary.latest.date)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">30d avg</p>
            <p className="text-base font-bold text-gray-900 leading-tight">
              {summary.average?.systolic ?? "—"}<span className="text-gray-600 font-normal">/</span>{summary.average?.diastolic ?? "—"}
            </p>
            <p className="text-[10px] text-gray-600">across {summary.count} readings</p>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">AM vs PM</p>
            <p className="text-[13px] font-semibold text-gray-800 leading-tight">
              {summary.morning?.systolic ?? "—"}<span className="text-gray-600 font-normal">/</span>{summary.morning?.diastolic ?? "—"}
              <span className="text-[10px] text-gray-600 font-normal ml-1">AM</span>
            </p>
            <p className="text-[13px] font-semibold text-gray-800 leading-tight">
              {summary.evening?.systolic ?? "—"}<span className="text-gray-600 font-normal">/</span>{summary.evening?.diastolic ?? "—"}
              <span className="text-[10px] text-gray-600 font-normal ml-1">PM</span>
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {summary && summary.count === 0 && !adding && (
        <p className="text-xs text-gray-600 italic mb-3">
          No readings yet. Tap + Add to log your first.
        </p>
      )}

      {/* Inline form */}
      {adding && (
        <div className="rounded-xl border border-[#1B3829]/40 bg-[#1B3829]/5 p-3 mb-3 space-y-2">
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
              onClick={() => { setAdding(false); resetForm(); }}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Recent list */}
      {readings.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Recent</p>
          <ul className="space-y-1">
            {visibleReadings.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {r.systolic}<span className="text-gray-600 font-normal">/</span>{r.diastolic}
                    {r.pulse != null && (
                      <span className="text-[11px] text-gray-600 ml-2 font-normal">♥ {r.pulse}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-600 capitalize">
                    {r.time_of_day} · {fmtMMM(r.date)}
                    {r.notes && <span className="ml-1.5 italic">— {r.notes}</span>}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors text-base leading-none px-2"
                  aria-label="Delete reading"
                  title="Delete"
                >×</button>
              </li>
            ))}
          </ul>
          {readings.length > 5 && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="text-[11px] text-gray-600 hover:text-[#1B3829] mt-1.5 font-medium"
            >
              {showAll ? "Show fewer" : `Show all ${readings.length} readings`}
            </button>
          )}
        </div>
      )}

      {/* Informational-use footer — App Store guideline 1.4.1 wants a
          medical-context disclaimer on any surface that shows clinical
          numbers. Small, non-intrusive, links to the full disclaimer. */}
      <p className="mt-3 text-[10px] text-gray-500 leading-snug">
        Numbers shown for personal tracking only, not medical advice or
        interpretation. If a reading feels concerning, talk to your doctor.
        {" "}
        <a href="/disclaimer" className="underline hover:text-[#1B3829]">
          Learn more
        </a>
      </p>
    </section>
  );
}
