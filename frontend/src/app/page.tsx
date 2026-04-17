"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, storeSupabaseToken } from "@/lib/supabase";

const BACKEND = "https://backnine-hu60.onrender.com";

type Mode = "signin" | "signup";

export default function Home() {
  const router = useRouter();
  const [mode,     setMode]     = useState<Mode>("signin");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [message,  setMessage]  = useState<string | null>(null);

  // If already authenticated, go straight to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        storeSupabaseToken(data.session.access_token);
        router.replace("/dashboard");
      }
    });
    // Also check for existing Oura token
    const existing = typeof window !== "undefined" && localStorage.getItem("bn_token");
    if (existing) router.replace("/dashboard");
  }, [router]);

  // ── Email / password ────────────────────────────────────────────────────────
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          storeSupabaseToken(data.session.access_token);
          router.replace("/dashboard");
        } else {
          setMessage("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          storeSupabaseToken(data.session.access_token);
          router.replace("/dashboard");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // If no error, browser redirects to Google — no further code runs
  };

  // ── Oura direct connect (legacy / Oura-only users) ───────────────────────────
  const handleOura = () => {
    window.location.href = `${BACKEND}/auth/oura`;
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 bg-[#0f1a15]">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center mb-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Back<span className="text-green-400">Nine</span>
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Your personal health intelligence platform</p>
        </div>

        {/* Email / password card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">

          {/* Mode toggle */}
          <div className="flex rounded-xl bg-zinc-800 p-1 gap-1">
            {(["signin", "signup"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setMessage(null); }}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mode === m ? "bg-white text-gray-900" : "text-zinc-400 hover:text-white"
                }`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-green-500 transition-colors"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-green-500 transition-colors"
            />

            {error   && <p className="text-red-400 text-xs">{error}</p>}
            {message && <p className="text-green-400 text-xs">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold text-sm transition-colors"
            >
              {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-zinc-700" />
            <span className="text-zinc-600 text-xs">or</span>
            <div className="flex-1 h-px bg-zinc-700" />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {/* Google logo SVG */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-zinc-700 text-xs">already have Oura?</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        {/* Oura direct */}
        <button
          onClick={handleOura}
          className="w-full flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-600 px-5 py-4 transition-colors text-left"
        >
          <span className="text-2xl">💍</span>
          <div className="flex-1">
            <p className="font-semibold text-white text-sm">Sign in with Oura Ring</p>
            <p className="text-xs text-zinc-500">Connect directly — no separate account needed</p>
          </div>
          <span className="text-green-400 text-xs font-medium">→</span>
        </button>

        <p className="text-center text-zinc-700 text-xs px-4">
          By continuing you agree to BackNine's terms of service and privacy policy.
        </p>
      </div>
    </main>
  );
}
