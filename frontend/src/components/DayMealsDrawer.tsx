"use client";

/**
 * DayMealsDrawer — slide-up panel showing the meals logged on a specific date,
 * with inline edit + delete on each row.
 *
 * Triggered by tapping a bar in the Nutrition tab's 7-day chart. The chart
 * shows aggregates; this drawer is the drill-down.
 */

import { useEffect, useState } from "react";
import { api, Meal } from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface Props {
  date:    string;          // YYYY-MM-DD
  onClose: () => void;
  onChanged: () => void;    // parent should refetch the weekly summary
}

interface EditDraft {
  name:     string;
  calories: string;   // text inputs use strings — coerce on save
  protein:  string;
  carbs:    string;
  fat:      string;
}

function fmt(date: string): string {
  // "2026-05-29" → "Thu May 29"
  try {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return date; }
}

function toDraft(m: Meal): EditDraft {
  return {
    name:     m.name,
    calories: String(m.calories ?? 0),
    protein:  String(m.protein  ?? 0),
    carbs:    String(m.carbs    ?? 0),
    fat:      String(m.fat      ?? 0),
  };
}

export default function DayMealsDrawer({ date, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [meals,   setMeals]   = useState<Meal[]>([]);
  const [editing, setEditing] = useState<string | null>(null);   // meal_id being edited
  const [draft,   setDraft]   = useState<EditDraft | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    setLoading(true);
    api.nutritionToday(date)
      .then(d => setMeals(d.meals || []))
      .catch(() => setMeals([]))
      .finally(() => setLoading(false));
  }, [date]);

  // Totals (computed from current meals so they reflect edits/deletes instantly)
  const totals = meals.reduce(
    (t, m) => ({
      calories: t.calories + (m.calories || 0),
      protein:  t.protein  + (m.protein  || 0),
      carbs:    t.carbs    + (m.carbs    || 0),
      fat:      t.fat      + (m.fat      || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const handleStartEdit = (m: Meal) => {
    setEditing(m.id);
    setDraft(toDraft(m));
  };

  const handleCancelEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const handleSave = async (mealId: string) => {
    if (!draft) return;
    const patch = {
      name:     draft.name.trim() || "Meal",
      calories: Number(draft.calories) || 0,
      protein:  Number(draft.protein)  || 0,
      carbs:    Number(draft.carbs)    || 0,
      fat:      Number(draft.fat)      || 0,
    };
    setSaving(true);
    try {
      const updated = await api.updateMeal(mealId, patch);
      setMeals(prev => prev.map(m => (m.id === mealId ? updated : m)));
      handleCancelEdit();
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mealId: string) => {
    try {
      await api.deleteMeal(mealId, date);
      setMeals(prev => prev.filter(m => m.id !== mealId));
      setPendingDelete(null);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[85vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide">Meal log</p>
            <h2 className="text-lg font-bold text-gray-900">{fmt(date)}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Totals strip */}
        <div className="grid grid-cols-4 gap-2 px-5 py-3 bg-gray-50 border-b border-gray-200 text-center">
          {[
            { l: "Cal",      v: Math.round(totals.calories), u: "" },
            { l: "Protein",  v: totals.protein.toFixed(1),   u: "g" },
            { l: "Carbs",    v: totals.carbs.toFixed(1),     u: "g" },
            { l: "Fat",      v: totals.fat.toFixed(1),       u: "g" },
          ].map(({ l, v, u }) => (
            <div key={l}>
              <p className="text-[10px] text-gray-600 uppercase tracking-wide">{l}</p>
              <p className="text-sm font-bold text-gray-900">{v}<span className="text-xs text-gray-600 font-normal">{u}</span></p>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <p className="text-sm text-gray-600 text-center py-8">Loading…</p>
          ) : meals.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-8">No meals logged on this day.</p>
          ) : meals.map(m => {
            const isEditing = editing === m.id;
            const isPendingDelete = pendingDelete === m.id;
            return (
              <div key={m.id} className="rounded-xl border border-gray-200 bg-white">
                {isEditing && draft ? (
                  <div className="p-3 space-y-2">
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Meal name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-green-500"
                    />
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        ["calories", "Cal"],
                        ["protein",  "P (g)"],
                        ["carbs",    "C (g)"],
                        ["fat",      "F (g)"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          <label className="block text-[10px] text-gray-600 mb-1">{label}</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={draft[key]}
                            onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:border-green-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="accent" className="flex-1" onClick={() => handleSave(m.id)} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button variant="secondary" className="flex-1" onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                      <p className="text-xs text-gray-600">
                        {Math.round(m.calories)} kcal · P {m.protein}g · C {m.carbs}g · F {m.fat}g
                      </p>
                    </div>
                    {isPendingDelete ? (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setPendingDelete(null)}
                          className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-900 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleStartEdit(m)}
                          className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium"
                          aria-label="Edit meal"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setPendingDelete(m.id)}
                          className="px-2 py-1 rounded text-red-600 hover:bg-red-50 text-xs font-medium"
                          aria-label="Delete meal"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-[11px] text-gray-600 text-center">
            Edits update the 7-day chart and average automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
