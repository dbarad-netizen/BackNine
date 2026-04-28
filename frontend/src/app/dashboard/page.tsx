"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  api,
  type DashboardData,
  type NutritionToday,
  type NutritionSummary,
  type WeightEntry,
  type FoodItem,
  type Meal,
  type NutritionSettings,
} from "@/lib/api";
import { scoreColor, fmtDate } from "@/lib/utils";
import ScoreRing from "@/components/ScoreRing";
import CoachCard from "@/components/CoachCard";
import CoachingItem from "@/components/CoachingItem";
import TrendChart from "@/components/TrendChart";
import TrainingTab from "@/components/TrainingTab";
import LabsTab from "@/components/LabsTab";
import ChallengeTab from "@/components/ChallengeTab";
import AppleHealthTab from "@/components/AppleHealthTab";
import GearTab from "@/components/GearTab";
import InsightsSection from "@/components/InsightsSection";
import ProgressSection from "@/components/ProgressSection";
import ChatWidget from "@/components/ChatWidget";
import ProfileModal from "@/components/ProfileModal";
import CoachAlAvatar from "@/components/CoachAlAvatar";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

type Tab     = "scores" | "hrv" | "sleep_detail";
type Section = "coaching" | "nutrition" | "training" | "labs" | "challenges" | "apple-health" | "gear";

// ── Calorie ring ──────────────────────────────────────────────────────────────
function CalorieRing({
  consumed, budget, color = "#22c55e",
}: { consumed: number; budget: number; color?: string }) {
  const r    = 42;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(1, consumed / Math.max(budget, 1));
  return (
    <div className="relative w-28 h-28 flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E5E7EB" strokeWidth="10" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={pct >= 1 ? "#ef4444" : color}
          strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-gray-900 leading-none">{consumed}</span>
        <span className="text-[10px] text-gray-400 mt-0.5">/ {budget}</span>
      </div>
    </div>
  );
}

// ── Macro bar ─────────────────────────────────────────────────────────────────
function MacroBar({
  label, value, target, unit = "g", color,
}: { label: string; value: number; target: number; unit?: string; color: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(target, 1)) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-700 font-medium">{value}{unit} <span className="text-gray-400">/ {target}{unit}</span></span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Fasting clock ──────────────────────────────────────────────────────────────
function FastingClock({ start, end }: { start: string; end: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Parse HH:MM to minutes-since-midnight
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const startMin = toMin(start);
  const endMin   = toMin(end);

  const inWindow = nowMin >= startMin && nowMin < endMin;
  const windowLen = endMin - startMin;   // eating window in minutes
  const fastLen   = 1440 - windowLen;   // fasting window in minutes

  let elapsed: number;
  let total: number;
  let nextEvent: string;
  let nextMin: number;

  if (inWindow) {
    elapsed  = nowMin - startMin;
    total    = windowLen;
    nextMin  = endMin - nowMin;
    const h  = Math.floor(nextMin / 60), m = nextMin % 60;
    nextEvent = `Eating window closes in ${h}h ${m}m`;
  } else {
    if (nowMin >= endMin) {
      elapsed = nowMin - endMin;
    } else {
      elapsed = nowMin + (1440 - endMin); // past midnight
    }
    total   = fastLen;
    nextMin = nowMin < startMin ? startMin - nowMin : 1440 - nowMin + startMin;
    const h = Math.floor(nextMin / 60), m = nextMin % 60;
    nextEvent = `Eating window opens in ${h}h ${m}m`;
  }

  const pct = Math.min(100, Math.round((elapsed / Math.max(total, 1)) * 100));
  const fastHours = (fastLen / 60).toFixed(0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">
        {parseInt(fastHours)}:{(60 - windowLen % 60).toString().padStart(2, "0")} Intermittent Fasting
      </p>
      <div className="flex items-center gap-5">
        {/* Arc */}
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#E5E7EB" strokeWidth="12" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke={inWindow ? "#f59e0b" : "#6366f1"}
              strokeWidth="12" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (1 - pct / 100)}`}
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold" style={{ color: inWindow ? "#f59e0b" : "#6366f1" }}>
              {pct}%
            </span>
          </div>
        </div>
        <div className="flex-1">
          <p className={`text-base font-semibold mb-1 ${inWindow ? "text-amber-400" : "text-indigo-400"}`}>
            {inWindow ? "🍽️ Eating Window" : "⏳ Fasting"}
          </p>
          <p className="text-xs text-gray-500">{nextEvent}</p>
          <p className="text-xs text-gray-400 mt-1">
            Window: {start} – {end}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Add meal form ─────────────────────────────────────────────────────────────
function AddMealForm({ onAdd }: { onAdd: (meal: Omit<Meal, "id" | "logged_at">) => void }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [mode,    setMode]    = useState<"search" | "custom">("search");
  const [custom,  setCustom]  = useState({ name: "", calories: "", protein: "", carbs: "", fat: "", meal_type: "meal" });
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [qty,     setQty]     = useState("1");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const { results: r } = await api.searchFoods(q);
        setResults(r);
      } catch { setResults([]); }
    }, 300);
  }, []);

  const pickFood = (f: FoodItem) => {
    setSelected(f);
    setQuery(f.name);
    setResults([]);
    setQty("1");
  };

  const submitSearch = () => {
    if (!selected) return;
    const q = parseFloat(qty) || 1;
    onAdd({
      name:      `${selected.name} (${q} × ${selected.unit})`,
      calories:  Math.round(selected.calories * q),
      protein:   Math.round(selected.protein  * q * 10) / 10,
      carbs:     Math.round(selected.carbs    * q * 10) / 10,
      fat:       Math.round(selected.fat      * q * 10) / 10,
      meal_type: "meal",
    });
    setQuery(""); setSelected(null); setQty("1"); setResults([]);
  };

  const submitCustom = () => {
    if (!custom.name || !custom.calories) return;
    onAdd({
      name:      custom.name,
      calories:  parseFloat(custom.calories) || 0,
      protein:   parseFloat(custom.protein)  || 0,
      carbs:     parseFloat(custom.carbs)    || 0,
      fat:       parseFloat(custom.fat)      || 0,
      meal_type: custom.meal_type,
    });
    setCustom({ name: "", calories: "", protein: "", carbs: "", fat: "", meal_type: "meal" });
  };

  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex gap-2">
        <button onClick={() => setMode("search")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "search" ? "bg-[#1B3829] text-white" : "text-gray-500 hover:text-gray-800"}`}>
          Search food
        </button>
        <button onClick={() => setMode("custom")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "custom" ? "bg-[#1B3829] text-white" : "text-gray-500 hover:text-gray-800"}`}>
          Enter custom
        </button>
      </div>

      {mode === "search" && (
        <div className="space-y-2">
          <div className="relative">
            <input
              className={inp}
              placeholder="Search: chicken, rice, banana…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); doSearch(e.target.value); }}
            />
            {results.length > 0 && (
              <div className="absolute z-10 w-full mt-1 rounded-xl bg-gray-100 border border-gray-300 shadow-xl overflow-hidden">
                {results.map((f) => (
                  <button key={f.name} onClick={() => pickFood(f)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-200 text-left transition-colors">
                    <span className="text-sm text-gray-900 capitalize">{f.name}</span>
                    <span className="text-xs text-gray-400">{f.calories} kcal · {f.unit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected && (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <p className="text-xs text-gray-400 mb-1">Servings ({selected.unit})</p>
                <input className={inp} type="number" min="0.25" step="0.25" value={qty}
                  onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="flex-1 rounded-lg bg-gray-100/50 px-3 py-2 text-xs text-gray-500 space-y-0.5">
                <p className="text-gray-900 font-medium capitalize">{selected.name}</p>
                <p>{Math.round(selected.calories * (parseFloat(qty) || 1))} kcal · P {Math.round(selected.protein * (parseFloat(qty) || 1))}g · C {Math.round(selected.carbs * (parseFloat(qty) || 1))}g · F {Math.round(selected.fat * (parseFloat(qty) || 1))}g</p>
              </div>
            </div>
          )}
          <button disabled={!selected}
            onClick={submitSearch}
            className="w-full py-2 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-sm font-semibold transition-colors">
            + Add to log
          </button>
        </div>
      )}

      {mode === "custom" && (
        <div className="space-y-2">
          <input className={inp} placeholder="Food name" value={custom.name}
            onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Calories</p>
              <input className={inp} type="number" placeholder="kcal" value={custom.calories}
                onChange={(e) => setCustom({ ...custom, calories: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Protein (g)</p>
              <input className={inp} type="number" placeholder="g" value={custom.protein}
                onChange={(e) => setCustom({ ...custom, protein: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Carbs (g)</p>
              <input className={inp} type="number" placeholder="g" value={custom.carbs}
                onChange={(e) => setCustom({ ...custom, carbs: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Fat (g)</p>
              <input className={inp} type="number" placeholder="g" value={custom.fat}
                onChange={(e) => setCustom({ ...custom, fat: e.target.value })} />
            </div>
          </div>
          <button disabled={!custom.name || !custom.calories}
            onClick={submitCustom}
            className="w-full py-2 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-sm font-semibold transition-colors">
            + Add to log
          </button>
        </div>
      )}
    </div>
  );
}

// ── InBody weight form ────────────────────────────────────────────────────────
function WeightForm({ onSave }: { onSave: (e: Partial<WeightEntry> & { weight_lbs: number }) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const f = (k: string) => vals[k] || "";
  const set = (k: string, v: string) => setVals(prev => ({ ...prev, [k]: v }));

  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  const submit = () => {
    if (!vals.weight_lbs) return;
    const num = (k: string) => vals[k] ? parseFloat(vals[k]) : undefined;
    onSave({
      weight_lbs:               parseFloat(vals.weight_lbs),
      body_fat_pct:             num("body_fat_pct"),
      muscle_mass_lbs:          num("muscle_mass_lbs"),
      lean_mass_lbs:            num("lean_mass_lbs"),
      trunk_muscle_lbs:         num("trunk_muscle_lbs"),
      right_arm_muscle_lbs:     num("right_arm_muscle_lbs"),
      left_arm_muscle_lbs:      num("left_arm_muscle_lbs"),
      right_leg_muscle_lbs:     num("right_leg_muscle_lbs"),
      left_leg_muscle_lbs:      num("left_leg_muscle_lbs"),
      trunk_fat_lbs:            num("trunk_fat_lbs"),
      right_arm_fat_lbs:        num("right_arm_fat_lbs"),
      left_arm_fat_lbs:         num("left_arm_fat_lbs"),
      right_leg_fat_lbs:        num("right_leg_fat_lbs"),
      left_leg_fat_lbs:         num("left_leg_fat_lbs"),
      total_body_water_lbs:     num("total_body_water_lbs"),
      intracellular_water_lbs:  num("intracellular_water_lbs"),
      extracellular_water_lbs:  num("extracellular_water_lbs"),
      ecw_ratio:                num("ecw_ratio"),
      visceral_fat_level:       num("visceral_fat_level"),
      bone_mineral_content_lbs: num("bone_mineral_content_lbs"),
      bmr_kcal:                 num("bmr_kcal") ? Math.round(num("bmr_kcal")!) : undefined,
      inbody_score:             num("inbody_score") ? Math.round(num("inbody_score")!) : undefined,
    });
    setVals({});
    setExpanded(false);
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Log Weigh-In</p>
        <button onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-green-400 transition-colors">
          {expanded ? "Hide InBody fields ▲" : "InBody fields ▼"}
        </button>
      </div>

      {/* Always-visible: weight + body fat */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-gray-400 mb-1">Weight (lbs) *</p>
          <input className={inp} type="number" step="0.1" placeholder="185.0" value={f("weight_lbs")}
            onChange={e => set("weight_lbs", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Body Fat %</p>
          <input className={inp} type="number" step="0.1" placeholder="18.5" value={f("body_fat_pct")}
            onChange={e => set("body_fat_pct", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Muscle Mass (lbs)</p>
          <input className={inp} type="number" step="0.1" placeholder="152.0" value={f("muscle_mass_lbs")}
            onChange={e => set("muscle_mass_lbs", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">InBody Score</p>
          <input className={inp} type="number" placeholder="78" value={f("inbody_score")}
            onChange={e => set("inbody_score", e.target.value)} />
        </div>
      </div>

      {/* InBody expanded */}
      {expanded && (
        <div className="space-y-3 pt-1 border-t border-gray-200">
          <p className="text-xs text-gray-400 uppercase tracking-widest pt-1">Segmental Muscle (lbs)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Trunk", "trunk_muscle_lbs"],
              ["Right Arm", "right_arm_muscle_lbs"],
              ["Left Arm", "left_arm_muscle_lbs"],
              ["Right Leg", "right_leg_muscle_lbs"],
              ["Left Leg", "left_leg_muscle_lbs"],
              ["Lean Mass", "lean_mass_lbs"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <input className={inp} type="number" step="0.1" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 uppercase tracking-widest">Segmental Fat (lbs)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Trunk", "trunk_fat_lbs"],
              ["Right Arm", "right_arm_fat_lbs"],
              ["Left Arm", "left_arm_fat_lbs"],
              ["Right Leg", "right_leg_fat_lbs"],
              ["Left Leg", "left_leg_fat_lbs"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <input className={inp} type="number" step="0.1" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 uppercase tracking-widest">Body Water (lbs)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Total Water", "total_body_water_lbs"],
              ["Intracellular", "intracellular_water_lbs"],
              ["Extracellular", "extracellular_water_lbs"],
              ["ECW Ratio", "ecw_ratio"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <input className={inp} type="number" step="0.01" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 uppercase tracking-widest">Other</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Visceral Fat Level", "visceral_fat_level"],
              ["Bone Mineral (lbs)", "bone_mineral_content_lbs"],
              ["BMR (kcal)", "bmr_kcal"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <input className={inp} type="number" step="0.1" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <button disabled={!vals.weight_lbs} onClick={submit}
        className="w-full py-2 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-sm font-semibold transition-colors">
        Save weigh-in
      </button>
    </div>
  );
}

// ── Weight trend chart ────────────────────────────────────────────────────────
function WeightTrendChart({ entries, goalLbs }: { entries: WeightEntry[]; goalLbs: number | null }) {
  if (entries.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
        No weigh-ins logged yet
      </div>
    );
  }

  const data = entries.slice(-30).map((e) => ({
    date:    e.date.slice(5),  // MM-DD
    weight:  e.weight_lbs,
    fat_pct: e.body_fat_pct,
    muscle:  e.muscle_mass_lbs,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ background: "#FFFFFF", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#6B7280" }}
          itemStyle={{ color: "#111827" }}
        />
        {goalLbs && <ReferenceLine y={goalLbs} stroke="#6366f1" strokeDasharray="3 3" label={{ value: "Goal", fill: "#6366f1", fontSize: 10 }} />}
        <Line type="monotone" dataKey="weight" stroke="#22c55e" strokeWidth={2} dot={false} name="Weight (lbs)" />
        {data.some(d => d.muscle) && (
          <Line type="monotone" dataKey="muscle" stroke="#6366f1" strokeWidth={2} dot={false} name="Muscle (lbs)" />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Body comp badge ───────────────────────────────────────────────────────────
function BodyCompBadge({ entry }: { entry: WeightEntry }) {
  const items = [
    { label: "Body Fat",    value: entry.body_fat_pct    != null ? `${entry.body_fat_pct}%`      : null },
    { label: "Fat Mass",    value: entry.fat_mass_lbs    != null ? `${entry.fat_mass_lbs} lbs`   : null },
    { label: "Muscle",      value: entry.muscle_mass_lbs != null ? `${entry.muscle_mass_lbs} lbs`: null },
    { label: "Lean",        value: entry.lean_mass_lbs   != null ? `${entry.lean_mass_lbs} lbs`  : null },
    { label: "Visceral",    value: entry.visceral_fat_level != null ? `Level ${entry.visceral_fat_level}` : null },
    { label: "InBody",      value: entry.inbody_score    != null ? `${entry.inbody_score}`        : null },
    { label: "BMR",         value: entry.bmr_kcal        != null ? `${entry.bmr_kcal} kcal`      : null },
    { label: "ECW Ratio",   value: entry.ecw_ratio       != null ? `${entry.ecw_ratio}`           : null },
  ].filter(i => i.value);

  if (!items.length) return null;
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2">
      {items.map(({ label, value }) => (
        <div key={label} className="rounded-lg bg-gray-100/80 px-2 py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">{label}</p>
          <p className="text-xs font-semibold text-gray-900 mt-0.5">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Macro preset profiles ──────────────────────────────────────────────────────
const MACRO_PRESETS = [
  { id: "keto",      label: "Keto",        icon: "🥑", prot: 0.25, carb: 0.05, fat: 0.70, desc: "Very low carb" },
  { id: "lowcarb",   label: "Low Carb",    icon: "🥩", prot: 0.35, carb: 0.20, fat: 0.45, desc: "High protein" },
  { id: "balanced",  label: "Balanced",    icon: "⚖️",  prot: 0.30, carb: 0.40, fat: 0.30, desc: "Classic split" },
  { id: "highcarb",  label: "High Carb",   icon: "🍝", prot: 0.20, carb: 0.55, fat: 0.25, desc: "Endurance" },
];

function applyPreset(calTarget: number, prot: number, carb: number, fat: number) {
  return {
    protein_g: Math.round((calTarget * prot) / 4),
    carbs_g:   Math.round((calTarget * carb) / 4),
    fat_g:     Math.round((calTarget * fat)  / 9),
  };
}

// ── Stepper input ──────────────────────────────────────────────────────────────
function Stepper({
  label, value, step, min, max, color, unit, onChange,
}: {
  label: string; value: number; step: number; min: number; max: number;
  color: string; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3">
      <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
        {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          className="w-8 h-8 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-lg font-bold leading-none flex items-center justify-center transition-colors"
        >−</button>
        <div className="flex-1 text-center">
          <span className="text-xl font-bold text-gray-900">{value}</span>
          <span className="text-xs text-gray-400 ml-1">{unit}</span>
        </div>
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          className="w-8 h-8 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-lg font-bold leading-none flex items-center justify-center transition-colors"
        >+</button>
      </div>
    </div>
  );
}

// ── Nutrition settings panel ──────────────────────────────────────────────────
function SettingsPanel({ settings, onSave }: { settings: NutritionSettings; onSave: (s: NutritionSettings) => void }) {
  const [s, setS] = useState(settings);
  const [tab, setTab] = useState<"macros" | "other">("macros");
  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  // Live calorie math
  const macroCals = Math.round(s.protein_g * 4 + s.carbs_g * 4 + s.fat_g * 9);
  const calDiff   = macroCals - s.calorie_target;
  const diffColor = Math.abs(calDiff) < 30 ? "#22c55e" : Math.abs(calDiff) < 80 ? "#f59e0b" : "#ef4444";

  const handlePreset = (prot: number, carb: number, fat: number) => {
    const { protein_g, carbs_g, fat_g } = applyPreset(s.calorie_target, prot, carb, fat);
    setS(prev => ({ ...prev, protein_g, carbs_g, fat_g }));
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
        {(["macros", "other"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
              tab === t ? "bg-[#1B3829] text-white" : "text-gray-500 hover:text-gray-800"
            }`}>
            {t === "macros" ? "🎯 Macro Targets" : "⚙ Other Settings"}
          </button>
        ))}
      </div>

      {tab === "macros" && (
        <>
          {/* Calorie target */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Daily Calorie Target</p>
            <div className="flex items-center gap-2">
              <input className={`${inp} text-center text-lg font-bold`} type="number"
                value={s.calorie_target}
                onChange={e => setS({ ...s, calorie_target: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-gray-400 whitespace-nowrap">kcal / day</span>
            </div>
          </div>

          {/* Preset chips */}
          <div>
            <p className="text-xs text-gray-400 mb-2">Quick presets</p>
            <div className="grid grid-cols-2 gap-1.5">
              {MACRO_PRESETS.map(p => (
                <button key={p.id}
                  onClick={() => handlePreset(p.prot, p.carb, p.fat)}
                  className="flex items-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 border border-gray-300 hover:border-zinc-500 px-3 py-2 transition-colors text-left">
                  <span className="text-base">{p.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{p.label}</p>
                    <p className="text-[10px] text-gray-400">{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Steppers */}
          <div className="grid grid-cols-3 gap-2">
            <Stepper label="Protein" value={s.protein_g} step={5} min={50} max={400} color="#6366f1" unit="g"
              onChange={v => setS(prev => ({ ...prev, protein_g: v }))} />
            <Stepper label="Carbs" value={s.carbs_g} step={5} min={20} max={500} color="#f59e0b" unit="g"
              onChange={v => setS(prev => ({ ...prev, carbs_g: v }))} />
            <Stepper label="Fat" value={s.fat_g} step={2} min={20} max={200} color="#ef4444" unit="g"
              onChange={v => setS(prev => ({ ...prev, fat_g: v }))} />
          </div>

          {/* Live calorie math */}
          <div className="rounded-xl bg-gray-100 border border-gray-300/50 px-3 py-2.5 flex items-center justify-between">
            <div className="text-xs text-gray-400">
              <span style={{ color: "#6366f1" }}>{s.protein_g}g P</span>
              <span className="mx-1 text-gray-300">×4</span>
              <span className="text-gray-400 mr-2">+</span>
              <span style={{ color: "#f59e0b" }}>{s.carbs_g}g C</span>
              <span className="mx-1 text-gray-300">×4</span>
              <span className="text-gray-400 mr-2">+</span>
              <span style={{ color: "#ef4444" }}>{s.fat_g}g F</span>
              <span className="mx-1 text-gray-300">×9</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-900">{macroCals}</span>
              <span className="text-xs text-gray-400 ml-1">kcal</span>
              {Math.abs(calDiff) > 5 && (
                <p className="text-[10px] mt-0.5" style={{ color: diffColor }}>
                  {calDiff > 0 ? `+${calDiff}` : calDiff} vs target
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "other" && (
        <>
          <p className="text-sm font-semibold text-gray-900">Weight Goal</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Goal Type</p>
              <select className={inp} value={s.weight_goal_type}
                onChange={e => setS({ ...s, weight_goal_type: e.target.value as NutritionSettings["weight_goal_type"] })}>
                <option value="lose">Lose</option>
                <option value="maintain">Maintain</option>
                <option value="gain">Gain</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Goal Weight (lbs)</p>
              <input className={inp} type="number" step="0.5" placeholder="175"
                value={s.weight_goal_lbs ?? ""}
                onChange={e => setS({ ...s, weight_goal_lbs: parseFloat(e.target.value) || null })}
              />
            </div>
          </div>

          <p className="text-sm font-semibold text-gray-900 pt-1">Fasting Window</p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Enable fasting tracker</span>
            <button onClick={() => setS({ ...s, fasting_enabled: !s.fasting_enabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${s.fasting_enabled ? "bg-[#1B3829]" : "bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${s.fasting_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Eating starts</p>
              <input className={inp} type="time" value={s.eating_start}
                onChange={e => setS({ ...s, eating_start: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Eating ends</p>
              <input className={inp} type="time" value={s.eating_end}
                onChange={e => setS({ ...s, eating_end: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Add active calories to budget</span>
            <button onClick={() => setS({ ...s, include_active_cal_in_budget: !s.include_active_cal_in_budget })}
              className={`relative w-10 h-5 rounded-full transition-colors ${s.include_active_cal_in_budget ? "bg-[#2D6A4F]" : "bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${s.include_active_cal_in_budget ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </>
      )}

      <button onClick={() => onSave(s)}
        className="w-full py-2 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">
        Save settings
      </button>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data,       setData]       = useState<DashboardData | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<Tab>("scores");
  const [section,    setSection]    = useState<Section>("coaching");
  const [showProfile, setShowProfile] = useState(false);
  const openChatRef = useRef<(() => void) | null>(null);

  // Nutrition state
  const [nutToday,   setNutToday]   = useState<NutritionToday | null>(null);
  const [nutSummary, setNutSummary] = useState<NutritionSummary | null>(null);
  const [weightLog,  setWeightLog]  = useState<WeightEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [nutLoading,   setNutLoading]   = useState(false);
  const [vo2Input,     setVo2Input]     = useState("");
  const [vo2Saving,    setVo2Saving]    = useState(false);
  const [vo2Saved,     setVo2Saved]     = useState(false);
  const [vo2Editing,   setVo2Editing]   = useState(false);

  useEffect(() => {
    api.dashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // Pre-load weight entries so Body Composition card is ready on Scorecard
    api.weightEntries()
      .then(w => setWeightLog(w.entries))
      .catch(() => {});
  }, []);

  // Reload nutrition data every time the tab is opened so meals logged
  // in an earlier session / on another device always show up.
  useEffect(() => {
    if (section !== "nutrition") return;
    setNutLoading(true);
    Promise.all([
      api.nutritionToday(),
      api.nutritionSummary(),
      api.weightEntries(),
    ]).then(([today, summary, weight]) => {
      setNutToday(today);
      setNutSummary(summary);
      setWeightLog(weight.entries);
    }).catch(console.error)
      .finally(() => setNutLoading(false));
  }, [section]); // Re-fetch every tab switch — keeps data fresh across sessions

  const handleAddMeal = async (meal: Omit<Meal, "id" | "logged_at">) => {
    try {
      const entry = await api.logMeal(meal);
      setNutToday(prev => prev ? {
        ...prev,
        meals:  [...prev.meals, entry],
        totals: {
          calories: prev.totals.calories + entry.calories,
          protein:  Math.round((prev.totals.protein  + entry.protein)  * 10) / 10,
          carbs:    Math.round((prev.totals.carbs    + entry.carbs)    * 10) / 10,
          fat:      Math.round((prev.totals.fat      + entry.fat)      * 10) / 10,
        },
      } : prev);
    } catch (e) { console.error(e); }
  };

  const handleDeleteMeal = async (id: string) => {
    const meal = nutToday?.meals.find(m => m.id === id);
    if (!meal) return;
    try {
      await api.deleteMeal(id, nutToday?.date);
      setNutToday(prev => prev ? {
        ...prev,
        meals:  prev.meals.filter(m => m.id !== id),
        totals: {
          calories: prev.totals.calories - meal.calories,
          protein:  Math.round((prev.totals.protein  - meal.protein)  * 10) / 10,
          carbs:    Math.round((prev.totals.carbs    - meal.carbs)    * 10) / 10,
          fat:      Math.round((prev.totals.fat      - meal.fat)      * 10) / 10,
        },
      } : prev);
    } catch (e) { console.error(e); }
  };

  const handleLogWeight = async (entry: Partial<WeightEntry> & { weight_lbs: number }) => {
    try {
      const saved = await api.logWeight(entry);
      setWeightLog(prev => {
        const filtered = prev.filter(e => e.date !== saved.date);
        return [...filtered, saved].sort((a, b) => a.date.localeCompare(b.date));
      });
    } catch (e) { console.error(e); }
  };

  const handleDeleteWeight = async (id: string) => {
    try {
      await api.deleteWeight(id);
      setWeightLog(prev => prev.filter(e => e.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleSaveVo2 = async () => {
    const val = parseFloat(vo2Input);
    if (!val || val < 10 || val > 90) return;
    setVo2Saving(true);
    try {
      await api.saveProfile({ vo2_max: val });
      setVo2Saved(true);
      setVo2Editing(false);
      setVo2Input("");
      // Refresh dashboard so longevity score recalculates with the new VO2 max
      const fresh = await api.dashboard();
      setData(fresh);
      setTimeout(() => setVo2Saved(false), 3000);
    } catch (e) { console.error(e); }
    finally { setVo2Saving(false); }
  };

  const handleSaveSettings = async (s: NutritionSettings) => {
    try {
      const saved = await api.saveNutritionSettings(s);
      setNutToday(prev => prev ? { ...prev, settings: saved } : prev);
      setShowSettings(false);
    } catch (e) { console.error(e); }
  };

  if (loading) return <LoadingState />;
  if (error)   return <ErrorState error={error} />;
  if (!data)   return null;

  const { today, trend, coaches, coaching, training_load, readiness_forecast, prediction_accuracy } = data;
  const sm  = today.sleep_model   as Record<string, number | null>;
  const rdy = today.readiness     as Record<string, number | null>;
  const sl  = today.sleep         as Record<string, number | null>;
  const act = today.activity      as Record<string, number | null>;

  const hrsTot  = sm?.total ? Math.floor((sm.total as number) / 3600) : null;
  const hrsMins = sm?.total ? Math.round(((sm.total as number) % 3600) / 60) : null;
  const deepMin = sm?.deep  ? Math.round((sm.deep as number) / 60) : null;
  const remMin  = sm?.rem   ? Math.round((sm.rem  as number) / 60) : null;

  const tempVal = rdy?.temperature_deviation != null
    ? `${(rdy.temperature_deviation as number) > 0 ? "+" : ""}${(rdy.temperature_deviation as number).toFixed(1)}°C`
    : "—";

  // Recovery metrics — last night's biometrics from Oura/AH (no activity data here)
  const metrics = [
    { label: "HRV",   value: sm?.hrv       ? `${sm.hrv} ms`         : "—" },
    { label: "RHR",   value: sm?.rhr       ? `${sm.rhr} bpm`        : "—" },
    { label: "Sleep", value: hrsTot != null ? `${hrsTot}h ${hrsMins}m` : "—" },
    { label: "Deep",  value: deepMin       ? `${deepMin} min`       : "—" },
    { label: "REM",   value: remMin        ? `${remMin} min`        : "—" },
    { label: "Temp",  value: tempVal },
  ];

  // Calorie budget calculation — prefer live AH active cal for today's budget
  const liveAct    = today.activity_live;
  const settings   = nutToday?.settings;
  const activeCal  = (liveAct?.active_cal ?? act?.active_cal as number) || 0;
  const baseBudget = settings?.calorie_target ?? 2000;
  const budget     = settings?.include_active_cal_in_budget ? baseBudget + activeCal : baseBudget;
  const consumed   = nutToday?.totals.calories ?? 0;
  const remaining  = Math.max(0, budget - consumed);

  const NAV_ITEMS: { id: Section; label: string; icon: string }[] = [
    { id: "coaching",     label: "Scorecard", icon: "📋" },
    { id: "apple-health", label: "Metrics",   icon: "📊" },
    { id: "nutrition",    label: "Nutrition", icon: "🥗" },
    { id: "training",     label: "Training",  icon: "🏋️" },
    { id: "labs",         label: "Labs",      icon: "🔬" },
    { id: "challenges",   label: "Compete",   icon: "🏆" },
    { id: "gear",         label: "Gear",      icon: "🛒" },
  ];

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-gray-900">
      {/* ── Top nav ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center h-12">
          {/* Logo */}
          <span className="font-bold text-sm tracking-tight shrink-0 mr-3">
            <span className="text-[#1B3829]">Back</span><span className="text-[#2D6A4F]">Nine</span>
          </span>
          {/* Divider */}
          <div className="w-px h-5 bg-gray-200 shrink-0 mr-1" />
          {/* Tabs */}
          <div className="flex overflow-x-auto scrollbar-none flex-1">
            {NAV_ITEMS.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  section === id
                    ? "text-[#1B3829] border-[#1B3829]"
                    : "text-gray-500 border-transparent hover:text-gray-900 hover:border-gray-300"
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                {label}
              </button>
            ))}
          </div>
          {/* Right side */}
          <div className="flex items-center gap-3 ml-3 shrink-0">
            <span className="hidden sm:block text-xs text-gray-400">
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <button
              onClick={() => setShowProfile(true)}
              title="Edit health profile"
              className="text-gray-400 hover:text-gray-700 transition-colors text-base leading-none"
            >
              👤
            </button>
            <button
              onClick={() => api.logout().then(() => (window.location.href = "/"))}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* ── COACH (also the landing page) ── */}
        {section === "coaching" && (() => {
          const todayStr   = new Date().toISOString().slice(0, 10);
          const isStale    = !!(data.today?.date && data.today.date < todayStr);
          const rdyScore   = rdy?.score  as number | undefined;
          const slScore    = sl?.score   as number | undefined;
          const actScore   = act?.score  as number | undefined;

          // Fallback: if today's readiness/sleep isn't scored yet, use the most recent
          // historical value from trend so rings show something useful instead of "Syncing…".
          // This covers cases where the ring wasn't worn overnight, Oura processing lags,
          // or the ring is worn during the day but not during sleep.
          const lastRdyEntry = [...trend].reverse().find(t => t.readiness != null && t.readiness > 0);
          const lastSlEntry  = [...trend].reverse().find(t => t.sleep != null && t.sleep > 0);
          const displayRdy   = (rdyScore != null && rdyScore > 0) ? rdyScore : (lastRdyEntry?.readiness ?? null);
          const displaySl    = (slScore  != null && slScore  > 0) ? slScore  : (lastSlEntry?.sleep    ?? null);
          const rdyFallback  = displayRdy != null && displayRdy !== rdyScore;
          const slFallback   = displaySl  != null && displaySl  !== slScore;

          const hasReadiness = displayRdy != null && displayRdy > 0;
          const heroColor  = hasReadiness ? (coaches.overall?.border ?? "#22c55e") : "#d1d5db";
          const visibleMetrics = metrics.filter(m => m.value !== "—");

          // Yesterday's Performance — only show when the main rings are showing TODAY's data.
          // Use today.calendar_today (Oura's timezone-safe "today") rather than the browser's
          // UTC date, which can be one day ahead of the user's local date after ~8 PM ET.
          const anchorIsToday = today.date === today.calendar_today;
          const yest       = today.yesterday_activity as Record<string, number | null> | undefined;
          const yestScore  = yest?.score   ?? null;
          const yestSteps  = yest?.steps   ?? null;
          const yestActCal = yest?.active_cal ?? null;
          const hasYest    = anchorIsToday && (yestScore != null || yestSteps != null || yestActCal != null);

          // Today's Performance — live AH data merged with today's Oura activity.
          // Only uses genuinely-today data: AH live (syncs every 5 min) or
          // today_activity = am[oura_today].  Never falls back to act (anchor-date
          // Oura activity) because _scored_row can return a previous day when today's
          // score is 0 — that would make Today and Yesterday show identical numbers.
          const liveScore    = liveAct?.score  ?? null;
          const liveSteps    = liveAct?.steps  ?? null;
          const liveCalVal   = liveAct?.active_cal ?? null;
          const todayAct     = today.today_activity as Record<string, number | null> | undefined;
          const todayActScore = liveScore ?? (todayAct?.score ?? null);
          const todaySteps   = liveSteps ?? (todayAct?.steps   ?? null);
          const todayActCal  = liveCalVal ?? (todayAct?.active_cal ?? null);
          const hasTodayPerf = todayActScore != null || todaySteps != null || todayActCal != null;

          return (
          <div className="space-y-6">
            {/* No-Oura banner */}
            {data.has_oura === false && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-4">
                <span className="text-2xl mt-0.5">💍</span>
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">Connect your Oura Ring</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Link your ring to unlock readiness scores, HRV trends, sleep analysis, and personalized coaching.
                  </p>
                </div>
                <a href="/connect"
                  className="shrink-0 mt-0.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors">
                  Connect →
                </a>
              </div>
            )}

            {/* ── Daily Greeting + Score Snapshot ── */}
            {(() => {
              const hour = new Date().getHours();
              const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
              const dayFull  = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
              const scoreColor = (s: number | undefined) =>
                !s ? "#9ca3af" : s >= 85 ? "#22c55e" : s >= 70 ? "#f59e0b" : "#ef4444";
              const scoreLabel = (s: number | undefined) =>
                !s ? "" : s >= 85 ? "Excellent" : s >= 70 ? "Good" : "Low";

              const rings = [
                { label: "Readiness", score: displayRdy, color: heroColor,              stale: rdyFallback },
                { label: "Sleep",     score: displaySl,  color: scoreColor(displaySl),  stale: slFallback  },
                { label: "Activity",  score: actScore,   color: scoreColor(actScore),   stale: false       },
              ];

              const circ = 2 * Math.PI * 40;

              return (
                <section className="rounded-2xl border-2 bg-white overflow-hidden"
                  style={{ borderColor: heroColor + "88" }}>

                  {/* Greeting row */}
                  <div className="px-5 pt-4 pb-3 flex items-start justify-between">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">{greeting}</p>
                      <p className="font-bold text-gray-900 text-lg leading-tight">{dayFull}</p>
                    </div>
                    {coaches.overall?.title && (
                      <div className="text-right ml-3 shrink-0">
                        <span
                          className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold leading-tight"
                          style={{ color: heroColor, backgroundColor: heroColor + "18" }}
                        >
                          {coaches.overall.title.replace(/[.!]$/, "")}
                        </span>
                        {isStale && (
                          <p className="text-[10px] text-gray-400 mt-1">{fmtDate(data.today.date!)}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Three score rings */}
                  <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                    {rings.map(({ label, score, color, stale }) => (
                      <div key={label} className="flex flex-col items-center gap-1.5">
                        <div className="relative w-20 h-20">
                          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                            <circle cx="50" cy="50" r="40" fill="none" stroke="#E5E7EB" strokeWidth="11"/>
                            <circle cx="50" cy="50" r="40" fill="none"
                              stroke={stale ? color + "88" : color}
                              strokeWidth="11" strokeLinecap="round"
                              strokeDasharray={circ}
                              strokeDashoffset={circ * (1 - (score ?? 0) / 100)}
                              className="transition-all duration-700"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {score != null && score > 0 ? (
                              <>
                                <span className={`text-xl font-bold leading-none ${stale ? "text-gray-400" : "text-gray-900"}`}>{score}</span>
                                <span className="text-[9px] text-gray-400 mt-0.5">{stale ? "last" : "/100"}</span>
                              </>
                            ) : (
                              <span className="text-[11px] text-gray-400 text-center leading-tight px-1">—</span>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{label}</p>
                        <p className="text-[11px] font-medium" style={{ color: stale ? "#9ca3af" : color }}>{stale ? "Last known" : scoreLabel(score)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Coach verdict */}
                  {coaches.overall?.msg && (
                    <div className="border-t border-gray-100 px-5 py-3 flex items-start gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">💬</span>
                      <p className="text-xs text-gray-500 leading-relaxed">{coaches.overall.msg}</p>
                    </div>
                  )}
                </section>
              );
            })()}

            {/* ── Longevity Score ── */}
            {data.longevity_score?.score != null && (() => {
              const lon = data.longevity_score!;
              const gradeColor = lon.grade === "Excellent" ? "#22c55e"
                : lon.grade === "Good" ? "#84cc16"
                : lon.grade === "Fair" ? "#f59e0b" : "#ef4444";
              const circ = 2 * Math.PI * 42;
              return (
                <section className="rounded-2xl border bg-white p-5 space-y-4" style={{ borderColor: gradeColor + "66" }}>
                  <div className="flex items-center gap-4">
                    {/* Score ring */}
                    <div className="relative w-16 h-16 shrink-0">
                      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="10"/>
                        <circle cx="50" cy="50" r="42" fill="none"
                          stroke={gradeColor} strokeWidth="10" strokeLinecap="round"
                          strokeDasharray={circ}
                          strokeDashoffset={circ * (1 - lon.score! / 100)}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold text-gray-900 leading-none">{lon.score}</span>
                        <span className="text-[9px] text-gray-400 uppercase tracking-wide">Vitality</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Longevity Score</p>
                      <p className="font-bold text-gray-900 text-base" style={{ color: gradeColor }}>{lon.grade}</p>
                      {lon.biological_age_delta != null && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {lon.biological_age_delta === 0 ? (
                            <span className="font-semibold text-gray-600">On par with your chronological age</span>
                          ) : (
                            <>
                              Biologically{" "}
                              <span className={`font-semibold ${lon.biological_age_delta < 0 ? "text-green-600" : "text-red-500"}`}>
                                {Math.abs(lon.biological_age_delta)} yr {lon.biological_age_delta < 0 ? "younger" : "older"}
                              </span>{" "}
                              than your age suggests
                            </>
                          )}
                        </p>
                      )}
                      <p className="text-[10px] text-gray-300 mt-1">{lon.data_coverage} available</p>
                    </div>
                  </div>
                  {/* Component breakdown — scored metrics */}
                  {Object.keys(lon.components).length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                      {Object.values(lon.components).map(comp => {
                        const pct = Math.round((comp.points / comp.max) * 100);
                        const barColor = pct >= 80 ? "#22c55e" : pct >= 60 ? "#84cc16" : pct >= 40 ? "#f59e0b" : "#ef4444";
                        const isVo2 = comp.label === "VO2 Max";
                        return (
                          <div key={comp.label} className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-500 truncate pr-1">{comp.label}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-gray-700 font-medium">{comp.points}/{comp.max}</span>
                                {isVo2 && !vo2Editing && (
                                  <button
                                    onClick={() => { setVo2Editing(true); setVo2Input(""); setVo2Saved(false); }}
                                    className="text-[9px] text-blue-400 hover:text-blue-600 underline leading-none"
                                    title="Update VO2 Max"
                                  >edit</button>
                                )}
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                            <p className="text-[9px] text-gray-400">{comp.value} · {comp.norm}</p>
                            {/* Inline edit form — shown when user clicks "edit" */}
                            {isVo2 && vo2Editing && (
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <input
                                  type="number" min={10} max={90} step={0.1}
                                  placeholder="ml/kg/min"
                                  value={vo2Input}
                                  onChange={e => setVo2Input(e.target.value)}
                                  className="w-20 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-900 focus:outline-none focus:border-green-400"
                                />
                                <button
                                  onClick={handleSaveVo2}
                                  disabled={vo2Saving || !vo2Input}
                                  className="rounded bg-green-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
                                >
                                  {vo2Saved ? "✓" : vo2Saving ? "…" : "Save"}
                                </button>
                                <button
                                  onClick={() => { setVo2Editing(false); setVo2Input(""); }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600"
                                >✕</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Missing metrics — show what would unlock a higher score */}
                  {(() => {
                    const present = new Set(Object.keys(lon.components));
                    const missingBodyFat = !present.has("body_fat");
                    const missingVo2    = !present.has("vo2_max");
                    if (!missingBodyFat && !missingVo2) return null;
                    return (
                      <div className="pt-2 border-t border-gray-100 space-y-2">
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Unlock more points</p>

                        {/* VO2 Max — inline entry */}
                        {missingVo2 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[10px] text-gray-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                              <span><span className="font-medium text-gray-500">VO2 Max</span> (+20 pts max)</span>
                            </div>
                            <div className="flex items-center gap-2 pl-3.5">
                              <input
                                type="number"
                                min={10} max={90} step={0.1}
                                placeholder="e.g. 45"
                                value={vo2Input}
                                onChange={e => setVo2Input(e.target.value)}
                                className="w-24 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-400"
                              />
                              <span className="text-[10px] text-gray-400">ml/kg/min</span>
                              <button
                                onClick={handleSaveVo2}
                                disabled={vo2Saving || !vo2Input}
                                className="rounded-lg bg-green-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 hover:bg-green-700 transition-colors"
                              >
                                {vo2Saved ? "✓ Saved" : vo2Saving ? "…" : "Save"}
                              </button>
                            </div>
                            <p className="pl-3.5 text-[10px] text-gray-400">
                              From your Oura app or Apple Health → Cardio Fitness. Will auto-sync once connected.
                            </p>
                          </div>
                        )}

                        {/* Body fat — redirect to weigh-in card */}
                        {missingBodyFat && (
                          <div className="flex items-center gap-2 text-[10px] text-gray-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                            <span><span className="font-medium text-gray-500">Body Fat %</span> (+10 pts max) — enter via the Log Weigh-In card below</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Top improvement tip — highlight the lowest-scoring component */}
                  {(() => {
                    const comps = Object.values(lon.components);
                    if (!comps.length) return null;
                    const worst = comps.reduce((a, b) => (a.points / a.max < b.points / b.max ? a : b));
                    const pct = Math.round((worst.points / worst.max) * 100);
                    if (pct >= 80) return null; // no tip needed if everything is good
                    const tips: Record<string, string> = {
                      "Heart Rate Variability": "Prioritize 7–9h sleep and reduce evening alcohol — HRV is highly sensitive to both.",
                      "Resting Heart Rate":     "Add 20–30 min of Zone 2 cardio 3×/week. Consistent aerobic work lowers resting HR over weeks.",
                      "VO2 Max":                "Include one interval session per week (e.g. 4×4 min at hard effort) — the strongest driver of VO2 max.",
                      "Sleep (7-day avg)":      "Set a consistent bedtime alarm. Even 30 min more sleep per night compounds quickly.",
                      "Body Fat %":             "Modest calorie deficit (200–300 kcal/day) plus resistance training 2–3×/week drives the best body composition change.",
                      "Daily Steps (avg)":      "Aim for 7,000–8,000 steps — a short 15-min walk after each meal gets you there without dedicated workout time.",
                    };
                    const tip = tips[worst.label];
                    if (!tip) return null;
                    return (
                      <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                        <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-1">
                          Biggest opportunity · {worst.label}
                        </p>
                        <p className="text-xs text-amber-800 leading-snug">{tip}</p>
                      </div>
                    );
                  })()}

                  <p className="text-[10px] text-gray-400 border-t border-gray-50 pt-2">
                    💡 Add your age &amp; sex in <button onClick={() => setShowProfile(true)} className="underline hover:text-gray-600">Profile</button> for more accurate norms.
                  </p>
                </section>
              );
            })()}

            {/* ── Coach Al teaser ── */}
            <section
              className="rounded-2xl overflow-hidden cursor-pointer group"
              style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 60%, #3a8a63 100%)" }}
              onClick={() => openChatRef.current?.()}
            >
              <div className="px-5 py-4 flex items-center gap-4">
                <CoachAlAvatar size={52} className="rounded-full ring-2 ring-white/30 group-hover:ring-white/50 transition-all shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm leading-tight">Meet Coach Al</p>
                  <p className="text-white/70 text-xs mt-0.5 leading-snug">
                    Your AI health coach — ask about your recovery, sleep, training, or anything on your mind.
                  </p>
                </div>
                <div className="shrink-0 bg-white/20 hover:bg-white/30 transition-colors rounded-xl px-3 py-2 text-white text-xs font-semibold group-hover:scale-105 transition-transform">
                  Chat →
                </div>
              </div>
              {/* Quick-start chips */}
              <div className="px-5 pb-4 flex flex-wrap gap-2">
                {["How's my recovery?", "Optimize my sleep", "What's my longevity score mean?"].map(q => (
                  <button
                    key={q}
                    onClick={e => { e.stopPropagation(); openChatRef.current?.(); }}
                    className="text-[11px] text-white/80 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1 transition-colors border border-white/20"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </section>

            {/* ── Coaching Insights (collapsible) ── */}
            <CollapsibleSection title="Coaching Insights" icon="💡">
              {(() => {
                const shortLabels = new Set(
                  (coaching.short as { label?: string }[]).map(i => i.label).filter(Boolean)
                );
                const midUniq  = (coaching.mid  as { label?: string }[]).filter(i => !shortLabels.has(i.label));
                const longUniq = (coaching.long as { label?: string }[]).filter(i => !shortLabels.has(i.label));
                return (
                  <>
                    <CoachingSection title="This Week"       items={midUniq}  />
                    <CoachingSection title="Long-Term Watch" items={longUniq} />
                  </>
                );
              })()}
              <InsightsSection />
            </CollapsibleSection>

            {/* ── Body & Weight (collapsible) ── */}
            <CollapsibleSection
              title="Body & Weight"
              icon="⚖️"
              badge={weightLog.length > 0 ? `${weightLog[weightLog.length-1].weight_lbs} lbs` : undefined}
            >
            <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-900">Body Composition</p>
                {weightLog.length > 0 && (
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{weightLog[weightLog.length - 1].weight_lbs} <span className="text-xs text-gray-400 font-normal">lbs</span></p>
                    {settings?.weight_goal_lbs && (
                      <p className="text-xs text-gray-400">
                        Goal: {settings.weight_goal_lbs} lbs
                        ({((weightLog[weightLog.length - 1].weight_lbs - settings.weight_goal_lbs) > 0 ? "+" : "") +
                          (weightLog[weightLog.length - 1].weight_lbs - settings.weight_goal_lbs).toFixed(1)} lbs)
                      </p>
                    )}
                  </div>
                )}
              </div>

              <WeightTrendChart entries={weightLog} goalLbs={settings?.weight_goal_lbs ?? null} />

              {/* Latest InBody breakdown */}
              {weightLog.length > 0 && <BodyCompBadge entry={weightLog[weightLog.length - 1]} />}

              {/* Last 3 entries */}
              {weightLog.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  {weightLog.slice(-3).reverse().map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded-lg bg-gray-100/80 px-3 py-2">
                      <div>
                        <span className="text-sm text-gray-900 font-medium">{e.weight_lbs} lbs</span>
                        {e.body_fat_pct && <span className="text-xs text-gray-400 ml-2">{e.body_fat_pct}% fat</span>}
                        {e.muscle_mass_lbs && <span className="text-xs text-gray-400 ml-2">{e.muscle_mass_lbs} lbs muscle</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{e.date}</span>
                        <button onClick={() => handleDeleteWeight(e.id)}
                          className="text-gray-400 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Log Weigh-In ── */}
            <WeightForm onSave={handleLogWeight} />
            </CollapsibleSection>

            {/* ── Today's Focus — personalized coaching actions ── */}
            {coaching.short?.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                  Today&apos;s Focus
                </h3>
                <div className="space-y-2">
                  {(coaching.short as Parameters<typeof CoachingItem>[0]["item"][]).map((item, i) => (
                    <CoachingItem key={i} item={item} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Today's Performance — live AH data merged with today's Oura activity ── */}
            {hasTodayPerf && (
              <section className="rounded-2xl border border-green-100 bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    Today&apos;s Performance
                  </h3>
                  {liveSteps != null && (
                    <span className="text-[10px] text-green-500 font-medium">● Live</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {todayActScore != null && (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative w-10 h-10">
                        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                          <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="14"/>
                          <circle cx="50" cy="50" r="42" fill="none"
                            stroke={todayActScore >= 85 ? "#22c55e" : todayActScore >= 70 ? "#f59e0b" : "#ef4444"}
                            strokeWidth="14" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 42}`}
                            strokeDashoffset={`${2 * Math.PI * 42 * (1 - todayActScore / 100)}`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-gray-900">{todayActScore}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Activity</p>
                        <p className="text-xs font-medium text-gray-700">Score</p>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-6">
                    {todaySteps != null && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Steps</p>
                        <p className="text-base font-bold text-gray-900">{todaySteps.toLocaleString()}</p>
                      </div>
                    )}
                    {todayActCal != null && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Active Cal</p>
                        <p className="text-base font-bold text-gray-900">{todayActCal}</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ── Yesterday's Performance — explicit yesterday Oura data ── */}
            {hasYest && (
            <CollapsibleSection
              title="Yesterday's Performance"
              icon="📅"
              badge={(() => { const s = (today.readiness as Record<string,number|null>); return s ? undefined : undefined; })()}
            >
              <section className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Yesterday&apos;s Performance
                </h3>
                <div className="flex items-center gap-4">
                  {yestScore != null && (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative w-10 h-10">
                        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                          <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="14"/>
                          <circle cx="50" cy="50" r="42" fill="none"
                            stroke={yestScore >= 85 ? "#22c55e" : yestScore >= 70 ? "#f59e0b" : "#ef4444"}
                            strokeWidth="14" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 42}`}
                            strokeDashoffset={`${2 * Math.PI * 42 * (1 - yestScore / 100)}`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-gray-900">{yestScore}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Activity</p>
                        <p className="text-xs font-medium text-gray-700">Score</p>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-6">
                    {yestSteps != null && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Steps</p>
                        <p className="text-base font-bold text-gray-900">{yestSteps.toLocaleString()}</p>
                      </div>
                    )}
                    {yestActCal != null && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Active Cal</p>
                        <p className="text-base font-bold text-gray-900">{yestActCal}</p>
                      </div>
                    )}
                  </div>
                </div>
                {coaches.activity?.msg && (
                  <p className="text-xs text-gray-400 pt-2 border-t border-gray-50 leading-snug">
                    {coaches.activity.msg}
                  </p>
                )}
              </section>
            </CollapsibleSection>
            )}

            {/* ── Tomorrow's Forecast (collapsible) ── */}
            <CollapsibleSection
              title="Tomorrow's Forecast"
              icon="🔮"
              badge={`${readiness_forecast.score} · ${readiness_forecast.label}`}
            >
            <section className="rounded-xl border bg-gray-50 p-4 space-y-4"
              style={{ borderColor: readiness_forecast.color + "55" }}>
              <div className="flex items-center gap-4">
                <div className="relative w-14 h-14 shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="10"/>
                    <circle cx="50" cy="50" r="42" fill="none"
                      stroke={readiness_forecast.color} strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 42}`}
                      strokeDashoffset={`${2 * Math.PI * 42 * (1 - readiness_forecast.score / 100)}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-gray-900">{readiness_forecast.score}</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Tomorrow&apos;s Forecast</p>
                  <p className="font-semibold text-gray-900 text-sm">{readiness_forecast.label}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span>HRV <span className={readiness_forecast.hrv_adj >= 0 ? "text-green-500" : "text-red-400"}>
                      {readiness_forecast.hrv_adj >= 0 ? "+" : ""}{readiness_forecast.hrv_adj}
                    </span></span>
                    <span>Sleep <span className={readiness_forecast.sleep_adj >= 0 ? "text-green-500" : "text-red-400"}>
                      {readiness_forecast.sleep_adj >= 0 ? "+" : ""}{readiness_forecast.sleep_adj}
                    </span></span>
                  </div>
                </div>
                {prediction_accuracy && prediction_accuracy.streak > 0 && (
                  <div className="text-center shrink-0">
                    <div className="text-2xl font-bold text-amber-500">{prediction_accuracy.streak}</div>
                    <div className="text-[10px] text-gray-400">day streak 🔥</div>
                  </div>
                )}
              </div>

              {prediction_accuracy && prediction_accuracy.resolved.length > 0 && (() => {
                const yesterday = prediction_accuracy.resolved[0];
                const diffAbs   = Math.abs(yesterday.diff);
                return (
                  <div className={`rounded-xl px-3 py-2 flex items-center justify-between text-xs ${
                    yesterday.hit ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"
                  }`}>
                    <span className="text-gray-500">
                      Yesterday — predicted <span className="font-semibold text-gray-700">{yesterday.predicted}</span>,
                      got <span className="font-semibold text-gray-700">{yesterday.actual}</span>
                    </span>
                    <span className={`font-semibold ml-2 shrink-0 ${yesterday.hit ? "text-green-600" : "text-red-500"}`}>
                      {yesterday.hit ? `✓ ${diffAbs === 0 ? "exact!" : `off by ${diffAbs}`}` : `✗ off by ${diffAbs}`}
                    </span>
                  </div>
                );
              })()}

              {prediction_accuracy && prediction_accuracy.total_resolved >= 3 && (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span><span className="font-semibold text-gray-700">{prediction_accuracy.accuracy_pct}%</span> accuracy</span>
                    <span><span className="font-semibold text-gray-700">{prediction_accuracy.total_resolved}</span> predictions</span>
                    <span>Best streak <span className="font-semibold text-gray-700">{prediction_accuracy.best_streak}</span></span>
                  </div>
                  <div className="flex items-end gap-0.5 h-10 overflow-hidden">
                    {[...prediction_accuracy.resolved].reverse().slice(0, 30).map((p, i) => {
                      const height = Math.max(20, Math.min(100, 50 + p.diff * 2));
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${p.date}: predicted ${p.predicted}, got ${p.actual}`}>
                          <div className="w-full rounded-sm" style={{
                            height: `${height}%`,
                            backgroundColor: p.hit ? "#22c55e" : "#ef4444",
                            opacity: 0.7 + (i / 30) * 0.3,
                          }} />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-300 text-right">
                    ±{prediction_accuracy.hit_threshold} pts = hit · last {Math.min(prediction_accuracy.total_resolved, 30)} nights
                  </p>
                </div>
              )}

              {(!prediction_accuracy || prediction_accuracy.total_resolved < 3) && (
                <p className="text-xs text-gray-400">
                  Accuracy tracking starts after a few days — check back tomorrow to see how tonight&apos;s forecast holds up.
                </p>
              )}
            </section>

            {/* ── Recovery Details ── */}
            {visibleMetrics.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                  Recovery Details
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {visibleMetrics.map(({ label, value }) => (
                    <div key={label} className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">{label}</p>
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            </CollapsibleSection>

          </div>
          );
        })()}

        {/* ── NUTRITION ── */}
        {section === "nutrition" && (
          <div className="space-y-4">
            {nutLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
              </div>
            )}

            {!nutLoading && nutToday && (
              <>
                {/* ─ Calorie + Macro summary ─ */}
                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center gap-5 mb-5">
                    <CalorieRing consumed={consumed} budget={budget} />
                    <div className="flex-1">
                      <p className="text-gray-900 font-semibold text-base">{consumed} <span className="text-gray-400 text-sm font-normal">kcal eaten</span></p>
                      <p className="text-xs text-gray-400 mb-3">
                        Budget: {baseBudget}
                        {settings?.include_active_cal_in_budget && activeCal > 0 && ` + ${activeCal} active = ${budget}`} kcal
                      </p>
                      <div className="flex gap-3 text-center">
                        {[
                          { label: "Left",    val: remaining,        unit: "kcal", color: remaining > 0 ? "#22c55e" : "#ef4444" },
                          { label: "Protein", val: nutToday.totals.protein, unit: "g",    color: "#6366f1" },
                          { label: "Carbs",   val: nutToday.totals.carbs,   unit: "g",    color: "#f59e0b" },
                          { label: "Fat",     val: nutToday.totals.fat,     unit: "g",    color: "#ef4444"  },
                        ].map(({ label, val, unit, color }) => (
                          <div key={label}>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                            <p className="text-sm font-bold" style={{ color }}>{val}{unit}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-gray-400 uppercase tracking-widest">Macros</p>
                      <button
                        onClick={() => { setShowSettings(true); }}
                        className="text-[10px] text-gray-400 hover:text-green-400 transition-colors flex items-center gap-1"
                      >
                        ✏ Edit targets
                      </button>
                    </div>
                    <MacroBar label="Protein" value={nutToday.totals.protein} target={settings?.protein_g ?? 150} color="#6366f1" />
                    <MacroBar label="Carbs"   value={nutToday.totals.carbs}   target={settings?.carbs_g ?? 200}   color="#f59e0b" />
                    <MacroBar label="Fat"     value={nutToday.totals.fat}     target={settings?.fat_g ?? 65}      color="#ef4444"  />
                  </div>
                </section>

                {/* ─ Fasting tracker ─ */}
                {settings?.fasting_enabled && (
                  <FastingClock start={settings.eating_start} end={settings.eating_end} />
                )}

                {/* ─ Meal log ─ */}
                <section className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Today's Meals</p>
                  {nutToday.meals.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">No meals logged yet today</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {nutToday.meals.map((meal) => (
                        <div key={meal.id} className="flex items-center justify-between rounded-xl bg-gray-100/80 px-3 py-2.5">
                          <div>
                            <p className="text-sm text-gray-900 capitalize">{meal.name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {meal.calories} kcal · P {meal.protein}g · C {meal.carbs}g · F {meal.fat}g
                            </p>
                          </div>
                          <button onClick={() => handleDeleteMeal(meal.id)}
                            className="text-gray-400 hover:text-red-400 transition-colors ml-2 text-lg leading-none">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ─ Add meal ─ */}
                <AddMealForm onAdd={handleAddMeal} />

                {/* ─ Weekly summary ─ */}
                {nutSummary && nutSummary.days_logged > 0 && (
                  <section className="rounded-2xl border border-gray-200 bg-white p-5">
                    <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">7-Day Average</p>
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {[
                        { label: "Calories",     val: nutSummary.avg_calories, unit: "kcal" },
                        { label: "Protein",      val: nutSummary.avg_protein,  unit: "g" },
                        { label: "Carbs",        val: nutSummary.avg_carbs,    unit: "g" },
                        { label: "Fat",          val: nutSummary.avg_fat,      unit: "g" },
                      ].map(({ label, val, unit }) => (
                        <div key={label} className="rounded-xl bg-gray-100 px-2 py-3 text-center">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-sm font-bold text-gray-900">{val}<span className="text-xs text-gray-400 font-normal">{unit}</span></p>
                        </div>
                      ))}
                    </div>
                    {/* Daily bars */}
                    <div className="flex gap-1 items-end h-16">
                      {nutSummary.daily.map((day) => {
                        const maxCal = Math.max(...nutSummary.daily.map(d => d.calories), 1);
                        const h = day.calories > 0 ? Math.max(8, Math.round((day.calories / maxCal) * 56)) : 4;
                        return (
                          <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                            <div
                              className="w-full rounded-t transition-all duration-500"
                              style={{ height: h, backgroundColor: day.calories > 0 ? "#22c55e" : "#E5E7EB" }}
                              title={`${day.date}: ${day.calories} kcal`}
                            />
                            <p className="text-[9px] text-gray-400">{day.date.slice(5)}</p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">{nutSummary.days_logged} of 7 days logged</p>
                  </section>
                )}


                {/* ─ Settings ─ */}
                <div>
                  <button onClick={() => setShowSettings(!showSettings)}
                    className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400 text-sm font-medium transition-colors">
                    {showSettings ? "▲ Hide" : "⚙ Nutrition settings"}
                  </button>
                  {showSettings && nutToday.settings && (
                    <div className="mt-3">
                      <SettingsPanel settings={nutToday.settings} onSave={handleSaveSettings} />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TRAINING ── */}
        {section === "training" && (
          <div className="space-y-4">
            {/* Training Load (ACWR) */}
            <section className="rounded-2xl border bg-white p-6" style={{ borderColor: training_load.color + "66" }}>
              <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">Training Load (ACWR)</p>
              <div className="mb-5">
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Under-trained</span><span>Optimal</span><span>Overreaching</span>
                </div>
                <div className="relative h-3 rounded-full overflow-hidden bg-gray-100">
                  <div className="absolute inset-0 flex">
                    <div className="h-full bg-blue-500/50"  style={{ width: "26.7%" }} />
                    <div className="h-full bg-green-500/50" style={{ width: "33.3%" }} />
                    <div className="h-full bg-amber-500/50" style={{ width: "13.3%" }} />
                    <div className="h-full bg-red-500/50"   style={{ width: "26.7%" }} />
                  </div>
                  {training_load.acwr != null && (
                    <div className="absolute top-0 bottom-0 w-1 rounded-full bg-white shadow-lg transition-all duration-700"
                      style={{ left: `${Math.min(98, Math.max(1, (training_load.acwr / 2) * 100))}%` }} />
                  )}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0.0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0+</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-3xl font-bold text-gray-900">{training_load.acwr?.toFixed(2) ?? "—"}</span>
                    <span className="text-sm font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: training_load.color + "33", color: training_load.color }}>
                      {training_load.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Acute/Chronic Workload Ratio
                    <span className="ml-2 text-gray-300">·</span>
                    <span className="ml-2 text-green-600 font-medium">Optimal: 0.8–1.3</span>
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">7-Day Avg</p>
                  <p className="text-lg font-bold text-gray-900">{training_load.acute_avg ?? "—"} <span className="text-xs text-gray-400 font-normal">cal</span></p>
                </div>
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">28-Day Avg</p>
                  <p className="text-lg font-bold text-gray-900">{training_load.chronic_avg ?? "—"} <span className="text-xs text-gray-400 font-normal">cal</span></p>
                </div>
                <div className="rounded-xl px-4 py-3 text-center" style={{ backgroundColor: training_load.color + "18" }}>
                  <p className="text-xs text-gray-400 mb-1">Status</p>
                  <p className="text-sm font-bold" style={{ color: training_load.color }}>
                    {training_load.zone === "optimal" ? "✓ In zone" :
                     training_load.zone === "low"     ? "↑ Too low" :
                     training_load.zone === "caution" ? "⚠ High" :
                     training_load.zone === "danger"  ? "⛔ Over" : "—"}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-gray-400 leading-relaxed">
                {training_load.zone === "optimal"  && "Your training load is balanced. Keep this up for sustained performance gains."}
                {training_load.zone === "low"       && "You've been under-training recently. Gradually increase intensity over the next week."}
                {training_load.zone === "caution"   && "Load is elevated. Prioritize sleep and recovery to avoid injury."}
                {training_load.zone === "danger"    && "Overreaching detected. Take 2–3 easy days before resuming hard training."}
                {training_load.zone === "unknown"   && "Need more activity data for a full analysis. Keep wearing your ring."}
              </p>
            </section>
            <TrainingTab />
          </div>
        )}

        {/* ── LABS ── */}
        {section === "labs" && (
          <div>
            <LabsTab />
          </div>
        )}

        {/* ── CHALLENGES ── */}
        {section === "challenges" && (
          <div>
            <ChallengeTab />
          </div>
        )}

        {section === "apple-health" && (
          <div className="space-y-4">
            {/* ── Trends & Progress ── */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-sm">30-Day Trends</h2>
                <div className="flex gap-1">
                  {(["scores", "hrv", "sleep_detail"] as Tab[]).map((t) => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        tab === t ? "bg-gray-200 text-gray-900" : "text-gray-500 hover:text-gray-800"
                      }`}>
                      {t === "scores" ? "Scores" : t === "hrv" ? "HRV/RHR" : "Sleep"}
                    </button>
                  ))}
                </div>
              </div>
              <TrendChart data={trend} metric={tab} />
            </section>
            <ProgressSection />
            {/* ── Apple Health raw data ── */}
            <AppleHealthTab />
          </div>
        )}

        {section === "gear" && (
          <div>
            <GearTab />
          </div>
        )}

      </main>

      {/* ── Coach Al chat ── */}
      <ChatWidget onRegisterOpen={opener => { openChatRef.current = opener; }} />

      {/* ── Profile modal ── */}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────
function CollapsibleSection({
  title, icon, defaultOpen = false, badge, children,
}: {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  badge?: string;          // optional summary shown when collapsed, e.g. "82 · Good"
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-base">{icon}</span>}
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          {!open && badge && (
            <span className="text-xs text-gray-400 font-normal">{badge}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-gray-50">
          {children}
        </div>
      )}
    </div>
  );
}

function CoachingSection({ title, items }: { title: string; items: unknown[] }) {
  if (!items?.length) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{title}</h2>
      <div className="space-y-2.5">
        {(items as Parameters<typeof CoachingItem>[0]["item"][]).map((item, i) => (
          <CoachingItem key={i} item={item} />
        ))}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F1EA]">
      <div className="text-center space-y-4">
        <div className="h-12 w-12 rounded-full border-4 border-[#1B3829] border-t-transparent animate-spin mx-auto" />
        <p className="text-gray-500 text-sm">Loading your health data…</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  const e = error.toLowerCase();
  const isAuth    = e.includes("not authenticated") || e.includes("session expired") || e === "401";
  const isOuraApi = e.includes("oura") || e.includes("502") || e.includes("token");
  const isOffline = e.includes("fetch") || e.includes("network") || e.includes("failed to fetch");

  let emoji = "⚠️";
  let title = "Something went wrong";
  let message = error;
  let btnLabel = "Retry";
  let btnHref  = "/dashboard";

  if (isAuth || isOuraApi) {
    emoji   = "🔗";
    title   = "Oura connection issue";
    message = e.includes("expired") || e.includes("reconnect")
      ? "Your Oura session expired. Reconnect to restore your dashboard."
      : "There was a problem reaching your Oura Ring data. Try reconnecting — it usually fixes it.";
    btnLabel = "Reconnect Oura →";
    btnHref  = "https://backnine-hu60.onrender.com/auth/oura";
  } else if (isOffline) {
    emoji   = "📡";
    title   = "Can't reach the server";
    message = "The backend may be waking up (give it 30 seconds) or check your connection.";
    btnLabel = "Retry";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F1EA] px-4">
      <div className="text-center space-y-5 max-w-sm">
        <p className="text-5xl">{emoji}</p>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="text-gray-500 text-sm leading-relaxed">{message}</p>
        <div className="flex flex-col gap-2 items-center">
          <a
            href={btnHref}
            className="inline-block rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white font-semibold px-6 py-3 text-sm transition-colors"
          >
            {btnLabel}
          </a>
          {(isAuth || isOuraApi) && (
            <a href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600">
              Retry without reconnecting
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
