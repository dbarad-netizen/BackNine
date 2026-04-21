"use client";

/**
 * ProfileModal — slide-in modal for editing user health profile.
 *
 * Collects age, biological sex, and health goals.
 * Saves to /api/profile (Supabase user_profiles table via backend).
 */

import { useState, useEffect } from "react";
import { api, type UserProfile } from "@/lib/api";

const GOAL_OPTIONS = [
  { id: "longevity",      label: "Longevity",         icon: "🧬" },
  { id: "weight_loss",    label: "Weight Loss",        icon: "⚖️" },
  { id: "muscle_gain",    label: "Muscle Gain",        icon: "💪" },
  { id: "better_sleep",   label: "Better Sleep",       icon: "😴" },
  { id: "stress_reduce",  label: "Reduce Stress",      icon: "🧘" },
  { id: "cardio",         label: "Cardio Fitness",     icon: "🏃" },
  { id: "energy",         label: "More Energy",        icon: "⚡" },
  { id: "nutrition",      label: "Improve Nutrition",  icon: "🥗" },
];

interface Props {
  onClose: () => void;
}

export default function ProfileModal({ onClose }: Props) {
  const [profile,  setProfile]  = useState<UserProfile>({ age: null, biological_sex: null, health_goals: [] });
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Load existing profile on mount
  useEffect(() => {
    api.getProfile()
      .then(p => setProfile({ age: p.age ?? null, biological_sex: p.biological_sex ?? null, health_goals: p.health_goals ?? [] }))
      .catch(() => {}) // empty profile if none saved yet
      .finally(() => setLoading(false));
  }, []);

  const toggleGoal = (id: string) => {
    setProfile(prev => {
      const goals = prev.health_goals ?? [];
      return {
        ...prev,
        health_goals: goals.includes(id) ? goals.filter(g => g !== id) : [...goals, id],
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(profile);
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const inp = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 mx-auto max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900">Health Profile</p>
            <p className="text-xs text-gray-400 mt-0.5">Personalizes your longevity score &amp; AI coaching</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-3">✕</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-7 w-7 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5 max-h-[60vh] overflow-y-auto">

            {/* Age */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Age</label>
              <input
                type="number"
                min={10}
                max={120}
                placeholder="e.g. 42"
                className={inp}
                value={profile.age ?? ""}
                onChange={e => setProfile(prev => ({ ...prev, age: parseInt(e.target.value) || null }))}
              />
              <p className="text-[10px] text-gray-400 mt-1">Used to age-adjust your HRV norms and longevity score.</p>
            </div>

            {/* Biological sex */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Biological Sex</label>
              <div className="flex gap-2">
                {(["male", "female"] as const).map(sex => (
                  <button
                    key={sex}
                    onClick={() => setProfile(prev => ({ ...prev, biological_sex: sex }))}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                      profile.biological_sex === sex
                        ? "bg-[#1B3829] text-white border-[#1B3829]"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {sex === "male" ? "♂ Male" : "♀ Female"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Used for body fat and VO2 max reference ranges.</p>
            </div>

            {/* Health goals */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                Health Goals <span className="normal-case font-normal text-gray-400">(pick any)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {GOAL_OPTIONS.map(({ id, label, icon }) => {
                  const selected = (profile.health_goals ?? []).includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleGoal(id)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors border ${
                        selected
                          ? "bg-[#1B3829]/8 border-[#1B3829]/40 text-[#1B3829]"
                          : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"
                      }`}
                      style={selected ? { backgroundColor: "rgba(27,56,41,0.08)", borderColor: "rgba(27,56,41,0.4)" } : undefined}
                    >
                      <span className="text-base leading-none">{icon}</span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Profile"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
