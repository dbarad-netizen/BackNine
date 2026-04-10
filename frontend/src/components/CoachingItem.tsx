"use client";

import type { CoachItem } from "@/lib/api";

export default function CoachingItem({ item }: { item: CoachItem }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-white border border-gray-200 p-4">
      <span
        className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: item.color }}
      />
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg leading-none">{item.icon}</span>
          <span className="font-semibold text-gray-900 text-sm">{item.label}</span>
        </div>
        <p className="text-gray-500 text-sm leading-relaxed">{item.text}</p>
      </div>
    </div>
  );
}
