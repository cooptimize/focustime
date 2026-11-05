// P1: in-app notifications. What the notifier delivered (after its gate) is listed under ⋯ › Notifications, newest
// first, with an unread dot on ⋯; while the app is open a new one also shows as a toast for a few seconds. Opening the
// list marks everything read; a notice opens its view. Nothing here makes a notice.
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InAppNotice, NoticeList } from "../plan/push.ts";
import { call } from "./api.ts";

const POLL_MS = 30_000;
/** Something just sent one (Settings' test): look again shortly instead of waiting for the next poll. */
export const NOTICES_CHANGED = "focustime:notices";
const TOAST_MS = 7_000;

/** The list, polled while the page is visible; new unread notices since the last look come back as toasts. */
export function useNotices(enabled: boolean) {
  const [list, setList] = useState<NoticeList>({ items: [], unread: 0 });
  const [toasts, setToasts] = useState<InAppNotice[]>([]);
  const seen = useRef<Set<number> | null>(null);
  const latest = useRef(list);
  latest.current = list;
  const refresh = useCallback(async (background = false) => {
    const next = await call<NoticeList>("notices.list", {}, { background }).catch(() => null);
    if (!next) return;
    // The first look only learns what is there: no toast for what came before this page opened.
    const fresh = seen.current ? next.items.filter((n) => !n.read && !n.closed && !seen.current!.has(n.id)) : [];
    seen.current = new Set(next.items.map((n) => n.id));
    setList(next);
    if (fresh.length) setToasts((t) => [...fresh.slice(0, 3).reverse(), ...t].slice(0, 3));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh(true);
    // HK-3: the poll is a timer's call, never someone using FocusTime.
    const tick = () => document.visibilityState === "visible" && void refresh(true);
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    const soon = () => window.setTimeout(() => void refresh(true), 800);
    window.addEventListener(NOTICES_CHANGED, soon);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener(NOTICES_CHANGED, soon);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((t) => t.slice(0, -1)), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toasts]);
  /** Marks all read on the server; returns the list as it was, so the panel can still show which were new. */
  const readAll = useCallback((): InAppNotice[] => {
    const before = latest.current.items;
    setList((l) => ({ items: l.items.map((n) => ({ ...n, read: true })), unread: 0 }));
    setToasts([]);
    void call("notices.read", {}).catch(() => null);
    return before;
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((n) => n.id !== id));
    void call("notices.read", { ids: [id] }).catch(() => null);
  }, []);
  return { ...list, toasts, refresh, readAll, dismiss };
}

/** The first line of a notice body (bodies end with "Click to …" for the desktop). */
const firstLine = (body: string) => body.split("\n").find((l) => l.trim() && !/^Click to /.test(l)) ?? "";

function when(at: string, now: number): string {
  const t = Date.parse(at.replace(/\[.*\]$/, ""));
  if (!Number.isFinite(t)) return "";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** ⋯ › Notifications: a sheet with the list; full screen on the phone. */
export function NoticesPanel({ items, onOpen, onClose }: { items: InAppNotice[]; onOpen: (route: string) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useReturnFocus();
  useEffect(() => close.current?.focus(), []);
  const now = Date.now();
  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="command-menu notices-panel"
        data-overlay="modal"
        role="dialog"
        aria-label="Notifications"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.preventDefault(), onClose());
        }}
      >
        <div className="command-head">
          <span className="command-step-title">Notifications</span>
          <CloseButton buttonRef={close} onClose={onClose} />
        </div>
        {items.length ? (
          <ul className="notice-list">
            {items.map((n) => (
              <li key={n.id} className={n.read ? "notice-row" : "notice-row unread"}>
                <button type="button" onClick={() => n.route && onOpen(n.route)} disabled={!n.route}>
                  <span className="nr-title">
                    {!n.read && <span className="nr-dot" aria-label="New" />}
                    {n.title}
                  </span>
                  {firstLine(n.body) && <span className="nr-body">{firstLine(n.body)}</span>}
                  <span className="nr-when muted">
                    {when(n.at, now)}
                    {n.closed ? " · done" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice-empty muted">Nothing yet. Reminders, the timer and follow-ups due show here, and on this device if you turn on push in Settings › Notifications.</p>
        )}
      </div>
    </div>
  );
}

/** New notices while the app is open: a few seconds each, at the bottom; a tap opens the view. */
export function NoticeToasts({ toasts, onOpen, onDismiss }: { toasts: InAppNotice[]; onOpen: (n: InAppNotice) => void; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="notice-toasts" role="status" aria-live="polite">
      {toasts.map((n) => (
        <div key={n.id} className="notice-toast">
          <button type="button" className="nt-main" onClick={() => onOpen(n)}>
            <span className="nt-title">{n.title}</span>
            {firstLine(n.body) && <span className="nt-body">{firstLine(n.body)}</span>}
          </button>
          <button type="button" className="mini nt-x" aria-label="Dismiss" onClick={() => onDismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
