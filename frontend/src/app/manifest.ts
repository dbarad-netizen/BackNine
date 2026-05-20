import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes BackNine installable to the phone home screen with an
 * app icon and a standalone (chrome-less) window. Next serves this at
 * /manifest.webmanifest and links it automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BackNine Health",
    short_name: "BackNine",
    description: "Your personal health intelligence — recovery, sleep, longevity & community.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1a15",
    theme_color: "#1B3829",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
