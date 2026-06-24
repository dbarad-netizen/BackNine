"use client";

/**
 * SystemTemplatesBrowser — curated workout-program library.
 *
 * Lives inside the Training tab. Two states:
 *   • Collapsed: a small "📚 Browse programs" pill
 *   • Expanded: list of curated programs (PPL, 5/3/1, Tactical Barbell,
 *     etc.). Tap a program → details (description, sessions). Tap a
 *     session → calls `onStartSession(exerciseNames)` which the parent
 *     uses to seed the WorkoutLogger.
 *
 * Backend serves the catalog from `system_templates.py` (static data),
 * so no DB churn when we iterate on the library.
 *
 * Persona note: the programs tilt toward strength + sustainability for
 * the men-50+ demo. Each card also includes a "Why this works after 50"
 * blurb because the demo cares about that framing.
 */

import { useEffect, useState } from "react";
import { api, type SystemWorkoutTemplate } from "@/lib/api";

interface Props {
  onStartSession: (sessionName: string, exercises: string[]) => void;
}

export default function SystemTemplatesBrowser({ onStartSession }: Props) {
  const [expanded, setExpanded]   = useState(false);
  const [templates, setTemplates] = useState<SystemWorkoutTemplate[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [openId, setOpenId]       = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || templates.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    api.systemTemplates()
      .then(r => setTemplates(r.templates))
      .catch(e => setError(e instanceof Error ? e.message : "Couldn't load programs"))
      .finally(() => setLoading(false));
  }, [expanded, templates.length, loading]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full py-2 rounded-lg border border-[#1B3829]/25 bg-white text-xs font-medium text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors flex items-center justify-center gap-1.5"
      >
        📚 Browse programs · curated for strength + longevity
      </button>
    );
  }

  return (
    <section className="rounded-2xl border border-[#1B3829]/20 bg-[#1B3829]/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#1B3829] uppercase tracking-wide">📚 Workout Programs</p>
        <button
          onClick={() => { setExpanded(false); setOpenId(null); }}
          className="text-[11px] text-gray-600 hover:text-gray-900 transition-colors"
        >
          Hide
        </button>
      </div>

      {loading && <p className="text-xs text-gray-600 italic">Loading…</p>}
      {error   && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && templates.length > 0 && (
        <ul className="space-y-2">
          {templates.map(t => (
            <li key={t.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <button
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      <span className="inline-block rounded-full bg-[#1B3829]/10 text-[#1B3829] px-1.5 py-0.5 text-[10px] font-medium mr-1.5">{t.tag}</span>
                      {t.level} · {t.days_per_week}× / week
                    </p>
                  </div>
                  <span className="text-gray-600 text-xs shrink-0">{openId === t.id ? "▴" : "▾"}</span>
                </div>
              </button>

              {openId === t.id && (
                <div className="border-t border-gray-100 px-3 py-3 space-y-3 bg-gray-50">
                  <p className="text-xs text-gray-700 leading-relaxed">{t.summary}</p>
                  {t.why_for_50 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-0.5">Why this works after 50</p>
                      <p className="text-[11px] text-amber-900 leading-snug">{t.why_for_50}</p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest">Sessions</p>
                    {t.sessions.map((s, idx) => (
                      <div key={`${t.id}-${idx}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-xs font-semibold text-gray-900">{s.name}</p>
                          <button
                            onClick={() => onStartSession(s.name, s.exercises)}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors shrink-0"
                            title="Start this session — seeds the workout below with these exercises"
                          >
                            ▶ Start
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-700 leading-snug">{s.exercises.join(" · ")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
