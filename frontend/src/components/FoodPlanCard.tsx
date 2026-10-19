"use client";

/**
 * FoodPlanCard — the user's eating protocol, checked by the app.
 *
 * David 2026-10-18: his nutritionist's plan (10-hour window, kitchen
 * closed 3 h before bed, protein first, carbs under 25 g/meal, veg at
 * lunch and dinner, no snacks, no alcohol during a 14-day restart).
 *
 * What makes it BackNine: most rules are checked against things we
 * already measure — meal logs for window/protein/carbs/snacks, the
 * OURA BEDTIME for "kitchen closed" (no other app can see that), the
 * vices log for drinks, the scale for weight. Only veg is a tap. Fiber
 * isn't tracked and the card says so instead of guessing.
 *
 * Nothing here moves the Health Span score or the League — a plan you
 * log is not a sensor. It's a coach's clipboard, not a scoreboard.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type FoodPlanToday } from "@/lib/api";

const RULE_LABEL: Record<string, string> = {
  kitchen_closed: "Kitchen closed 3 h before bed",
  window:         "10-hour eating window",
  protein_first:  "Protein first, every meal",
  carbs_capped:   "Carbs under 25 g a meal",
  veg:            "Two fists of veg · lunch & dinner",
  no_snacks:      "Three meals, no snacks",
  alcohol:        "Alcohol",
};
const ORDER = ["kitchen_closed", "window", "protein_first", "carbs_capped", "veg", "no_snacks", "alcohol"] as const;

export default function FoodPlanCard({ onAsk }: { onAsk?: (seed: string) => void }) {
  const [data, setData] = useState<FoodPlanToday | null>(null);
  const [noPlan, setNoPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  const load = useCallback(() => {
    api.foodPlanToday()
      .then(r => { if ("phase" in r) { setData(r); setNoPlan(false); } else { setData(null); setNoPlan(true); } })
      .catch(() => setNoPlan(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true);
    try { await api.foodPlanPut({ start: true }); load(); } finally { setBusy(false); }
  };
  const tapVeg = async (which: "veg_lunch" | "veg_dinner", value: boolean) => {
    if (!data) return;
    setBusy(true);
    try { await api.foodPlanDay({ date: data.today.date, [which]: value }); load(); } finally { setBusy(false); }
  };

  if (noPlan || !data) return null; // plan is set per-user; self-hides otherwise

  const { plan, phase, today, week } = data;
  const restart = phase.phase === "restart";
  const vegLunch = today.rules.veg.detail.includes("lunch ✓");
  const vegDinner = today.rules.veg.detail.includes("dinner ✓");

  const dot = (ok: boolean | null) =>
    ok === true ? "bg-emerald-500" : ok === false ? "bg-red-400" : "bg-gray-300";

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between bg-[#1B3829]/5 border-b border-gray-100">
        <div>
          <p className="font-bold text-sm text-[#1B3829] leading-tight">{plan.name}</p>
          <p className="text-[10px] uppercase tracking-widest text-gray-500">
            {phase.phase === "not_started" ? "not started"
              : restart ? `Restart · day ${phase.day} of ${phase.restart_days}`
              : `Day ${phase.day} · full targets`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-[#1B3829] leading-none">{today.kept}<span className="text-xs text-gray-500">/{today.measured}</span></p>
          <p className="text-[10px] text-gray-500">rules kept today</p>
        </div>
      </div>

      {phase.phase === "not_started" && (
        <div className="px-5 py-4">
          <p className="text-sm text-gray-700 mb-3">Two-week restart: six rules, no counting. Sunday prep: {plan.sunday_prep}</p>
          <button onClick={start} disabled={busy}
            className="rounded-xl bg-[#1B3829] text-white text-sm font-semibold px-4 py-2 disabled:opacity-50">
            Start the restart today
          </button>
        </div>
      )}

      {phase.phase !== "not_started" && (
        <>
          {/* Rules — measured where possible, grey where not */}
          <ul className="divide-y divide-gray-50">
            {ORDER.map(k => {
              const r = today.rules[k];
              if (!r) return null;
              return (
                <li key={k} className="flex items-start gap-3 px-5 py-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${dot(r.ok)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{RULE_LABEL[k]}</p>
                    <p className="text-[11px] text-gray-500">{r.detail}</p>
                  </div>
                  {k === "veg" && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => tapVeg("veg_lunch", !vegLunch)} disabled={busy}
                        className={`text-[10px] font-semibold rounded-lg px-2 py-1 border ${vegLunch ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "border-gray-200 text-gray-600"}`}>
                        Lunch
                      </button>
                      <button onClick={() => tapVeg("veg_dinner", !vegDinner)} disabled={busy}
                        className={`text-[10px] font-semibold rounded-lg px-2 py-1 border ${vegDinner ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "border-gray-200 text-gray-600"}`}>
                        Dinner
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Per-meal protein / carbs vs floors and caps */}
          {today.meals.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-50">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">Today&apos;s meals vs targets</p>
              <div className="space-y-1">
                {today.meals.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-16 shrink-0 capitalize text-gray-500">{m.slot}</span>
                    <span className="flex-1 truncate text-gray-800">{m.name ?? "meal"}</span>
                    <span className={`tabular-nums shrink-0 ${m.protein_ok ? "text-emerald-700" : "text-amber-700"}`}>
                      P {m.protein != null ? Math.round(m.protein) : "—"}/{m.protein_floor}
                    </span>
                    <span className={`tabular-nums shrink-0 ${m.carb_ok ? "text-emerald-700" : "text-amber-700"}`}>
                      C {m.carbs != null ? Math.round(m.carbs) : "—"}/{m.carb_cap}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sunday check-in — auto-tallied */}
          <div className="px-5 py-3 border-t border-gray-50">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">Last 7 days · the Sunday check-in</p>
            <div className="grid grid-cols-5 gap-1 text-center">
              {(["window", "protein_first", "veg", "no_snacks", "kitchen_closed"] as const).map(k => {
                const w = week[k];
                const good = w.of > 0 && w.kept >= Math.min(5, w.of);
                return (
                  <div key={k} className="rounded-lg bg-gray-50 px-1 py-1.5">
                    <p className={`text-sm font-bold tabular-nums ${w.of === 0 ? "text-gray-400" : good ? "text-emerald-700" : "text-gray-800"}`}>
                      {w.of === 0 ? "—" : `${w.kept}/${w.of}`}
                    </p>
                    <p className="text-[9px] text-gray-500 leading-tight">
                      {k === "window" ? "10-hr" : k === "protein_first" ? "protein" : k === "veg" ? "veg" : k === "no_snacks" ? "no snack" : "kitchen"}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">
              {data.weight_lb != null ? `Weight ${data.weight_lb} lb (scale) · ` : ""}
              {data.drinks_week ? `${data.drinks_week} drink${data.drinks_week === 1 ? "" : "s"} this week · ` : ""}
              five or more on each is a good week. Fiber isn&apos;t tracked here — flax and the two fists cover it.
            </p>
          </div>

          {/* Footer: plan details + ask Coach Al */}
          <div className="px-5 py-2.5 border-t border-gray-50 flex items-center justify-between">
            <button onClick={() => setShowPlan(v => !v)} className="text-[11px] font-semibold text-[#1B3829]">
              {showPlan ? "Hide the plan" : "The plan"}
            </button>
            {onAsk && (
              <button onClick={() => onAsk("I'm eating out tonight. Using my food plan's eating-out playbook, what should I order?")}
                className="text-[11px] font-semibold text-[#1B3829]">
                Eating out? Ask Coach Al →
              </button>
            )}
          </div>
          {showPlan && (
            <div className="px-5 pb-4 text-[11px] text-gray-600 space-y-2">
              {restart ? (
                <ol className="list-decimal pl-4 space-y-0.5">
                  {plan.restart_rules.map((r, i) => <li key={i}>{r}</li>)}
                </ol>
              ) : (
                <p>
                  Protein {plan.protein_floor_g.breakfast}/{plan.protein_floor_g.lunch}/{plan.protein_floor_g.dinner} g per meal ({plan.protein_day_g[0]}–{plan.protein_day_g[1]} g/day) ·
                  carbs under {plan.carb_cap_meal_g} g a meal, {plan.carb_cap_day_g} g a day · fiber about {plan.fiber_day_g} g ·
                  {" "}{plan.window_hours}-hour window, last bite {plan.kitchen_close_hours_before_bed} h before bed · water {plan.water_liters[0]}–{plan.water_liters[1]} L ·
                  {" "}≤{plan.alcohol_week_max} drinks a week.
                </p>
              )}
              <p><span className="font-semibold">Eating out:</span> {plan.eating_out.default} <span className="text-gray-500">If you slip: {plan.eating_out.slip}</span></p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
