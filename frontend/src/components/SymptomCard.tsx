"use client";

/**
 * SymptomCard — Phase 2 of the Insight pillar.
 *
 * Two surfaces in one card:
 *   1) Quick "How do you feel today?" log — emoji tag picker, optional
 *      severity + note, save in one tap.
 *   2) Correlation view (collapsed by default) — once the user has 3+
 *      symptom-day rows in the window, surfaces "On low-energy days,
 *      sleep averaged 5.8h vs 7.1h on other days" with the top deltas.
 *
 * Designed to be the "why am I tired?" answer for the men-50+ persona.
 * The correlation deltas are observational — we use "associated with"
 * language and the AI narrative is prompted to never imply causation.
 */

import { useEffect, useState } from "react";
import { api, type Mood, type SymptomLog, type SymptomCorrelation } from "@/lib/api";

// Mood emoji row — moved out of MorningBriefing into this unified card so
// users have ONE place to do the daily check-in. Mood = emotional pulse;
// the symptom tags below = physical issues. Both write to their own
// backend tables (daily_checkins / symptom_logs) — UI consolidates.
const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: "great", emoji: "😊", label: "Great" },
  { value: "good",  emoji: "🙂", label: "Good"  },
  { value: "okay",  emoji: "😐", label: "Okay"  },
  { value: "tired", emoji: "😴", label: "Tired" },
  { value: "off",   emoji: "😣", label: "Off"   },
];

interface CatalogItem { id: string; label: string; emoji: string; }

const SEVERITY_OPTIONS: Array<{ value: "mild" | "moderate" | "severe"; label: string }> = [
  { value: "mild",     label: "Mild"     },
  { value: "moderate", label: "Moderate" },
  { value: "severe",   label: "Severe"   },
];

export default function SymptomCard() {
  const [catalog, setCatalog]   = useState<CatalogItem[]>([]);
  const [today, setToday]       = useState<SymptomLog | null>(null);
  const [logs, setLogs]         = useState<SymptomLog[]>([]);
  const [loading, setLoading]   = useState(true);

  // Mood half of the unified Daily Check-in
  const [todayMood, setTodayMood]   = useState<Mood | null>(null);
  const [moodSaving, setMoodSaving] = useState(false);
  const [moodSaved, setMoodSaved]   = useState(false);

  const [picked, setPicked]     = useState<Set<string>>(new Set());
  const [severity, setSeverity] = useState<"mild" | "moderate" | "severe" | "">("");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  const [corrOpen, setCorrOpen] = useState(false);
  const [corrSym, setCorrSym]   = useState<string>("");      // "" = any-symptom
  const [corr, setCorr]         = useState<SymptomCorrelation | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([
      api.symptomsCatalog().then(r => setCatalog(r.catalog)).catch(() => {}),
      api.symptomsList(90).then(r => {
        setLogs(r.logs);
        const t = r.logs.find(l => l.date === todayIso);
        if (t) {
          setToday(t);
          setPicked(new Set(t.symptoms || []));
          setSeverity((t.severity as "mild" | "moderate" | "severe") || "");
          setNotes(t.notes ?? "");
        }
      }).catch(() => {}),
      // Load today's mood from the checkins endpoint (same source the
      // briefing was using before the unification). Endpoint returns
      // {today, yesterday} — read mood from today's row, not the root.
      // That mismatch is why the saved mood wasn't sticking after page
      // refresh — local state would clear and the (wrong) root-level
      // `mood` read returned undefined every time.
      api.getCheckinToday().then(r => {
        const m = r.today?.mood ?? null;
        if (m) setTodayMood(m);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [todayIso]);

  const handleMoodTap = async (mood: Mood) => {
    if (moodSaving) return;
    setMoodSaving(true);
    setMoodSaved(false);
    const previous = todayMood;
    setTodayMood(mood);  // optimistic
    try {
      await api.postCheckin(mood);
      setMoodSaved(true);
    } catch {
      setTodayMood(previous);  // revert on failure
    } finally {
      setMoodSaving(false);
    }
  };

  const togglePick = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const row = await api.symptomsLog({
        date:     todayIso,
        symptoms: Array.from(picked),
        severity: severity || undefined,
        notes:    notes.trim() || undefined,
      });
      setToday(row);
      // Refresh the log list so the correlation view reflects today.
      const fresh = await api.symptomsList(90);
      setLogs(fresh.logs);
      setSaved(true);
    } catch {
      // silent — user can try again
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!today) {
      setPicked(new Set()); setSeverity(""); setNotes(""); return;
    }
    try {
      await api.symptomsDelete(todayIso);
      setToday(null);
      setPicked(new Set()); setSeverity(""); setNotes("");
      const fresh = await api.symptomsList(90);
      setLogs(fresh.logs);
    } catch {}
  };

  const loadCorrelation = (symptom?: string) => {
    setCorrLoading(true);
    setCorr(null);
    api.symptomsCorrelation({ days: 60, symptom: symptom || undefined })
      .then(setCorr)
      .catch(() => {})
      .finally(() => setCorrLoading(false));
  };

  // Auto-load on first open
  useEffect(() => {
    if (corrOpen && !corr && !corrLoading) {
      loadCorrelation(corrSym || undefined);
    }
  }, [corrOpen, corr, corrLoading, corrSym]);

  // Symptom-day count for the user's window — drives "ready for correlation?" hint
  const symptomDays60 = logs.filter(l => (l.symptoms || []).length > 0).length;
  // Match the backend's shared MIN_SAMPLE_SIZE. Bumped from 3 → 5 as
  // part of the correlation-confidence tightening (Fable IMPROVE #4).
  const MIN_CORR_DAYS = 5;
  const correlationReady = symptomDays60 >= MIN_CORR_DAYS;

  if (loading) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">📋 Daily Check-in</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Tap your mood. Add any symptoms below if something feels off.
          </p>
        </div>
        {(moodSaved || (today && saved)) && (
          <span className="text-[11px] font-semibold text-emerald-700">✓ Saved</span>
        )}
      </div>

      {/* Mood pulse — moved from MorningBriefing. One tap, emotional pulse. */}
      <div className="mb-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 mb-1.5">
          {todayMood ? "How you're feeling today" : "How are you feeling today?"}
        </p>
        <div className="flex gap-1.5">
          {MOODS.map(m => {
            const selected = todayMood === m.value;
            return (
              <button
                key={m.value}
                onClick={() => handleMoodTap(m.value)}
                disabled={moodSaving}
                className={`flex-1 rounded-lg py-2 transition-all flex flex-col items-center gap-0.5 disabled:opacity-60 ${
                  selected
                    ? "bg-[#1B3829] text-white ring-2 ring-[#1B3829]/40 shadow scale-105"
                    : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:scale-95"
                }`}
                title={m.label}
              >
                <span className="text-base leading-none">{m.emoji}</span>
                <span className={`text-[9px] font-semibold uppercase tracking-wide ${selected ? "text-white" : "text-gray-600"}`}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Anything off? — physical symptom tags */}
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 mb-1.5">
        Anything off? <span className="font-normal lowercase text-gray-600 normal-case">(skip if feeling fine)</span>
        {symptomDays60 > 0 && symptomDays60 < 3 && (
          <span className="ml-1 font-medium text-[#1B3829] normal-case lowercase"> · {symptomDays60}/{MIN_CORR_DAYS} logged to unlock correlations</span>
        )}
      </p>

      {/* Tag picker — toggleable chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {catalog.map(s => {
          const on = picked.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => togglePick(s.id)}
              className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-[#1B3829] text-white border-[#1B3829]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
              }`}
            >
              <span className="mr-1">{s.emoji}</span>{s.label}
            </button>
          );
        })}
      </div>

      {/* Severity + notes only show once at least one symptom is picked */}
      {picked.size > 0 && (
        <div className="space-y-2 mb-2">
          <div className="flex gap-1.5">
            {SEVERITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSeverity(severity === opt.value ? "" : opt.value)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  severity === opt.value
                    ? "bg-[#1B3829] text-white"
                    : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            placeholder="Optional notes (context, possible trigger, etc.)"
            maxLength={500}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20"
          />
        </div>
      )}

      {/* Save / Clear */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (picked.size === 0 && !today)}
          className="px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {saving ? "Saving…" : today ? "Update" : "Log symptoms"}
        </button>
        {(today || picked.size > 0) && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 transition-colors"
          >
            {today ? "Remove today" : "Reset"}
          </button>
        )}
        {picked.size === 0 && !today && (
          <span className="text-[11px] text-gray-600 italic">Feeling fine? Skip — only log when something&apos;s off.</span>
        )}
      </div>

      {/* Correlation toggle */}
      {correlationReady && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <button
            onClick={() => setCorrOpen(o => !o)}
            className="text-xs font-semibold text-[#1B3829] hover:underline"
          >
            {corrOpen ? "▴ Hide correlations" : "▾ What's different on symptom days?"}
          </button>

          {corrOpen && (
            <div className="mt-2 space-y-2">
              {/* Symptom selector */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-600">For symptom:</span>
                <select
                  value={corrSym}
                  onChange={e => { setCorrSym(e.target.value); loadCorrelation(e.target.value || undefined); }}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white"
                >
                  <option value="">Any symptom</option>
                  {catalog.map(s => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
                </select>
              </div>

              {corrLoading && <p className="text-xs text-gray-600 italic">Computing correlations…</p>}

              {!corrLoading && corr && (
                <>
                  {corr.insufficient_data && (
                    <p className="text-xs text-gray-600 italic">
                      Need at least {corr.min_sample_size ?? 5} days logged for &quot;{corr.symptom_label}&quot; to compute correlations. You have {corr.symptom_day_count}.
                    </p>
                  )}

                  {!corr.insufficient_data && corr.narrative && (
                    <div className="rounded-lg border border-[#1B3829]/20 bg-[#1B3829]/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829] mb-1">
                        Coach Al · {corr.symptom_label} pattern
                      </p>
                      <p className="text-sm text-gray-800 leading-relaxed">{corr.narrative}</p>
                    </div>
                  )}

                  {!corr.insufficient_data && corr.deltas.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 mt-2">
                        Top differences · {corr.symptom_day_count} symptom days vs {corr.symptom_free_day_count} other days
                      </p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-200">
                            <th className="py-1.5 pr-2 font-semibold">Metric</th>
                            <th className="py-1.5 pr-2 font-semibold text-right">Symptom days</th>
                            <th className="py-1.5 pr-2 font-semibold text-right">Other days</th>
                            <th className="py-1.5 pr-2 font-semibold text-right">Δ</th>
                            <th className="py-1.5 font-semibold text-right">n</th>
                          </tr>
                        </thead>
                        <tbody>
                          {corr.deltas.slice(0, 8).map(d => {
                            // Muted rendering for low-confidence rows so
                            // a skeptical reader immediately sees "this
                            // is an early signal" not "this is a fact."
                            const isLow = d.confidence === "low";
                            const worseTone = d.worse_on_symptom
                              ? (isLow ? "text-rose-500" : "text-rose-700 font-semibold")
                              : (isLow ? "text-gray-600" : "text-gray-800");
                            const confBadge =
                              d.confidence === "high"   ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                              d.confidence === "medium" ? "bg-sky-100 text-sky-800 border-sky-200" :
                                                          "bg-gray-100 text-gray-600 border-gray-200";
                            return (
                              <tr key={d.metric} className="border-b border-gray-100">
                                <td className={`py-1 pr-2 ${isLow ? "text-gray-700" : ""}`}>{d.label}</td>
                                <td className={`py-1 pr-2 text-right font-mono ${worseTone}`}>
                                  {d.symptom_avg}{d.unit ? ` ${d.unit}` : ""}
                                </td>
                                <td className="py-1 pr-2 text-right font-mono text-gray-700">
                                  {d.symptom_free_avg}{d.unit ? ` ${d.unit}` : ""}
                                </td>
                                <td className={`py-1 pr-2 text-right font-mono ${worseTone}`}>
                                  {d.delta > 0 ? "+" : ""}{d.delta} ({d.abs_delta_pct}%)
                                </td>
                                <td className="py-1 text-right">
                                  <span
                                    className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${confBadge}`}
                                    title={d.confidence_label || `${d.positive_n ?? "?"} matching days`}
                                  >
                                    {d.positive_n ?? "?"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-gray-600 italic">
                        Observational pattern only — correlation, not causation. The <span className="font-mono not-italic">n</span> column shows how many matching days each row is based on;
                        green = confident (10+), blue = moderate (7-9), gray = early signal (5-6). Bring to your doctor if a pattern feels meaningful.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
