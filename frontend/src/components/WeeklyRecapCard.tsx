"use client";

/**
 * WeeklyRecapCard — end-of-week celebration card on the Scorecard.
 *
 * Shows from Saturday onward through Tuesday so people who don't open the
 * app every day still see it. Pulls the past 7 days across Training,
 * Nutrition, and Sleep into one shareable summary plus a Coach Al voice
 * headline. The user can share into the PulseFeed in one tap — the
 * resulting friend_event becomes UGC that drives friend engagement and
 * re-opens.
 *
 * Renders nothing when the week is empty (no workouts, no meals, no
 * sleep) so the Scorecard stays clean for new users.
 */

import { useEffect, useState } from "react";
import { api, type WeeklyRecap } from "@/lib/api";

interface Props {
  /** Optional ISO date anchor — defaults to current week. */
  weekAnchor?: string;
  /** Open the chat with a contextual seed. Optional. */
  onAsk?: (seed: string) => void;
}

// Decide whether the recap is "in season" — i.e. now is Sat-Tue or the user
// is looking at last week. The card is visible all week, but we suppress it
// on Wednesday-Friday of the CURRENT week (too early to celebrate).
function inSeason(recap: WeeklyRecap): boolean {
  if (!recap.is_current_week) return true;
  const today = new Date();
  const dow = today.getDay(); // 0=Sun .. 6=Sat
  // Sat (6) and Sun (0) and Mon (1) and Tue (2) — celebration window.
  return dow === 6 || dow === 0 || dow === 1 || dow === 2;
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sLabel = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const eLabel = e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${sLabel} – ${eLabel}`;
}

export default function WeeklyRecapCard({ weekAnchor, onAsk }: Props = {}) {
  const [recap,    setRecap]    = useState<WeeklyRecap | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [sharing,  setSharing]  = useState(false);
  const [shared,   setShared]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [extBusy,  setExtBusy]  = useState(false);
  const [extToast, setExtToast] = useState<string | null>(null);

  useEffect(() => {
    api.weeklyRecap(weekAnchor)
      .then(setRecap)
      .catch(() => setRecap(null))
      .finally(() => setLoading(false));
  }, [weekAnchor]);

  if (loading || !recap) return null;
  if (!recap.has_content) return null;
  if (dismissed) return null;
  if (!inSeason(recap)) return null;

  const t = recap.training;
  const n = recap.nutrition;
  const s = recap.sleep;

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true); setError(null);
    try {
      await api.shareWeeklyRecap(weekAnchor);
      setShared(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share — try again in a moment.");
    } finally {
      setSharing(false);
    }
  };

  /**
   * External share — Twitter / LinkedIn / iMessage. Uses navigator.share
   * on devices that support it (iOS/Android open the native sheet), and
   * falls back to clipboard copy elsewhere. The share_text already
   * embeds the referral URL, so any signup that clicks through gets
   * credited to the user via the standard referral loop.
   */
  const handleShareExternal = async () => {
    if (extBusy) return;
    setExtBusy(true); setError(null); setExtToast(null);
    try {
      const { share_text, share_url } = await api.shareWeeklyRecapExternal(weekAnchor);
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        try {
          await nav.share({ text: share_text, url: share_url });
          setExtToast("Shared.");
        } catch {
          // User canceled — no error state.
        }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(share_text);
        setExtToast("Copied — paste into Twitter, LinkedIn, or a text.");
      } else {
        // Very old browser fallback: dump into a prompt.
        window.prompt("Copy this to share:", share_text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prepare a share link — try again.");
    } finally {
      setExtBusy(false);
    }
  };

  // The recap leans on bright accent colors per pillar so each stat card is
  // visually scannable. Same color language as the training-load cards and
  // the tonight's-sleep card.
  return (
    <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800">
            {/* Fable v2 Sunday Scorecard ritual: on Sunday itself the
                weekly recap becomes a named ritual. Same card, sharper
                framing for the weekly rhythm. */}
            {new Date().getDay() === 0 ? "Coach Al · Sunday Scorecard" : "Coach Al · weekly recap"}
          </p>
          <h3 className="text-base font-bold text-gray-900 leading-tight mt-0.5">
            {recap.is_current_week ? "This week" : "Last week"} · {fmtRange(recap.week_start, recap.week_end)}
          </h3>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-gray-500 hover:text-gray-900 text-lg leading-none px-1"
          aria-label="Hide"
          title="Hide this recap"
        >×</button>
      </div>

      {/* Headline + highlight */}
      <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 mb-3">
        <p className="text-sm text-gray-900 leading-snug font-medium">{recap.headline}</p>
        {recap.highlight && (
          <p className="text-[12px] text-amber-800 font-semibold mt-1">{recap.highlight}</p>
        )}
      </div>

      {/* Three pillar stat cards */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg border border-emerald-200 bg-white px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-800">Training</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-0.5">
            {t.workouts}<span className="text-[10px] font-normal text-gray-600 ml-1">sessions</span>
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {t.pr_count > 0 ? <>🏆 {t.pr_count} PR{t.pr_count === 1 ? "" : "s"}</>
              : t.lifting_volume_lbs > 0
                ? <>{t.lifting_volume_lbs.toLocaleString()} lb vol</>
                : t.cardio_min > 0
                  ? <>{t.cardio_min} min cardio</>
                  : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-white px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-800">Nutrition</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-0.5">
            {n.days_logged}<span className="text-[10px] font-normal text-gray-600 ml-1">days</span>
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {n.protein_days > 0 ? <>🥩 {n.protein_days}/{n.days_logged} on protein</>
              : n.avg_protein
                ? <>~{n.avg_protein}g avg protein</>
                : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-sky-800">Sleep</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-0.5">
            {s.avg_hours ? <>{s.avg_hours.toFixed(1)}<span className="text-[10px] font-normal text-gray-600 ml-1">h avg</span></> : "—"}
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {s.streak_nights > 0
              ? <>🔥 {s.streak_nights} good nights</>
              : s.nights_logged > 0
                ? <>{s.nights_logged} nights logged</>
                : "—"}
          </p>
        </div>
      </div>

      {/* Sunday Scorecard ritual — next week plan + one experiment.
          These give the recap its forward half: "what's the plan, and
          what one thing should I try?" Renders quietly when the fields
          are absent so we never fake action guidance. */}
      {(recap.next_week_plan || recap.experiment) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 mb-3">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-800 mb-1">
            Next week
          </p>
          {recap.next_week_plan && (
            <p className="text-[13px] text-gray-900 leading-snug">{recap.next_week_plan}</p>
          )}
          {recap.experiment && (
            <p className="text-[12px] text-emerald-900 leading-snug mt-1.5">
              <span className="font-semibold">One experiment:</span> {recap.experiment}
            </p>
          )}
        </div>
      )}

      {/* PR list — only render when there's something to brag about */}
      {t.prs.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-3">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-1">
            New PRs this week
          </p>
          <ul className="text-[12px] text-gray-900 space-y-0.5">
            {t.prs.map((pr, i) => (
              <li key={i} className="capitalize">🏆 {pr}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {!shared ? (
          <button
            onClick={handleShare}
            disabled={sharing}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] text-white transition-colors disabled:opacity-40"
          >
            {sharing ? "Sharing…" : "📣 Share with friends"}
          </button>
        ) : (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
            ✓ Shared to your friends&apos; feed
          </span>
        )}
        {/* External share — Twitter/LinkedIn/text. Referral URL is
            embedded in the copy the backend generates. */}
        <button
          onClick={handleShareExternal}
          disabled={extBusy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#1B3829]/25 text-[#1B3829] hover:bg-[#1B3829]/5 transition-colors disabled:opacity-40"
          title="Share to Twitter, LinkedIn, or a text — with your referral link"
        >
          {extBusy ? "Preparing…" : "🔗 Share externally"}
        </button>
        {onAsk && (
          <button
            onClick={() => {
              const seed = recap.highlight
                ? `Looking back at my week — ${recap.highlight}. What should I focus on next week?`
                : "Looking at this week's recap, what should I focus on next week?";
              onAsk(seed);
            }}
            className="text-xs font-medium text-[#1B3829] hover:underline transition-colors"
          >
            💬 Ask Coach Al about it
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-700 mt-2">{error}</p>}
      {extToast && !error && (
        <p className="text-[11px] text-emerald-800 mt-2">{extToast}</p>
      )}
    </section>
  );
}
