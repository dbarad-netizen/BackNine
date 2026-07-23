import { createClient } from "@supabase/supabase-js";

// Fallback placeholders prevent build-time crashes when env vars aren't set.
// The real values must be set in Vercel → Settings → Environment Variables.
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "https://placeholder.supabase.co";
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
const BACKEND      = process.env.NEXT_PUBLIC_API_URL ?? "https://backnine-hu60.onrender.com";

export const supabase = createClient(supabaseUrl, supabaseAnon);

/**
 * Establish a BackNine session from a fresh Supabase access token.
 *
 * Replaces the old `storeSupabaseToken` which just dumped the Supabase
 * access token into localStorage — that token expires in ~1 hour and
 * we weren't refreshing it, so non-Oura users got bounced to the
 * login screen the next day.
 *
 * Now: we POST the Supabase token to `/auth/session`, which verifies
 * it server-side and returns a BackNine-issued JWT (30 days). That
 * BackNine token replaces the Supabase token in localStorage and the
 * matching HttpOnly cookie is set by the backend on the response.
 *
 * Callers MUST await this before redirecting to /dashboard — otherwise
 * the very next API call will use the short-lived Supabase token.
 *
 * Throws on failure so the sign-in form can surface the error.
 */
export async function establishSession(supabaseAccessToken: string): Promise<void> {
  if (typeof window === "undefined") return;
  const res = await fetch(`${BACKEND}/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${supabaseAccessToken}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Sign-in failed (${res.status})`);
  }
  const data = await res.json();
  if (data?.token) {
    try { localStorage.setItem("bn_token", data.token); } catch { /* private mode */ }
    // Also write the first-party cookie fallback so the home-screen
    // webview and Safari share persistence. See api.ts::_writeTokenCookie
    // for the reasoning; duplicated here to avoid a circular import.
    _writeBackNineTokenCookie(data.token);
  }
}

function _writeBackNineTokenCookie(token: string): void {
  if (typeof document === "undefined") return;
  const isLocalhost = window.location.hostname === "localhost";
  const domain = isLocalhost ? "" : "; Domain=.backnine.health";
  const secure = isLocalhost ? "" : "; Secure";
  document.cookie =
    `bn_token_client=${encodeURIComponent(token)}` +
    `; Max-Age=${60 * 60 * 24 * 30}` +
    `; Path=/` +
    domain +
    `; SameSite=Lax` +
    secure;
}

/** Clear all auth state (sign out). */
export function clearAuth() {
  if (typeof window !== "undefined") {
    try { localStorage.removeItem("bn_token"); } catch { /* private mode */ }
    const isLocalhost = window.location.hostname === "localhost";
    const domain = isLocalhost ? "" : "; Domain=.backnine.health";
    document.cookie = `bn_token_client=; Max-Age=0; Path=/${domain}`;
  }
}
