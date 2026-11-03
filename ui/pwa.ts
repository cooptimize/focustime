// P1: FocusTime as an installed app. The service worker (built pages only; /sw.js caches the shell, never data),
// Install app (Chromium's prompt, or the iPhone how-to), this device's push (asked for only when tapped) and
// sign-out's cleanup: this device's push removed, then every FocusTime cache cleared.
import { useSyncExternalStore } from "react";
import { deviceLabel } from "../plan/push.ts";
import { ROUTE_EVENT } from "../plan/notify.ts";
import { call, setBeforeSignOut } from "./api.ts";

// ---- Install ----

type InstallPrompt = Event & { prompt: () => Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

/** Running as the installed app (home screen or desktop app window), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
/** iPhone or iPad Safari: no install prompt; Share › Add to Home Screen instead. */
export function isIos(ua = typeof navigator === "undefined" ? "" : navigator.userAgent, touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}

export type InstallState = "prompt" | "ios" | "hidden";
export function installState(): InstallState {
  if (installed || isStandalone()) return "hidden";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "hidden";
}
export const useInstall = () => useSyncExternalStore(subscribe, installState, () => "hidden" as const);

/** Chromium's install dialog; hidden afterwards either way (the prompt can be used once). */
export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  changed();
  return (await p.prompt().catch(() => ({ outcome: "dismissed" as const }))).outcome === "accepted";
}

// ---- This device ----

const DEVICE_KEY = "focustime.device";
/** This browser's own random id for its push subscription (not a person's id; the server scopes by the session). */
export function deviceId(): string {
  try {
    const had = localStorage.getItem(DEVICE_KEY);
    if (had && /^[A-Za-z0-9_-]{16,64}$/.test(had)) return had;
    const made = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    return "";
  }
}

export type PushDeviceRow = { deviceId: string; label: string; createdAt: string; sentAt: string | null; failedAt: string | null };
export type PushStatus = { available: boolean; reason: string | null; publicKey: string | null; devices: PushDeviceRow[] };

/** What this browser can do about push. */
export function pushSupport(): "ok" | "ios-install" | "unsupported" {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  return "ok";
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/**
 * Notify this device: the browser asks permission (only now, from the tap), subscribes with the app's key, and the
 * server keeps the subscription sealed. Returns the new status, or a plain reason it didn't happen.
 */
export async function enablePush(publicKey: string): Promise<{ ok: true; status: PushStatus } | { ok: false; reason: string }> {
  if (pushSupport() !== "ok") return { ok: false, reason: "This browser can't get push notifications." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "Notifications are blocked for FocusTime in this browser's settings." : "Notifications weren't allowed." };
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const status = await call<PushStatus>("push.subscribe", { deviceId: deviceId(), label: deviceLabel(navigator.userAgent), subscription: sub.toJSON() });
  return { ok: true, status };
}

/** Turns push off here: the browser's subscription ends and the server forgets this device. */
export async function disablePush(): Promise<PushStatus | null> {
  const sub = await currentSubscription();
  await sub?.unsubscribe().catch(() => false);
  return call<PushStatus>("push.remove", { deviceId: deviceId() }).catch(() => null);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** Every FocusTime shell cache, gone (sign-out). */
export async function clearShellCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-caches" });
  const keys = await caches.keys().catch(() => [] as string[]);
  await Promise.all(keys.filter((k) => k.startsWith("focustime-shell-")).map((k) => caches.delete(k)));
}

// ---- Start ----

/** A view a tapped push asked for when it opened the app (?route=), taken once; the app opens it after its first load. */
export function takeLaunchRoute(): string | null {
  const u = new URL(location.href);
  const r = u.searchParams.get("route");
  if (!r) return null;
  u.searchParams.delete("route");
  history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  return r;
}

export function startPwa(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    changed();
  });
  // Sign-out on this device: push here is removed (while the session still lets it), then the caches go.
  setBeforeSignOut(async () => {
    if (await currentSubscription()) await disablePush();
    await clearShellCaches();
  });
  // Built pages only: the dev UI changes under Vite, and a worker would serve yesterday's files.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: unknown; route?: unknown } | null;
    // A tapped push while the app is open: the same page event as every other notification route.
    if (d?.type === "open-route" && typeof d.route === "string") window.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail: d.route }));
  });
  // The app's module loads after the page (ui/boot.ts), usually after "load" has fired.
  const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
