"use client";

/**
 * HealthKitCard — Profile surface for native Apple Health integration.
 *
 * David 2026-08-03: replaces the XML upload as the primary Apple Health
 * connection method. Self-hides on web (isHealthKitAvailable returns
 * false) so the same Profile page works everywhere. On iOS, offers:
 *   - "Connect Apple Health" if not yet authorized
 *   - Sync status + "Sync now" once connected
 *
 * Actual data pull happens in lib/healthkit.ts. This card is just UX.
 */

import { useEffect, useState } from "react";
import {
  isHealthKitAvailable,
  requestAuthorization,
  syncRecent,
  markSyncedNow,
} from "@/lib/healthkit";

type State = "checking" | "unsupported" | "unauthorized" | "connected" | "syncing" | "error";

export default function HealthKitCard() {
  const [state, setState]   = useState<State>("checking");
  const [error, setError]   = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const available = await isHealthKitAvailable();
      if (!available) {
        setState("unsupported");
        return;
      }
      // We don't have a synchronous "am I authorized?" check — the
      // plugin's read query silently returns [] if not granted. We
      // start in the "unauthorized" state and flip to "connected"
      // after a successful authorize + sync. localStorage remembers
      // this across sessions.
      const cached = typeof window !== "undefined"
        ? localStorage.getItem("bn_hk_last_sync") : null;
      setState(cached ? "connected" : "unauthorized");
    })();
  }, []);

  // Web / Android — hide the card entirely; it's iOS-only functionality.
  if (state === "unsupported" || state === "checking") return null;

  const handleConnect = async () => {
    setError(null);
    const auth = await requestAuthorization();
    if (!auth.granted) {
      setError(auth.error || "Permission was denied");
      return;
    }
    setState("syncing");
    setLastResult(null);
    const res = await syncRecent(30);   // 30-day backfill on first connect
    if (res.error) {
      setError(res.error);
      setState("unauthorized");
      return;
    }
    markSyncedNow();
    setLastResult(`Synced ${res.days_synced} day${res.days_synced === 1 ? "" : "s"} of data.`);
    setState("connected");
  };

  const handleSyncNow = async () => {
    setError(null);
    setLastResult(null);
    setState("syncing");
    const res = await syncRecent(7);
    if (res.error) {
      setError(res.error);
      setState("connected");
      return;
    }
    markSyncedNow();
    setLastResult(`Synced ${res.days_synced} day${res.days_synced === 1 ? "" : "s"}.`);
    setState("connected");
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0" aria-hidden></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-gray-900 leading-tight">
            Apple Health
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
            Auto-sync your steps, sleep, HRV, heart rate, VO₂ max, weight,
            and blood pressure from Apple Health. Runs whenever you open the
            app.
          </p>
        </div>
      </div>

      {state === "unauthorized" && (
        <button
          onClick={handleConnect}
          className="w-full py-2.5 rounded-lg bg-black hover:bg-gray-900 text-white font-semibold text-sm transition-colors"
        >
           Connect Apple Health
        </button>
      )}

      {state === "syncing" && (
        <div className="flex items-center gap-2 text-[12px] text-gray-700">
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-[#1B3829] animate-spin" />
          Syncing from HealthKit…
        </div>
      )}

      {state === "connected" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-800 font-semibold">Connected</span>
            <span className="text-gray-500">— auto-syncs on app open</span>
          </div>
          <button
            onClick={handleSyncNow}
            className="text-[11px] font-semibold text-[#1B3829] hover:text-[#2D6A4F] underline underline-offset-2"
          >
            Sync now
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {lastResult && (
        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {lastResult}
        </p>
      )}

      <p className="text-[10px] text-gray-500 leading-snug">
        BackNine reads HealthKit data on your device. Nothing leaves your
        phone except the aggregated daily numbers we send to your account.
      </p>
    </section>
  );
}
