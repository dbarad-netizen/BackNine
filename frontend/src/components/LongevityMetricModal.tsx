"use client";

/**
 * LongevityMetricModal — per-slot history pop-out for the Longevity Score.
 *
 * Tap a Longevity card slot → modal opens with a 90-day chart for THAT
 * metric, threshold-band overlay, and a "wins vs misses" summary so you
 * can see whether you've been trending up or down on the thing the slot
 * actually measures.
 *
 * Lightweight: backend serves a small payload (date+value list + unit +
 * threshold). Frontend renders pure inline SVG so it prints if needed.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Props {
  open:        boolean;
  metricKey:   string;          // hrv | rhr | sleep | steps | body_fat | vo2_max
  metricLabel: string;          // display label ("Heart Rate Variability")
  onClose:     () => void;
}

interface HistoryPayload {
  metric:    string;
  unit:      string;
  threshold: number | null;
  trend:     Array<{ date: string; value: number; pre_reset?: boolean }>;
  /** Baseline reset (e.g. "Started CPAP" on Aug 3): nights before this
      date are drawn dimmed and excluded from stats/direction. */
  reset_date?:   string | null;
  reset_reason?: string | null;
}

export default function LongevityMetricModal({ open, metricKey, metricLabel, onClose }: Props) {
  const [data, setData]       = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setData(null);
    api.longevityMetricHistory(metricKey, 90)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load"))
      .finally(() => setLoading(false));
  }, [open, metricKey]);

  if (!open) return null;

  // Mini-stats from the trend — post-reset nights only. Pre-reset HRV
  // (apnea-inflated) is not a baseline; it's shown on the chart as
  // history, never averaged into "you".
  const resetDate = data?.reset_date ?? null;
  const postTrend = data?.trend.filter(p => !p.pre_reset) ?? [];
  const preVals   = data?.trend.filter(p => p.pre_reset).map(p => p.value) ?? [];
  const vals = postTrend.map(p => p.value);
  const preAvg  = preVals.length >= 5 ? Math.round((preVals.reduce((a, b) => a + b, 0) / preVals.length) * 10) / 10 : null;
  const fmtReset = resetDate
    ? new Date(resetDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const avg  = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  const min  = vals.length ? Math.min(...vals) : null;
  const max  = vals.length ? Math.max(...vals) : null;
  const last = vals.length ? vals[vals.length - 1] : null;

  // Direction call: compare first-third vs last-third averages
  let direction: "up" | "down" | "flat" | "no-data" = "no-data";
  if (vals.length >= 6) {
    const third = Math.floor(vals.length / 3);
    const firstAvg = vals.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const lastAvg  = vals.slice(-third).reduce((a, b) => a + b, 0) / third;
    const delta = lastAvg - firstAvg;
    const relativeDelta = Math.abs(delta) / Math.max(0.001, firstAvg);
    if (relativeDelta < 0.03) direction = "flat";
    else if (delta > 0)       direction = "up";
    else                       direction = "down";
  }

  // For BF and RHR, lower is better; flip the direction interpretation
  const lowerIsBetter = metricKey === "rhr" || metricKey === "body_fat";
  const directionGood =
    direction === "no-data" ? null :
    direction === "flat" ? null :
    lowerIsBetter ? direction === "down" : direction === "up";

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-center justify-center p-2 sm:p-6">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-900">{metricLabel} · 90-day history</p>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-xl leading-none px-2"
            aria-label="Close"
          >×</button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading && <p className="text-sm text-gray-600 italic">Loading…</p>}
          {error   && <p className="text-sm text-red-500">Couldn&apos;t load: {error}</p>}
          {!loading && !error && data && (
            <>
              {/* Stat tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <StatTile label="Latest" value={last} unit={data.unit} />
                <StatTile label={fmtReset ? `Avg since ${fmtReset}` : "Average"} value={avg}  unit={data.unit} />
                <StatTile label="Min"     value={min}  unit={data.unit} />
                <StatTile label="Max"     value={max}  unit={data.unit} />
              </div>

              {/* Trend chart */}
              {data.trend.length >= 2 ? (
                <MiniChart
                  trend={data.trend}
                  threshold={data.threshold}
                  unit={data.unit}
                  lowerIsBetter={lowerIsBetter}
                  resetLabel={fmtReset}
                />
              ) : (
                <p className="text-sm text-gray-600 italic">
                  Not enough history yet. Trend will fill in as data accumulates.
                </p>
              )}

              {/* Baseline reset explainer — the before/after shown as what it is */}
              {fmtReset && preVals.length > 0 && (
                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  <p className="font-semibold">
                    Baseline reset {fmtReset}{data.reset_reason ? ` — ${data.reset_reason}` : ""}
                  </p>
                  <p className="text-xs mt-0.5">
                    {preAvg != null && avg != null
                      ? `Before: ${preAvg} ${data.unit} avg · Since: ${avg} ${data.unit} avg. `
                      : ""}
                    {metricKey === "hrv"
                      ? "Nights before the reset are shown faded and aren't counted as your baseline. Untreated sleep apnea inflates wearable HRV; a lower, steadier number after treatment is the real you — not a decline."
                      : "Nights before the reset are shown faded and aren't counted as your baseline, so trends and averages only compare you to yourself since then."}
                  </p>
                </div>
              )}

              {/* Direction summary */}
              {direction !== "no-data" && (
                <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                  directionGood === true  ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                  directionGood === false ? "bg-amber-50  border-amber-200  text-amber-800"     :
                                            "bg-gray-50   border-gray-200   text-gray-700"
                }`}>
                  <p className="font-semibold">
                    {direction === "flat"
                      ? "Holding steady"
                      : direction === "up"
                        ? `Trending up${lowerIsBetter ? " — worth watching" : ", nice"}`
                        : `Trending down${lowerIsBetter ? ", nice" : " — worth watching"}`}
                  </p>
                  {data.threshold != null && last != null && (
                    <p className="text-xs mt-0.5">
                      Latest {last}{data.unit ? ` ${data.unit}` : ""} vs threshold {data.threshold}{data.unit ? ` ${data.unit}` : ""}
                      {lowerIsBetter
                        ? (last <= data.threshold ? " — you&apos;re inside the target band." : " — above target band.")
                        : (last >= data.threshold ? " — you&apos;re inside the target band." : " — below target band.")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2 bg-white">
      <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-base font-bold text-gray-900 leading-tight">
        {value == null ? "—" : (Number.isInteger(value) ? value : value.toFixed(1))}
        {value != null && unit && <span className="text-[11px] text-gray-600 font-normal ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function MiniChart({ trend, threshold, lowerIsBetter, resetLabel }: {
  trend:        Array<{ date: string; value: number; pre_reset?: boolean }>;
  threshold:    number | null;
  unit:         string;
  lowerIsBetter: boolean;
  resetLabel?:  string | null;
}) {
  if (trend.length < 2) return null;
  // Index of the first post-reset night (divider position), if any pre-reset nights exist.
  const firstPost = trend.findIndex(p => !p.pre_reset);
  const hasDivider = firstPost > 0;

  // Y-range from the post-reset line (plus threshold) so an inflated
  // pre-reset era doesn't squash the real signal; pre-reset points are
  // clamped into view.
  const allValues  = (hasDivider ? trend.slice(firstPost) : trend).map(p => p.value);
  const refValues  = threshold != null ? [threshold] : [];
  const dataMin    = Math.min(...allValues, ...refValues);
  const dataMax    = Math.max(...allValues, ...refValues);
  const pad        = (dataMax - dataMin) * 0.1 || 1;
  const lo         = dataMin - pad;
  const hi         = dataMax + pad;

  const margin = { top: 10, right: 50, bottom: 24, left: 36 };
  const width  = 600;
  const height = 180;
  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  const n = trend.length;
  const xFor = (i: number) => margin.left + (i / Math.max(1, n - 1)) * innerW;
  const yFor = (v: number) => margin.top  + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * innerH;

  const lineColor = lowerIsBetter ? "#0891b2" : "#059669";
  const prePts  = trend.slice(0, hasDivider ? firstPost : 0);
  const postPts = hasDivider ? trend.slice(firstPost) : trend;
  const prePoly  = prePts.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(" ");
  const postPoly = postPts.map((p, i) => `${xFor(i + (hasDivider ? firstPost : 0))},${yFor(p.value)}`).join(" ");

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return iso; }
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img">
      {/* Axes */}
      <line x1={margin.left} y1={margin.top}            x2={margin.left}            y2={margin.top + innerH} stroke="#d1d5db" strokeWidth="0.5" />
      <line x1={margin.left} y1={margin.top + innerH}   x2={margin.left + innerW}   y2={margin.top + innerH} stroke="#d1d5db" strokeWidth="0.5" />

      <text x={margin.left - 4} y={margin.top + 4}      textAnchor="end" fontSize="10" fill="#6b7280">{Math.round(hi)}</text>
      <text x={margin.left - 4} y={margin.top + innerH} textAnchor="end" fontSize="10" fill="#6b7280">{Math.round(lo)}</text>

      {/* Threshold reference line */}
      {threshold != null && (
        <g>
          <line
            x1={margin.left}             y1={yFor(threshold)}
            x2={margin.left + innerW}    y2={yFor(threshold)}
            stroke="#94a3b8" strokeWidth="0.75" strokeDasharray="3,3"
          />
          <text x={margin.left + innerW + 4} y={yFor(threshold) + 3} fontSize="10" fill="#94a3b8">
            {threshold}
          </text>
        </g>
      )}

      {/* Pre-reset history: faded, dashed — context, not baseline */}
      {prePts.length >= 2 && (
        <polyline fill="none" stroke="#9ca3af" strokeWidth="1.25" strokeDasharray="2,3" points={prePoly} />
      )}
      {/* Reset divider */}
      {hasDivider && (
        <g>
          <line x1={xFor(firstPost)} y1={margin.top} x2={xFor(firstPost)} y2={margin.top + innerH}
                stroke="#0284c7" strokeWidth="1" strokeDasharray="4,3" />
          <text x={xFor(firstPost) + 4} y={margin.top + 10} fontSize="10" fill="#0284c7">
            {resetLabel ? `reset ${resetLabel}` : "reset"}
          </text>
        </g>
      )}
      {/* Trend line (post-reset, or everything when no reset) */}
      {postPts.length >= 2 && (
        <polyline fill="none" stroke={lineColor} strokeWidth="1.5" points={postPoly} />
      )}
      <circle cx={xFor(n - 1)} cy={yFor(trend[n - 1].value)} r="3" fill={lineColor} />

      {/* Date stamps */}
      <text x={margin.left} y={margin.top + innerH + 14} fontSize="10" fill="#6b7280">{fmtDate(trend[0].date)}</text>
      <text x={margin.left + innerW} y={margin.top + innerH + 14} textAnchor="end" fontSize="10" fill="#6b7280">{fmtDate(trend[n - 1].date)}</text>
    </svg>
  );
}
