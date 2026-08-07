import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import PWARegister from "@/components/PWARegister";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BackNine Health",
  description: "Your personal health intelligence dashboard",
  applicationName: "BackNine",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BackNine",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#1B3829",
  width: "device-width",
  initialScale: 1,
  // Lock zoom in the native app WebView. Accidental pinch-zoom in a
  // hybrid app is a trap — there's no Safari-style "reset zoom" gesture
  // to recover, so users get stuck (David 2026-08-06). Standard
  // practice for Capacitor / Cordova / React Native apps. Users who
  // need larger text should use iOS system Dynamic Type instead.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 min-h-screen`}>
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
