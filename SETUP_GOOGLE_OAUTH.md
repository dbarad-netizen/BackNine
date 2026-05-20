# Setup: Google Sign-In (Google Cloud Console + Supabase)

The code for Google sign-in is already complete (`signInWithOAuth` on the login
page, `/auth/callback` handler, Supabase JWT verification on the backend). The
only thing missing is configuration in two external dashboards. Do these once
and Google login works for everyone.

Your specific values:
- **Supabase project URL**: `https://xazmwpozsmbrqoulizyn.supabase.co`
- **Supabase OAuth callback** (Google needs this): `https://xazmwpozsmbrqoulizyn.supabase.co/auth/v1/callback`
- **App URL**: `https://back-nine-six.vercel.app`
- **App auth callback** (Supabase needs this in its allowlist): `https://back-nine-six.vercel.app/auth/callback`

---

## Part 1 — Google Cloud Console (create the OAuth client)

1. Go to https://console.cloud.google.com and sign in.
2. Top bar → project dropdown → **New Project** (name it "BackNine") → Create.
   Make sure it's selected afterward.
3. Left menu → **APIs & Services → OAuth consent screen**.
   - User type: **External** → Create.
   - App name: `BackNine`. User support email: your email.
   - Developer contact: your email. Save and continue through the screens.
   - Scopes: you can leave defaults (email, profile, openid). Save.
   - Test users: while in "Testing" mode, add the Google accounts you'll test
     with (your own). Or click **Publish App** to allow anyone (recommended
     once you're confident). Save.
4. Left menu → **APIs & Services → Credentials**.
   - **+ Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `BackNine Web`.
   - **Authorized JavaScript origins** — add both:
     - `https://back-nine-six.vercel.app`
     - `https://xazmwpozsmbrqoulizyn.supabase.co`
   - **Authorized redirect URIs** — add exactly:
     - `https://xazmwpozsmbrqoulizyn.supabase.co/auth/v1/callback`
   - **Create**.
5. A dialog shows your **Client ID** and **Client Secret**. Copy both — you'll
   paste them into Supabase next.

---

## Part 2 — Supabase (enable the Google provider)

1. Go to https://supabase.com/dashboard → select your project (xazmwpozsmbrqoulizyn).
2. Left menu → **Authentication → Providers → Google**.
   - Toggle **Enable**.
   - Paste the **Client ID** from Google.
   - Paste the **Client Secret** from Google.
   - **Save**.
3. Left menu → **Authentication → URL Configuration**.
   - **Site URL**: `https://back-nine-six.vercel.app`
   - **Redirect URLs** — add (one per line):
     - `https://back-nine-six.vercel.app/auth/callback`
     - `http://localhost:3000/auth/callback`  ← only if you test locally
   - **Save**.

---

## Part 3 — Confirm Vercel env vars (probably already set)

The frontend reads the Supabase connection from env vars. In
**Vercel → your project → Settings → Environment Variables**, confirm:

- `NEXT_PUBLIC_SUPABASE_URL` = `https://xazmwpozsmbrqoulizyn.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (Supabase → Settings → API → "anon public" key)

If these are missing, email/password login wouldn't work either — so if that
already works, they're set. If you change them, redeploy Vercel.

---

## Part 4 — Test

1. Open https://back-nine-six.vercel.app in an incognito window.
2. Click **Continue with Google**.
3. You should be redirected to Google's account chooser, then back to
   `/auth/callback`, then to `/dashboard`.
4. First-time Google users will see the onboarding flow.

### If it fails

- **"redirect_uri_mismatch"** → the redirect URI in Google Cloud doesn't
  exactly match `https://xazmwpozsmbrqoulizyn.supabase.co/auth/v1/callback`.
  Check for trailing slashes / typos.
- **"Access blocked: app not verified"** → your OAuth consent screen is in
  Testing mode and the Google account isn't in the test-users list. Add it,
  or publish the app.
- **Lands on /auth/callback but spins forever** → the app callback URL isn't
  in Supabase's Redirect URLs allowlist (Part 2, step 3).
- **"provider is not enabled"** → the Google provider toggle in Supabase
  (Part 2, step 2) wasn't saved.

No code deploy is required for any of this — it's all dashboard config.
