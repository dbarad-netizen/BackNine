"use client";

import { cn, scoreColor } from "@/lib/utils";

interface ScoreRingProps {
  score:   number | null | undefined;
  label:   string;
  size?:   number;
  stroke?: number;
}

export default function ScoreRing({ score, label, size = 96, stroke = 8 }: ScoreRingProps) {
  const r   = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = score != null ? Math.min(score, 100) / 100 : 0;
  const dash = circ * pct;

  const colorMap: Record<string, string> = {
    "text-green-400":  "#4ade80",
    "text-yellow-400": "#facc15",
    "text-red-400":    "#f87171",
    "text-gray-400":   "#9CA3AF",
  };
  const cls   = scoreColor(score);
  const color = colorMap[cls] ?? "#9CA3AF";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          {/* track */}
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="#E5E7EB" strokeWidth={stroke} />
          {/* fill */}
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-2xl font-bold tabular-nums", cls)}>
            {score ?? "—"}
          </span>
        </div>
      </div>
      <span className="text-xs text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
  );
}
