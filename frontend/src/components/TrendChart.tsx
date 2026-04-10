"use client";

import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { TrendDay } from "@/lib/api";
import { fmtDate } from "@/lib/utils";

interface TrendChartProps {
  data:   TrendDay[];
  metric: "scores" | "hrv" | "sleep_detail";
}

const SCORES_LINES = [
  { key: "readiness", color: "#4ade80", label: "Readiness" },
  { key: "sleep",     color: "#818cf8", label: "Sleep" },
  { key: "activity",  color: "#f59e0b", label: "Activity" },
];

const HRV_LINES = [
  { key: "hrv",  color: "#4ade80", label: "HRV (ms)" },
  { key: "rhr",  color: "#f87171", label: "RHR (bpm)" },
];

const SLEEP_LINES = [
  { key: "total_hrs", color: "#818cf8", label: "Total (h)" },
  { key: "deep_min",  color: "#4ade80", label: "Deep (min)" },
  { key: "rem_min",   color: "#a78bfa", label: "REM (min)" },
];

export default function TrendChart({ data, metric }: TrendChartProps) {
  const lines =
    metric === "scores"       ? SCORES_LINES  :
    metric === "hrv"          ? HRV_LINES     :
    SLEEP_LINES;

  const formatted = data.map((d) => ({ ...d, label: fmtDate(d.date) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="label"
          tick={{ fill: "#9CA3AF", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#D1D5DB" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#9CA3AF", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#FFFFFF", border: "1px solid #3f3f46", borderRadius: 8 }}
          labelStyle={{ color: "#6B7280" }}
          itemStyle={{ color: "#111827" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#6B7280", paddingTop: 8 }}
        />
        {lines.map(({ key, color, label }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={label}
            stroke={color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
