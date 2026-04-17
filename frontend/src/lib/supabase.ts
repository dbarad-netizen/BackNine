import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnon);

/**
 * Store the Supabase access token where the BackNine API client will find it.
 * Called after a successful sign-in so all subsequent api.* calls are
 * authenticated automatically.
 */
export function storeSupabaseToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("bn_token", token);
  }
}

/** Clear all auth state (sign out). */
export function clearAuth() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("bn_token");
  }
}
