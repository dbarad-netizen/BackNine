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
import { supabase, storeSupabaseToken } from "@/lib/supabase";

export default function AuthCallback() {
  const router  = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        // Supabase may need to exchange the code from the URL hash/query first
        supabase.auth.onAuthStateChange((event, session) => {
          if (session) {
            storeSupabaseToken(session.access_token);
            router.replace("/dashboard");
          }
        });
        if (error) setError(error.message);
        return;
      }
      storeSupabaseToken(data.session.access_token);
      router.replace("/dashboard");
    });
  }, [router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1a15] px-4">
        <div className="text-center space-y-3">
          <p className="text-red-400 text-sm">{error}</p>
          <a href="/" className="text-green-400 text-sm underline">Back to sign in</a>
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
