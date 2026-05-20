"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  api,
  type TrainingRecommendation,
  type WeeklyPlan,
  type WeeklySession,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
  type WorkoutTemplate,
  type ExerciseInfo,
  type StretchRoutine,
  type TrainingSettings,
} from "@/lib/api";

const TYPE_ICON: Record<string, string>  = { lifting: "🏋️", stretching: "🧘", mobility: "🔄" };
const TYPE_LABEL: Record<string, string> = { lifting: "Lifting", stretching: "Stretch", mobility: "Mobility" };
const TYPE_BADGE: Record<string, string> = {
  lifting:    "bg-[#1B3829]/10 text-[#1B3829]",
  stretching: "bg-indigo-50 text-indigo-600",
  mobility:   "bg-amber-50 text-amber-700",
};

// ── Daily recommendation card ─────────────────────────────────────────────────
function RecCard({ rec }: { rec: TrainingRecommendation }) {
  return (
    <div className="rounded-2xl border bg-white p-5" style={{ borderColor: rec.color + "66" }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Today&apos;s Training</p>
          <p className="text-gray-900 font-semibold text-lg">{rec.title}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ml-2"
          style={{ backgroundColor: rec.color + "22", color: rec.color }}>
          {rec.label}
        </span>
      </div>
      <p className="text-sm text-gray-500 leading-relaxed mb-3">{rec.detail}</p>
      {rec.modifiers.length > 0 && (
        <div className="space-y-1 mb-3">
          {rec.modifiers.map((m, i) => (
            <p key={i} className="text-xs text-amber-600 flex gap-1.5">
              <span>⚠</span><span>{m}</span>
            </p>
          ))}
        </div>
      )}
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
        <p className="text-xs text-gray-400 mb-0.5">Suggestion</p>
        <p className="text-sm text-gray-800">{rec.suggestion}</p>
      </div>
      {rec.consecutive_days > 0 && (
        <p className="text-xs text-gray-400 mt-2">{rec.consecutive_days} consecutive training day{rec.consecutive_days > 1 ? "s" : ""}</p>
      )}
    </div>
  );
}

// ── Weekly plan ───────────────────────────────────────────────────────────────
function WeeklyPlanView({ plan }: { plan: WeeklyPlan }) {
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">This Week&apos;s Plan</p>
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
            <p className={`text-[10px] font-medium mb-1 ${session.is_today ? "text-green-600" : "text-gray-400"}`}>
              {DAY_LABELS[i]}
            </p>
            {session.rest ? (
              <p className="text-[10px] text-gray-400">Rest</p>
            ) : (
              <>
                <p className="text-[9px] text-gray-700 leading-tight line-clamp-2">
                  {(session as WeeklySession & { optional?: boolean }).optional ? "🧘 " : ""}
                  {session.name.split("—")[0].trim()}
                </p>
                {session.focus && session.focus.length > 0 && (
                  <p className="text-[8px] text-gray-400 mt-0.5 leading-tight">
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
                    {ex.note && <p className="text-xs text-gray-400 mt-0.5">{ex.note}</p>}
                  </div>
                  <span className="text-xs text-gray-500 font-mono shrink-0 ml-2">
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
  const btn = "w-6 h-7 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 text-sm leading-none flex items-center justify-center transition-colors";
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
function WorkoutLogger({
  onSaved, recentWorkouts,
}: {
  onSaved: (w: Workout) => void;
  recentWorkouts: Workout[];
}) {
  const [workoutType, setWorkoutType] = useState<"lifting" | "stretching" | "mobility">("lifting");
  const [exercises, setExercises]     = useState<WorkoutExercise[]>([]);
  const [duration, setDuration]       = useState("");
  const [notes, setNotes]             = useState("");
  const [query, setQuery]             = useState("");
  const [results, setResults]         = useState<ExerciseInfo[]>([]);
  const [saving, setSaving]           = useState(false);
  const [templates, setTemplates]     = useState<WorkoutTemplate[]>([]);
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName]         = useState("");
  const [savingTpl, setSavingTpl]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.trainingTemplates().then(r => setTemplates(r.templates)).catch(() => {});
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

  const save = async () => {
    if (exercises.length === 0) return;
    setSaving(true);
    try {
      // Don't persist UI-only "done" flags on the workout record.
      const clean = exercises.map(ex => ({
        name: ex.name,
        ...(ex.sets ? { sets: ex.sets.map(s => ({ weight_lbs: s.weight_lbs, reps: s.reps })) } : {}),
        ...(ex.duration_sec ? { duration_sec: ex.duration_sec } : {}),
      }));
      const w = await api.logWorkout({
        date:         new Date().toISOString().slice(0, 10),
        type:         workoutType,
        exercises:    clean,
        duration_min: duration ? parseInt(duration) : undefined,
        notes,
      });
      onSaved(w);
      setExercises([]); setDuration(""); setNotes("");
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const inp = "w-full rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500";
  const typeTemplates = templates.filter(t => t.type === workoutType);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-900">Log Workout</p>

      {/* Type selector */}
      <div className="flex gap-1">
        {(["lifting", "stretching", "mobility"] as const).map(t => (
          <button key={t} onClick={() => setWorkoutType(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              workoutType === t ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-500 hover:text-gray-800"
            }`}>
            {TYPE_ICON[t]} {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Repeat last — one tap to start from your previous session of this type */}
      {lastWorkoutOfType && (
        <button onClick={() => loadExercises(lastWorkoutOfType.exercises)}
          className="w-full py-2 rounded-lg border border-[#1B3829]/30 bg-[#1B3829]/5 text-xs font-semibold text-[#1B3829] hover:bg-[#1B3829]/10 transition-colors">
          ↻ Repeat last {TYPE_LABEL[workoutType]} workout · {lastWorkoutOfType.date}
        </button>
      )}

      {/* Saved routines — one tap to start from a template */}
      {typeTemplates.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Start from a routine</p>
          <div className="flex flex-wrap gap-1.5">
            {typeTemplates.map(t => (
              <span key={t.id} className="inline-flex items-center rounded-full bg-[#1B3829]/8 border border-[#1B3829]/15 pl-2.5 pr-1 py-0.5">
                <button onClick={() => loadTemplate(t)}
                  className="text-xs font-medium text-[#1B3829] hover:underline">
                  {t.name}
                </button>
                <button onClick={() => deleteTemplate(t.id)} title="Delete routine"
                  className="ml-1 w-4 h-4 text-gray-300 hover:text-red-400 text-sm leading-none">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Exercise search */}
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
                  <p className="text-xs text-gray-400">{r.primary.join(", ")} · {r.equipment}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 ml-2 capitalize">{r.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Exercise list */}
      {exercises.length > 0 && (
        <div className="space-y-3">
          {exercises.map((ex, exIdx) => (
            <div key={exIdx} className="rounded-xl bg-gray-50 border border-gray-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-900 capitalize">{ex.name}</p>
                <button onClick={() => removeExercise(exIdx)} className="text-gray-400 hover:text-red-400 text-lg leading-none transition-colors">×</button>
              </div>

              {workoutType === "lifting" && ex.sets ? (
                <>
                  {ex.sets.map((s, setIdx) => (
                    <div key={setIdx} className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-4 shrink-0 text-center text-[11px] text-gray-400">{setIdx + 1}</span>
                      <SetStepper value={s.weight_lbs} step={5} placeholder="lbs" width="w-12"
                        onChange={v => updateSet(exIdx, setIdx, "weight_lbs", v)} />
                      <span className="text-[11px] text-gray-300">×</span>
                      <SetStepper value={s.reps} step={1} placeholder="reps" width="w-11"
                        onChange={v => updateSet(exIdx, setIdx, "reps", v)} />
                      <button onClick={() => toggleDone(exIdx, setIdx)} title="Mark set done"
                        className={`ml-auto w-7 h-7 rounded-md text-sm leading-none transition-colors flex items-center justify-center ${
                          s.done ? "bg-green-600 text-white" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                        }`}>✓</button>
                      <button onClick={() => removeSet(exIdx, setIdx)} title="Remove set"
                        className="w-4 text-gray-300 hover:text-red-400 text-sm leading-none">×</button>
                    </div>
                  ))}
                  <button onClick={() => addSet(exIdx)}
                    className="mt-1 w-full py-1 rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-colors">
                    + Add set
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-400">Duration (sec)</p>
                  <input type="number" min="10" step="5" placeholder="30"
                    value={ex.duration_sec || ""}
                    onChange={e => setExercises(prev => prev.map((x, i) => i === exIdx ? { ...x, duration_sec: parseInt(e.target.value) || 30 } : x))}
                    className="w-20 rounded-lg bg-white border border-gray-200 px-2 py-1.5 text-sm text-gray-900 text-center focus:outline-none focus:border-green-500" />
                  <span className="text-xs text-gray-400">each side</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Save as routine */}
      {exercises.length > 0 && (
        showSaveTpl ? (
          <div className="flex items-center gap-2">
            <input className={inp} placeholder="Routine name (e.g. Push Day)" value={tplName}
              onChange={e => setTplName(e.target.value)} />
            <button onClick={saveAsRoutine} disabled={savingTpl || !tplName.trim()}
              className="shrink-0 rounded-lg bg-[#1B3829] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {savingTpl ? "…" : "Save"}
            </button>
            <button onClick={() => { setShowSaveTpl(false); setTplName(""); }}
              className="shrink-0 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
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
          <p className="text-xs text-gray-400 mb-1">Duration (min)</p>
          <input className={inp} type="number" placeholder="45" value={duration}
            onChange={e => setDuration(e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Notes</p>
          <input className={inp} placeholder="Optional" value={notes}
            onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <button disabled={exercises.length === 0 || saving} onClick={save}
        className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] disabled:opacity-30 text-white text-sm font-semibold transition-colors">
        {saving ? "Saving…" : "Save workout"}
      </button>
    </div>
  );
}

// ── Stretch routine view ──────────────────────────────────────────────────────
function StretchRoutineView({ routine, onClose }: { routine: StretchRoutine; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest">Post-Workout Stretch</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{routine.total_min} min · {routine.exercises.length} exercises</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
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
            <p className="text-xs text-gray-400">{ex.muscle_group} · {ex.cue}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        Targets: {routine.muscle_groups.join(", ")}
      </p>
    </div>
  );
}

// ── Recent workouts ───────────────────────────────────────────────────────────
function RecentWorkouts({
  workouts,
  onDelete,
  onStretch,
}: {
  workouts: Workout[];
  onDelete: (id: string) => void;
  onStretch: (muscleGroups: string[]) => void;
}) {
  if (workouts.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center">
        <p className="text-gray-400 text-sm">No workouts logged yet</p>
        <p className="text-gray-300 text-xs mt-1">Log your first session above</p>
      </div>
    );
  }

  const sorted = [...workouts].sort((a, b) =>
    (b.logged_at || b.date).localeCompare(a.logged_at || a.date));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">Recent Workouts</p>
      <div className="space-y-2.5">
        {sorted.slice(0, 5).map(w => {
          const vol = w.total_volume_lbs;
          return (
            <div key={w.id} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE[w.type] ?? "bg-gray-100 text-gray-600"}`}>
                      {TYPE_ICON[w.type] ?? "💪"} {TYPE_LABEL[w.type] ?? w.type}
                    </span>
                    <span className="text-xs text-gray-400">{w.date}</span>
                  </div>
                  <p className="text-sm text-gray-700 capitalize">
                    {w.exercises.map(e => e.name).join(", ")}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
                    {w.duration_min ? <span>⏱ {w.duration_min} min</span> : null}
                    {vol && vol > 0 ? <span>📦 {vol.toLocaleString()} lbs vol</span> : null}
                    {w.muscle_groups.length > 0 && (
                      <span>{w.muscle_groups.slice(0, 3).map(m => m.replace("_", " ")).join(", ")}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => onDelete(w.id)} title="Delete workout"
                  className="text-gray-300 hover:text-red-400 text-lg leading-none transition-colors shrink-0">×</button>
              </div>

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
          <p className="text-xs text-gray-400 mb-1">Days / week</p>
          <select className={inp} value={s.days_per_week}
            onChange={e => setS({ ...s, days_per_week: parseInt(e.target.value) })}>
            {[3, 4, 5].map(n => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Goal</p>
          <select className={inp} value={s.goal}
            onChange={e => setS({ ...s, goal: e.target.value })}>
            <option value="general_fitness">General Fitness</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Hypertrophy</option>
          </select>
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-2">Available equipment</p>
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT.map(e => (
            <button key={e} onClick={() => toggleEquip(e)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                s.equipment.includes(e)
                  ? "bg-green-100 text-green-700 border border-green-300"
                  : "bg-gray-100 text-gray-400 border border-gray-200"
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
}: {
  autoOpenLogger?: boolean;
  onLoggerOpened?: () => void;
} = {}) {
  const [rec,          setRec]          = useState<TrainingRecommendation | null>(null);
  const [weeklyPlan,   setWeeklyPlan]   = useState<WeeklyPlan | null>(null);
  const [workouts,     setWorkouts]     = useState<Workout[]>([]);
  const [stretchR,     setStretchR]     = useState<StretchRoutine | null>(null);
  const [showLogger,   setShowLogger]   = useState(autoOpenLogger);
  const [showSettings, setShowSettings] = useState(false);
  const [loading,      setLoading]      = useState(true);

  // Quick-log from the Scorecard opens the logger straight away.
  useEffect(() => {
    if (autoOpenLogger) {
      setShowLogger(true);
      onLoggerOpened?.();
    }
  }, [autoOpenLogger, onLoggerOpened]);

  useEffect(() => {
    Promise.all([
      api.trainingRecommendation(),
      api.weeklyPlan(),
      api.workouts(30),
    ]).then(([r, p, w]) => {
      setRec(r);
      setWeeklyPlan(p);
      setWorkouts(w.workouts);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleWorkoutSaved = (w: Workout) => {
    setWorkouts(prev => [w, ...prev]);
    setShowLogger(false);
    // Refresh recommendation since training load changed
    api.trainingRecommendation().then(setRec).catch(() => {});
  };

  const handleDeleteWorkout = async (id: string) => {
    try {
      await api.deleteWorkout(id);
      setWorkouts(prev => prev.filter(w => w.id !== id));
    } catch (e) { console.error(e); }
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

      {/* Daily recommendation */}
      {rec && <RecCard rec={rec} />}

      {/* Weekly plan */}
      {weeklyPlan && <WeeklyPlanView plan={weeklyPlan} />}

      {/* Log workout toggle */}
      <button onClick={() => setShowLogger(!showLogger)}
        className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
          showLogger
            ? "border-gray-300 text-gray-500 hover:text-gray-800"
            : "border-green-600/50 bg-green-600/10 text-green-700 hover:bg-green-600/20"
        }`}>
        {showLogger ? "▲ Cancel" : "＋ Log a workout"}
      </button>

      {showLogger && <WorkoutLogger onSaved={handleWorkoutSaved} recentWorkouts={workouts} />}

      {/* Recent workouts */}
      <RecentWorkouts
        workouts={workouts}
        onDelete={handleDeleteWorkout}
        onStretch={handleStretch}
      />

      {/* Settings */}
      <div>
        <button onClick={() => setShowSettings(!showSettings)}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 text-sm font-medium transition-colors">
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
