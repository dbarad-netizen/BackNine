/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Serve the Apple App Site Association (AASA) file with the correct
   * Content-Type. Apple requires application/json (or application/pkcs7-mime
   * for signed AASA — we're using the plain JSON form).
   *
   * The file itself lives at frontend/public/.well-known/apple-app-site-association
   * (no file extension — Apple's requirement). Next.js serves everything in
   * public/ at root, so this URL resolves to:
   *
   *     https://www.backnine.health/.well-known/apple-app-site-association
   *
   * Apple's CDN fetches this URL when validating Universal Links for the
   * bundle ID com.strategyd.backnine, so it MUST be reachable over HTTPS
   * with a 200 response and the right Content-Type before the app can
   * associate incoming domains.
   *
   * David 2026-07-27, after enrolling in Apple Developer Program with
   * Team ID 5TU6C6ND63.
   */
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type",  value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
