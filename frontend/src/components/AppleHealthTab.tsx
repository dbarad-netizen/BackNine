"use client";

import { useEffect, useState } from "react";
import { api, type AppleHealthSummary } from "@/lib/api";

const SYNC_URL = "https://backnine-hu60.onrender.com/api/apple-health/sync";

function kgToLb(kg: number): string {
  return (kg * 2.20462).toFixed(1);
}

function fmt(val: number | undefined | null, decimals = 0): string {
  if (val == null) return "—";
  return decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString();
}

export default function AppleHealthTab() {
  const [apiKey, setApiKey]       = useState<string | null>(null);
  const [summary, setSummary]     = useState<AppleHealthSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [copied, setCopied]       = useState<"key" | "url" | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showShortcut, setShowShortcut] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.appleHealthKey(), api.appleHealthData(30)])
      .then(([keyRes, dataRes]) => {
        setApiKey(keyRes.api_key);
        setSummary(dataRes);
        setShowSetup(!dataRes.has_data); // expand setup only until first sync lands
      })
      .catch((e: Error) => setError(e.message || "Failed to load Apple Health data"))
      .finally(() => setLoading(false));
  }, []);

  function copy(text: string, which: "key" | "url") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(c => (c === which ? null : c)), 2000);
    });
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B3829]" />
      </div>
    );
  }

  const connected = !!summary?.has_data;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Apple Health</h2>
        <p className="mt-1 text-gray-500 text-sm">
          Pull steps, sleep, HRV, heart rate, body composition and more from Apple Health —
          including anything your Apple Watch, Withings, or other devices write to it.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── Connection status ───────────────────────────────────────────── */}
      <div
        className={`rounded-2xl border p-4 flex items-center gap-3 ${
          connected ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <span className="text-2xl">{connected ? "✅" : "🔌"}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${connected ? "text-green-800" : "text-amber-800"}`}>
            {connected ? "Connected" : "Not connected yet"}
          </p>
          <p className={`text-xs ${connected ? "text-green-700" : "text-amber-700"}`}>
            {connected
              ? `${summary!.days_synced} day${summary!.days_synced !== 1 ? "s" : ""} of data · most recent ${summary!.as_of}`
              : "Set up Health Auto Export below to start pulling your Apple Health data in automatically."}
          </p>
        </div>
        <button
          onClick={() => setShowSetup(s => !s)}
          className="shrink-0 text-xs font-medium text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          {showSetup ? "Hide setup" : connected ? "Setup" : "Set up"}
        </button>
      </div>

      {/* ── Setup ───────────────────────────────────────────────────────── */}
      {showSetup && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-6">
          <div>
            <h3 className="font-semibold text-gray-900">Connect with Health Auto Export</h3>
            <p className="text-sm text-gray-500 mt-1">
              The easiest way — a free App Store app that sends your Health data to BackNine on a
              schedule. No coding, no Apple Developer account.
            </p>
          </div>

          {/* Your credentials */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Sync URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700 truncate select-all">
                  {SYNC_URL}
                </code>
                <button
                  onClick={() => copy(SYNC_URL, "url")}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition shrink-0"
                >
                  {copied === "url" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Header — <code className="bg-gray-100 px-1 rounded">X-AH-Key</code>
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700 truncate select-all">
                  {apiKey || "—"}
                </code>
                <button
                  onClick={() => apiKey && copy(apiKey, "key")}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition shrink-0"
                >
                  {copied === "key" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                This key is private — it links the data to your account. Don&apos;t share it.
              </p>
            </div>
          </div>

          {/* Steps */}
          <ol className="space-y-4 text-sm text-gray-700">
            {[
              <>Install <strong>Health Auto Export – JSON+CSV</strong> from the App Store and open it (allow it access to Health when asked).</>,
              <>Go to <strong>Automations</strong> → <strong>＋ Add Automation</strong>.</>,
              <>Set the export to <strong>REST API</strong>, method <strong>POST</strong>, and paste the <strong>Sync URL</strong> above.</>,
              <>Add a request header named <code className="bg-gray-100 px-1 rounded">X-AH-Key</code> with your key above as the value.</>,
              <>Set format to <strong>JSON</strong>, aggregation to <strong>Daily</strong>, and choose the metrics: steps, sleep, resting heart rate, HRV, active energy, VO₂ max, weight, body fat, respiratory rate.</>,
              <>Set the schedule to run <strong>daily</strong> (e.g. every evening), then <strong>save</strong> and tap <strong>Run</strong> once to test.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1B3829] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1">{step}</div>
              </li>
            ))}
          </ol>

          <p className="text-xs text-gray-500">
            After the first run, refresh this page — your data appears below and starts feeding your
            Longevity Score, leaderboard, and Coach Al.
          </p>

          {/* What gets synced */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data we can read</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
              {["Steps", "Sleep + stages", "Active calories", "Resting HR", "HRV", "VO₂ Max", "Weight", "Body fat %", "Lean / muscle mass", "Blood pressure", "SpO₂", "Respiratory rate"].map((item) => (
                <div key={item} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2D6A4F] flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Alternative: manual Shortcut */}
          <div className="border-t border-gray-100 pt-4">
            <button
              onClick={() => setShowShortcut(s => !s)}
              className="text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              {showShortcut ? "▲ Hide" : "▼ Prefer a free Apple Shortcut instead? (advanced)"}
            </button>
            {showShortcut && (
              <div className="mt-3 space-y-3 text-xs text-gray-600">
                <p>
                  You can also build an iOS Shortcut that reads Health samples and POSTs to the same
                  Sync URL with the <code className="bg-gray-100 px-1 rounded">X-AH-Key</code> header. Send a flat JSON body like:
                </p>
                <pre className="rounded-lg bg-gray-900 text-gray-100 p-3 overflow-x-auto text-[11px] leading-relaxed">{`{
  "date": "2026-05-20",
  "steps": 8432,
  "resting_hr": 58,
  "hrv": 45.3,
  "active_calories": 512,
  "weight_lb": 181.0,
  "vo2_max": 48.2,
  "sleep_hours": 7.2
}`}</pre>
                <p>
                  Then automate it (Shortcuts → Automation → Time of Day → Run Shortcut, with
                  &quot;Ask Before Running&quot; off). Health Auto Export is easier and handles more
                  metrics, so it&apos;s the recommended route.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Data card ──────────────────────────────────────────────────────── */}
      {connected ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-lg">Your Data</h3>
            <span className="text-xs text-gray-400">
              {summary!.days_synced} day{summary!.days_synced !== 1 ? "s" : ""} synced · as of {summary!.as_of}
            </span>
          </div>

          {/* Most recent */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Most Recent</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricBox label="Steps"       value={fmt(summary!.today?.steps)}            unit="steps"     icon="👟" />
              <MetricBox label="Sleep"       value={fmt(summary!.today?.sleep_hours, 1)}   unit="hrs"       icon="😴" />
              <MetricBox label="Active Cal"  value={fmt(summary!.today?.active_calories)}  unit="kcal"      icon="🔥" />
              <MetricBox label="Resting HR"  value={fmt(summary!.today?.resting_hr)}       unit="bpm"       icon="❤️" />
              <MetricBox label="HRV"         value={fmt(summary!.today?.hrv, 1)}           unit="ms"        icon="📈" />
              <MetricBox
                label="Weight"
                value={summary!.today?.weight_kg ? kgToLb(summary!.today.weight_kg) : "—"}
                unit="lbs"
                icon="⚖️"
              />
              <MetricBox label="VO₂ Max"    value={fmt(summary!.today?.vo2_max, 1)}       unit="ml/kg/min" icon="🫁" />
              <MetricBox label="Resp. Rate" value={fmt(summary!.today?.respiratory_rate, 1)} unit="br/min" icon="💨" />
            </div>
          </div>

          {/* Body composition — only show if InBody data exists */}
          {(summary!.latest_body_fat_pct || summary!.latest_lean_mass_kg || summary!.latest_skeletal_muscle_kg) && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Body Composition (InBody)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="Body Fat"    value={fmt(summary!.latest_body_fat_pct, 1)} unit="%"    icon="📊" />
                <MetricBox label="Lean Mass"   value={summary!.latest_lean_mass_kg ? kgToLb(summary!.latest_lean_mass_kg) : "—"} unit="lbs" icon="💪" />
                <MetricBox label="Muscle Mass" value={summary!.latest_skeletal_muscle_kg ? kgToLb(summary!.latest_skeletal_muscle_kg) : "—"} unit="lbs" icon="🦵" />
                <MetricBox label="BMI"         value={fmt(summary!.latest_bmi, 1)} unit="" icon="⚖️" />
              </div>
            </div>
          )}

          {/* 30-day averages */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">30-Day Averages</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <AvgBox label="Avg Steps"      value={fmt(summary!.averages?.steps)} />
              <AvgBox label="Avg Sleep"      value={`${fmt(summary!.averages?.sleep_hours, 1)} hrs`} />
              <AvgBox label="Avg Active Cal" value={`${fmt(summary!.averages?.active_calories)} kcal`} />
              <AvgBox label="Avg Resting HR" value={`${fmt(summary!.averages?.resting_hr)} bpm`} />
              <AvgBox label="Avg HRV"        value={`${fmt(summary!.averages?.hrv, 1)} ms`} />
              <AvgBox
                label="Latest Weight"
                value={summary!.latest_weight_kg ? `${kgToLb(summary!.latest_weight_kg)} lbs` : "—"}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center space-y-2">
          <p className="text-4xl">📱</p>
          <p className="font-medium text-gray-700">No data synced yet</p>
          <p className="text-sm text-gray-500">
            Set up Health Auto Export above and run it once on your iPhone — your data shows up here.
          </p>
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value, unit, icon }: { label: string; value: string; unit: string; icon: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400">{unit}</p>
    </div>
  );
}

function AvgBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}
