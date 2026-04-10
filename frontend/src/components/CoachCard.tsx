"use client";

import type { CoachCard as CoachCardType } from "@/lib/api";

export default function CoachCard({ card }: { card: CoachCardType }) {
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{ backgroundColor: card.color, borderColor: card.border }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{card.icon}</span>
        <div>
          <p className="font-semibold text-white mb-1">{card.title}</p>
          <p className="text-white/70 leading-relaxed">{card.msg}</p>
        </div>
      </div>
    </div>
  );
}
