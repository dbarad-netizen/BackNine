"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";

const BACKEND = "https://backnine-hu60.onrender.com";

function ConnectContent() {
  const params  = useSearchParams();
  const router  = useRouter();
  const error   = params.get("error");

  const [userId,     setUserId]     = useState<string | null>(null);
  const [userEmail,  setUserEmail]  = useState<string | null>(null);
  const [appleKey,   setAppleKey]   = useState<string | null>(null);
  const [showApple,  setShowApple]  = useState(false);
  const [copying,    setCopying]    = useState(false);
  const [copyingUrl, setCopyingUrl] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // Apple Health connection status — for the "Check sync" button.
  const [ahStatus, setAhStatus] = useState<{
    connected: boolean; last_sync_at: string | null; latest_date: string | null; days_synced: number;
  } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email ?? null);
      } else {
        // No Supabase session — check for legacy token
        const legacy = typeof window !== "undefined" && localStorage.getItem("bn_token");
        if (!legacy) {
          router.replace("/");
          return;
        }
      }
      setAuthChecked(true);
    });
  }, [router]);

  const handleConnectOura = () => {
    const url = userId
      ? `${BACKEND}/auth/oura?link_user_id=${encodeURIComponent(userId)}`
      : `${BACKEND}/auth/oura`;
    window.location.href = url;
  };

  const handleAppleHealth = async () => {
    setShowApple(true);
    if (!appleKey) {
      try {
        const { api_key } = await api.appleHealthKey();
        setAppleKey(api_key);
      } catch {
        setAppleKey("error");
      }
    }
    // Probe for existing sync data so returning users see their status without
    // having to click "Check sync" again.
    if (ahStatus === null) {
      try {
        const s = await api.appleHealthStatus();
        setAhStatus(s);
      } catch {
        /* leave null — user can tap Check sync */
      }
    }
  };

  // Tiny "synced 2h ago" formatter for the connection status pill.
  const timeAgo = (iso: string): string => {
    try {
      const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (diffMin < 1)   return "just now";
      if (diffMin < 60)  return `${diffMin} min ago`;
      const h = Math.round(diffMin / 60);
      if (h < 24)        return `${h}h ago`;
      const d = Math.round(h / 24);
      return `${d}d ago`;
    } catch { return ""; }
  };

  const handleCopy = () => {
    if (!appleKey || appleKey === "error") return;
    navigator.clipboard.writeText(appleKey).then(() => {
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    });
  };

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1a15]">
        <div className="h-8 w-8 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 bg-[#0f1a15]">
      <div className="w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">
            Back<span className="text-green-400">Nine</span>
          </h1>
          <p className="text-zinc-400 text-sm mt-2">
            Connect your devices to start tracking
          </p>
          {userEmail && (
            <p className="text-zinc-600 text-xs mt-1">{userEmail}</p>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-xl bg-red-950 border border-red-800 text-red-300 px-4 py-3 text-sm">
            Connection failed: {error}. Please try again.
          </div>
        )}

        {/* Wearable options */}
        <div className="space-y-3">

          {/* Oura Ring */}
          <button
            onClick={handleConnectOura}
            className="w-full flex items-center gap-4 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-green-600 hover:bg-zinc-800 px-5 py-4 transition-colors text-left group"
          >
            <span className="text-2xl">💍</span>
            <div className="flex-1">
              <p className="font-semibold text-white text-sm">Oura Ring</p>
              <p className="text-xs text-zinc-400">Sleep, readiness & recovery</p>
            </div>
            <span className="text-green-400 text-xs font-medium group-hover:translate-x-0.5 transition-transform">
              Connect →
            </span>
          </button>

          {/* Apple Health */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden">
            <button
              onClick={handleAppleHealth}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-800 transition-colors text-left group"
            >
              <span className="text-2xl">🍎</span>
              <div className="flex-1">
                <p className="font-semibold text-white text-sm">Apple Health</p>
                <p className="text-xs text-zinc-400">Steps, heart rate & sleep</p>
              </div>
              <span className="text-green-400 text-xs font-medium group-hover:translate-x-0.5 transition-transform">
                Setup →
              </span>
            </button>

            {/* Apple Health setup panel */}
            {showApple && (
              <div className="border-t border-zinc-800 px-5 py-4 space-y-4">
                <p className="text-zinc-300 text-xs leading-relaxed">
                  Two ways to sync Apple Health to BackNine. Pick one — both send
                  the same data, just packaged differently.
                </p>

                {/* Path A — BackNine Shortcut (recommended once authored) */}
                <div className="rounded-lg border border-green-700/60 bg-green-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-300 text-xs font-semibold">Recommended · Free</span>
                    <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-700/60 px-1.5 py-0.5 rounded">
                      Install link coming soon
                    </span>
                  </div>
                  <p className="text-white text-sm font-semibold">BackNine Sync Shortcut</p>
                  <p className="text-zinc-300 text-xs leading-relaxed">
                    A free iPhone Shortcut that reads your Apple Health data and sends it to
                    BackNine on a daily schedule. Uses Apple&apos;s built-in Shortcuts app — no
                    paid third-party app required. We&apos;re finalizing the one-tap install link;
                    if you&apos;d like to hand-build it now, the URL + key below are everything
                    you need (POST a flat JSON like <code className="text-green-300">{`{"date":"2026-06-03","steps":8200,...}`}</code>).
                  </p>
                </div>

                {/* Path B — Health Auto Export */}
                <p className="text-zinc-300 text-xs leading-relaxed pt-1">
                  <span className="text-white font-semibold">Or:</span> use{" "}
                  <a href="https://apps.apple.com/app/health-auto-export/id1115567069"
                    target="_blank" rel="noopener" className="text-green-400 underline">Health Auto Export</a>
                  {" "}— a one-time-purchase iOS app (~$5) that does the same job with a polished UI.
                  Steps below assume HAE.
                </p>

                {/* Connection status — shows after the user has hit "Check sync" */}
                {ahStatus && (
                  ahStatus.connected ? (
                    <div className="rounded-lg border border-green-700 bg-green-950/40 px-3 py-2">
                      <p className="text-green-300 text-xs font-semibold">✓ Connected</p>
                      <p className="text-green-400/80 text-[10px] mt-0.5">
                        {ahStatus.days_synced} day{ahStatus.days_synced === 1 ? "" : "s"} of data
                        {ahStatus.latest_date ? ` · latest ${ahStatus.latest_date}` : ""}
                        {ahStatus.last_sync_at ? ` · synced ${timeAgo(ahStatus.last_sync_at)}` : ""}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2">
                      <p className="text-amber-300 text-xs font-semibold">No data received yet</p>
                      <p className="text-amber-400/80 text-[10px] mt-0.5">
                        Finish the steps below, then tap Check sync again after running the export.
                      </p>
                    </div>
                  )
                )}

                {/* The two values the user needs: URL and Key */}
                <div className="space-y-2">
                  <div>
                    <p className="text-zinc-500 text-[10px] mb-1 uppercase tracking-wide">REST API URL</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[11px] text-zinc-200 font-mono truncate">
                        {BACKEND}/api/apple-health/sync
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${BACKEND}/api/apple-health/sync`).then(() => {
                            setCopyingUrl(true);
                            setTimeout(() => setCopyingUrl(false), 1800);
                          });
                        }}
                        className="shrink-0 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                      >
                        {copyingUrl ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-[10px] mb-1 uppercase tracking-wide">Header — X-AH-Key</p>
                    {!appleKey ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
                        <span className="text-zinc-500 text-xs">Loading…</span>
                      </div>
                    ) : appleKey === "error" ? (
                      <p className="text-red-400 text-xs">Failed to load API key. Try refreshing.</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[11px] text-green-300 font-mono truncate">
                          {appleKey}
                        </code>
                        <button
                          onClick={handleCopy}
                          className="shrink-0 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                        >
                          {copying ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Step-by-step */}
                <ol className="space-y-2 text-xs text-zinc-300">
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">1.</span>
                    <span>Install <span className="text-white">Health Auto Export</span> from the App Store and grant it Health permissions.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">2.</span>
                    <span>In the app: <span className="text-white">Automations → Add → REST API</span>. Paste the URL above as the endpoint, add an <span className="text-white">X-AH-Key</span> header with your key.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">3.</span>
                    <span>Select metrics: <span className="text-white">Steps, Sleep Analysis, Active Energy, Resting Heart Rate, Heart Rate Variability, Body Mass, VO₂ Max, Body Fat Percentage, Respiratory Rate</span>. (Skip anything you don&apos;t track.)</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">4.</span>
                    <span>Set the schedule to <span className="text-white">Daily</span>, save, then tap <span className="text-white">Test Now</span> in HAE to send your first batch.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">5.</span>
                    <span>Come back here and tap Check sync below to confirm it worked.</span>
                  </li>
                </ol>

                {/* Check sync button */}
                <button
                  onClick={async () => {
                    setCheckingStatus(true);
                    try {
                      const s = await api.appleHealthStatus();
                      setAhStatus(s);
                    } catch {
                      setAhStatus({ connected: false, last_sync_at: null, latest_date: null, days_synced: 0 });
                    } finally {
                      setCheckingStatus(false);
                    }
                  }}
                  disabled={checkingStatus}
                  className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {checkingStatus ? "Checking…" : ahStatus?.connected ? "Re-check sync" : "Check sync"}
                </button>
              </div>
            )}
          </div>

          {/* Coming soon */}
          {[
            { icon: "🏃", name: "Garmin",    desc: "GPS, training load & HRV" },
            { icon: "💪", name: "WHOOP",     desc: "Strain, recovery & sleep" },
            { icon: "📊", name: "Fitbit",    desc: "Sleep stages & daily activity" },
          ].map(({ icon, name, desc }) => (
            <div
              key={name}
              className="w-full flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 opacity-50 cursor-not-allowed text-left"
            >
              <span className="text-2xl">{icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-300 text-sm">{name}</p>
                <p className="text-xs text-zinc-500">{desc}</p>
              </div>
              <span className="text-zinc-600 text-xs">Coming soon</span>
            </div>
          ))}
        </div>

        {/* Skip link */}
        <div className="text-center">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
          >
            Skip for now — go to dashboard →
          </button>
        </div>

      </div>
    </main>
  );
}

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectContent />
    </Suspense>
  );
}
