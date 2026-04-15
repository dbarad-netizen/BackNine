"use client";

import { useState } from "react";
import GEAR, { type GearItem } from "@/lib/gearData";

export default function GearTab() {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const visibleCategories =
    activeCategory === "all"
      ? GEAR
      : GEAR.filter((c) => c.id === activeCategory);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Gear</h2>
        <p className="mt-1 text-sm text-gray-500">
          Products we use and recommend. Curated for performance, recovery, and longevity.
        </p>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <FilterPill
          label="All"
          icon="✦"
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
        />
        {GEAR.map((cat) => (
          <FilterPill
            key={cat.id}
            label={cat.label}
            icon={cat.icon}
            active={activeCategory === cat.id}
            onClick={() =>
              setActiveCategory(activeCategory === cat.id ? "all" : cat.id)
            }
          />
        ))}
      </div>

      {/* Stacked categories */}
      {visibleCategories.map((cat) => (
        <section key={cat.id} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{cat.icon}</span>
            <h3 className="text-lg font-semibold text-gray-900">{cat.label}</h3>
            <div className="flex-1 h-px bg-gray-200 ml-2" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cat.items.map((item) => (
              <ProductCard key={item.id} item={item} categoryIcon={cat.icon} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FilterPill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition ${
        active
          ? "bg-[#2D6A4F] text-white"
          : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function ProductCard({
  item,
  categoryIcon,
}: {
  item: GearItem;
  categoryIcon: string;
}) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition overflow-hidden"
    >
      {item.image ? (
        <img src={item.image} alt={item.name} className="w-full h-40 object-cover" />
      ) : (
        <div className="w-full h-32 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-4xl">
          {categoryIcon}
        </div>
      )}

      <div className="p-4 flex flex-col flex-1 space-y-2">
        {item.badge && (
          <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2D6A4F]/10 text-[#2D6A4F]">
            {item.badge}
          </span>
        )}
        <div>
          <p className="text-xs text-gray-400 font-medium">{item.brand}</p>
          <h3 className="font-semibold text-gray-900 group-hover:text-[#2D6A4F] transition leading-snug">
            {item.name}
          </h3>
        </div>
        <p className="text-sm text-gray-500 flex-1 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-base font-bold text-gray-900">{item.price}</span>
          <span className="text-xs font-medium text-[#2D6A4F] group-hover:underline">
            View →
          </span>
        </div>
      </div>
    </a>
  );
}
