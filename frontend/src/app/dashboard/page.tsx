"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  api,
  getPendingReferral,
  clearPendingReferral,
  type DashboardData,
  type NutritionToday,
  type NutritionSummary,
  type WeightEntry,
  type FoodItem,
  type Meal,
  type NutritionSettings,
  type LongevityHistory,
  type UserProfile,
} from "@/lib/api";
import { scoreColor, fmtDate } from "@/lib/utils";
import ScoreRing from "@/components/ScoreRing";
import SupplementsCard from "@/components/SupplementsCard";
import AppleHealthCard from "@/components/AppleHealthCard";
import DayMealsDrawer from "@/components/DayMealsDrawer";
import ManualLogCard from "@/components/ManualLogCard";
import CoachReactionToast from "@/components/CoachReactionToast";
import CoachCard from "@/components/CoachCard";
import TrendChart from "@/components/TrendChart";
import TrainingTab, { WorkoutLogger } from "@/components/TrainingTab";
import LabsTab from "@/components/LabsTab";
import ChallengeTab from "@/components/ChallengeTab";
import AppleHealthTab from "@/components/AppleHealthTab";
import GearTab from "@/components/GearTab";
import ProgressSection from "@/components/ProgressSection";
import ChatWidget from "@/components/ChatWidget";
import ProfileModal from "@/components/ProfileModal";
import CoachAlAvatar from "@/components/CoachAlAvatar";
import MorningBriefing from "@/components/MorningBriefing";
import WeeklyInsight from "@/components/WeeklyInsight";
import GoalCard from "@/components/GoalCard";
import GearPicks from "@/components/GearPicks";
import PulseFeed from "@/components/PulseFeed";
import FriendLeaderboard from "@/components/FriendLeaderboard";
import WeeklyLeague from "@/components/WeeklyLeague";
import GroupsSection from "@/components/GroupsSection";
import Achievements from "@/components/Achievements";
import MealQuickAdd from "@/components/MealQuickAdd";
import NotificationBell from "@/components/NotificationBell";
import ShareCardModal from "@/components/ShareCardModal";
import OnboardingModal from "@/components/OnboardingModal";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

type Tab     = "scores" | "hrv" | "sleep_detail";
type Section = "coaching" | "nutrition" | "training" | "labs" | "challenges" | "apple-health" | "gear";

// Standalone PWAs have no browser refresh, so give people an explicit one.
// A full reload re-fetches all data (the API is never cached) and picks up new
// app versions (page loads are network-first in the service worker).
function RefreshButton() {
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      onClick={() => { setSpinning(true); window.location.reload(); }}
      title="Refresh"
      aria-label="Refresh"
      className="text-gray-600 hover:text-[#1B3829] transition-colors text-base leading-none"
    >
      <span className={`inline-block ${spinning ? "animate-spin" : ""}`}>↻</span>
    </button>
  );
}

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
        <span className="text-[10px] text-gray-600 mt-0.5">/ {budget}</span>
      </div>
    </div>
  );
}

// ── Longevity Score sparkline ───────────────────────────────────────────────────
function LongevitySparkline({
  points, color,
}: { points: { date: string; score: number }[]; color: string }) {
  const W = 300, H = 44, P = 5;
  const scores = points.map(p => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = Math.max(1, max - min);
  const n = points.length;
  const x = (i: number) => P + (n === 1 ? (W - 2 * P) / 2 : (i / (n - 1)) * (W - 2 * P));
  const y = (v: number) => P + (1 - (v - min) / range) * (H - 2 * P);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(H - P).toFixed(1)} L${x(0).toFixed(1)},${(H - P).toFixed(1)} Z`;
  const lastX = x(n - 1), lastY = y(points[n - 1].score);
  const gid = "lon-spark-grad";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path
        d={line} fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={3} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
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
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-700 font-medium">{value}{unit} <span className="text-gray-600">/ {target}{unit}</span></span>
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
      <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">
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
          <p className="text-xs text-gray-600">{nextEvent}</p>
          <p className="text-xs text-gray-600 mt-1">
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
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "search" ? "bg-[#1B3829] text-white" : "text-gray-600 hover:text-gray-800"}`}>
          Search food
        </button>
        <button onClick={() => setMode("custom")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "custom" ? "bg-[#1B3829] text-white" : "text-gray-600 hover:text-gray-800"}`}>
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
                    <span className="text-xs text-gray-600">{f.calories} kcal · {f.unit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected && (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <p className="text-xs text-gray-600 mb-1">Servings ({selected.unit})</p>
                <input className={inp} type="number" min="0.25" step="0.25" value={qty}
                  onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="flex-1 rounded-lg bg-gray-100/50 px-3 py-2 text-xs text-gray-600 space-y-0.5">
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
              <p className="text-xs text-gray-600 mb-1">Calories</p>
              <input className={inp} type="number" placeholder="kcal" value={custom.calories}
                onChange={(e) => setCustom({ ...custom, calories: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Protein (g)</p>
              <input className={inp} type="number" placeholder="g" value={custom.protein}
                onChange={(e) => setCustom({ ...custom, protein: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Carbs (g)</p>
              <input className={inp} type="number" placeholder="g" value={custom.carbs}
                onChange={(e) => setCustom({ ...custom, carbs: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Fat (g)</p>
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
          className="text-xs text-gray-600 hover:text-green-400 transition-colors">
          {expanded ? "Hide InBody fields ▲" : "InBody fields ▼"}
        </button>
      </div>

      {/* Always-visible: weight + body fat */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-gray-600 mb-1">Weight (lbs) *</p>
          <input className={inp} type="number" step="0.1" placeholder="185.0" value={f("weight_lbs")}
            onChange={e => set("weight_lbs", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Body Fat %</p>
          <input className={inp} type="number" step="0.1" placeholder="18.5" value={f("body_fat_pct")}
            onChange={e => set("body_fat_pct", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Muscle Mass (lbs)</p>
          <input className={inp} type="number" step="0.1" placeholder="152.0" value={f("muscle_mass_lbs")}
            onChange={e => set("muscle_mass_lbs", e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">InBody Score</p>
          <input className={inp} type="number" placeholder="78" value={f("inbody_score")}
            onChange={e => set("inbody_score", e.target.value)} />
        </div>
      </div>

      {/* InBody expanded */}
      {expanded && (
        <div className="space-y-3 pt-1 border-t border-gray-200">
          <p className="text-xs text-gray-600 uppercase tracking-widest pt-1">Segmental Muscle (lbs)</p>
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
                <p className="text-xs text-gray-600 mb-1">{label}</p>
                <input className={inp} type="number" step="0.1" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-600 uppercase tracking-widest">Segmental Fat (lbs)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Trunk", "trunk_fat_lbs"],
              ["Right Arm", "right_arm_fat_lbs"],
              ["Left Arm", "left_arm_fat_lbs"],
              ["Right Leg", "right_leg_fat_lbs"],
              ["Left Leg", "left_leg_fat_lbs"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-600 mb-1">{label}</p>
                <input className={inp} type="number" step="0.1" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-600 uppercase tracking-widest">Body Water (lbs)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Total Water", "total_body_water_lbs"],
              ["Intracellular", "intracellular_water_lbs"],
              ["Extracellular", "extracellular_water_lbs"],
              ["ECW Ratio", "ecw_ratio"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-600 mb-1">{label}</p>
                <input className={inp} type="number" step="0.01" value={f(key)}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-600 uppercase tracking-widest">Other</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Visceral Fat Level", "visceral_fat_level"],
              ["Bone Mineral (lbs)", "bone_mineral_content_lbs"],
              ["BMR (kcal)", "bmr_kcal"],
            ].map(([label, key]) => (
              <div key={key}>
                <p className="text-xs text-gray-600 mb-1">{label}</p>
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
      <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
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

  const hasMuscle = data.some(d => d.muscle != null);
  const hasFat    = data.some(d => d.fat_pct != null);

  return (
    // Weight & muscle share the left axis (lbs); body fat rides its own right
    // axis (%) so its smaller numbers don't flatten against the pounds scale.
    <ResponsiveContainer width="100%" height={hasFat ? 188 : 170}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="lbs" tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        {hasFat && (
          <YAxis yAxisId="pct" orientation="right" width={34} tick={{ fontSize: 10, fill: "#f59e0b" }}
            tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} />
        )}
        <Tooltip
          contentStyle={{ background: "#FFFFFF", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#6B7280" }}
          itemStyle={{ color: "#111827" }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="plainline" />
        {goalLbs && <ReferenceLine yAxisId="lbs" y={goalLbs} stroke="#6366f1" strokeDasharray="3 3" label={{ value: "Goal", fill: "#6366f1", fontSize: 10 }} />}
        <Line yAxisId="lbs" type="monotone" dataKey="weight" stroke="#22c55e" strokeWidth={2} dot={false} name="Weight (lbs)" connectNulls />
        {hasMuscle && (
          <Line yAxisId="lbs" type="monotone" dataKey="muscle" stroke="#6366f1" strokeWidth={2} dot={false} name="Muscle (lbs)" connectNulls />
        )}
        {hasFat && (
          <Line yAxisId="pct" type="monotone" dataKey="fat_pct" stroke="#f59e0b" strokeWidth={2} dot={false} name="Body Fat (%)" connectNulls />
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
          <p className="text-[9px] text-gray-600 uppercase tracking-wide">{label}</p>
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
      <p className="text-xs text-gray-600 mb-2 flex items-center gap-1.5">
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
          <span className="text-xs text-gray-600 ml-1">{unit}</span>
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
              tab === t ? "bg-[#1B3829] text-white" : "text-gray-600 hover:text-gray-800"
            }`}>
            {t === "macros" ? "🎯 Macro Targets" : "⚙ Other Settings"}
          </button>
        ))}
      </div>

      {tab === "macros" && (
        <>
          {/* Calorie target */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Daily Calorie Target</p>
            <div className="flex items-center gap-2">
              <input className={`${inp} text-center text-lg font-bold`} type="number"
                value={s.calorie_target}
                onChange={e => setS({ ...s, calorie_target: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-gray-600 whitespace-nowrap">kcal / day</span>
            </div>
          </div>

          {/* Preset chips */}
          <div>
            <p className="text-xs text-gray-600 mb-2">Quick presets</p>
            <div className="grid grid-cols-2 gap-1.5">
              {MACRO_PRESETS.map(p => (
                <button key={p.id}
                  onClick={() => handlePreset(p.prot, p.carb, p.fat)}
                  className="flex items-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 border border-gray-300 hover:border-zinc-500 px-3 py-2 transition-colors text-left">
                  <span className="text-base">{p.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{p.label}</p>
                    <p className="text-[10px] text-gray-600">{p.desc}</p>
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
            <div className="text-xs text-gray-600">
              <span style={{ color: "#6366f1" }}>{s.protein_g}g P</span>
              <span className="mx-1 text-gray-500">×4</span>
              <span className="text-gray-600 mr-2">+</span>
              <span style={{ color: "#f59e0b" }}>{s.carbs_g}g C</span>
              <span className="mx-1 text-gray-500">×4</span>
              <span className="text-gray-600 mr-2">+</span>
              <span style={{ color: "#ef4444" }}>{s.fat_g}g F</span>
              <span className="mx-1 text-gray-500">×9</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-900">{macroCals}</span>
              <span className="text-xs text-gray-600 ml-1">kcal</span>
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
              <p className="text-xs text-gray-600 mb-1">Goal Type</p>
              <select className={inp} value={s.weight_goal_type}
                onChange={e => setS({ ...s, weight_goal_type: e.target.value as NutritionSettings["weight_goal_type"] })}>
                <option value="lose">Lose</option>
                <option value="maintain">Maintain</option>
                <option value="gain">Gain</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Goal Weight (lbs)</p>
              <input className={inp} type="number" step="0.5" placeholder="175"
                value={s.weight_goal_lbs ?? ""}
                onChange={e => setS({ ...s, weight_goal_lbs: parseFloat(e.target.value) || null })}
              />
            </div>
          </div>

          <p className="text-sm font-semibold text-gray-900 pt-1">Fasting Window</p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-600">Enable fasting tracker</span>
            <button onClick={() => setS({ ...s, fasting_enabled: !s.fasting_enabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${s.fasting_enabled ? "bg-[#1B3829]" : "bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${s.fasting_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-600 mb-1">Eating starts</p>
              <input className={inp} type="time" value={s.eating_start}
                onChange={e => setS({ ...s, eating_start: e.target.value })} />
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Eating ends</p>
              <input className={inp} type="time" value={s.eating_end}
                onChange={e => setS({ ...s, eating_end: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Add active calories to budget</span>
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
  const [lonHistory, setLonHistory] = useState<LongevityHistory | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<Tab>("scores");
  const [section,    setSection]    = useState<Section>("coaching");
  const [showProfile, setShowProfile] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<"profile" | "friends">("profile");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [autoLogWorkout, setAutoLogWorkout] = useState(false);
  const [showMealAdd, setShowMealAdd] = useState(false);
  const [showWorkoutAdd, setShowWorkoutAdd] = useState(false);
  const [showBodyWeight, setShowBodyWeight] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // When the user has an active goal, hoist the Goal card above Weekly Insight.
  // Seed from localStorage so returning users get the right order on first paint
  // (no reorder flash); GoalCard confirms/updates it once it fetches.
  const [goalActive, setGoalActive] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("bn_goal_active") === "1";
  });
  const handleGoalActive = (active: boolean) => {
    setGoalActive(active);
    try { window.localStorage.setItem("bn_goal_active", active ? "1" : "0"); } catch { /* ignore */ }
  };
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const openChatRef = useRef<((seed?: string) => void) | null>(null);

  // Nutrition state
  const [nutToday,   setNutToday]   = useState<NutritionToday | null>(null);
  const [nutSummary, setNutSummary] = useState<NutritionSummary | null>(null);
  // Day being inspected in the historical meal-log drawer (null = closed).
  const [drawerDate, setDrawerDate] = useState<string | null>(null);
  // Coach Al's one-line reaction to the user's most recent action. Cleared
  // when the toast auto-dismisses. Null = no active reaction.
  const [coachReaction, setCoachReaction] = useState<string | null>(null);
  const [weightLog,  setWeightLog]  = useState<WeightEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [nutLoading,   setNutLoading]   = useState(false);
  const [vo2Input,     setVo2Input]     = useState("");
  const [vo2Saving,    setVo2Saving]    = useState(false);
  const [vo2Saved,     setVo2Saved]     = useState(false);
  const [vo2Editing,   setVo2Editing]   = useState(false);

  useEffect(() => {
    api.dashboard()
      .then((d) => {
        setData(d);
        // Fetch the Longevity trend AFTER the dashboard resolves so today's
        // score has been recorded (and any first-time backfill has run).
        api.longevityHistory().then(setLonHistory).catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // Pre-load weight entries so Body Composition card is ready on Scorecard
    api.weightEntries()
      .then(w => setWeightLog(w.entries))
      .catch(() => {});
    // Profile — used to hide the "add age & sex" nudge once it's filled in
    api.getProfile()
      .then(setProfile)
      .catch(() => {});
    // Check onboarding status independently of the (possibly empty) dashboard
    // payload — a brand-new user with no data still needs the welcome flow.
    // localStorage backstop prevents an infinite loop if the backend write
    // ever fails (e.g. the onboarded_at column hasn't been migrated yet).
    api.me()
      .then(me => {
        const locallyDone = typeof window !== "undefined" && localStorage.getItem("bn_onboarded") === "1";
        if (me.needs_onboarding && !locallyDone) setShowOnboarding(true);
        // Auto-connect via a referral link the user arrived through (shared
        // invite card). The code was stashed in localStorage before any auth
        // redirect; now that we're signed in, consume it once.
        const pendingRef = getPendingReferral();
        if (pendingRef) {
          api.friends.acceptReferral(pendingRef)
            .catch(() => {})
            .finally(() => clearPendingReferral());
        }
      })
      .catch(() => {});
  }, []);

  // Reload nutrition data when the Nutrition tab OR the Scorecard is opened.
  // The Scorecard's inline quick-actions (Enter a meal/macros panel, Body &
  // Weight pill) read nutToday/weightLog too, so without fetching here they'd be
  // empty on a fresh load that lands straight on the Scorecard.
  useEffect(() => {
    if (section !== "nutrition" && section !== "coaching") return;
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
      // The reload re-records today's score; refresh the trend to match.
      api.longevityHistory().then(setLonHistory).catch(() => {});
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

  // Onboarding overlay renders on top of whatever state the dashboard is in —
  // a brand-new user may have empty/failed dashboard data but still needs the
  // welcome flow. So we render it alongside the loading/error/empty states too.
  const onboardingOverlay = showOnboarding ? (
    <OnboardingModal onDone={() => { setShowOnboarding(false); window.location.reload(); }} />
  ) : null;

  if (loading) return <>{onboardingOverlay}<LoadingState /></>;
  if (error)   return <>{onboardingOverlay}<ErrorState error={error} /></>;
  if (!data)   return <>{onboardingOverlay}</>;

  const { today, trend, coaches, training_load, readiness_forecast, prediction_accuracy } = data;

  // Gear-picks signals — computed once and reused across the Scorecard,
  // Nutrition, and Training tabs. Gear has commercial value (affiliate
  // revenue) so it earns persistent visibility throughout the app.
  const gearSignals = (() => {
    const recent = trend.slice(-7);
    const avg = (key: keyof typeof recent[number]): number | null => {
      const vals = recent
        .map(d => d[key])
        .filter((v): v is number => typeof v === "number" && v > 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const hrvVals = recent.map(d => d.hrv).filter((v): v is number => typeof v === "number" && v > 0);
    let hrvDirection: "rising" | "falling" | "stable" | null = null;
    if (hrvVals.length >= 4) {
      const half = Math.floor(hrvVals.length / 2);
      const firstAvg  = hrvVals.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const secondAvg = hrvVals.slice(half).reduce((a, b) => a + b, 0) / (hrvVals.length - half);
      hrvDirection = secondAvg > firstAvg + 1 ? "rising" : secondAvg < firstAvg - 1 ? "falling" : "stable";
    }
    return {
      hasOura:          data.has_oura !== false,
      longevityKeys:    Object.keys(data.longevity_score?.components ?? {}),
      sleepScoreAvg7d:  avg("sleep"),
      sleepHrsAvg7d:    avg("total_hrs"),
      stepsAvg7d:       avg("steps"),
      hrvDirection,
      rhrAvg7d:         avg("rhr"),
      readinessAvg7d:   avg("readiness"),
      trainingLoadZone: training_load?.zone ?? null,
    };
  })();
  const sm  = today.sleep_model   as Record<string, number | null>;
  const rdy = today.readiness     as Record<string, number | null>;
  const sl  = today.sleep         as Record<string, number | null>;
  const act = today.activity      as Record<string, number | null>;

  const hrsTot  = sm?.total ? Math.floor((sm.total as number) / 3600) : null;
  const hrsMins = sm?.total ? Math.round(((sm.total as number) % 3600) / 60) : null;
  const deepMin = sm?.deep  ? Math.round((sm.deep as number) / 60) : null;
  const remMin  = sm?.rem   ? Math.round((sm.rem  as number) / 60) : null;

  // ── Recovery metrics with 7-day baseline deltas ────────────────────────────
  // Each metric shows today's value plus a colored arrow indicating direction
  // versus the user's typical week. Goodness depends on the metric:
  //   • HRV / Sleep / Deep / REM — higher is better
  //   • RHR                       — lower is better
  //   • Temp deviation            — closer to 0 is better (we compare |today| vs |avg|)
  type DeltaTone = "good" | "bad" | "neutral";
  interface MetricRow {
    label: string;
    value: string;
    delta: { text: string; tone: DeltaTone } | null;
  }

  // Avoid Math.abs(0) edge case by treating tiny deltas as neutral.
  const _tone = (d: number, threshold: number, higherIsBetter: boolean): DeltaTone => {
    if (Math.abs(d) < threshold) return "neutral";
    return (d > 0) === higherIsBetter ? "good" : "bad";
  };

  // 7-day average over the trend slice. Filters nulls and zero-or-negative
  // sentinels that Oura uses to mean "no data this day".
  type TrendKey = "hrv" | "rhr" | "total_hrs" | "deep_min" | "rem_min" | "temp_dev";
  const _avg = (key: TrendKey): number | null => {
    const vals = trend.slice(-7)
      .map(d => d[key])
      .filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const _signed = (n: number) => (n > 0 ? `↑ ${Math.abs(n)}` : n < 0 ? `↓ ${Math.abs(n)}` : "— 0");

  const metrics: MetricRow[] = [];

  if (sm?.hrv) {
    const today_v  = sm.hrv as number;
    const baseline = _avg("hrv");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      const d = today_v - baseline;
      delta = { text: `${_signed(Math.round(d))} vs avg`, tone: _tone(d, 1, true) };
    }
    metrics.push({ label: "HRV", value: `${today_v} ms`, delta });
  }

  if (sm?.rhr) {
    const today_v  = sm.rhr as number;
    const baseline = _avg("rhr");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      const d = today_v - baseline;
      delta = { text: `${_signed(Math.round(d))} vs avg`, tone: _tone(d, 1, false) };
    }
    metrics.push({ label: "RHR", value: `${today_v} bpm`, delta });
  }

  if (hrsTot != null && hrsMins != null) {
    const todayHrs = hrsTot + hrsMins / 60;
    const baseline = _avg("total_hrs");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      const d = todayHrs - baseline;
      const txt = d >= 0 ? `↑ ${d.toFixed(1)}h` : `↓ ${Math.abs(d).toFixed(1)}h`;
      delta = { text: `${txt} vs avg`, tone: _tone(d, 0.2, true) };
    }
    metrics.push({ label: "Sleep", value: `${hrsTot}h ${hrsMins}m`, delta });
  }

  if (deepMin) {
    const baseline = _avg("deep_min");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      const d = deepMin - baseline;
      delta = { text: `${_signed(Math.round(d))} min`, tone: _tone(d, 5, true) };
    }
    metrics.push({ label: "Deep", value: `${deepMin} min`, delta });
  }

  if (remMin) {
    const baseline = _avg("rem_min");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      const d = remMin - baseline;
      delta = { text: `${_signed(Math.round(d))} min`, tone: _tone(d, 5, true) };
    }
    metrics.push({ label: "REM", value: `${remMin} min`, delta });
  }

  if (rdy?.temperature_deviation != null) {
    const today_v  = rdy.temperature_deviation as number;
    const baseline = _avg("temp_dev");
    let delta: MetricRow["delta"] = null;
    if (baseline != null) {
      // Closer to baseline body temp is better, so we compare absolute deviation.
      const d = Math.abs(today_v) - Math.abs(baseline);
      const txt = d >= 0 ? `↑ ${d.toFixed(1)}°` : `↓ ${Math.abs(d).toFixed(1)}°`;
      delta = { text: `${txt} swing`, tone: _tone(d, 0.05, false) };
    }
    metrics.push({
      label: "Temp",
      value: `${today_v > 0 ? "+" : ""}${today_v.toFixed(1)}°C`,
      delta,
    });
  }

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
    { id: "nutrition",    label: "Nutrition", icon: "🥗" },
    { id: "training",     label: "Training",  icon: "🏋️" },
    { id: "challenges",   label: "Clubhouse", icon: "🏛️" },
    { id: "gear",         label: "Gear",      icon: "🛒" },
    { id: "apple-health", label: "Metrics",   icon: "📊" },
  ];

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-gray-900">
      {/* ── Top nav ── */}
      <header
        className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center h-12">
          {/* Logo — taps back to the Scorecard (home) */}
          <button
            onClick={() => { setSection("coaching"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            title="Go to Scorecard"
            aria-label="Go to Scorecard"
            className="font-bold text-sm tracking-tight shrink-0 mr-3 rounded-md hover:opacity-80 active:scale-95 transition-all"
          >
            <span className="text-[#1B3829]">Back</span><span className="text-[#2D6A4F]">Nine</span>
          </button>
          {/* Divider (desktop only) */}
          <div className="hidden sm:block w-px h-5 bg-gray-200 shrink-0 mr-1" />
          {/* Mobile spacer — pushes the right cluster over since tabs are hidden */}
          <div className="flex-1 sm:hidden" />
          {/* Tabs (desktop only — mobile uses the ☰ menu) */}
          <div className="hidden sm:flex overflow-x-auto scrollbar-none flex-1">
            {NAV_ITEMS.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  section === id
                    ? "text-[#1B3829] border-[#1B3829]"
                    : "text-gray-600 border-transparent hover:text-gray-900 hover:border-gray-300"
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                {label}
              </button>
            ))}
          </div>
          {/* Right side */}
          <div className="flex items-center gap-3 ml-3 shrink-0">
            <span className="hidden sm:block text-xs text-gray-600">
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <RefreshButton />
            <NotificationBell
              onDeepLinkPulse={(eventId) => {
                // PulseFeed now lives in the Clubhouse tab (section id is still
                // "challenges" internally for backwards compat). Switch sections
                // AND set the hash before navigation completes so PulseFeed's
                // mount-effect sees it and scrolls/expands/focuses the event.
                setSection("challenges");
                window.location.hash = `pulse-${eventId}`;
              }}
            />
            {/* Desktop-only utility icons — mobile uses the ☰ menu */}
            <button
              onClick={() => setShowShare(true)}
              title="Invite friends"
              className="hidden sm:block text-gray-600 hover:text-[#1B3829] transition-colors text-base leading-none"
            >
              📣
            </button>
            <button
              onClick={() => setShowProfile(true)}
              title="Edit health profile"
              className="hidden sm:block text-gray-600 hover:text-gray-700 transition-colors text-base leading-none"
            >
              👤
            </button>
            <button
              onClick={() => api.logout().then(() => (window.location.href = "/"))}
              className="hidden sm:block text-xs text-gray-600 hover:text-gray-700 transition-colors"
            >
              Disconnect
            </button>
            {/* Mobile menu button */}
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="sm:hidden text-gray-600 hover:text-[#1B3829] transition-colors text-xl leading-none"
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile nav drawer (☰) ── */}
      {navOpen && (
        <div className="sm:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
          <div
            className="absolute right-0 top-0 h-full w-72 max-w-[82%] bg-white shadow-2xl flex flex-col"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <span className="font-bold text-sm tracking-tight">
                <span className="text-[#1B3829]">Back</span><span className="text-[#2D6A4F]">Nine</span>
              </span>
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Close menu"
                className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 hover:text-gray-700 flex items-center justify-center text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {NAV_ITEMS.slice(0, 5).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => { setSection(id); setNavOpen(false); window.scrollTo({ top: 0 }); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left transition-colors ${
                    section === id ? "bg-[#1B3829]/5 text-[#1B3829]" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-lg leading-none">{icon}</span>{label}
                </button>
              ))}
              {NAV_ITEMS.length > 5 && (
                <>
                  <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-600 font-semibold">More</p>
                  {NAV_ITEMS.slice(5).map(({ id, label, icon }) => (
                    <button
                      key={id}
                      onClick={() => { setSection(id); setNavOpen(false); window.scrollTo({ top: 0 }); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left transition-colors ${
                        section === id ? "bg-[#1B3829]/5 text-[#1B3829]" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-lg leading-none">{icon}</span>{label}
                    </button>
                  ))}
                </>
              )}
              <div className="my-2 border-t border-gray-100" />
              <button
                onClick={() => { setShowShare(true); setNavOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-left"
              >
                <span className="text-lg leading-none">📣</span>Invite friends
              </button>
              <button
                onClick={() => { setShowProfile(true); setNavOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-left"
              >
                <span className="text-lg leading-none">👤</span>Profile
              </button>
              <button
                onClick={() => api.logout().then(() => (window.location.href = "/"))}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-left"
              >
                <span className="text-lg leading-none">🚪</span>Log out
              </button>
            </nav>
          </div>
        </div>
      )}

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
          // Metrics now self-filter (only rows with values are pushed).
          const visibleMetrics = metrics;

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
            {/* Apple Health card — for users without Oura who are syncing AH.
                Surfaces the metrics AH actually provides (steps, sleep duration,
                HRV, RHR, weight, body fat, VO2 max) instead of leaving the
                dashboard empty. Sits above the Getting Started card so the
                user sees their numbers first. */}
            {data.has_apple_health && data.apple_health && (
              <AppleHealthCard data={data.apple_health} />
            )}

            {/* Getting Started card — shown until a data source is connected.
                Frames all three paths (Oura / Apple Health / manual) so a
                no-wearable user feels guided rather than blocked. */}
            {/* Get-started card — only shows when:
                  (1) no device connected, AND
                  (2) no manually-logged data exists yet (meal/workout/weight), AND
                  (3) user hasn't dismissed it via the "Hide" link.
                Hiding logic prevents the card from sticking around after a user
                has actually started using BackNine. The dismissal is in
                localStorage so it persists per device. */}
            {(() => {
              if (data.has_oura !== false) return null;
              if (data.has_apple_health) return null;
              const hasMeals    = (nutToday?.meals?.length ?? 0) > 0
                                || (nutSummary?.days_logged ?? 0) > 0;
              const hasWorkouts = (weightLog?.length ?? 0) > 0;
              if (hasMeals || hasWorkouts) return null;
              if (typeof window !== "undefined"
                  && localStorage.getItem("bn_getstarted_dismissed") === "1") return null;
              return (
              <div className="rounded-2xl border border-[#1B3829]/15 bg-white p-5 shadow-sm relative">
                <button
                  onClick={() => {
                    localStorage.setItem("bn_getstarted_dismissed", "1");
                    // Force a re-render — easiest way: nudge a no-op state.
                    setSection(section);
                  }}
                  className="absolute top-3 right-3 text-[11px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
                  aria-label="Hide this card"
                >
                  Hide
                </button>
                <p className="font-bold text-gray-900 text-sm mb-1">👋 Let&apos;s get your data flowing</p>
                <p className="text-xs text-gray-600 mb-4 leading-relaxed">
                  Pick whichever feels easiest right now. You can always add more later.
                </p>
                <div className="space-y-2">
                  <a href="/connect"
                    className="flex items-center gap-3 rounded-xl border border-gray-200 hover:border-[#1B3829]/40 px-3 py-2.5 transition-colors">
                    <span className="text-xl shrink-0">📲</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Connect a device</p>
                      <p className="text-[11px] text-gray-600">Oura Ring, Apple Health, or both</p>
                    </div>
                    <span className="text-gray-600 text-sm shrink-0">→</span>
                  </a>
                  <button onClick={() => setSection("nutrition")}
                    className="w-full flex items-center gap-3 rounded-xl border border-gray-200 hover:border-[#1B3829]/40 px-3 py-2.5 transition-colors text-left">
                    <span className="text-xl shrink-0">🍽️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Log a meal</p>
                      <p className="text-[11px] text-gray-600">Snap a photo, describe it, or pick from a list</p>
                    </div>
                    <span className="text-gray-600 text-sm shrink-0">→</span>
                  </button>
                  <button onClick={() => setSection("training")}
                    className="w-full flex items-center gap-3 rounded-xl border border-gray-200 hover:border-[#1B3829]/40 px-3 py-2.5 transition-colors text-left">
                    <span className="text-xl shrink-0">🏋️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Log a workout</p>
                      <p className="text-[11px] text-gray-600">Strength, cardio, or just describe what you did</p>
                    </div>
                    <span className="text-gray-600 text-sm shrink-0">→</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 text-center mt-4">
                  Or <button onClick={() => openChatRef.current?.()} className="underline hover:text-gray-700">ask Coach Al</button> what to focus on first.
                </p>
              </div>
              );
            })()}

            {/* ── Manual quick-log for non-Oura users ──
                Always available (no dismiss). Lets users without HAE / Shortcut
                still feed BackNine. Logs go to device_readings (source=manual)
                AND apple_health_daily so the dashboard surfaces them today. */}
            {data.has_oura === false && (
              <ManualLogCard onLogged={() => {
                // Refetch the dashboard so the freshly-logged values show up
                // in the AppleHealthCard / rings.
                api.dashboard().then(setData).catch(() => {});
              }} />
            )}

            {/* ── Coach Al's Morning Briefing ── */}
            <MorningBriefing onOpenChat={() => openChatRef.current?.()} />

            {/* ── Daily Greeting + Score Snapshot ── */}
            {(() => {
              const hour = new Date().getHours();
              const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
              // Morning gap: today's Oura data hasn't synced yet (anchor is an
              // older day). Show "Syncing…" rather than presenting yesterday's
              // scores as today's. After ~2pm we stop waiting and fall back to
              // showing the last-known values (current behavior).
              const syncingToday = !anchorIsToday && hour < 14;
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
                      <p className="text-xs text-gray-600 uppercase tracking-widest mb-0.5">{greeting}</p>
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
                          <p className="text-[10px] text-gray-600 mt-1">{fmtDate(data.today.date!)}</p>
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
                              stroke={syncingToday ? "#D1D5DB" : stale ? color + "88" : color}
                              strokeWidth="11" strokeLinecap="round"
                              strokeDasharray={circ}
                              strokeDashoffset={syncingToday ? circ : circ * (1 - (score ?? 0) / 100)}
                              className="transition-all duration-700"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {syncingToday ? (
                              <span className="text-[10px] text-gray-600 text-center leading-tight px-1 animate-pulse">Syncing…</span>
                            ) : score != null && score > 0 ? (
                              <>
                                <span className={`text-xl font-bold leading-none ${stale ? "text-gray-600" : "text-gray-900"}`}>{score}</span>
                                <span className="text-[9px] text-gray-600 mt-0.5">{stale ? "last" : "/100"}</span>
                              </>
                            ) : (
                              <span className="text-[11px] text-gray-600 text-center leading-tight px-1">—</span>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">{label}</p>
                        <p className="text-[11px] font-medium" style={{ color: syncingToday ? "#9ca3af" : stale ? "#9ca3af" : color }}>{syncingToday ? "Updating…" : stale ? "Last known" : scoreLabel(score)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Coach verdict */}
                  {coaches.overall?.msg && (
                    <div className="border-t border-gray-100 px-5 py-3 flex items-start gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">💬</span>
                      <p className="text-xs text-gray-600 leading-relaxed">{coaches.overall.msg}</p>
                    </div>
                  )}
                </section>
              );
            })()}

            {/* ── Longevity Score teaser — shown when no score is computable yet ── */}
            {data.longevity_score?.score == null && (
              <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🧬</span>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Longevity Score</p>
                    <p className="text-[11px] text-gray-600">Your vitality, scored against age &amp; sex norms</p>
                  </div>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed mb-3">
                  We compute this from six markers — HRV, resting heart rate, VO2 max, sleep,
                  body fat, and daily steps. Connect a tracker or add a couple of numbers manually to unlock it.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href="/connect"
                    className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors">
                    Connect a tracker
                  </a>
                  <button onClick={() => setShowProfile(true)}
                    className="text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 transition-colors">
                    Add age &amp; sex
                  </button>
                </div>
              </section>
            )}

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
                        <span className="text-[9px] text-gray-600 uppercase tracking-wide">Vitality</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">Longevity Score</p>
                      <p className="font-bold text-gray-900 text-base" style={{ color: gradeColor }}>{lon.grade}</p>
                      {lon.biological_age_delta != null && (
                        <p className="text-xs text-gray-600 mt-0.5">
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
                      <p className="text-[10px] text-gray-500 mt-1">{lon.data_coverage} available</p>
                    </div>
                  </div>

                  {/* ── Score trend over time ── */}
                  {lonHistory && lonHistory.history.length >= 2 ? (() => {
                    const delta = lonHistory.summary.delta_30d ?? lonHistory.summary.delta_7d;
                    const deltaWindow = lonHistory.summary.delta_30d != null ? 30 : 7;
                    const deltaColor = delta == null ? "text-gray-600"
                      : delta > 0 ? "text-green-600"
                      : delta < 0 ? "text-red-500" : "text-gray-600";
                    const firstDate = lonHistory.history[0].date;
                    const [, fm, fd] = firstDate.split("-");
                    return (
                      <div className="pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] text-gray-600 uppercase tracking-widest">Score trend</p>
                          {delta != null && (
                            <span className={`text-[11px] font-semibold ${deltaColor}`}>
                              {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta)} pts vs {deltaWindow}d ago
                            </span>
                          )}
                        </div>
                        <LongevitySparkline points={lonHistory.history} color={gradeColor} />
                        <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                          <span>{parseInt(fm)}/{parseInt(fd)}</span>
                          <span>Today</span>
                        </div>
                      </div>
                    );
                  })() : lonHistory && lonHistory.history.length === 1 ? (
                    <div className="pt-3 border-t border-gray-100">
                      <p className="text-[10px] text-gray-600 leading-snug">
                        📈 Now tracking your Longevity Score — a trend line appears here as your history builds.
                      </p>
                    </div>
                  ) : null}

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
                              <span className="text-gray-600 truncate pr-1">{comp.label}</span>
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
                            <p className="text-[9px] text-gray-600">{comp.value} · {comp.norm}</p>
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
                                <Button
                                  variant="accent"
                                  size="sm"
                                  onClick={handleSaveVo2}
                                  disabled={vo2Saving || !vo2Input}
                                  className="!h-auto !px-2 !py-1 !text-[10px]"
                                >
                                  {vo2Saved ? "✓" : vo2Saving ? "…" : "Save"}
                                </Button>
                                <button
                                  onClick={() => { setVo2Editing(false); setVo2Input(""); }}
                                  className="text-[10px] text-gray-600 hover:text-gray-600"
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
                        <p className="text-[10px] text-gray-600 font-medium uppercase tracking-widest">Unlock more points</p>

                        {/* VO2 Max — inline entry */}
                        {missingVo2 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[10px] text-gray-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                              <span><span className="font-medium text-gray-600">VO2 Max</span> (+20 pts max)</span>
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
                              <span className="text-[10px] text-gray-600">ml/kg/min</span>
                              <Button
                                variant="accent"
                                size="sm"
                                onClick={handleSaveVo2}
                                disabled={vo2Saving || !vo2Input}
                              >
                                {vo2Saved ? "✓ Saved" : vo2Saving ? "…" : "Save"}
                              </Button>
                            </div>
                            <p className="pl-3.5 text-[10px] text-gray-600">
                              From your Oura app or Apple Health → Cardio Fitness. Will auto-sync once connected.
                            </p>
                          </div>
                        )}

                        {/* Body fat — redirect to weigh-in card */}
                        {missingBodyFat && (
                          <div className="flex items-center gap-2 text-[10px] text-gray-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                            <span><span className="font-medium text-gray-600">Body Fat %</span> (+10 pts max) — enter via the Log Weigh-In card below</span>
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

                  {profile != null && (profile.age == null || !profile.biological_sex) && (
                    <p className="text-[10px] text-gray-600 border-t border-gray-50 pt-2">
                      💡 Add your age &amp; sex in <button onClick={() => setShowProfile(true)} className="underline hover:text-gray-600">Profile</button> for more accurate norms.
                    </p>
                  )}
                </section>
              );
            })()}

            {/* ── Weekly Leaderboard ──
                The engagement-points standings (check-ins, workouts, meals,
                weigh-ins, steps) on the Scorecard top. Same component used in
                Clubhouse; here it gets a "Clubhouse →" header link so users
                still have a one-tap path to Pulse, groups, and challenges.
                The daily-matchup FriendLeaderboard ("Today's Matchup") lives
                only in the Clubhouse — kept off the Scorecard so we have
                one leaderboard at a time, not two competing ones. */}
            <WeeklyLeague
              onInvite={() => setShowShare(true)}
              onSeeMore={() => { setSection("challenges"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            />

            {/* ── Quick action: enter a meal / macros (logs inline — no tab switch) ──
                Collapsed summary matches the Body & Weight pill below: a one-line
                "what does this look like today" peek so users see value without
                tapping.
                id="meal-quick-add" so Today's Move CTAs ("Log meal") can scroll
                here after expanding — the form is far below the fold, and users
                tapping the top-of-page CTA otherwise see nothing happen. */}
            <button
              id="meal-quick-add"
              onClick={() => setShowMealAdd(v => !v)}
              className="w-full py-3 rounded-2xl border border-[#1B3829]/25 bg-white text-sm font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="text-base leading-none">🍳</span>
              {showMealAdd ? "Hide meal/macros" : "Enter a meal/macros"}
              {!showMealAdd && nutToday && (nutToday.meals?.length ?? 0) > 0 && (
                <span className="text-xs font-normal text-[#1B3829]/60">
                  · {nutToday.totals.calories} / {nutToday.settings.calorie_target} kcal
                </span>
              )}
              {!showMealAdd && nutToday && (nutToday.meals?.length ?? 0) === 0 && (
                <span className="text-xs font-normal text-[#1B3829]/60">· nothing logged yet</span>
              )}
            </button>
            {showMealAdd && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button onClick={() => setShowMealAdd(false)} className="text-xs font-medium text-gray-600 hover:text-gray-700">Close ✕</button>
                </div>

                {/* Abbreviated macros snapshot — today's totals vs targets.
                    Updates live as meals are logged (onLogged refreshes nutToday). */}
                {nutToday && (
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-600 uppercase tracking-widest">Today's macros</p>
                      <span className="text-[11px] font-medium text-gray-700">
                        {nutToday.totals.calories}
                        <span className="text-gray-600"> / {nutToday.settings.calorie_target} kcal</span>
                      </span>
                    </div>
                    <MacroBar label="Calories" value={nutToday.totals.calories} target={nutToday.settings.calorie_target} unit=" kcal" color="#1B3829" />
                    <MacroBar label="Protein"  value={nutToday.totals.protein}  target={nutToday.settings.protein_g}      color="#6366f1" />
                    <MacroBar label="Carbs"    value={nutToday.totals.carbs}    target={nutToday.settings.carbs_g}        color="#f59e0b" />
                    <MacroBar label="Fat"      value={nutToday.totals.fat}      target={nutToday.settings.fat_g}          color="#ef4444" />
                  </div>
                )}

                <MealQuickAdd
                  date={nutToday?.date}
                  onLogged={async () => {
                    // Refetch today's nutrition so totals update in place.
                    const fresh = await api.nutritionToday().catch(() => null);
                    if (fresh) setNutToday(fresh);
                    // Note: we used to fire a Coach Al reaction here
                    // (api.coachReact("meal_logged", …)). Removed — firing on
                    // every meal made Coach Al feel like a pest. The Scorecard
                    // macro bars already show the same info silently. Workout
                    // and weigh-in reactions stay because those actions are
                    // less frequent and the "I see you" beat lands better.
                    // Backend VALID_ACTIONS still accepts "meal_logged" so
                    // reviving this is a one-line frontend change if we want.
                  }}
                />
              </div>
            )}

            {/* ── Quick action: log a workout (inline — no tab switch) ──
                Workout-count summary would need a separate fetch (not on
                DashboardData); kept as a clean action button for now. */}
            <button
              onClick={() => setShowWorkoutAdd(v => !v)}
              className="w-full py-3 rounded-2xl border border-[#1B3829]/25 bg-white text-sm font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="text-base leading-none">🏋️</span>
              {showWorkoutAdd ? "Hide workout" : "Log a workout"}
            </button>
            {showWorkoutAdd && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button onClick={() => setShowWorkoutAdd(false)} className="text-xs font-medium text-gray-600 hover:text-gray-700">Close ✕</button>
                </div>
                <WorkoutLogger recentWorkouts={[]} onSaved={() => setShowWorkoutAdd(false)} />
              </div>
            )}

            {/* ── Quick action: body & weight (pill — matches the two above) ── */}
            <button
              onClick={() => setShowBodyWeight(v => !v)}
              className="w-full py-3 rounded-2xl border border-[#1B3829]/25 bg-white text-sm font-semibold text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="text-base leading-none">⚖️</span>
              {showBodyWeight ? "Hide body & weight" : "Body & Weight"}
              {!showBodyWeight && weightLog.length > 0 && (
                <span className="text-xs font-normal text-[#1B3829]/60">· {weightLog[weightLog.length - 1].weight_lbs} lbs</span>
              )}
            </button>
            {showBodyWeight && (
            <div className="space-y-4">
            <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-900">Body Composition</p>
                {weightLog.length > 0 && (
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{weightLog[weightLog.length - 1].weight_lbs} <span className="text-xs text-gray-600 font-normal">lbs</span></p>
                    {settings?.weight_goal_lbs && (
                      <p className="text-xs text-gray-600">
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
                        {e.body_fat_pct && <span className="text-xs text-gray-600 ml-2">{e.body_fat_pct}% fat</span>}
                        {e.muscle_mass_lbs && <span className="text-xs text-gray-600 ml-2">{e.muscle_mass_lbs} lbs muscle</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">{e.date}</span>
                        <button onClick={() => handleDeleteWeight(e.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Log Weigh-In ── */}
            <WeightForm onSave={handleLogWeight} />
            </div>
            )}

            {/* ── Coach Al Goal & Weekly Insight ──
                Stays ABOVE the explore fold because these are daily-relevant.
                Goal card rises above the Weekly Insight when active so the
                committed target leads. No active goal → Insight leads. */}
            {goalActive ? (
              <>
                <GoalCard onOpenChat={(seed) => openChatRef.current?.(seed)} onActiveChange={handleGoalActive} />
                <WeeklyInsight onOpenChat={(seed) => openChatRef.current?.(seed)} />
              </>
            ) : (
              <>
                <WeeklyInsight onOpenChat={(seed) => openChatRef.current?.(seed)} />
                <GoalCard onOpenChat={(seed) => openChatRef.current?.(seed)} onActiveChange={handleGoalActive} />
              </>
            )}

            {/* LeagueGlance used to live here as a "Weekly Leaderboard ·
                engagement points" pill that linked to Clubhouse. Removed
                because Today's Leaderboard at the top of the Scorecard
                already carries the leaderboard surface and has its own
                "See full Clubhouse →" link. Keeping two leaderboard CTAs
                was redundant. */}

            {/* ── Achievements "Next up" ──
                Promoted out of the previous expander — it shows the closest
                badge to unlock with a progress bar and the level info. Small,
                motivating, daily-relevant. Earns its place above the fold. */}
            <Achievements />

            {/* ── Picked For You (smart gear recommendations) ──
                Pulled out of the Explore fold and made always-visible on the
                Scorecard. Gear is a commercial surface — impressions matter
                for affiliate revenue, so this earns persistent placement. */}
            <GearPicks signals={gearSignals} onJump={() => setSection("gear")} />

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
                      <p className="text-gray-900 font-semibold text-base">{consumed} <span className="text-gray-600 text-sm font-normal">kcal eaten</span></p>
                      <p className="text-xs text-gray-600 mb-3">
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
                            <p className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</p>
                            <p className="text-sm font-bold" style={{ color }}>{val}{unit}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-gray-600 uppercase tracking-widest">Macros</p>
                      <button
                        onClick={() => { setShowSettings(true); }}
                        className="text-[10px] text-gray-600 hover:text-green-400 transition-colors flex items-center gap-1"
                      >
                        ✏ Edit targets
                      </button>
                    </div>
                    <MacroBar label="Protein" value={nutToday.totals.protein} target={settings?.protein_g ?? 150} color="#6366f1" />
                    <MacroBar label="Carbs"   value={nutToday.totals.carbs}   target={settings?.carbs_g ?? 200}   color="#f59e0b" />
                    <MacroBar label="Fat"     value={nutToday.totals.fat}     target={settings?.fat_g ?? 65}      color="#ef4444"  />
                  </div>
                </section>

                {/* ─ Meal log (directly under macros) ─ */}
                <section className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Today's Meals</p>
                  {nutToday.meals.length === 0 ? (
                    <p className="text-gray-600 text-sm text-center py-4">No meals logged yet today</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {nutToday.meals.map((meal) => (
                        <div key={meal.id} className="flex items-center justify-between rounded-xl bg-gray-100/80 px-3 py-2.5">
                          <div>
                            <p className="text-sm text-gray-900 capitalize">{meal.name}</p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {meal.calories} kcal · P {meal.protein}g · C {meal.carbs}g · F {meal.fat}g
                            </p>
                          </div>
                          <button onClick={() => handleDeleteMeal(meal.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors ml-2 text-lg leading-none">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ─ Add a meal (natural language / photo / recents / search) ─ */}
                <MealQuickAdd
                  date={nutToday.date}
                  onLogged={() => api.nutritionToday().then(setNutToday).catch(() => {})}
                />

                {/* ─ Fasting tracker ─ */}
                {settings?.fasting_enabled && (
                  <FastingClock start={settings.eating_start} end={settings.eating_end} />
                )}

                {/* ─ Weekly summary ─ */}
                {nutSummary && nutSummary.days_logged > 0 && (
                  <section className="rounded-2xl border border-gray-200 bg-white p-5">
                    <p className="text-xs text-gray-600 uppercase tracking-widest mb-1">
                      {(() => {
                        const n = nutSummary.avg_days_count ?? 0;
                        if (n <= 0) return "Average — no complete days yet";
                        if (n === 1) return "Average — 1 complete day";
                        return `${n}-Day Average`;
                      })()}
                    </p>
                    <p className="text-[10px] text-gray-500 mb-4">excludes today (partial)</p>
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {[
                        { label: "Calories",     val: nutSummary.avg_calories, unit: "kcal" },
                        { label: "Protein",      val: nutSummary.avg_protein,  unit: "g" },
                        { label: "Carbs",        val: nutSummary.avg_carbs,    unit: "g" },
                        { label: "Fat",          val: nutSummary.avg_fat,      unit: "g" },
                      ].map(({ label, val, unit }) => (
                        <div key={label} className="rounded-xl bg-gray-100 px-2 py-3 text-center">
                          <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-sm font-bold text-gray-900">{val}<span className="text-xs text-gray-600 font-normal">{unit}</span></p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mb-1.5">Tap any bar to review or edit that day&apos;s meals.</p>
                    {/* Daily bars — stacked by macro (protein / carbs / fat).
                        Each segment's height is proportional to that macro's
                        calorie contribution (4·g for protein/carbs, 9·g for fat),
                        so the totals match the calories number above. Tap a bar
                        to open the day-meals drawer with edit + delete. */}
                    <div className="flex gap-1 items-end h-16">
                      {nutSummary.daily.map((day) => {
                        const maxCal = Math.max(...nutSummary.daily.map(d => d.calories), 1);
                        const totalH = day.calories > 0
                          ? Math.max(8, Math.round((day.calories / maxCal) * 56))
                          : 4;
                        const pKcal = (day.protein || 0) * 4;
                        const cKcal = (day.carbs   || 0) * 4;
                        const fKcal = (day.fat     || 0) * 9;
                        const macroKcal = pKcal + cKcal + fKcal;
                        const pH = macroKcal > 0 ? Math.round((pKcal / macroKcal) * totalH) : 0;
                        const cH = macroKcal > 0 ? Math.round((cKcal / macroKcal) * totalH) : 0;
                        const fH = macroKcal > 0 ? totalH - pH - cH : 0;
                        const empty = day.calories === 0;
                        const title = empty
                          ? `${day.date}: no meals logged — tap to review`
                          : `${day.date}: ${day.calories} kcal · P ${day.protein}g · C ${day.carbs}g · F ${day.fat}g — tap to review`;
                        return (
                          // Tap the bar to drill into that day's meals (edit + delete).
                          // Buttonifying the bar lets keyboard users open it too.
                          <button
                            key={day.date}
                            type="button"
                            onClick={() => setDrawerDate(day.date)}
                            className="flex-1 flex flex-col items-center gap-1 group focus:outline-none"
                            title={title}
                            aria-label={`Open meal log for ${day.date}`}
                          >
                            <div className="w-full flex flex-col-reverse rounded-t overflow-hidden transition-all duration-500 group-hover:ring-2 group-hover:ring-green-500/40 group-focus-visible:ring-2 group-focus-visible:ring-green-500"
                              style={{ height: totalH }}>
                              {empty ? (
                                <div className="w-full h-full" style={{ backgroundColor: "#E5E7EB" }} />
                              ) : macroKcal === 0 ? (
                                <div className="w-full h-full" style={{ backgroundColor: "#9CA3AF" }} />
                              ) : (
                                <>
                                  <div className="w-full" style={{ height: pH, backgroundColor: "#6366f1" }} />
                                  <div className="w-full" style={{ height: cH, backgroundColor: "#f59e0b" }} />
                                  <div className="w-full" style={{ height: fH, backgroundColor: "#ef4444" }} />
                                </>
                              )}
                            </div>
                            <p className="text-[9px] text-gray-600 group-hover:text-gray-900">{day.date.slice(5)}</p>
                          </button>
                        );
                      })}
                    </div>
                    {/* Color legend for the stacked macro bars above */}
                    <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-gray-600">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{backgroundColor:"#6366f1"}}/>Protein</span>
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{backgroundColor:"#f59e0b"}}/>Carbs</span>
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{backgroundColor:"#ef4444"}}/>Fat</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">{nutSummary.days_logged} of 7 days logged</p>
                  </section>
                )}


                {/* ─ Supplements (static stack — flows into Coach Al's chat + briefing context) ─ */}
                <SupplementsCard
                  supplements={profile?.supplements ?? []}
                  onSave={async (next) => {
                    const updated = await api.saveProfile({ ...(profile ?? {}), supplements: next });
                    setProfile(prev => ({ ...(prev ?? {}), ...updated, supplements: next }));
                  }}
                />

                {/* ─ Settings ─ */}
                <div>
                  <button onClick={() => setShowSettings(!showSettings)}
                    className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-400 text-sm font-medium transition-colors">
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

            {/* ── Picked For You — gear surfaced in Nutrition too.
                Persistent visibility supports affiliate revenue. Scoped to
                nutrition-relevant categories (Nutrition + Supplements) so
                we're not pitching foam rollers next to a meal logger. */}
            <GearPicks signals={gearSignals} onJump={() => setSection("gear")} context="nutrition" />
          </div>
        )}

        {/* ── TRAINING ── */}
        {section === "training" && (
          <div className="space-y-4">
            {/* Training Load (ACWR) */}
            <section className="rounded-2xl border bg-white p-6" style={{ borderColor: training_load.color + "66" }}>
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-3">Training Load (ACWR)</p>
              <div className="mb-5">
                <div className="flex justify-between text-xs text-gray-600 mb-1.5">
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
                <div className="flex justify-between text-xs text-gray-600 mt-1">
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
                  <p className="text-xs text-gray-600">
                    Acute/Chronic Workload Ratio
                    <span className="ml-2 text-gray-500">·</span>
                    <span className="ml-2 text-green-600 font-medium">Optimal: 0.8–1.3</span>
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-center">
                  <p className="text-xs text-gray-600 mb-1">7-Day Avg</p>
                  <p className="text-lg font-bold text-gray-900">{training_load.acute_avg ?? "—"} <span className="text-xs text-gray-600 font-normal">cal</span></p>
                </div>
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-center">
                  <p className="text-xs text-gray-600 mb-1">28-Day Avg</p>
                  <p className="text-lg font-bold text-gray-900">{training_load.chronic_avg ?? "—"} <span className="text-xs text-gray-600 font-normal">cal</span></p>
                </div>
                <div className="rounded-xl px-4 py-3 text-center" style={{ backgroundColor: training_load.color + "18" }}>
                  <p className="text-xs text-gray-600 mb-1">Status</p>
                  <p className="text-sm font-bold" style={{ color: training_load.color }}>
                    {training_load.zone === "optimal" ? "✓ In zone" :
                     training_load.zone === "low"     ? "↑ Too low" :
                     training_load.zone === "caution" ? "⚠ High" :
                     training_load.zone === "danger"  ? "⛔ Over" : "—"}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-gray-600 leading-relaxed">
                {training_load.zone === "optimal"  && "Your training load is balanced. Keep this up for sustained performance gains."}
                {training_load.zone === "low"       && "You've been under-training recently. Gradually increase intensity over the next week."}
                {training_load.zone === "caution"   && "Load is elevated. Prioritize sleep and recovery to avoid injury."}
                {training_load.zone === "danger"    && "Overreaching detected. Take 2–3 easy days before resuming hard training."}
                {training_load.zone === "unknown"   && "Need more activity data for a full analysis. Keep wearing your ring."}
              </p>
            </section>
            <TrainingTab autoOpenLogger={autoLogWorkout} onLoggerOpened={() => setAutoLogWorkout(false)} />

            {/* ── Picked For You — gear in Training is the most natural
                commercial fit (shoes, mats, recovery tools, supplements). */}
            {/* Training tab — scoped to fitness/recovery/wearable picks. */}
            <GearPicks signals={gearSignals} onJump={() => setSection("gear")} context="training" />
          </div>
        )}

        {/* ── LABS ── */}
        {/* ── CHALLENGES ── */}
        {section === "challenges" && (
          <div className="space-y-4">
            {/* Clubhouse header — sets context that this is the social hub */}
            <div className="rounded-2xl border border-[#1B3829]/15 bg-gradient-to-br from-[#1B3829] to-[#2D6A4F] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="text-3xl shrink-0">🏛️</span>
                <div className="min-w-0">
                  <h1 className="text-base font-bold">Clubhouse</h1>
                  <p className="text-[11px] text-white/75 leading-snug">
                    Where you and your friends compete, compare, and cheer each other on.
                  </p>
                </div>
              </div>
            </div>

            {/* Today's leaderboard — self + friends, ranked.
                Most active card; goes first so it loads what you'd open the
                Clubhouse to see first. */}
            <FriendLeaderboard onInvite={() => setShowShare(true)} />

            {/* Weekly league — engagement-points race over a 7-day window. */}
            <WeeklyLeague onInvite={() => setShowShare(true)} />

            {/* Pulse feed — friend milestones, comments, reactions. */}
            <PulseFeed onInviteFriend={() => { setProfileInitialTab("friends"); setShowProfile(true); }} />

            {/* Groups (Crews) — shared group chat + standings. */}
            <GroupsSection />

            {/* Challenges — head-to-head bets / streak challenges between friends. */}
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
                        tab === t ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:text-gray-800"
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
            {/* ── Labs ── */}
            <LabsTab />
          </div>
        )}

        {section === "gear" && (
          <div>
            <GearTab />
          </div>
        )}

      </main>

      {/* ── Footer with legal links ── */}
      <Footer />

      {/* ── Coach Al chat ── */}
      <ChatWidget onRegisterOpen={opener => { openChatRef.current = opener; }} />

      {/* ── Coach Al reaction toast — fires after meal/workout/weight logs ── */}
      <CoachReactionToast
        text={coachReaction}
        onDismiss={() => setCoachReaction(null)}
        onOpenChat={(seed) => openChatRef.current?.(seed)}
      />

      {/* ── Day-meals drawer (opened by tapping a bar in the 7-day chart) ── */}
      {drawerDate && (
        <DayMealsDrawer
          date={drawerDate}
          onClose={() => setDrawerDate(null)}
          onChanged={() => {
            // Refetch the weekly summary so the chart + averages reflect the edit.
            api.nutritionSummary().then(setNutSummary).catch(() => {});
            // Also refetch today if the day they edited is today.
            if (drawerDate === new Date().toISOString().slice(0, 10)) {
              api.nutritionToday().then(setNutToday).catch(() => {});
            }
          }}
        />
      )}

      {/* ── Profile modal ── */}
      {showProfile && (
        <ProfileModal
          onClose={() => {
            setShowProfile(false);
            // Refresh so the "add age & sex" nudge clears once they've filled it in.
            api.getProfile().then(setProfile).catch(() => {});
          }}
          initialTab={profileInitialTab}
        />
      )}
      {showShare && (
        <ShareCardModal
          onClose={() => setShowShare(false)}
          longevity={data?.longevity_score
            ? {
                score: data.longevity_score.score ?? null,
                grade: data.longevity_score.grade ?? null,
                biological_age_delta: data.longevity_score.biological_age_delta ?? null,
              }
            : null}
        />
      )}
      {showOnboarding && <OnboardingModal onDone={() => { setShowOnboarding(false); window.location.reload(); }} />}

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
            <span className="text-xs text-gray-600 font-normal">{badge}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F1EA]">
      <div className="text-center space-y-4">
        <div className="h-12 w-12 rounded-full border-4 border-[#1B3829] border-t-transparent animate-spin mx-auto" />
        <p className="text-gray-600 text-sm">Loading your health data…</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  const e = error.toLowerCase();
  // Auth errors are a SEPARATE bucket from Oura errors — a Supabase email user
  // getting a 401 should be sent to sign in, not pushed to "Reconnect Oura"
  // (which is what was happening to non-Oura users). Only explicit Oura mentions
  // route to the Oura reconnect path now.
  const isAuth    = e.includes("not authenticated") || e.includes("session expired") || e === "401" || e.includes("401");
  const isOuraApi = e.includes("oura") || e.includes("reconnect");
  const isOffline = e.includes("fetch") || e.includes("network") || e.includes("failed to fetch") || e.includes("502");

  let emoji    = "⚠️";
  let title    = "Something went wrong";
  let message  = error;
  let btnLabel = "Retry";
  let btnHref  = "/dashboard";
  let secondary: { label: string; href: string } | null = null;

  if (isOuraApi) {
    emoji   = "🔗";
    title   = "Oura connection issue";
    message = e.includes("expired") || e.includes("reconnect")
      ? "Your Oura session expired. Reconnect to restore your dashboard."
      : "There was a problem reaching your Oura Ring data. Try reconnecting — it usually fixes it.";
    btnLabel = "Reconnect Oura →";
    btnHref  = "https://backnine-hu60.onrender.com/auth/oura";
    secondary = { label: "Retry without reconnecting", href: "/dashboard" };
  } else if (isAuth) {
    emoji   = "🔒";
    title   = "Please sign in again";
    message = "Your session expired. Sign in to pick back up where you left off.";
    btnLabel = "Sign in →";
    btnHref  = "/";
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
        <p className="text-gray-600 text-sm leading-relaxed">{message}</p>
        <div className="flex flex-col gap-2 items-center">
          <a
            href={btnHref}
            onClick={() => {
              // On the auth path, clear the stale token BEFORE letting the browser
              // navigate. Otherwise the homepage sees bn_token still in localStorage,
              // auto-redirects to /dashboard, which 401s again — infinite loop.
              if (isAuth && typeof window !== "undefined") {
                try {
                  localStorage.removeItem("bn_token");
                  Object.keys(localStorage)
                    .filter(k => k.startsWith("sb-"))
                    .forEach(k => localStorage.removeItem(k));
                } catch { /* ignore */ }
              }
            }}
            className="inline-block rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white font-semibold px-6 py-3 text-sm transition-colors"
          >
            {btnLabel}
          </a>
          {secondary && (
            <a href={secondary.href} className="text-xs text-gray-600 hover:text-gray-600">
              {secondary.label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
