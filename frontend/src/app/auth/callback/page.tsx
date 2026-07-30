"use client";

/**
 * /auth/callback
 *
 * Supabase redirects here after Google (or any other OAuth provider) sign-in.
 * We exchange the code in the URL for a session, store the access token, then
 * send the user to the dashboard.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, establishSession } from "@/lib/supabase";
import { api } from "@/lib/api";

export default function AuthCallback() {
  const router  = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Diagnostic (David 2026-07-30 — SIWA debugging): capture any OAuth
  // error params that come back in the URL so we can see WHY Apple /
  // Supabase failed instead of just spinning forever. Both querystring
  // (?error=...) and hash fragment (#error=...) are checked because
  // Supabase uses fragment for implicit-grant flows and query for
  // authorization-code flows. Full URL is also captured for support.
  const [diag, setDiag] = useState<{ url: string; params: Record<string, string> } | null>(null);

  useEffect(() => {
    // Parse both search and hash params first — even a successful
    // flow may carry diagnostic info; a failed one certainly will.
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      const hash   = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const merged: Record<string, string> = {};
      search.forEach((v, k) => { merged[k] = v; });
      hash.forEach(  (v, k) => { merged[k] = v; });
      const hasErr = merged.error || merged.error_code || merged.error_description;
      if (hasErr) {
        setDiag({ url: window.location.href, params: merged });
        setError(
          (merged.error_description as string) ||
          (merged.error as string) ||
          "Sign-in failed"
        );
        return;   // don't try to establish a session — nothing to work with
      }
    }

    // Check for a link-intent stashed by ConnectedAccountsCard. If set,
    // this OAuth roundtrip is a LINKING request from an already-signed-
    // in user — POST the Supabase token to /api/account/link/apple
    // instead of establishing a fresh session (which would swap the
    // user out of their current account). See task #142.
    const linkIntent = typeof window !== "undefined"
      ? localStorage.getItem("bn_link_intent")
      : null;

    // Each branch must AWAIT establishSession before redirecting — the
    // dashboard's first API call needs the long-lived BackNine session,
    // not the short-lived Supabase access token.
    supabase.auth.getSession().then(async ({ data, error }) => {
      const handleSession = async (accessToken: string) => {
        // Link flow — user was already signed in; this OAuth completed
        // just to prove ownership of the new identity being linked.
        if (linkIntent === "apple") {
          try { localStorage.removeItem("bn_link_intent"); } catch { /* ignore */ }
          try {
            await api.linkAppleIdentity(accessToken);
            // Sign OUT of Supabase so the new Apple session doesn't
            // clobber the user's existing BackNine session, then bounce
            // to dashboard where the ConnectedAccountsCard will reload
            // and show the new link.
            await supabase.auth.signOut();
            router.replace("/dashboard?linked=apple");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't link Apple ID");
          }
          return;
        }
        // Standard sign-in flow
        try {
          await establishSession(accessToken);
          router.replace("/dashboard");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Sign-in failed");
        }
      };

      if (error || !data.session) {
        // Supabase may need to exchange the code from the URL hash/query first
        supabase.auth.onAuthStateChange(async (_event, session) => {
          if (session) await handleSession(session.access_token);
        });
        if (error) setError(error.message);
        return;
      }
      await handleSession(data.session.access_token);
    });
  }, [router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1a15] px-4 py-8">
        <div className="max-w-lg w-full space-y-4 text-center">
          <p className="text-red-400 text-sm font-semibold">Sign-in failed</p>
          <p className="text-zinc-300 text-sm">{error}</p>
          {/* Diagnostic block — David 2026-07-30. When OAuth (Apple, Google,
              Oura) round-trips fail, all we usually get in support is "it
              didn't work". Surfacing the raw error params + URL here means
              a screenshot is all we need to root-cause. */}
          {diag && (
            <details className="text-left mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs">
              <summary className="text-zinc-400 cursor-pointer">Technical details (share this with support)</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="text-zinc-500 uppercase tracking-wide text-[10px] mb-1">URL</p>
                  <code className="text-zinc-300 break-all block">{diag.url}</code>
                </div>
                <div>
                  <p className="text-zinc-500 uppercase tracking-wide text-[10px] mb-1">Params</p>
                  <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(diag.params, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          )}
          <a href="/signin" className="text-green-400 text-sm underline inline-block mt-2">Back to sign in</a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1a15]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
        <p className="text-zinc-400 text-sm">Signing you in…</p>
      </div>
    </main>
  );
}
