"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so BackNine is installable to the home screen
 * and gets a light offline shell. No-op in dev or unsupported browsers.
 * Mounted once in the root layout.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid SW caching during dev
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
