"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  api,
  localToday,
  type WeeklyPlan,
  type WeeklySession,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
  type WorkoutTemplate,
  type ExerciseInfo,
  type ExerciseProgression,
  type StretchRoutine,
  type TrainingSettings,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import SystemTemplatesBrowser from "@/components/SystemTemplatesBrowser";
import TodayWorkoutCard from "@/components/TodayWorkoutCard";
import LifetimePrsCard from "@/components/LifetimePrsCard";
import ExerciseHistoryModal from "@/components/ExerciseHistoryModal";
import TrainingLoadCards from "@/components/TrainingLoadCards";

const TYPE_ICON: Record<string, string>  = { lifting: "🏋️", stretching: "🧘", mobility: "🔄", cardio: "🏃" };
const TYPE_LABEL: Record<string, string> = { lifting: "Lifting", stretching: "Stretch", mobility: "Mobility", cardio: "Cardio" };

// Cardio activity options shown in the logger — slug = stored, label = displayed.
const CARDIO_ACTIVITIES: Array<{ slug: string; label: string; icon: string }> = [
  { slug: "running",  label: "Run",   icon: "🏃" },
  { slug: "walking",  label: "Walk",  icon: "🚶" },
  { slug: "hiking",   label: "Hike",  icon: "🥾" },
  { slug: "cycling",  label: "Bike",  icon: "🚴" },
  { slug: "swimming", label: "Swim",  icon: "🏊" },
  { slug: "rowing",   label: "Row",   icon: "🚣" },
  { slug: "other",    label: "Other", icon: "💪" },
];

// Activity-level icons for Oura-imported workouts/sessions — picked over the
// type icon when present so a "Running" row shows 🏃 instead of the generic 💪.
const ACTIVITY_ICON: Record<string, string> = {
  running: "🏃", walking: "🚶", hiking: "🥾", cycling: "🚴", swimming: "🏊",
  rowing: "🚣", yoga: "🧘", pilates: "🤸", weights: "🏋️", strength: "🏋️",
  dance: "💃", tennis: "🎾", basketball: "🏀", soccer: "⚽", golf: "⛳",
  skiing: "🎿", snowboarding: "🏂", climbing: "🧗", boxing: "🥊",
  sauna: "🧖", meditation: "🧘", breathing: "🌬️", rest: "😌", ice_bath: "🧊",
  nap: "🛌",
};

function workoutGlyph(w: { activity?: string; type: string; kind?: string }): string {
  const a = (w.activity || "").toLowerCase();
  if (a && ACTIVITY_ICON[a]) return ACTIVITY_ICON[a];
  if (TYPE_ICON[w.type]) return TYPE_ICON[w.type];
  if (w.kind === "cardio")  return "🏃";
  if (w.kind === "session") return "🧘";
  return "💪";
}
const TYPE_BADGE: Record<string, string> = {
  lifting:    "bg-[#1B3829]/10 text-[#1B3829]",
  stretching: "bg-indigo-50 text-indigo-600",
  mobility:   "bg-amber-50 text-amber-700",
  cardio:     "bg-rose-50 text-rose-700",
};

// ── Progression badge ─────────────────────────────────────────────────────────
// Tiny pill rendered next to a lifting exercise name on the recent-workouts
// list. Server computes the e1RM delta vs. the user's history; we just paint
// it. Visually loud for a PR (gold), quiet for ▲/▼, hidden for "same".
const PROGRESSION_STYLE: Record<ExerciseProgression["kind"], string> = {
  pr:   "bg-amber-100 text-amber-800 border border-amber-200",
  up:   "bg-emerald-50 text-emerald-700 border border-emerald-100",
  down: "bg-rose-50 text-rose-700 border border-rose-100",
  same: "",
  new:  "bg-sky-50 text-sky-700 border border-sky-100",
};
function ProgressionBadge({ p }: { p?: ExerciseProgression }) {
  if (!p || !p.label) return null;
  const cls = PROGRESSION_STYLE[p.kind] || "";
  if (!cls) return null;
  const title =
    p.kind === "pr"   ? `Lifetime best estimated 1RM${p.delta_lbs ? ` (+${p.delta_lbs} lb vs. prior best)` : ""}`
    : p.kind === "up"   ? `Estimated 1RM up ${p.delta_lbs} lb vs. last session`
    : p.kind === "down" ? `Estimated 1RM down ${Math.abs(p.delta_lbs || 0)} lb vs. last session`
    : p.kind === "new"  ? `First time logging this lift`
    : "";
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}
      title={title}
    >
      {p.label}
    </span>
  );
}

// ── Weekly plan ───────────────────────────────────────────────────────────────
function WeeklyPlanView({ plan }: { plan: WeeklyPlan }) {
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">This Week&apos;s Plan</p>
      <div className="grid grid-cols-7 gap-1">
        {plan.plan.map((session, i) => (
          <div key={session.date}
            className={`rounded-xl p-2 text-center transition-all ${
              session.is_today
                ? "bg-green-50 border border-green-300"
                : session.rest
                ? "bg-gray-50"
                : "bg-gray-100"
            }`}>
            <p className={`text-[10px] font-medium mb-1 ${session.is_today ? "text-green-600" : "text-gray-600"}`}>
              {DAY_LABELS[i]}
            </p>
            {session.rest ? (
              <p className="text-[10px] text-gray-600">Rest</p>
            ) : (
              <>
                <p className="text-[9px] text-gray-700 leading-tight line-clamp-2">
                  {(session as WeeklySession & { optional?: boolean }).optional ? "🧘 " : ""}
                  {session.name.split("—")[0].trim()}
                </p>
                {session.focus && session.focus.length > 0 && (
                  <p className="text-[8px] text-gray-600 mt-0.5 leading-tight">
                    {session.focus.slice(0, 2).map(f => f.replace("_", " ")).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Today's session detail */}
      {(() => {
        const today = plan.plan.find(s => s.is_today && !s.rest);
        if (!today || !today.exercises) return null;
        return (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">{today.name}</p>
            <div className="space-y-1.5">
              {today.exercises.map((ex, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-900 capitalize">{ex.name}</p>
                    {ex.note && <p className="text-xs text-gray-600 mt-0.5">{ex.note}</p>}
                  </div>
                  <span className="text-xs text-gray-600 font-mono shrink-0 ml-2">
                    {ex.sets}×{ex.reps}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Set stepper (− input +) ───────────────────────────────────────────────────
function SetStepper({
  value, step, placeholder, width, onChange,
}: {
  value: number; step: number; placeholder: string; width: string;
  onChange: (v: number) => void;
}) {
  const btn = "w-6 h-7 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm leading-none flex items-center justify-center transition-colors";
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" className={btn} onClick={() => onChange(Math.max(0, (value || 0) - step))}>−</button>
      <input
        type="number" inputMode="numeric" min="0" step={step}
        value={value || ""} placeholder={placeholder}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={`${width} h-7 rounded-md bg-white border border-gray-200 text-center text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-green-500`}
      />
      <button type="button" className={btn} onClick={() => onChange((value || 0) + step)}>+</button>
    </div>
  );
}

// ── Workout logger ────────────────────────────────────────────────────────────
export function WorkoutLogger({
  onSaved, recentWorkouts, seed, onSeedConsumed,
}: {
  onSaved: (w: Workout) => void;
  recentWorkouts: Workout[];
  /** Optional pre-fill from Today's Workout prescription or system template. */
  seed?: { name: string; exercises: { name: string }[] } | null;
  /** Called after the seed is loaded so the parent can clear its state and
   *  avoid re-seeding on every render. */
  onSeedConsumed?: () => void;
}) {
  const [workoutType, setWorkoutType] = useState<"lifting" | "stretching" | "mobility" | "cardio">("lifting");
  const [exercises, setExercises]     = useState<WorkoutExercise[]>([]);
  const [duration, setDuration]       = useState("");
  const [notes, setNotes]             = useState("");
  const [query, setQuery]             = useState("");
  // Cardio-only inputs. Kept in their own state so switching modes doesn't
  // clobber the user's strength session in progress (or vice versa).
  const [cardioActivity, setCardioActivity]   = useState<string>("running");
  const [cardioDistance, setCardioDistance]   = useState<string>("");
  const [cardioUnit, setCardioUnit]           = useState<"mi" | "km">("mi");
  const [cardioAvgHr, setCardioAvgHr]         = useState<string>("");
  const [cardioCalories, setCardioCalories]   = useState<string>("");
  const [results, setResults]         = useState<ExerciseInfo[]>([]);
  const [saving, setSaving]           = useState(false);
  const [templates, setTemplates]     = useState<WorkoutTemplate[]>([]);
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName]         = useState("");
  const [savingTpl, setSavingTpl]     = useState(false);
  const [describe, setDescribe]       = useState("");
  const [parsing, setParsing]         = useState(false);
  const [parseError, setParseError]   = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.trainingTemplates().then(r => setTemplates(r.templates)).catch(() => {});
  }, []);

  // Consume the optional `seed` from Today's Workout prescription. Pre-fills
  // the exercise list with just names (no sets/reps) so the user can add
  // their actual numbers as they lift. Runs once on mount when seed exists.
  useEffect(() => {
    if (seed && seed.exercises.length > 0) {
      setExercises(seed.exercises.map(ex => ({ name: ex.name })));
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map exercise name -> last logged set, so adding an exercise pre-fills the
  // weight/reps you used last time. Sorted newest-first regardless of input order.
  const lastByExercise = useMemo(() => {
    const map: Record<string, { weight_lbs: number; reps: number }> = {};
    const sorted = [...recentWorkouts].sort((a, b) =>
      (b.logged_at || b.date).localeCompare(a.logged_at || a.date));
    for (const w of sorted) {
      for (const ex of w.exercises) {
        if (!map[ex.name] && ex.sets && ex.sets.length) {
          const last = ex.sets[ex.sets.length - 1];
          map[ex.name] = { weight_lbs: last.weight_lbs || 0, reps: last.reps || 0 };
        }
      }
    }
    return map;
  }, [recentWorkouts]);

  const doSearch = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const { results: r } = await api.searchExercises(q);
        setResults(r);
      } catch { setResults([]); }
    }, 250);
  }, []);

  const addExercise = (info: ExerciseInfo) => {
    setExercises(prev => [
      ...prev,
      workoutType === "lifting"
        ? { name: info.name, sets: [ lastByExercise[info.name] ? { ...lastByExercise[info.name] } : { weight_lbs: 0, reps: 0 } ] }
        : { name: info.name, duration_sec: 30 },
    ]);
    setQuery(""); setResults([]);
  };

  const addSet = (exIdx: number) => {
    setExercises(prev => prev.map((ex, i) => {
      if (i !== exIdx) return ex;
      const sets = ex.sets || [];
      const last = sets[sets.length - 1];
      const next: WorkoutSet = last ? { weight_lbs: last.weight_lbs, reps: last.reps } : { weight_lbs: 0, reps: 0 };
      return { ...ex, sets: [...sets, next] };
    }));
  };

  const updateSet = (exIdx: number, setIdx: number, field: "weight_lbs" | "reps", val: number) => {
    setExercises(prev => prev.map((ex, i) => {
      if (i !== exIdx) return ex;
      const sets = (ex.sets || []).map((s, j) => j === setIdx ? { ...s, [field]: val } : s);
      return { ...ex, sets };
    }));
  };

  const toggleDone = (exIdx: number, setIdx: number) => {
    setExercises(prev => prev.map((ex, i) => {
      if (i !== exIdx) return ex;
      const sets = (ex.sets || []).map((s, j) => j === setIdx ? { ...s, done: !s.done } : s);
      return { ...ex, sets };
    }));
  };

  const removeSet = (exIdx: number, setIdx: number) => {
    setExercises(prev => prev.map((ex, i) =>
      i === exIdx ? { ...ex, sets: (ex.sets || []).filter((_, j) => j !== setIdx) } : ex
    ));
  };

  const removeExercise = (idx: number) => setExercises(prev => prev.filter((_, i) => i !== idx));

  const loadExercises = (exs: WorkoutExercise[]) => {
    setExercises(exs.map(ex => ({
      name: ex.name,
      ...(ex.sets ? { sets: ex.sets.map(s => ({ weight_lbs: s.weight_lbs || 0, reps: s.reps || 0 })) } : {}),
      ...(ex.duration_sec ? { duration_sec: ex.duration_sec } : {}),
    })));
  };

  const loadTemplate = (t: WorkoutTemplate) => {
    setWorkoutType(t.type);
    loadExercises(t.exercises);
  };

  // "Describe your workout" → Claude structures it into the editable list.
  const parseDescribe = async () => {
    const t = describe.trim();
    if (!t || parsing) return;
    setParsing(true); setParseError(null);
    try {
      const p = await api.parseWorkout(t);
      if (p.exercises.length > 0) {
        // Structured workout — fill the editable exercise list to review.
        setWorkoutType(p.type || "lifting");
        loadExercises(p.exercises);
        if (p.duration_min) setDuration(String(p.duration_min));
        if (p.notes) setNotes(prev => prev ? `${prev}; ${p.notes}` : p.notes);
        setDescribe("");
      } else {
        // Generic session (e.g. "30 min upper body lifting") — no itemized
        // sets to review. Log it as a freeform workout: keep the description
        // as the title/notes and capture the duration. Still fully saveable.
        if (p.type) setWorkoutType(p.type);
        if (p.duration_min) setDuration(String(p.duration_min));
        const freeform = p.notes && p.notes.trim().length > 2 ? p.notes.trim() : t;
        setNotes(prev => prev ? `${prev}; ${freeform}` : freeform);
        setDescribe("");
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Couldn't parse that workout");
    } finally {
      setParsing(false);
    }
  };

  // Most recent workout matching the selected type — for one-tap "repeat".
  const lastWorkoutOfType = useMemo(() => {
    const sorted = [...recentWorkouts].sort((a, b) =>
      (b.logged_at || b.date).localeCompare(a.logged_at || a.date));
    return sorted.find(w => w.type === workoutType) || null;
  }, [recentWorkouts, workoutType]);

  const saveAsRoutine = async () => {
    if (!tplName.trim() || exercises.length === 0) return;
    setSavingTpl(true);
    try {
      // Strip UI-only "done" flags before saving the routine.
      const clean = exercises.map(ex => ({
        name: ex.name,
        ...(ex.sets ? { sets: ex.sets.map(s => ({ weight_lbs: s.weight_lbs, reps: s.reps })) } : {}),
        ...(ex.duration_sec ? { duration_sec: ex.duration_sec } : {}),
      }));
      await api.saveTemplate({ name: tplName.trim(), type: workoutType, exercises: clean });
      const r = await api.trainingTemplates();
      setTemplates(r.templates);
      setTplName(""); setShowSaveTpl(false);
    } catch (e) { console.error(e); }
    finally { setSavingTpl(false); }
  };

  const deleteTemplate = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (e) { console.error(e); }
  };

  // A workout is saveable if it has itemized exercises OR enough to stand on its
  // own as a quick log: a description, a note, or a duration. For cardio,
  // duration alone is enough (e.g. "ran for 30 min" — no other fields required).
  const describeTrimmed = describe.trim();
  const canSave = workoutType === "cardio"
    ? !!duration || !!cardioDistance || !!notes.trim()
    : (exercises.length > 0 || !!notes.trim() || !!duration || !!describeTrimmed);

  const save = async () => {
    // Fall back to whatever the user typed in the "describe" box if they hit
    // Save before pressing Add — log it as a freeform session.
    const effectiveNotes = notes.trim() || (exercises.length === 0 ? describeTrimmed : "");
    if (workoutType !== "cardio" && exercises.length === 0 && !effectiveNotes && !duration) return;
    if (workoutType === "cardio" && !duration && !cardioDistance && !effectiveNotes) return;
    setSaving(true);
    try {
      // Don't persist UI-only "done" flags on the workout record.
      const clean = exercises.map(ex => ({
        name: ex.name,
        ...(ex.sets ? { sets: ex.sets.map(s => ({ weight_lbs: s.weight_lbs, reps: s.reps })) } : {}),
        ...(ex.duration_sec ? { duration_sec: ex.duration_sec } : {}),
      }));

      // Cardio: convert distance to meters and pull HR / calories into the payload.
      const isCardio = workoutType === "cardio";
      const distNum  = isCardio && cardioDistance ? parseFloat(cardioDistance) : NaN;
      const distMeters = isCardio && !isNaN(distNum)
        ? Math.round(distNum * (cardioUnit === "mi" ? 1609.34 : 1000))
        : undefined;

      const w = await api.logWorkout({
        date:         localToday(),
        type:         workoutType,
        exercises:    clean,
        duration_min: duration ? parseInt(duration) : undefined,
        notes:        effectiveNotes,
        ...(isCardio ? {
          activity:        cardioActivity,
          distance_meters: distMeters,
          avg_hr:          cardioAvgHr   ? parseInt(cardioAvgHr)   : undefined,
          calories_kcal:   cardioCalories ? parseInt(cardioCalories) : undefined,
        } : {}),
      });
      onSaved(w);
      setExercises([]); setDuration(""); setNotes(""); setDescribe("");
      setCardioDistance(""); setCardioAvgHr(""); setCardioCalories("");
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500";
  const typeTemplates = templates.filter(t => t.type === workoutType);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-900">Log Workout</p>

      {/* Describe your workout — AI fills the list below */}
      <div>
        <div className="flex items-center gap-2">
          <input
            value={describe}
            onChange={e => setDescribe(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") parseDescribe(); }}
            placeholder="Describe it: bench 3x8 @135, squats 5x5 @225…"
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#2D6A4F]"
          />
          <button onClick={parseDescribe} disabled={!describe.trim() || parsing}
            className="shrink-0 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40">
            {parsing ? "…" : "Add"}
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-1">
          Type your whole workout and Coach Al fills in the exercises &amp; sets below to review.
        </p>
        {parsing && (
          <div className="flex items-center gap-2 text-xs text-gray-600 mt-1.5">
            <div className="h-4 w-4 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            Reading your workout…
          </div>
        )}
        {parseError && <p className="text-[11px] text-red-500 mt-1">{parseError}</p>}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-gray-100" />
        <span className="text-[10px] text-gray-600 uppercase tracking-widest">or build it manually</span>
        <div className="flex-1 h-px bg-gray-100" />
      </div>

      {/* Type selector */}
      <div className="flex gap-1">
        {(["lifting", "cardio", "stretching", "mobility"] as const).map(t => (
          <button key={t} onClick={() => setWorkoutType(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              workoutType === t ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-600 hover:text-gray-800"
            }`}>
            {TYPE_ICON[t]} {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Cardio inputs — activity / distance / avg HR / calories. Duration
          uses the shared Meta input below so the layout stays familiar. */}
      {workoutType === "cardio" && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Activity</p>
            <div className="flex flex-wrap gap-1.5">
              {CARDIO_ACTIVITIES.map(a => (
                <button key={a.slug} onClick={() => setCardioActivity(a.slug)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    cardioActivity === a.slug ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-600 hover:text-gray-800"
                  }`}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-600 mb-1">Distance</p>
              <div className="flex items-center gap-1">
                <input className={inp} type="number" step="0.01" placeholder="3.1"
                  value={cardioDistance} onChange={e => setCardioDistance(e.target.value)} />
                <div className="flex shrink-0 rounded-lg overflow-hidden border border-gray-200">
                  {(["mi", "km"] as const).map(u => (
                    <button key={u} onClick={() => setCardioUnit(u)}
                      className={`px-2 py-2 text-xs font-medium ${cardioUnit === u ? "bg-[#1B3829] text-white" : "bg-gray-50 text-gray-600"}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Avg HR (bpm)</p>
              <input className={inp} type="number" placeholder="148"
                value={cardioAvgHr} onChange={e => setCardioAvgHr(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Calories (optional)</p>
            <input className={inp} type="number" placeholder="385"
              value={cardioCalories} onChange={e => setCardioCalories(e.target.value)} />
          </div>
        </div>
      )}

      {/* Repeat last — one tap to start from your previous session of this type */}
      {workoutType !== "cardio" && lastWorkoutOfType && (
        <button onClick={() => loadExercises(lastWorkoutOfType.exercises)}
          className="w-full py-2 rounded-lg border border-[#1B3829]/30 bg-[#1B3829]/5 text-xs font-semibold text-[#1B3829] hover:bg-[#1B3829]/10 transition-colors">
          ↻ Repeat last {TYPE_LABEL[workoutType]} workout · {lastWorkoutOfType.date}
        </button>
      )}

      {/* Curated program library — strength-and-longevity skewed for the
          men-50+ persona. Each session "Start" button seeds the workout
          below with that session's exercises (no sets/reps; user fills). */}
      {workoutType !== "cardio" && (
        <SystemTemplatesBrowser
          onStartSession={(_name, exerciseNames) => {
            loadExercises(exerciseNames.map(n => ({ name: n })));
          }}
        />
      )}

      {/* Saved routines — one tap to start from a template */}
      {workoutType !== "cardio" && typeTemplates.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Start from a routine</p>
          <div className="flex flex-wrap gap-1.5">
            {typeTemplates.map(t => (
              <span key={t.id} className="inline-flex items-center rounded-full bg-[#1B3829]/8 border border-[#1B3829]/15 pl-2.5 pr-1 py-0.5">
                <button onClick={() => loadTemplate(t)}
                  className="text-xs font-medium text-[#1B3829] hover:underline">
                  {t.name}
                </button>
                <button onClick={() => deleteTemplate(t.id)} title="Delete routine"
                  className="ml-1 w-4 h-4 text-gray-500 hover:text-red-400 text-sm leading-none">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Exercise search (lifting/stretching/mobility) */}
      {workoutType !== "cardio" && (
      <div className="relative">
        <input className={inp} placeholder={workoutType === "lifting" ? "Add exercise: squat, bench, row…" : "Add stretch: pigeon, quad, lat…"}
          value={query} onChange={e => { setQuery(e.target.value); doSearch(e.target.value); }} />
        {results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden max-h-48 overflow-y-auto">
            {results.map(r => (
              <button key={r.name} onClick={() => addExercise(r)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left transition-colors">
                <div>
                  <p className="text-sm text-gray-900 capitalize">{r.name}</p>
                  <p className="text-xs text-gray-600">{r.primary.join(", ")} · {r.equipment}</p>
                </div>
                <span className="text-xs text-gray-600 shrink-0 ml-2 capitalize">{r.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Exercise list */}
      {workoutType !== "cardio" && exercises.length > 0 && (
        <div className="space-y-3">
          {exercises.map((ex, exIdx) => (
            <div key={exIdx} className="rounded-xl bg-gray-50 border border-gray-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-900 capitalize">{ex.name}</p>
                <button onClick={() => removeExercise(exIdx)} className="text-gray-600 hover:text-red-400 text-lg leading-none transition-colors">×</button>
              </div>

              {workoutType === "lifting" && ex.sets ? (
                <>
                  {ex.sets.map((s, setIdx) => (
                    <div key={setIdx} className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-4 shrink-0 text-center text-[11px] text-gray-600">{setIdx + 1}</span>
                      <SetStepper value={s.weight_lbs} step={5} placeholder="lbs" width="w-12"
                        onChange={v => updateSet(exIdx, setIdx, "weight_lbs", v)} />
                      <span className="text-[11px] text-gray-500">×</span>
                      <SetStepper value={s.reps} step={1} placeholder="reps" width="w-11"
                        onChange={v => updateSet(exIdx, setIdx, "reps", v)} />
                      <button onClick={() => toggleDone(exIdx, setIdx)} title="Mark set done"
                        className={`ml-auto w-7 h-7 rounded-md text-sm leading-none transition-colors flex items-center justify-center ${
                          s.done ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}>✓</button>
                      <button onClick={() => removeSet(exIdx, setIdx)} title="Remove set"
                        className="w-4 text-gray-500 hover:text-red-400 text-sm leading-none">×</button>
                    </div>
                  ))}
                  <button onClick={() => addSet(exIdx)}
                    className="mt-1 w-full py-1 rounded-lg border border-dashed border-gray-300 text-xs text-gray-600 hover:text-gray-700 hover:border-gray-400 transition-colors">
                    + Add set
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-600">Duration (sec)</p>
                  <input type="number" min="10" step="5" placeholder="30"
                    value={ex.duration_sec || ""}
                    onChange={e => setExercises(prev => prev.map((x, i) => i === exIdx ? { ...x, duration_sec: parseInt(e.target.value) || 30 } : x))}
                    className="w-20 rounded-lg bg-white border border-gray-200 px-2 py-1.5 text-sm text-gray-900 text-center focus:outline-none focus:border-green-500" />
                  <span className="text-xs text-gray-600">each side</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Save as routine */}
      {workoutType !== "cardio" && exercises.length > 0 && (
        showSaveTpl ? (
          <div className="flex items-center gap-2">
            <input className={inp} placeholder="Routine name (e.g. Push Day)" value={tplName}
              onChange={e => setTplName(e.target.value)} />
            <button onClick={saveAsRoutine} disabled={savingTpl || !tplName.trim()}
              className="shrink-0 rounded-lg bg-[#1B3829] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {savingTpl ? "…" : "Save"}
            </button>
            <button onClick={() => { setShowSaveTpl(false); setTplName(""); }}
              className="shrink-0 text-gray-600 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
        ) : (
          <button onClick={() => setShowSaveTpl(true)}
            className="text-xs font-medium text-[#1B3829] hover:underline">
            ＋ Save these exercises as a routine
          </button>
        )
      )}

      {/* Meta */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-gray-600 mb-1">Duration (min)</p>
          <input className={inp} type="number" placeholder="45" value={duration}
            onChange={e => setDuration(e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Notes</p>
          <input className={inp} placeholder="Optional" value={notes}
            onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <button disabled={!canSave || saving} onClick={save}
        className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-sm font-semibold transition-colors">
        {saving ? "Saving…" : "Save workout"}
      </button>
      {exercises.length === 0 && (notes.trim() || duration || describeTrimmed) && (
        <p className="text-[11px] text-gray-600 -mt-2 text-center">
          No exercises added — this will be logged as a quick session.
        </p>
      )}
    </div>
  );
}

// ── Stretch routine view ──────────────────────────────────────────────────────
function StretchRoutineView({ routine, onClose }: { routine: StretchRoutine; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-widest">Post-Workout Stretch</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{routine.total_min} min · {routine.exercises.length} exercises</p>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-600 text-xl leading-none">×</button>
      </div>
      <div className="space-y-2">
        {routine.exercises.map((ex, i) => (
          <div key={i} className="rounded-xl bg-gray-50 px-3 py-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-900 capitalize">{ex.name}</p>
              <span className="text-xs text-indigo-500 font-mono shrink-0 ml-2">
                {ex.sides === 2 ? `${ex.duration_sec}s × 2` : `${ex.duration_sec}s`}
              </span>
            </div>
            <p className="text-xs text-gray-600">{ex.muscle_group} · {ex.cue}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-600 mt-3">
        Targets: {routine.muscle_groups.join(", ")}
      </p>
    </div>
  );
}

// ── Recent workouts ───────────────────────────────────────────────────────────
function RecentWorkouts({
  workouts,
  onDelete,
  onUpdated,
  onStretch,
  onOpenHistory,
}: {
  workouts: Workout[];
  onDelete: (id: string) => void;
  onUpdated: (w: Workout) => void;
  onStretch: (muscleGroups: string[]) => void;
  /** Tap an exercise name → open the history modal for that exercise.
   *  Only meaningful for lifting rows; we still pass it through for
   *  consistency. */
  onOpenHistory: (exerciseName: string) => void;
}) {
  if (workouts.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
        <div className="text-3xl mb-2">🏋️</div>
        <p className="text-gray-900 font-semibold text-sm mb-1">No workouts logged yet</p>
        <p className="text-gray-600 text-xs leading-relaxed max-w-xs mx-auto">
          Tap <span className="font-semibold text-[#1B3829]">＋ Log a workout</span> above to start your history. Strength, cardio, or just a quick freeform note — anything counts.
        </p>
      </div>
    );
  }

  const sorted = [...workouts].sort((a, b) =>
    (b.logged_at || b.date).localeCompare(a.logged_at || a.date));

  // Inline edit state — one workout at a time. Editable headline fields only:
  // date, type/activity, duration_min, notes, plus cardio extras. Sets/reps
  // editing would warrant a deeper modal; punted to v2.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft,     setDraft]     = useState<{
    date: string; type: string; duration_min: string; notes: string;
    distance_mi: string; avg_hr: string; calories_kcal: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const beginEdit = (w: Workout) => {
    setEditingId(w.id);
    setDraft({
      date:          w.date,
      type:          w.type,
      duration_min:  w.duration_min != null ? String(w.duration_min) : "",
      notes:         w.notes || "",
      distance_mi:   w.distance_meters != null ? (w.distance_meters / 1609.34).toFixed(2) : "",
      avg_hr:        w.avg_hr != null ? String(w.avg_hr) : "",
      calories_kcal: w.calories_kcal != null ? String(w.calories_kcal) : "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };
  const saveEdit = async (w: Workout) => {
    if (!draft) return;
    setSaving(true);
    try {
      const patch: Parameters<typeof api.updateWorkout>[1] = {
        date:         draft.date.trim() || w.date,
        type:         draft.type.trim() || w.type,
        duration_min: draft.duration_min === "" ? undefined : Number(draft.duration_min),
        notes:        draft.notes,
      };
      // Cardio extras — only send if there's a real value to avoid wiping them.
      if (w.kind === "cardio") {
        if (draft.distance_mi !== "")   patch.distance_meters = Math.round(Number(draft.distance_mi) * 1609.34);
        if (draft.avg_hr !== "")        patch.avg_hr          = Number(draft.avg_hr);
        if (draft.calories_kcal !== "") patch.calories_kcal   = Number(draft.calories_kcal);
        // Treat `type` as the activity for cardio rows so the column reads naturally.
        if (draft.type.trim()) patch.activity = draft.type.trim().toLowerCase();
      }
      const updated = await api.updateWorkout(w.id, patch);
      onUpdated(updated);
      cancelEdit();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-600 uppercase tracking-widest mb-4">Recent Workouts</p>
      <div className="space-y-2.5">
        {sorted.slice(0, 5).map(w => {
          const vol = w.total_volume_lbs;
          const isEditing = editingId === w.id;
          const isOura    = w.source === "oura";
          return (
            <div key={w.id} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE[w.type] ?? "bg-gray-100 text-gray-600"}`}>
                      {workoutGlyph(w)} {TYPE_LABEL[w.type] ?? w.type}
                    </span>
                    {isOura && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700"
                        title="Imported from your Oura Ring"
                      >
                        💍 Oura
                      </span>
                    )}
                    <span className="text-xs text-gray-600">{w.date}</span>
                  </div>
                  {w.exercises.length > 0 ? (
                    // Each exercise on its own line so the progression badge
                    // has room. Comma-joining read fine before but hid every
                    // bit of session-over-session detail behind a wall of
                    // names — the badge is the whole point here. Names are
                    // tappable on lifting rows to open the per-exercise
                    // history modal (chart + every prior session).
                    <ul className="text-sm text-gray-700 space-y-0.5">
                      {w.exercises.map((e, i) => {
                        const tappable = w.kind === "strength" && !!e.sets?.length;
                        return (
                          <li key={`${e.name}-${i}`} className="flex items-center gap-1.5 flex-wrap">
                            {tappable ? (
                              <button
                                onClick={() => onOpenHistory(e.name)}
                                className="capitalize text-left hover:text-[#1B3829] hover:underline transition-colors"
                                title="See history for this lift"
                              >
                                {e.name}
                              </button>
                            ) : (
                              <span className="capitalize">{e.name}</span>
                            )}
                            <ProgressionBadge p={e.progression} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-700">
                      {w.notes?.trim() || "Quick session"}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-600">
                    {w.duration_min ? <span>⏱ {w.duration_min} min</span> : null}
                    {/* Cardio / Oura-import meta */}
                    {w.distance_meters != null && w.distance_meters > 0 && (
                      <span>📏 {(w.distance_meters / 1609.34).toFixed(2)} mi</span>
                    )}
                    {w.avg_hr ? <span>❤️ {w.avg_hr} bpm avg</span> : null}
                    {w.calories_kcal ? <span>🔥 {w.calories_kcal} kcal</span> : null}
                    {vol && vol > 0 ? <span>📦 {vol.toLocaleString()} lbs vol</span> : null}
                    {w.muscle_groups.length > 0 && (
                      <span>{w.muscle_groups.slice(0, 3).map(m => m.replace("_", " ")).join(", ")}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isEditing && !isOura && (
                    <button onClick={() => beginEdit(w)} title="Edit workout"
                      className="text-gray-500 hover:text-[#1B3829] text-xs font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors">
                      Edit
                    </button>
                  )}
                  <button onClick={() => onDelete(w.id)} title="Delete workout"
                    className="text-gray-500 hover:text-red-400 text-lg leading-none transition-colors px-1">×</button>
                </div>
              </div>

              {/* Inline edit form — appears below the summary so the user still
                  sees context while editing. Oura-imported rows are read-only
                  since they get re-synced from Oura. */}
              {isEditing && draft && !isOura && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] text-gray-600 uppercase tracking-wide">Date</span>
                      <input type="date" value={draft.date}
                        onChange={e => setDraft({ ...draft, date: e.target.value })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-gray-600 uppercase tracking-wide">{w.kind === "cardio" ? "Activity" : "Type"}</span>
                      <input type="text" value={draft.type}
                        onChange={e => setDraft({ ...draft, type: e.target.value })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                    </label>
                  </div>
                  <div className={`grid gap-2 ${w.kind === "cardio" ? "grid-cols-4" : "grid-cols-1"}`}>
                    <label className="block">
                      <span className="text-[10px] text-gray-600 uppercase tracking-wide">Duration (min)</span>
                      <input type="number" inputMode="numeric" value={draft.duration_min}
                        onChange={e => setDraft({ ...draft, duration_min: e.target.value })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                    </label>
                    {w.kind === "cardio" && (
                      <>
                        <label className="block">
                          <span className="text-[10px] text-gray-600 uppercase tracking-wide">Miles</span>
                          <input type="number" step="0.01" inputMode="decimal" value={draft.distance_mi}
                            onChange={e => setDraft({ ...draft, distance_mi: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-gray-600 uppercase tracking-wide">Avg HR</span>
                          <input type="number" inputMode="numeric" value={draft.avg_hr}
                            onChange={e => setDraft({ ...draft, avg_hr: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-gray-600 uppercase tracking-wide">Calories</span>
                          <input type="number" inputMode="numeric" value={draft.calories_kcal}
                            onChange={e => setDraft({ ...draft, calories_kcal: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                        </label>
                      </>
                    )}
                  </div>
                  <label className="block">
                    <span className="text-[10px] text-gray-600 uppercase tracking-wide">Notes</span>
                    <input type="text" value={draft.notes}
                      onChange={e => setDraft({ ...draft, notes: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500" />
                  </label>
                  {w.exercises.length > 0 && (
                    <p className="text-[10px] text-gray-600 italic">
                      Sets and reps aren&apos;t editable here yet — delete and re-log to fix those.
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button variant="accent" className="flex-1" onClick={() => saveEdit(w)} disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Clear action — not a category tag */}
              {w.type === "lifting" && w.muscle_groups.length > 0 && (
                <button onClick={() => onStretch(w.muscle_groups)}
                  className="mt-2.5 w-full py-1.5 rounded-lg border border-indigo-200 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
                  🧘 Get a stretch routine for {w.muscle_groups.slice(0, 2).map(m => m.replace("_", " ")).join(" & ")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Training settings ─────────────────────────────────────────────────────────
function TrainingSettingsPanel({ settings, onSave }: { settings: TrainingSettings; onSave: (s: TrainingSettings) => void }) {
  const [s, setS] = useState(settings);
  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500";
  const EQUIPMENT = ["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell"];

  const toggleEquip = (e: string) => {
    const has = s.equipment.includes(e);
    setS(prev => ({ ...prev, equipment: has ? prev.equipment.filter(x => x !== e) : [...prev.equipment, e] }));
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Training Settings</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-gray-600 mb-1">Days / week</p>
          <select className={inp} value={s.days_per_week}
            onChange={e => setS({ ...s, days_per_week: parseInt(e.target.value) })}>
            {[3, 4, 5].map(n => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Goal</p>
          <select className={inp} value={s.goal}
            onChange={e => setS({ ...s, goal: e.target.value })}>
            <option value="general_fitness">General Fitness</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
          </select>
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-600 mb-2">Available equipment</p>
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT.map(e => (
            <button key={e} onClick={() => toggleEquip(e)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                s.equipment.includes(e)
                  ? "bg-green-100 text-green-700 border border-green-300"
                  : "bg-gray-100 text-gray-600 border border-gray-200"
              }`}>{e}</button>
          ))}
        </div>
      </div>
      <button onClick={() => onSave(s)}
        className="w-full py-2 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">
        Save settings
      </button>
    </div>
  );
}

// ── Main TrainingTab ──────────────────────────────────────────────────────────
export default function TrainingTab({
  autoOpenLogger = false,
  onLoggerOpened,
  onAskCoach,
}: {
  autoOpenLogger?: boolean;
  onLoggerOpened?: () => void;
  /** Optional — when provided, the Today's Workout card surfaces an
   *  "Ask Coach Al" link that opens the chat drawer pre-seeded with a
   *  contextual prompt about today's session. */
  onAskCoach?: (seed: string) => void;
} = {}) {
  const [weeklyPlan,   setWeeklyPlan]   = useState<WeeklyPlan | null>(null);
  const [workouts,     setWorkouts]     = useState<Workout[]>([]);
  const [stretchR,     setStretchR]     = useState<StretchRoutine | null>(null);
  const [showLogger,   setShowLogger]   = useState(autoOpenLogger);
  const [showSettings, setShowSettings] = useState(false);
  const [loading,      setLoading]      = useState(true);
  // Seed for the WorkoutLogger when "Start session" is tapped on the
  // Today's Workout card — pre-fills the exercise list so the user just
  // adds sets/reps as they lift.
  const [loggerSeed,   setLoggerSeed]   = useState<{ name: string; exercises: { name: string }[] } | null>(null);
  // Exercise name currently being inspected in the history modal. Null = closed.
  const [historyName,  setHistoryName]  = useState<string | null>(null);

  // Quick-log from the Scorecard opens the logger straight away.
  useEffect(() => {
    if (autoOpenLogger) {
      setShowLogger(true);
      onLoggerOpened?.();
    }
  }, [autoOpenLogger, onLoggerOpened]);

  useEffect(() => {
    // RecCard removed — Today's Workout now subsumes that role. Only the
    // weekly plan + workout history need fetching at mount.
    Promise.all([
      api.weeklyPlan(),
      api.workouts(30),
    ]).then(([p, w]) => {
      setWeeklyPlan(p);
      setWorkouts(w.workouts);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleWorkoutSaved = (w: Workout) => {
    setWorkouts(prev => [w, ...prev]);
    setShowLogger(false);
  };

  const handleDeleteWorkout = async (id: string) => {
    try {
      await api.deleteWorkout(id);
      setWorkouts(prev => prev.filter(w => w.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleUpdatedWorkout = (updated: Workout) => {
    setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w));
  };

  const handleStretch = async (muscleGroups: string[]) => {
    try {
      const routine = await api.stretchRoutine(muscleGroups, 10);
      setStretchR(routine);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { console.error(e); }
  };

  const handleSaveSettings = async (s: TrainingSettings) => {
    try {
      await api.saveTrainingSettings(s);
      setShowSettings(false);
      const plan = await api.weeklyPlan();
      setWeeklyPlan(plan);
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stretch routine — shown at top when active */}
      {stretchR && <StretchRoutineView routine={stretchR} onClose={() => setStretchR(null)} />}

      {/* Today's Workout — Claude-prescribed daily session.
          Answers "what should I do today?" — the gap David flagged. Lives
          ABOVE the older RecCard / WeeklyPlanView (still kept as context
          for now; can be removed once the new card proves itself). */}
      <TodayWorkoutCard
        onStartSession={(name, exercises) => {
          // Seed the logger with the prescribed exercises and open it.
          setLoggerSeed({ name, exercises: exercises.map(e => ({ name: e.name })) });
          setShowLogger(true);
          // Scroll the logger into view since it lives further down the page.
          setTimeout(() => {
            document.getElementById("workout-logger-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }}
        onAsk={onAskCoach}
      />

      {/* Training load cluster: deload prompt (only if triggered), weekly
          volume sparkline, muscle-group balance heatmap. Lives right after
          Today's Workout so the deload nudge — if it fires — sits adjacent
          to the prescription and informs the user's decision to do today's
          session at full intensity or back off. */}
      <TrainingLoadCards />

      {/* Weekly plan */}
      {weeklyPlan && <WeeklyPlanView plan={weeklyPlan} />}

      {/* Log workout toggle */}
      <button onClick={() => setShowLogger(!showLogger)}
        className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
          showLogger
            ? "border-gray-300 text-gray-600 hover:text-gray-800"
            : "border-green-600/50 bg-green-600/10 text-green-700 hover:bg-green-600/20"
        }`}>
        {showLogger ? "▲ Cancel" : "＋ Log a workout"}
      </button>

      <div id="workout-logger-anchor" />
      {showLogger && (
        <WorkoutLogger
          onSaved={handleWorkoutSaved}
          recentWorkouts={workouts}
          seed={loggerSeed}
          onSeedConsumed={() => setLoggerSeed(null)}
        />
      )}

      {/* Lifetime PRs — sits just above Recent Workouts so the user sees
          their best lifts ("here's what you're proud of") right before the
          history list ("here's what you did"). Renders nothing for users
          with no lifting history yet, so the Training tab still feels
          clean during onboarding. */}
      <LifetimePrsCard />

      {/* Recent workouts */}
      <RecentWorkouts
        workouts={workouts}
        onDelete={handleDeleteWorkout}
        onUpdated={handleUpdatedWorkout}
        onStretch={handleStretch}
        onOpenHistory={setHistoryName}
      />

      {/* Per-exercise history modal — controlled by RecentWorkouts taps.
          Rendered at the tab root so it overlays cleanly without inheriting
          any scroll context from the list. */}
      <ExerciseHistoryModal
        exerciseName={historyName}
        onClose={() => setHistoryName(null)}
      />

      {/* Settings */}
      <div>
        <button onClick={() => setShowSettings(!showSettings)}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:text-gray-800 hover:border-gray-400 text-sm font-medium transition-colors">
          {showSettings ? "▲ Hide" : "⚙ Training settings"}
        </button>
        {showSettings && (
          <div className="mt-3">
            <TrainingSettingsPanel
              settings={{ goal: "general_fitness", days_per_week: 4, split_type: "push_pull_legs", equipment: ["barbell","dumbbell","cable","machine","bodyweight"], units: "lbs" }}
              onSave={handleSaveSettings}
            />
          </div>
        )}
      </div>
    </div>
  );
}
