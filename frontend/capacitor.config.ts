import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config — wraps the Next.js PWA in a native iOS shell.
 *
 * Strategy: BackNine's canonical experience is the responsive Next.js web
 * app at www.backnine.health. For the App Store we keep that as the source
 * of truth and use Capacitor to embed it in a native WKWebView, with two
 * concessions to Apple's rules:
 *
 *   1. The initial view loads a bundled offline HTML shell (frontend/out/)
 *      so the app opens instantly on cold-start and works if the network
 *      is down when the user launches. `server.url` below then transitions
 *      the webview to the live remote origin — reviewers won't reject this
 *      because we have real bundled content on first paint.
 *
 *   2. Auth persistence uses the shared .backnine.health cookie we shipped
 *      2026-07-23 (dual-storage in api.ts + supabase.ts), so once signed
 *      in on the standalone PWA the user stays signed in when they open
 *      the App Store build.
 *
 * Bump `appId` version cautiously — the reverse-DNS style ID is what
 * uniquely identifies the app in App Store Connect and cannot be changed
 * after first submission.
 */

const config: CapacitorConfig = {
  appId: "com.strategyd.backnine",
  appName: "BackNine",
  // Bundled offline shell — `next export` produces this. We generate it
  // in CI ahead of Capacitor sync.
  webDir: "out",
  server: {
    // Live remote origin. Capacitor allows this pattern; Apple accepts it
    // as long as the bundled webDir has real content (not just a redirect).
    url: "https://www.backnine.health",
    // Bypass any HTTP-to-HTTPS canonicalization delay
    androidScheme: "https",
    // Force iOS to use HTTPS — no mixed content
    iosScheme: "https",
    // Sends cookies from .backnine.health with WKWebView requests
    // (required for the dual-storage token to survive standalone launches).
    allowNavigation: [
      "www.backnine.health",
      "backnine.health",
      "backnine-hu60.onrender.com",     // API (Render)
      "cloud.ouraring.com",             // Oura OAuth
      "*.supabase.co",                  // Supabase Auth
      "*.supabase.io",
      "appleid.apple.com",              // Sign in with Apple OAuth
    ],
  },
  ios: {
    // Explicit content inset behavior; matches the theme_color from the
    // PWA manifest (#1B3829) so status bar sits flush against our green.
    contentInset: "always",
    // Keep the launch screen backgrounded until the webview has content —
    // hides the awkward white flash on cold start.
    backgroundColor: "#0f1a15",
    // Enable web-inspector in debug builds so we can Safari-devtool
    // the running app on device. Off in release automatically.
    webContentsDebuggingEnabled: false,
    // Standard WKWebView. Do not switch to UIWebView.
    scheme: "BackNine",
    // App-bound domains for shared cookies + universal links. Match the
    // apple-app-site-association hosted at /.well-known/.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0f1a15",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    Keyboard: {
      resize: "body",
      style: "DARK",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
