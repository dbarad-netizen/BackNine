"use client";

import { useEffect, useState } from "react";
import { api, type AppleHealthSummary } from "@/lib/api";

function kgToLb(kg: number): string {
  return (kg * 2.20462).toFixed(1);
}

function fmt(val: number | undefined | null, decimals = 0): string {
  if (val == null) return "—";
  return decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString();
}

export default function AppleHealthTab() {
  const [apiKey, setApiKey]   = useState<string | null>(null);
  const [summary, setSummary] = useState<AppleHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.appleHealthKey(),
      api.appleHealthData(30),
    ])
      .then(([keyRes, dataRes]) => {
        setApiKey(keyRes.api_key);
        setSummary(dataRes);
      })
      .catch((e: Error) => setError(e.message || "Failed to load Apple Health data"))
      .finally(() => setLoading(false));
  }, []);

  function copyKey() {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Apple Health</h2>
        <p className="mt-1 text-gray-500 text-sm">
          Sync HealthKit data to BackNine automatically via an iOS Shortcut.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── Setup card ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-5">
        <h3 className="font-semibold text-gray-800 text-lg">Setup</h3>

        <ol className="space-y-5 text-sm text-gray-700">
          {/* Step 1 */}
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              1
            </span>
            <div className="space-y-2 flex-1">
              <p className="font-medium text-gray-900">Build the BackNine Shortcut on your iPhone</p>
              <p className="text-gray-500 text-xs">
                Open the iOS Shortcuts app → tap <strong>+</strong> → add the actions below. Or follow
                the step-by-step guide in <code className="bg-gray-100 px-1 rounded">APPLE_HEALTH_SHORTCUT.md</code> in your project folder.
              </p>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs space-y-1 font-mono text-gray-600">
                <p>1. Get Quantity Samples → Steps (Sum, Today)</p>
                <p>2. Get Quantity Samples → Resting HR (Average, Today)</p>
                <p>3. Get Quantity Samples → HRV SDNN (Average, Today)</p>
                <p>4. Get Quantity Samples → Active Energy (Sum, Today)</p>
                <p>5. Get Quantity Samples → Body Mass (Latest)</p>
                <p>6. Get Quantity Samples → VO2 Max (Latest)</p>
                <p>7. Sleep Analysis → Asleep hours (Sum, Last Night)</p>
                <p>8. Get Current Date → Format as yyyy-MM-dd</p>
                <p>9. Dictionary → keys: date, steps, resting_hr, hrv,</p>
                <p className="pl-4">active_calories, weight_lb, vo2_max, sleep_hours</p>
                <p>10. Get Contents of URL → POST with JSON body (see below)</p>
              </div>
            </div>
          </li>

          {/* Step 2 */}
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              2
            </span>
            <div className="space-y-2 flex-1">
              <p className="font-medium text-gray-900">Copy your API key and paste it into the Shortcut</p>
              <p className="text-gray-500 text-xs">
                In the URL action, set header <code className="bg-gray-100 px-1 rounded">X-AH-Key</code> to this key:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700 truncate select-all">
                  {apiKey || "—"}
                </code>
                <button
                  onClick={copyKey}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-gray-500 text-xs">
                Endpoint: <code className="bg-gray-100 px-1 rounded">POST https://backnine-hu60.onrender.com/api/apple-health/sync</code>
              </p>
            </div>
          </li>

          {/* Step 3 */}
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              3
            </span>
            <div className="flex-1">
              <p className="font-medium text-gray-900">Run the Shortcut daily (or automate it)</p>
              <p className="text-gray-500 mt-1 text-xs">
                Tap the shortcut once to test. To automate: Shortcuts → Automation → New Automation →
                Time of Day (e.g. 8 PM) → Run Shortcut → turn off "Ask Before Running".
              </p>
            </div>
          </li>
        </ol>

        {/* What gets synced */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data synced</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
            {["Steps", "Sleep hours", "Active calories", "Resting heart rate", "HRV", "Weight", "VO₂ Max", "Respiratory rate"].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Data card ──────────────────────────────────────────────────────── */}
      {summary?.has_data ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-lg">Your Data</h3>
            <span className="text-xs text-gray-400">
              {summary.days_synced} day{summary.days_synced !== 1 ? "s" : ""} synced · as of {summary.as_of}
            </span>
          </div>

          {/* Most recent */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Most Recent</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricBox label="Steps"       value={fmt(summary.today?.steps)}            unit="steps"     icon="👟" />
              <MetricBox label="Sleep"       value={fmt(summary.today?.sleep_hours, 1)}   unit="hrs"       icon="😴" />
              <MetricBox label="Active Cal"  value={fmt(summary.today?.active_calories)}  unit="kcal"      icon="🔥" />
              <MetricBox label="Resting HR"  value={fmt(summary.today?.resting_hr)}       unit="bpm"       icon="❤️" />
              <MetricBox label="HRV"         value={fmt(summary.today?.hrv, 1)}           unit="ms"        icon="📈" />
              <MetricBox
                label="Weight"
                value={summary.today?.weight_kg ? kgToLb(summary.today.weight_kg) : "—"}
                unit="lbs"
                icon="⚖️"
              />
              <MetricBox label="VO₂ Max"    value={fmt(summary.today?.vo2_max, 1)}       unit="ml/kg/min" icon="🫁" />
              <MetricBox label="Resp. Rate" value={fmt(summary.today?.respiratory_rate, 1)} unit="br/min" icon="💨" />
            </div>
          </div>

          {/* 30-day averages */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">30-Day Averages</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <AvgBox label="Avg Steps"      value={fmt(summary.averages?.steps)} />
              <AvgBox label="Avg Sleep"      value={`${fmt(summary.averages?.sleep_hours, 1)} hrs`} />
              <AvgBox label="Avg Active Cal" value={`${fmt(summary.averages?.active_calories)} kcal`} />
              <AvgBox label="Avg Resting HR" value={`${fmt(summary.averages?.resting_hr)} bpm`} />
              <AvgBox label="Avg HRV"        value={`${fmt(summary.averages?.hrv, 1)} ms`} />
              <AvgBox
                label="Latest Weight"
                value={summary.latest_weight_kg ? `${kgToLb(summary.latest_weight_kg)} lbs` : "—"}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center space-y-2">
          <p className="text-4xl">📱</p>
          <p className="font-medium text-gray-700">No data synced yet</p>
          <p className="text-sm text-gray-500">
            Complete setup above and run the Shortcut on your iPhone to see your health data here.
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
