"use client";

/**
 * Password reset callback (David 2026-07-17). Handles the redirect from
 * the Supabase resetPasswordForEmail email link. The URL carries an
 * access token in the hash fragment — Supabase's JS client picks it up
 * automatically and puts the user in a "recovery" session where the
 * ONLY thing they're allowed to do is call updateUser({ password }).
 *
 * Flow:
 *   1. User taps "Forgot password?" on the login page.
 *   2. Supabase emails them a link → this page.
 *   3. Supabase auto-establishes a recovery session on mount.
 *   4. User types new password twice → we call updateUser.
 *   5. On success, hop into the app via the normal establishSession()
 *      exchange so their BackNine session lives 30 days like everyone else.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, establishSession } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady]     = useState(false);
  const [pw1, setPw1]         = useState("");
  const [pw2, setPw2]         = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Supabase JS client automatically processes the hash fragment on
    // load and creates a recovery session. Give it a beat then check.
    let cancelled = false;
    (async () => {
      // Small delay so the client can parse the hash. Supabase's own
      // examples do this pattern.
      await new Promise(r => setTimeout(r, 250));
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setError("This reset link looks stale or already used. Request a fresh one from the login page.");
      } else {
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw1.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: pw1 });
      if (updErr) throw updErr;
      // Grab the fresh session and hand it to the BackNine exchange.
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session) {
        await establishSession(sess.session.access_token);
      }
      setSuccess(true);
      // Redirect to dashboard after a short beat so the success line
      // is visible.
      setTimeout(() => router.replace("/dashboard"), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 bg-[#0f1a15]">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Set a new password</h1>
          <p className="text-zinc-400 text-sm mt-1">
            You&rsquo;ll be signed in after this.
          </p>
        </div>

        {!ready && !error && (
          <p className="text-zinc-500 text-sm text-center">Checking your reset link…</p>
        )}

        {error && (
          <p className="text-red-400 text-xs bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {success && (
          <p className="text-green-400 text-sm bg-green-950/40 border border-green-900/60 rounded-lg px-3 py-2 text-center">
            Password updated. Taking you to the app…
          </p>
        )}

        {ready && !success && (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              placeholder="New password (6+ characters)"
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              required
              minLength={6}
              autoFocus
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-green-500 transition-colors"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              required
              minLength={6}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-green-500 transition-colors"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold text-sm transition-colors"
            >
              {busy ? "Updating…" : "Set new password"}
            </button>
          </form>
        )}

        <div className="text-center">
          <a
            href="/"
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          >
            Back to sign in
          </a>
        </div>
      </div>
    </main>
  );
}
