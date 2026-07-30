"use client";

/**
 * ConnectedAccountsCard — Profile surface for identity linking.
 *
 * David 2026-07-30, task #142. Users can have multiple auth methods
 * (Oura + Apple + Google + email) all pointing to a single BackNine
 * user_id. This card lists what's currently linked and lets the user
 * connect additional methods.
 *
 * Rendered inside ProfileModal. Self-contained — fetches its own
 * data, handles its own OAuth linking flow via Supabase.
 */

import { useEffect, useState } from "react";
import { api, type LinkedIdentity } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const PROVIDER_META: Record<LinkedIdentity["provider"], { label: string; emoji: string }> = {
  oura:     { label: "Oura Ring",     emoji: "💍" },
  apple:    { label: "Apple ID",      emoji: "" },
  google:   { label: "Google",        emoji: "🅶" },
  email:    { label: "Email + password", emoji: "✉️" },
  supabase: { label: "Email + password", emoji: "✉️" },
};

export default function ConnectedAccountsCard() {
  const [identities, setIdentities] = useState<LinkedIdentity[] | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [busy, setBusy]             = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.linkedIdentities()
      .then(r => setIdentities(r.identities || []))
      .catch(() => setIdentities([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const hasApple = identities?.some(i => i.provider === "apple");

  const handleLinkApple = async () => {
    setError(null);
    setBusy("apple");
    try {
      // Kick off Supabase-Apple OAuth with a special intent so the
      // callback page knows to POST the resulting token to the link
      // endpoint instead of establishing a new session. We stash the
      // intent in localStorage — the callback page reads it and
      // routes accordingly.
      try { localStorage.setItem("bn_link_intent", "apple"); } catch { /* private mode */ }
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) {
        setError(oauthError.message);
        setBusy(null);
        try { localStorage.removeItem("bn_link_intent"); } catch { /* ignore */ }
      }
      // If successful, browser redirects — no further code runs here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start Apple sign-in");
      setBusy(null);
    }
  };

  const handleUnlink = async (id: string, label: string) => {
    if (!confirm(`Unlink ${label}? You'll no longer be able to sign in with it.`)) return;
    setBusy(id);
    setError(null);
    try {
      await api.unlinkIdentity(id);
      setIdentities(prev => (prev || []).filter(i => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unlink");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">
          Connected accounts
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
          Sign in with any of these methods and land on this same BackNine account.
        </p>
      </div>

      {error && (
        <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <ul className="space-y-1.5">
        {(identities || []).map(i => {
          const meta = PROVIDER_META[i.provider] || { label: i.provider, emoji: "🔗" };
          const canRemove = (identities || []).length > 1;
          return (
            <li
              key={i.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
            >
              <span className="text-lg shrink-0" aria-hidden>{meta.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-gray-900 leading-tight">
                  {meta.label}
                </p>
                {i.email && (
                  <p className="text-[11px] text-gray-500 truncate">{i.email}</p>
                )}
              </div>
              {canRemove && (
                <button
                  onClick={() => handleUnlink(i.id, meta.label)}
                  disabled={busy === i.id}
                  className="text-[11px] text-gray-500 hover:text-red-600 disabled:opacity-50"
                >
                  {busy === i.id ? "..." : "Unlink"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Add more — only show connectors that aren't already linked */}
      {!hasApple && (
        <button
          onClick={handleLinkApple}
          disabled={busy === "apple"}
          className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 px-4 py-2.5 text-[13px] font-semibold text-gray-900 transition-colors"
        >
          <svg width="15" height="16" viewBox="0 0 17 18" fill="none" aria-hidden="true">
            <path
              d="M13.874 9.567c-.017-2.086 1.703-3.088 1.781-3.137-.97-1.42-2.48-1.615-3.017-1.638-1.286-.13-2.51.757-3.163.757-.65 0-1.658-.738-2.724-.718-1.401.02-2.694.815-3.416 2.07-1.457 2.525-.373 6.257 1.048 8.301.694.999 1.522 2.121 2.607 2.08 1.045-.042 1.44-.678 2.702-.678 1.262 0 1.616.678 2.72.657 1.123-.02 1.836-1.02 2.523-2.023.795-1.161 1.123-2.286 1.14-2.344-.025-.011-2.187-.842-2.201-3.327zM11.812 3.393c.573-.702.964-1.671.857-2.643-.83.036-1.842.556-2.436 1.245-.53.61-.998 1.601-.873 2.55.928.073 1.877-.474 2.452-1.152z"
              fill="currentColor"
            />
          </svg>
          {busy === "apple" ? "Redirecting to Apple..." : "Connect Apple ID"}
        </button>
      )}

      <p className="text-[10px] text-gray-500 leading-snug">
        Adding a second sign-in method is a backup — if you ever lose access to
        the first, you can still get into your account with any linked method.
      </p>
    </section>
  );
}
