"use client";

/**
 * AppleHealthCard — raw Apple Health metrics for users without Oura.
 *
 * AH doesn't compute readiness / sleep / activity *scores* the way Oura does,
 * so we don't fake those. We surface the numbers AH actually provides — steps,
 * sleep duration, HRV, resting HR, active calories, weight/body comp, VO2 max —
 * each with an "as of [date]" stamp and a last-synced indicator so the user
 * always knows how fresh the data is.
 */

import type { AppleHealthBlock } from "@/lib/api";

interface Props {
  data: AppleHealthBlock;
}

function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return null;
  }
}

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const t = new Date(iso).getTime();
    const diffMin = Math.round((Date.now() - t) / 60000);
    if (diffMin < 1)   return "just now";
    if (diffMin < 60)  return `${diffMin} min ago`;
    const h = Math.round(diffMin / 60);
    if (h < 24)        return `${h}h ago`;
    const days = Math.round(h / 24);
    return `${days}d ago`;
  } catch {
    return null;
  }
}

function fmtSleep(hours?: number | null): string {
  if (hours == null) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

function kgToLbs(kg?: number | null): number | null {
  if (kg == null) return null;
  return Math.round(kg * 2.20462 * 10) / 10;
}

export default function AppleHealthCard({ data }: Props) {
  const t = data.today;
  const asOf  = shortDate(data.as_of);
  const synced = timeAgo(data.last_sync_at);

  // Group metrics so the card reads in a natural order: today's daily metrics
  // first (steps, sleep, recovery), then body comp / VO2 (slower-changing).
  const daily: Array<{ label: string; value: string; icon: string }> = [];
  if (t.steps           != null) daily.push({ icon: "👟",  label: "Steps",        value: t.steps.toLocaleString() });
  if (t.sleep_hours     != null) daily.push({ icon: "😴",  label: "Sleep",        value: fmtSleep(t.sleep_hours) });
  if (t.hrv             != null) daily.push({ icon: "❤️", label: "HRV",          value: `${Math.round(t.hrv)} ms` });
  if (t.resting_hr      != null) daily.push({ icon: "💗",  label: "Resting HR",   value: `${Math.round(t.resting_hr)} bpm` });
  if (t.active_calories != null) daily.push({ icon: "🔥",  label: "Active cal",   value: Math.round(t.active_calories).toLocaleString() });
  if (t.respiratory_rate != null) daily.push({ icon: "🌬️", label: "Resp rate",    value: `${Math.round(t.respiratory_rate)} /min` });

  const body: Array<{ label: string; value: string; icon: string }> = [];
  const lbs = kgToLbs(t.weight_kg);
  if (lbs                != null) body.push({ icon: "⚖️", label: "Weight",     value: `${lbs} lbs` });
  if (t.body_fat_percentage != null) body.push({ icon: "📉", label: "Body fat",   value: `${t.body_fat_percentage}%` });
  if (t.vo2_max          != null) body.push({ icon: "🫁",  label: "VO₂ max",    value: `${t.vo2_max} ml/kg/min` });
  if (t.bmi              != null) body.push({ icon: "📏", label: "BMI",        value: `${t.bmi}` });
  if (t.spo2             != null) body.push({ icon: "🩸",  label: "SpO₂",       value: `${t.spo2}%` });

  if (daily.length === 0 && body.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">
            Apple Health
          </p>
          <p className="text-sm font-bold text-gray-900">Your metrics</p>
        </div>
        <div className="text-right shrink-0">
          {asOf && (
            <p className="text-[11px] text-gray-600 font-medium">
              for <span className="text-gray-800 font-semibold">{asOf}</span>
            </p>
          )}
          {synced && (
            <p className="text-[10px] text-gray-600 mt-0.5">synced {synced}</p>
          )}
        </div>
      </div>

      {daily.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {daily.map(({ icon, label, value }) => (
            <div key={label} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
              <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1 truncate">
                {icon} {label}
              </p>
              <p className="text-sm font-bold text-gray-900 tabular-nums truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {body.length > 0 && (
        <>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
            Body composition
          </p>
          <div className="grid grid-cols-3 gap-2">
            {body.map(({ icon, label, value }) => (
              <div key={label} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold mb-1 truncate">
                  {icon} {label}
                </p>
                <p className="text-sm font-bold text-gray-900 tabular-nums truncate">{value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[10px] text-gray-600 mt-3 leading-relaxed">
        Apple Health doesn&apos;t compute Readiness, Sleep, or Activity scores like Oura does — so we show your raw numbers and let Coach Al do the interpretation.
      </p>
    </section>
  );
}
