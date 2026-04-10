"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function ConnectContent() {
  const params = useSearchParams();
  const error  = params.get("error");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold text-white mb-4">
        Connect Your Wearable
      </h1>

      {error && (
        <div className="mb-6 rounded-lg bg-red-950 border border-red-800 text-red-300 px-4 py-3 text-sm max-w-sm">
          Connection failed: {error}. Please try again.
        </div>
      )}

      <div className="space-y-4 w-full max-w-sm">
        {/* Oura */}
        <button
          onClick={() => api.connectOura()}
          className="w-full flex items-center gap-4 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-5 py-4 transition-colors text-left"
        >
          <span className="text-2xl">💍</span>
          <div>
            <p className="font-semibold text-white">Oura Ring</p>
            <p className="text-xs text-zinc-400">Sleep, readiness & activity</p>
          </div>
          <span className="ml-auto text-green-400 text-xs font-medium">Connect →</span>
        </button>

        {/* Coming soon */}
        {[
          { icon: "⌚", name: "Apple Health",  desc: "Heart rate, sleep & activity" },
          { icon: "🏃", name: "Garmin",        desc: "GPS, training load & HRV" },
          { icon: "💪", name: "WHOOP",         desc: "Strain, recovery & sleep" },
          { icon: "📊", name: "Fitbit",        desc: "Sleep stages & daily activity" },
        ].map(({ icon, name, desc }) => (
          <div
            key={name}
            className="w-full flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 opacity-50 cursor-not-allowed text-left"
          >
            <span className="text-2xl">{icon}</span>
            <div>
              <p className="font-semibold text-zinc-300">{name}</p>
              <p className="text-xs text-zinc-500">{desc}</p>
            </div>
            <span className="ml-auto text-zinc-600 text-xs">Coming soon</span>
          </div>
        ))}
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
