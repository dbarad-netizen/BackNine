"use client";

/**
 * /league — the tagged link in the Sunday text (David 2026-10-07).
 *
 * backnine.health/league?from=sunday&w=2026-10-05 → opens the dashboard
 * on the Clubhouse tab and records a link_tap event, so "did the text
 * drive an app open?" is a number, not a guess. Kept as a tiny client
 * redirect so the dashboard owns all section logic.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LeagueLink() {
  const router = useRouter();
  useEffect(() => {
    // window.location, not useSearchParams: the latter needs a Suspense
    // boundary at build time or the whole Vercel build fails (Aug 2026).
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from") || "link";
    const w = params.get("w") || "";
    router.replace(`/dashboard?section=challenges&from=${encodeURIComponent(from)}&w=${encodeURIComponent(w)}`);
  }, [router]);
  return (
    <main className="min-h-screen bg-[#f5f3ee] flex items-center justify-center text-sm text-gray-500">
      Opening the Clubhouse…
    </main>
  );
}
