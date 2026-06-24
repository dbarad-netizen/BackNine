"use client";

/**
 * FriendsGlanceCard — horizontal scroll strip of friends + this-week pulse.
 *
 * Lives at the top of the PulseFeed (above the event timeline) so the very
 * first thing a user sees is "what are my friends up to right now". Each
 * chip pulls the same numbers as that friend's weekly recap (workouts,
 * PRs, sleep streak, protein days) so the strip and the feed agree.
 *
 * Hidden when the viewer has no friends — the FriendInvite empty state in
 * PulseFeed handles that case better.
 */

import { useEffect, useState } from "react";
import { api, type FriendsGlancePayload, type FriendGlance } from "@/lib/api";

interface Props {
  /** Open a deeper friend modal when a chip is tapped. */
  onOpenFriend?: (userId: string, name: string) => void;
}

function Chip({ f, onClick }: { f: FriendGlance; onClick?: () => void }) {
  // Use the most flattering stat as the "headline" pill — PRs first, then
  // workouts, then sleep streak, then protein days. Falls through to a
  // muted "no activity" pill so quiet friends don't disappear entirely.
  let pill: string | null = null;
  let pillTone = "bg-gray-100 text-gray-700 border-gray-200";
  if (f.pr_count > 0) {
    pill = `🏆 ${f.pr_count} PR${f.pr_count === 1 ? "" : "s"}`;
    pillTone = "bg-amber-100 text-amber-800 border-amber-200";
  } else if (f.workouts > 0) {
    pill = `🏋️ ${f.workouts} session${f.workouts === 1 ? "" : "s"}`;
    pillTone = "bg-emerald-100 text-emerald-800 border-emerald-200";
  } else if (f.sleep_streak >= 3) {
    pill = `🔥 ${f.sleep_streak}-night sleep`;
    pillTone = "bg-sky-100 text-sky-800 border-sky-200";
  } else if (f.protein_days >= 3) {
    pill = `🥩 ${f.protein_days} protein days`;
    pillTone = "bg-indigo-100 text-indigo-800 border-indigo-200";
  }

  return (
    <button
      onClick={onClick}
      className="snap-start shrink-0 w-36 rounded-xl border border-gray-200 bg-white p-3 hover:border-[#1B3829] hover:shadow-sm transition-all text-left"
      title={f.headline || `${f.name} this week`}
    >
      <p className="text-sm font-semibold text-gray-900 truncate">{f.name}</p>
      <div className={`mt-1.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${pillTone}`}>
        {pill ?? "Quiet week"}
      </div>
      {f.highlight && (
        <p className="text-[10px] text-gray-600 italic mt-1.5 leading-snug line-clamp-2">{f.highlight}</p>
      )}
    </button>
  );
}

export default function FriendsGlanceCard({ onOpenFriend }: Props = {}) {
  const [data,    setData]    = useState<FriendsGlancePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.community.friendsGlance()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  if (!data.viewer_has_friends || data.friends.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-700">Friends pulse</p>
          <h3 className="text-sm font-bold text-gray-900">This week at a glance</h3>
        </div>
        <p className="text-[11px] text-gray-600">{data.friends.length} friend{data.friends.length === 1 ? "" : "s"}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
        {data.friends.map(f => (
          <Chip
            key={f.user_id}
            f={f}
            onClick={onOpenFriend ? () => onOpenFriend(f.user_id, f.name) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
