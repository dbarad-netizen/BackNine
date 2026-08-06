"use client";

/**
 * CapabilitySettings — Devices & Trackers section on the Profile modal.
 *
 * A grid of on/off toggles for optional integrations. Turning one on
 * makes the associated card appear on the dashboard (Scorecard or
 * elsewhere). Turning off hides the card but does NOT delete any logged
 * data — the user can reactivate later and their history is intact.
 *
 * The list of capabilities lives here rather than the backend so we can
 * add new ones by just editing this file (backend accepts arbitrary
 * lower-case strings). Auto-enable on first data write is handled
 * server-side. David 2026-08-06.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Capability {
  key:         string;
  label:       string;
  description: string;
  emoji:       string;
  status?:     "live" | "coming-soon";
}

const CAPABILITIES: Capability[] = [
  { key: "cpap",      label: "CPAP therapy",       description: "Log nightly hours, AHI, mask seal — plus insurance-compliance tracking (≥4h on ≥75% of nights).", emoji: "😴", status: "live" },
  { key: "cgm",       label: "Continuous glucose", description: "Dexcom / FreeStyle Libre readings and correlations with meals + sleep.",                          emoji: "🩸", status: "coming-soon" },
  { key: "migraine",  label: "Migraine journal",   description: "Track episodes, triggers, and treatment response.",                                                emoji: "🤕", status: "coming-soon" },
  { key: "cycle",     label: "Cycle tracking",     description: "Menstrual and hormone phase tracking for cycle-aware coaching.",                                   emoji: "🌙", status: "coming-soon" },
  { key: "rehab",     label: "Rehab / PT plan",    description: "Log a current physical therapy protocol alongside training.",                                      emoji: "🩺", status: "coming-soon" },
];

export default function CapabilitySettings() {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getCapabilities()
      .then(res => setEnabled(new Set(res.enabled)))
      .catch((e: Error) => setError(e.message || "Couldn't load your device settings"))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (key: string, comingSoon: boolean) => {
    if (comingSoon) return;
    // Optimistic
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const res = await api.setCapabilities(Array.from(next));
      setEnabled(new Set(res.enabled));
    } catch (e) {
      // Rollback on failure
      setEnabled(enabled);
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-gray-500 py-4 text-center">Loading device settings…</div>;
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-gray-900">Devices &amp; Trackers</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          Turn on only what you use. Enabled trackers add a card to your
          Scorecard and feed data to Coach Al.
        </p>
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">{error}</p>
      )}

      <div className="grid gap-2">
        {CAPABILITIES.map(cap => {
          const on         = enabled.has(cap.key);
          const comingSoon = cap.status === "coming-soon";
          return (
            <button
              key={cap.key}
              onClick={() => toggle(cap.key, comingSoon)}
              disabled={busy || comingSoon}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                on
                  ? "border-emerald-300 bg-emerald-50/60"
                  : "border-gray-200 bg-white hover:border-gray-300"
              } ${comingSoon ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span className="text-2xl leading-none mt-0.5" aria-hidden>{cap.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{cap.label}</span>
                  {comingSoon && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                      coming soon
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{cap.description}</p>
              </div>
              <div
                className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                  on ? "bg-emerald-500" : "bg-gray-300"
                }`}
                aria-hidden
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    on ? "left-4" : "left-0.5"
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
