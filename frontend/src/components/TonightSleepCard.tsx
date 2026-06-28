"use client";

/**
 * TonightSleepCard — Tonight's Sleep prescription for the Scorecard (Sleep
 * view).
 *
 * Forward-looking companion to the Morning Briefing's backward-looking
 * recap. Answers "what should I do tonight?" with three concrete things:
 *
 *   1. A bedtime window (wind-down → lights-out → expected wake)
 *   2. Where you stand on sleep debt + streak — context that influences how
 *      hard to lean into the recommendation
 *   3. A one-line Coach Al voice note tying it all together
 *
 * Renders nothing if Oura history is sparse — we'd rather not say anything
 * than fabricate a bedtime from no data. Mirrors the Today's Workout +
 * NutritionCoachCard visual treatment so coaching surfaces feel of-a-piece.
 */

import { useEffect, useState } from "react";
import { api, type TonightSleepPayload, type SleepDebtDebug, type OuraRawDebug } from "@/lib/api";

interface Props {
  /** Optional — when provided, an "Ask Coach Al" link appears in the
   *  card footer and opens the chat drawer pre-seeded with a contextual
   *  question about tonight's bedtime, sleep debt, or the streak. */
  onAsk?: (seed: string) => void;
}

export default function TonightSleepCard({ onAsk }: Props = {}) {
  const [data,    setData]    = useState<TonightSleepPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Debug viewer state — shown when the user taps the small "Debug" link.
  // Lets us inspect what's actually in our cache vs. what Oura's app shows.
  const [debugOpen, setDebugOpen] = useState(false);
  const [debug,     setDebug]     = useState<SleepDebtDebug | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  // Raw Oura API pull — separate from our cache so we can verify what
  // Oura is actually sending us (was: late_nap missing? sleep_need
  // missing?).
  const [ouraRaw,        setOuraRaw]        = useState<OuraRawDebug | null>(null);
  const [ouraRawLoading, setOuraRawLoading] = useState(false);
  // Sleep target editing
  const [sleepTargetInput, setSleepTargetInput] = useState("");
  const [savingTarget,     setSavingTarget]     = useState(false);
  const [savedTarget,      setSavedTarget]      = useState(false);

  useEffect(() => {
    api.tonightSleep()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const fresh = await api.tonightSleep({ refresh: true });
      setData(fresh);
      // If the debug viewer is open, re-fetch its breakdown too so it
      // reflects the freshly-pulled values.
      if (debugOpen) {
        try { setDebug(await api.sleepDebtDebug()); } catch {}
      }
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  };

  const openDebug = async () => {
    setDebugOpen(true);
    if (debug) return;
    setDebugLoading(true);
    try {
      setDebug(await api.sleepDebtDebug());
    } catch { /* silent */ }
    finally { setDebugLoading(false); }
  };

  const loadOuraRaw = async () => {
    setOuraRawLoading(true);
    try {
      setOuraRaw(await api.ouraRawDebug());
    } catch (e) {
      setOuraRaw({ error: e instanceof Error ? e.message : "Couldn't reach Oura" });
    }
    finally { setOuraRawLoading(false); }
  };

  const saveSleepTarget = async () => {
    const hrs = parseFloat(sleepTargetInput);
    if (!Number.isFinite(hrs) || hrs < 4 || hrs > 12) return;
    setSavingTarget(true); setSavedTarget(false);
    try {
      await api.setSleepTarget(hrs);
      setSavedTarget(true);
      // Force a debt recompute by refreshing the breakdown.
      const fresh = await api.sleepDebtDebug();
      setDebug(fresh);
      // And refresh the card itself so the displayed debt updates.
      const card = await api.tonightSleep();
      setData(card);
    } catch { /* silent */ }
    finally { setSavingTarget(false); }
  };

  // Format helpers for the debug rows
  const secToHrs = (s: number | null | undefined): string =>
    s == null ? "—" : (s / 3600).toFixed(2) + "h";

  if (loading || !data) return null;
  // If neither bedtime, streak, debt, nor last-night data exist, the card
  // would say nothing useful — skip it entirely.
  // Stricter render gate: only show the card when it actually adds value.
  // The bar: a real bedtime recommendation, a meaningful balance signal,
  // OR a multi-night streak worth celebrating. last_night was just a raw
  // duplicate of Oura's number and no longer factors. balance "unknown"
  // means Oura didn't return a sleep_balance score — don't show the card
  // just to render the generic 'aim for Xh' fallback.
  const hasBedtime  = !!data.bedtime;
  const hasBalance  = !!data.balance && data.balance.key !== "unknown";
  const hasStreak   = data.streak_nights >= 2;
  const hasContent  = hasBedtime || hasBalance || hasStreak;
  if (!hasContent) return null;

  // Tailwind tone palette for the balance pill — keeps the visual loud
  // when the user is in deficit, quiet when well-rested.
  const balanceClass = (tone: string | undefined): string => {
    switch (tone) {
      case "good":    return "bg-emerald-100 text-emerald-800 border border-emerald-200";
      case "ok":      return "bg-indigo-100 text-indigo-800 border border-indigo-200";
      case "warn":    return "bg-amber-100 text-amber-900 border border-amber-300";
      case "alert":   return "bg-rose-100 text-rose-800 border border-rose-300";
      default:        return "bg-gray-100 text-gray-700 border border-gray-200";
    }
  };
  const balanceEmoji = (key: string | undefined): string => {
    switch (key) {
      case "well_rested":     return "✅";
      case "running_flat":    return "🟦";
      case "running_on_fumes":return "⚠️";
      case "sleep_deficit":   return "🛑";
      default:                return "💤";
    }
  };

  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#0f172a] to-[#1e3a5f] p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">
            Coach Al · tonight&apos;s sleep
          </p>
          <h3 className="text-base font-bold text-white leading-tight mt-0.5">
            {data.bedtime
              ? <>Lights out by {data.bedtime.lights_out}</>
              : <>Aim for {data.target_hours.toFixed(0)}h tonight</>}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {data.streak_nights > 1 && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/90 text-amber-900"
              title={`${data.streak_nights} consecutive nights ≥ 7h and ≥85% efficiency`}
            >
              🔥 {data.streak_nights} night streak
            </span>
          )}
          {/* Manual refresh — pulls fresh data from Oura's API right now.
              Important on mornings when you've synced the ring twice (5am
              wake → back to bed → 9am wake): the second session may not
              appear in our 30-min cache window otherwise. */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-indigo-200 hover:text-white text-xs px-1 py-0.5 transition-colors disabled:opacity-50"
            aria-label="Refresh sleep data from Oura"
            title="Pull fresh data from Oura (useful after a split-sleep night)"
          >
            {refreshing ? "⟳" : "↻"}
          </button>
        </div>
      </div>

      {/* Bedtime window */}
      {data.bedtime && (
        <div className="rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-2.5 mb-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Wind down</p>
              <p className="text-sm font-bold text-white">{data.bedtime.wind_down_start}</p>
            </div>
            <span className="text-indigo-200/60 shrink-0">→</span>
            <div className="flex-1 min-w-0 text-center">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Lights out</p>
              <p className="text-sm font-bold text-white">{data.bedtime.lights_out}</p>
            </div>
            <span className="text-indigo-200/60 shrink-0">→</span>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Wake</p>
              <p className="text-sm font-bold text-white">{data.bedtime.target_wake}</p>
            </div>
          </div>
          {data.bedtime.earlier_for_training && (
            <p className="text-[10px] text-amber-200 italic mt-1.5">
              Shifted 30 min earlier — heavy training tomorrow.
            </p>
          )}
        </div>
      )}

      {/* Context chips: debt + last night */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.balance && data.balance.key !== "unknown" && (
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded-lg ${balanceClass(data.balance.tone)}`}
            title={
              data.balance_score != null
                ? `Oura sleep balance score: ${data.balance_score}/100. ${data.balance.summary}`
                : data.balance.summary
            }
          >
            {balanceEmoji(data.balance.key)} {data.balance.label}
          </span>
        )}
        {/* Last Night pill removed. It was a raw duplicate of what Oura's
            own app shows, and any visible disagreement (API lag, methodology
            differences, genuine drift) made us look broken even when we
            were technically correct. Users have Oura's app for raw numbers;
            our value is the prescription, the streak, the balance signal,
            and Coach Al's read across pillars. */}
        {data.tomorrow_intensity && data.tomorrow_intensity !== "rest" && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-lg bg-indigo-100 text-indigo-900 border border-indigo-200 capitalize">
            Tomorrow: {data.tomorrow_intensity}
          </span>
        )}
      </div>

      {/* Coach voice note + Ask Coach Al handoff */}
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm text-white leading-snug italic flex-1">
          &ldquo;{data.coach_note}&rdquo;
        </p>
        <button
          onClick={openDebug}
          className="shrink-0 text-[10px] text-indigo-300 hover:text-white underline self-end"
          title="See exactly what's in our cache vs. what Oura shows"
        >
          debug
        </button>
        {onAsk && (
          <button
            onClick={() => {
              // Seed the chat with whichever angle is most useful: deficit
              // → recovery question, training tomorrow → why earlier,
              // streak → keep it going, otherwise just open with the
              // bedtime question.
              let seed = "What should tonight's sleep look like for me?";
              const bk = data.balance?.key;
              if (bk === "sleep_deficit" || bk === "running_on_fumes") {
                seed = `My sleep balance is "${data.balance?.label}". How do I recover this week?`;
              } else if (data.bedtime?.earlier_for_training) {
                seed = "Why is tonight's lights-out earlier than usual?";
              } else if (data.streak_nights >= 3) {
                seed = `I'm on a ${data.streak_nights}-night sleep streak — anything I should change tonight?`;
              } else if (data.bedtime?.lights_out) {
                seed = `Why ${data.bedtime.lights_out} as tonight's lights-out?`;
              }
              onAsk(seed);
            }}
            className="shrink-0 text-[11px] font-semibold text-indigo-200 hover:text-white hover:underline transition-colors whitespace-nowrap"
          >
            💬 Ask Coach Al
          </button>
        )}
      </div>

      {/* ── Debug viewer modal ──────────────────────────────────────────
          Triggered by the small "debug" link. Shows the per-night cache
          values + math so the user can compare against the Oura app and
          tell us exactly where any remaining drift is coming from. */}
      {debugOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDebugOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-[#1B3829]">Sleep debt · debug</p>
                <h2 className="text-base font-bold text-gray-900 leading-tight">What our cache sees vs. your Oura app</h2>
              </div>
              <button
                onClick={() => setDebugOpen(false)}
                className="shrink-0 text-gray-500 hover:text-gray-900 text-2xl leading-none px-1"
                aria-label="Close"
              >×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {debugLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                </div>
              )}
              {!debugLoading && debug && (
                <>
                  {/* Parser version banner — verifies which deploy is live */}
                  <div className="rounded-lg border border-[#1B3829]/30 bg-[#1B3829]/5 px-3 py-1.5 text-[11px] text-[#1B3829] font-mono">
                    parser: <span className="font-semibold">{debug.version || "(unknown — old deploy)"}</span>
                  </div>

                  {/* Personal sleep need setter — overrides the static 8h
                      target until Oura's per-night sleep_need is in our
                      cache. Set this to whatever your Oura app shows as
                      your nightly need (e.g. 6.82 for 6h 49m). */}
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1">
                    <p className="text-[11px] font-semibold text-amber-900">⚡ Set your personal sleep need</p>
                    <p className="text-[10px] text-amber-900 leading-snug">
                      Right now we&apos;re using {debug.static_target_h}h as your target on every night Oura doesn&apos;t send per-night need. Override here with what your Oura app says (e.g. 6.82 for 6h 49m).
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" step="0.01" min={4} max={12}
                        placeholder={`current: ${debug.static_target_h}`}
                        value={sleepTargetInput}
                        onChange={e => setSleepTargetInput(e.target.value)}
                        className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-amber-500"
                      />
                      <span className="text-[10px] text-amber-900">hours / night</span>
                      <button
                        onClick={saveSleepTarget}
                        disabled={savingTarget || !sleepTargetInput.trim()}
                        className="ml-auto text-xs font-semibold px-2.5 py-1 rounded bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-40"
                      >
                        {savingTarget ? "…" : savedTarget ? "✓ Saved" : "Save"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 space-y-0.5">
                    <p><span className="font-semibold">Reported debt:</span> {debug.reported_debt_h ?? "—"} h</p>
                    <p><span className="font-semibold">Capped sum:</span> {debug.capped_sum_h} h · <span className="font-semibold">Raw sum:</span> {debug.raw_sum_h} h</p>
                    <p><span className="font-semibold">Window:</span> last {debug.window_nights} nights · <span className="font-semibold">Caps:</span> deficit {debug.per_night_caps_h.deficit}h, surplus {debug.per_night_caps_h.surplus}h/night</p>
                    <p><span className="font-semibold">Static target:</span> {debug.static_target_h}h (used when Oura&apos;s sleep_need is missing)</p>
                  </div>

                  <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-700">Per-night cache</p>
                  <div className="space-y-2">
                    {debug.nights.length === 0 && (
                      <p className="text-xs text-gray-600 italic">No cached nights in the window. Tap the ↻ refresh on the card to pull fresh data from Oura.</p>
                    )}
                    {debug.nights.map(n => (
                      <div key={n.date} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <p className="font-semibold text-gray-900">{n.date}</p>
                          <p className={`font-mono ${n.raw_gap_h > 0 ? "text-rose-700" : n.raw_gap_h < 0 ? "text-emerald-700" : "text-gray-600"}`}>
                            gap: {n.raw_gap_h > 0 ? "+" : ""}{n.raw_gap_h.toFixed(2)}h
                            {n.raw_gap_h !== n.capped_gap_h && <> → capped {n.capped_gap_h > 0 ? "+" : ""}{n.capped_gap_h.toFixed(2)}h</>}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-700">
                          <p>Actual: <span className="font-mono text-gray-900">{n.actual_h.toFixed(2)}h</span></p>
                          <p>Need:   <span className="font-mono text-gray-900">{n.need_h.toFixed(2)}h ({n.source})</span></p>
                          {n.raw_cache && (
                            <>
                              {n.raw_cache.efficiency != null && <p>Eff: <span className="font-mono">{n.raw_cache.efficiency}%</span></p>}
                              {n.raw_cache.deep_sec != null && <p>Deep: <span className="font-mono">{secToHrs(n.raw_cache.deep_sec)}</span></p>}
                              {n.raw_cache.rem_sec != null && <p>REM: <span className="font-mono">{secToHrs(n.raw_cache.rem_sec)}</span></p>}
                              {n.raw_cache.awake_sec != null && <p>Awake: <span className="font-mono">{secToHrs(n.raw_cache.awake_sec)}</span></p>}
                            </>
                          )}
                        </div>
                        {n.raw_cache?.bedtime_start && (
                          <p className="text-[10px] text-gray-500 mt-1 font-mono">bedtime_start: {n.raw_cache.bedtime_start}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-600 italic">{debug.note}</p>
                  <p className="text-[10px] text-gray-700 leading-snug">
                    <span className="font-semibold">How to use this:</span> Compare each night&apos;s <span className="font-mono">Actual</span>
                    {" "}to what your Oura app shows for the same date. If our number is lower, our cache is missing a session (likely a
                    late_nap that hadn&apos;t synced when we last pulled). Tap the ↻ on the card to force a fresh pull, then reopen this.
                  </p>

                  {/* Live Oura raw dump — bypasses our cache entirely.
                      Shows exactly what Oura is sending us. If there's no
                      late_nap or no sleep_need here, no parser tweak fixes
                      it — the data isn't being sent by Oura. */}
                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-700">Raw from Oura&apos;s API</p>
                      <button
                        onClick={loadOuraRaw}
                        disabled={ouraRawLoading}
                        className="text-xs font-medium text-[#1B3829] hover:underline disabled:opacity-50"
                      >
                        {ouraRawLoading ? "Loading…" : ouraRaw ? "↻ Re-pull" : "Pull live from Oura"}
                      </button>
                    </div>

                    {ouraRaw?.error && (
                      <p className="text-[11px] text-rose-700 mt-1">{ouraRaw.error}</p>
                    )}

                    {ouraRaw && !ouraRaw.error && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] text-gray-600 font-mono">
                          server parser_version: <span className="font-semibold">{ouraRaw.parser_version || "?"}</span> · {ouraRaw.session_count ?? 0} total sleep records in last 3 days
                        </p>
                        {(ouraRaw.sessions || []).length === 0 && (
                          <p className="text-[11px] text-gray-600 italic">Oura returned no sleep records for the last 3 days.</p>
                        )}
                        {(ouraRaw.sessions || []).map((s, i) => (
                          <div key={i} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-mono">
                            <p>
                              <span className="font-semibold">{s.day}</span> · type=<span className="font-semibold">{s.type}</span> · total=<span className={`font-semibold ${s.type === "late_nap" ? "text-amber-700" : ""}`}>{s.total_sleep_h ?? "?"}h</span> · eff={s.efficiency ?? "?"}%
                            </p>
                            <p className="text-gray-600">
                              bed: {s.bedtime_start?.slice(11, 16) || "?"} → {s.bedtime_end?.slice(11, 16) || "?"}
                            </p>
                            <p className="text-gray-600">
                              sleep_need_raw: <span className={typeof s.sleep_need_raw === "object" && s.sleep_need_raw !== null ? "text-emerald-700 font-semibold" : "text-rose-700"}>
                                {s.sleep_need_raw === null || s.sleep_need_raw === undefined
                                  ? "MISSING"
                                  : JSON.stringify(s.sleep_need_raw)}
                              </span>
                            </p>
                          </div>
                        ))}
                        <p className="text-[10px] text-gray-600 italic mt-1">{ouraRaw.note}</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between gap-2">
              <button
                onClick={async () => {
                  setDebugLoading(true);
                  try { setDebug(await api.sleepDebtDebug()); } catch {}
                  finally { setDebugLoading(false); }
                }}
                disabled={debugLoading}
                className="text-xs font-medium text-[#1B3829] hover:underline disabled:opacity-50"
              >
                {debugLoading ? "Reloading…" : "↻ Reload breakdown"}
              </button>
              <button
                onClick={async () => {
                  await handleRefresh();
                  setDebugLoading(true);
                  try { setDebug(await api.sleepDebtDebug()); } catch {}
                  finally { setDebugLoading(false); }
                }}
                disabled={refreshing || debugLoading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white disabled:opacity-50"
              >
                {refreshing ? "Pulling Oura…" : "↻ Force pull from Oura"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
