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
  const [authChecked, setAuthChecked] = useState(false);

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
              <div className="border-t border-zinc-800 px-5 py-4 space-y-3">
                <p className="text-zinc-300 text-xs leading-relaxed">
                  Use the <span className="text-white font-medium">BackNine iOS shortcut</span> to
                  automatically sync Apple Health data daily. Paste your personal API key into the
                  shortcut to connect.
                </p>

                {/* API Key */}
                <div>
                  <p className="text-zinc-500 text-xs mb-1.5">Your personal API key</p>
                  {!appleKey ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
                      <span className="text-zinc-500 text-xs">Loading…</span>
                    </div>
                  ) : appleKey === "error" ? (
                    <p className="text-red-400 text-xs">Failed to load API key. Try refreshing.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-green-300 font-mono truncate">
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

                {/* Steps */}
                <ol className="space-y-1.5 text-xs text-zinc-400">
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">1.</span>
                    Download the BackNine iOS Shortcut from iCloud
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">2.</span>
                    Open the shortcut and paste your API key when prompted
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">3.</span>
                    Allow Health permissions when asked
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-500 font-bold shrink-0">4.</span>
                    Run the shortcut once manually, then set it to run daily via Automation
                  </li>
                </ol>
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
