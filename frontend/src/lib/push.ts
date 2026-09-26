/**
 * push.ts — APNs registration for the native iOS app (David 2026-09-24).
 *
 * Coach Al works when he comes to you (the Sunday text proved it), so the
 * morning teaser and the Sunday scoreboard arrive as lock-screen
 * notifications. This file only asks permission and hands the device
 * token to the backend; the backend decides what to send and when.
 *
 * Accessed via window.Capacitor.Plugins.PushNotifications at runtime —
 * the same registration pattern as HealthKit — so the web build has NO
 * dependency on @capacitor/push-notifications. On web (and when the
 * plugin isn't installed in the iOS project yet) every call is a no-op.
 *
 * Native setup (one-time, David):
 *   cd frontend && npm i @capacitor/push-notifications && npx cap sync ios
 *   Xcode → App target → Signing & Capabilities → + Push Notifications
 *   AppDelegate.swift: forward the two remote-notification callbacks
 *   (already added).
 */

import { api } from "./api";

type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: string, cb: (data: any) => void): Promise<unknown> | unknown;
};

function plugin(): PushPlugin | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (!w.Capacitor?.isNativePlatform?.()) return null;
  return (w.Capacitor?.Plugins?.PushNotifications as PushPlugin) ?? null;
}

let _wired = false;

/** Ask once, register, and POST the token. Safe to call on every
 *  launch — iOS returns the same token and the backend upserts. */
export async function registerForPush(): Promise<void> {
  const p = plugin();
  if (!p || _wired) return;
  _wired = true;
  try {
    let { receive } = await p.checkPermissions();
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      receive = (await p.requestPermissions()).receive;
    }
    if (receive !== "granted") return;

    p.addListener("registration", (t: { value: string }) => {
      api.pushRegister(t.value).catch(() => { /* retry next launch */ });
    });
    p.addListener("registrationError", (e: unknown) => {
      console.warn("[push] registration error", e);
    });
    // Tap on a notification → tell the dashboard where to go.
    p.addListener("pushNotificationActionPerformed", (a: { notification?: { data?: { route?: string } } }) => {
      const route = a?.notification?.data?.route;
      if (route) window.dispatchEvent(new CustomEvent("backnine:push-route", { detail: route }));
    });
    await p.register();
  } catch (e) {
    console.warn("[push] setup failed", e);
  }
}
