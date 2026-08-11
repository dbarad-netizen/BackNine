"use client";

/**
 * CpapNightlyLogCard — one-tap CPAP nightly log for users on ResMed
 * (or any) CPAP therapy. Rendered on the Scorecard only when the
 * 'cpap' capability is enabled in Profile → Devices & Trackers.
 *
 * Fields mirror ResMed myAir's nightly card so users can copy across
 * without translating scales:
 *   - Usage hours (required)
 *   - Mask seal score      (0-20, myAir)
 *   - Events per hour AHI  (float)
 *   - Total score          (0-100, myAir)
 *
 * Insurance compliance pill: shows the last-30-nights % of nights
 * that hit >=4 hours. Green >=75%, amber 60-74%, red <60%. This is
 * the Medicare/insurance rule that determines whether the payer will
 * keep covering the machine. David 2026-08-06.
 */

import { useEffect, useState } from "react";
import { api, type CpapNightlyLog, type CpapAdherence } from "@/lib/api";
import BackfillDatePicker from "./BackfillDatePicker";

function localYesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Props {
  onLogged?: () => void;
}

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null) return "—";
  return decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
}

function complianceColor(pct: number, threshold: number): string {
  if (pct >= threshold) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (pct >= threshold * 0.8) return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-red-800 bg-red-50 border-red-200";
}

// Session-scoped dismissal key. If the user taps the ✕, we hide the
// card for the rest of this session but bring it back on next launch.
// For permanent hide, they can flip the capability toggle off in
// Profile → Devices & Trackers (which we hint at in the tooltip).
// David 2026-08-06.
const DISMISS_KEY = "bn_cpap_card_dismissed_session";

export default function CpapNightlyLogCard({ onLogged }: Props) {
  const [snap,      setSnap]      = useState<CpapAdherence | null>(null);
  const [yesterday, setYesterday] = useState<CpapNightlyLog | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  // Form state — pre-fills from last night's log if already saved
  const [hours,      setHours]      = useState<string>("");
  const [maskSeal,   setMaskSeal]   = useState<string>("");
  const [ahi,        setAhi]        = useState<string>("");
  const [totalScore, setTotalScore] = useState<string>("");
  const [notes,      setNotes]      = useState<string>("");
  const [busy,       setBusy]       = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState(false);
  // Which night this entry counts toward. Defaults to yesterday since
  // CPAP is a nightly stat logged the morning after. David 2026-08-07.
  const [logDate,    setLogDate]    = useState<string>(localYesterdayIso());

  useEffect(() => {
    setLoading(true);
    Promise.all([api.cpapToday(), api.cpapAdherence()])
      .then(([today, adh]) => {
        setYesterday(today.yesterday);
        setSnap(adh);
        if (today.yesterday) {
          setHours(String(today.yesterday.usage_hours ?? ""));
          if (today.yesterday.mask_seal_score  != null) setMaskSeal(String(today.yesterday.mask_seal_score));
          if (today.yesterday.events_per_hour  != null) setAhi(String(today.yesterday.events_per_hour));
          if (today.yesterday.total_score      != null) setTotalScore(String(today.yesterday.total_score));
          if (today.yesterday.notes) setNotes(today.yesterday.notes);
          setSaved(true);
        }
      })
      .catch((e: Error) => setError(e.message || "Failed to load CPAP data"))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    setError(null);
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0 || h > 24) { setError("Enter hours between 0 and 24."); return; }
    setBusy(true);
    try {
      const body = {
        date:            logDate,
        usage_hours:     h,
        mask_seal_score: maskSeal   === "" ? null : Number(maskSeal),
        events_per_hour: ahi        === "" ? null : Number(ahi),
        total_score:     totalScore === "" ? null : Number(totalScore),
        notes:           notes.trim() || null,
      };
      await api.logCpap(body);
      // Reload snapshot so the compliance pill updates immediately
      const adh = await api.cpapAdherence();
      setSnap(adh);
      setSaved(true);
      onLogged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  const showFullForm = expanded || !saved;
  const compliancePill = snap && (
    <div className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border ${complianceColor(snap.compliance_pct, snap.threshold_pct)}`}
         title={`${snap.qualifying_nights}/${snap.window_days} nights >=${snap.threshold_hours}h in the last ${snap.window_days} days`}>
      {snap.compliance_pct}% compliance
      {snap.compliant ? " ✓" : ` (need ${snap.threshold_pct}%)`}
    </div>
  );

  return (
    <section
      id="cpap-nightly-log"
      className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-white p-4 shadow-sm space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-800">
            😴 CPAP therapy
          </p>
          <h3 className="text-base font-bold text-[#1B3829] mt-0.5 leading-tight">
            Last night&rsquo;s CPAP
          </h3>
          <p className="text-[11px] text-gray-600 leading-snug mt-0.5">
            Copy the numbers from ResMed myAir&rsquo;s nightly card. Only
            hours is required — the rest sharpens Coach Al&rsquo;s
            correlations and Doctor Handoff.
          </p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          {compliancePill}
          <button
            onClick={dismiss}
            title="Hide until next launch. To hide permanently, turn off CPAP in Profile → Devices & Trackers."
            aria-label="Hide CPAP card"
            className="text-gray-500 hover:text-gray-900 text-lg leading-none px-1 -mt-0.5"
          >
            ×
          </button>
        </div>
      </div>

      {saved && !expanded && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between">
          <div className="text-[12px] text-emerald-900">
            <span className="font-semibold">{fmt(yesterday?.usage_hours, 1)}h</span> logged for last night
            {yesterday?.events_per_hour != null && (
              <> · AHI <span className="font-semibold">{fmt(yesterday.events_per_hour, 1)}</span></>
            )}
            {yesterday?.total_score != null && (
              <> · score <span className="font-semibold">{fmt(yesterday.total_score)}/100</span></>
            )}
          </div>
          <button onClick={() => setExpanded(true)}
                  className="text-[11px] font-medium text-emerald-800 hover:text-emerald-900 underline-offset-2 hover:underline">
            Edit
          </button>
        </div>
      )}

      {showFullForm && (
        <>
          <div className="flex items-center justify-between">
            <BackfillDatePicker value={logDate} onChange={setLogDate} label="For:" />
            <span className="text-[10px] text-gray-500">Defaults to last night</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-600">
              Usage hours <span className="text-red-600">*</span>
              <input type="number" step="0.1" min="0" max="24" placeholder="e.g. 6.8"
                     value={hours} onChange={e => setHours(e.target.value)}
                     className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white" />
            </label>
            <label className="text-[11px] text-gray-600">
              Events / hour (AHI)
              <input type="number" step="0.1" min="0" placeholder="e.g. 2.4"
                     value={ahi} onChange={e => setAhi(e.target.value)}
                     className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white" />
            </label>
            <label className="text-[11px] text-gray-600">
              Mask seal (/20)
              <input type="number" step="1" min="0" max="20" placeholder="e.g. 18"
                     value={maskSeal} onChange={e => setMaskSeal(e.target.value)}
                     className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white" />
            </label>
            <label className="text-[11px] text-gray-600">
              Total score (/100)
              <input type="number" step="1" min="0" max="100" placeholder="e.g. 93"
                     value={totalScore} onChange={e => setTotalScore(e.target.value)}
                     className="mt-1 w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white" />
            </label>
          </div>

          <input type="text" placeholder="Notes (optional — mask discomfort, travel, illness)"
                 value={notes} onChange={e => setNotes(e.target.value)}
                 className="w-full text-[12px] rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white" />

          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button onClick={submit} disabled={busy || !hours}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40 transition-colors">
              {busy ? "Saving…" : saved ? "Update" : "Save last night"}
            </button>
            {saved && expanded && (
              <button onClick={() => setExpanded(false)}
                      className="text-[11px] font-medium text-gray-600 hover:text-gray-900">
                Cancel
              </button>
            )}
            <p className="text-[10px] text-gray-500 leading-snug flex-1">
              Insurance rule: ≥{snap?.threshold_hours ?? 4}h on ≥{snap?.threshold_pct ?? 75}% of nights.
            </p>
          </div>
        </>
      )}

      {snap && snap.logged_nights > 0 && (
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
          <MiniStat label="30-day avg" value={`${fmt(snap.avg_hours, 1)}h`} />
          <MiniStat label="Avg AHI"    value={fmt(snap.avg_ahi, 1)} />
          <MiniStat label="Avg score"  value={snap.avg_total_score != null ? `${fmt(snap.avg_total_score)}/100` : "—"} />
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
