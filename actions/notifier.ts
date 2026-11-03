// Notifications (step 15.5): the one path every notification takes. Each checker (reminders, the timer, my VM,
// follow-ups, expiring secrets) asks `allows(kind)` before it marks its occasion, then `offer`s the notification; the
// notifier applies Settings > Notifications (switch, quiet hours, holding during focus), keeps held ones in the plan
// store until the session ends, collapses them into one, and routes a click: the notification itself opens FocusTime
// on the right view, a button runs its action. Showing it is the host's job (notify-send today, browser
// notifications in a hosted version), so nothing here is machine-specific.
import { collapse, gate, OPEN_KEY, type AnyKind, type Gate, type GateFacts, type Notice } from "../plan/notify.ts";
import type { PlanStore } from "../store/plan-store.ts";

export const HELD_KEY = "notify_held";
export const HANDLED_MARK = "notice_handled";
const SENT_MARK = "notice_sent";

export type NotifyHost = {
  /**
   * Shows a notification; resolves to the clicked button's key, OPEN_KEY for the notification itself, or null.
   * `shown` hears the host's handle for it, when the host can close notifications (Q91).
   */
  show: (n: Notice, shown?: (handle: string) => void) => Promise<string | null>;
  /** Withdraws a shown notification (Q91), when the notification service allows it. */
  close?: (handle: string) => void;
};

export type OnClick = (key: string) => Promise<void> | void;
/** A notification's own "open" button does what clicking the notification does. */
export const isOpen = (key: string) => key === OPEN_KEY || key === "open";

export type NotifierDeps = {
  plan: PlanStore;
  host: NotifyHost;
  /** Settings > Notifications and the facts the gate needs now. */
  facts: () => Promise<GateFacts>;
  now: () => string;
  /** Opens (or focuses) FocusTime on a route. */
  open: (route: string) => Promise<void> | void;
  /** Runs a notification's button (e.g. timer Done, VM Start). */
  act: (n: Notice, key: string) => Promise<void>;
  /** Whether a held notification still matters when the session ends (the day may have been planned meanwhile). */
  still?: (n: Notice) => Promise<boolean> | boolean;
  /** Step 16.2 (Q91): whether a shown notification's occasion was handled since (it is then closed). */
  done?: (n: Notice) => Promise<boolean> | boolean;
  log?: (op: string, kind: string) => void;
};

export type Notifier = {
  /** Reads Settings and the facts once per tick; `allows` and `offer` use them. */
  refresh: () => Promise<GateFacts>;
  /** Whether a checker may mark its occasion now: not when the switch is off or in quiet hours (it fires later). */
  allows: (kind: AnyKind) => boolean;
  /**
   * Sends, holds or drops one notification; each key goes out (or is held) once. `onClick` (the timer's own buttons)
   * hears every click instead of `act`; it is never kept with a held notification (the timer and meetings aren't held).
   */
  offer: (n: Notice, onClick?: OnClick) => Promise<Gate | "repeat">;
  /** After a focus session: the held ones, still relevant, as one notification. */
  flush: () => Promise<number>;
  /** Shows one now, past every setting and mark (samples for the live check). */
  show: (n: Notice, onClick?: OnClick) => void;
  /** Settings > Notifications > Send a test notification. */
  test: () => Promise<void>;
  /** A click, as the host reported it (exported for tests and for hosts that report clicks separately). */
  click: (n: Notice, key: string, held?: readonly Notice[], onClick?: OnClick) => Promise<void>;
  handled: (key: string) => boolean;
  held: () => Notice[];
  /** Step 16.2 (Q91): closes shown notifications whose occasion was handled; returns how many. */
  sweep: () => Promise<number>;
  /** The keys of the notifications on screen now (shown, not yet clicked, dismissed or closed). */
  onScreen: () => string[];
};

export function createNotifier(d: NotifierDeps): Notifier {
  let facts: GateFacts | null = null;
  const log = d.log ?? (() => {});
  const held = () => d.plan.getState<Notice[]>(HELD_KEY) ?? [];
  const handled = (key: string) => d.plan.marked(HANDLED_MARK, key);

  const click = async (n: Notice, key: string, list: readonly Notice[] = [], onClick?: OnClick) => {
    const known = isOpen(key) || n.buttons.some((b) => b.key === key);
    if (!known) return;
    for (const k of n.kind === "held" ? list.map((h) => h.key) : [n.key]) d.plan.markOnce(HANDLED_MARK, k);
    log("notify_click", isOpen(key) ? "open" : key);
    if (isOpen(key)) await d.open(n.route);
    if (onClick) await onClick(key);
    else if (!isOpen(key)) await d.act(n, key);
  };

  // Q91: the notifications on screen, with the host's handle once it is known.
  const shown = new Map<string, { n: Notice; list: readonly Notice[]; handle: string | null }>();
  const deliver = (n: Notice, list: readonly Notice[] = [], onClick?: OnClick) => {
    log("notify", String(n.kind));
    const entry = { n, list, handle: null as string | null };
    shown.set(n.key, entry);
    // Not awaited: a notification with buttons stays until answered.
    void d.host
      .show(n, (h) => (entry.handle = h))
      .then((key) => {
        if (shown.get(n.key) === entry) shown.delete(n.key);
        return key ? click(n, key, list, onClick) : onClick?.("");
      })
      .catch(() => log("notify", "failed"));
  };
  const isDone = async (n: Notice) => (d.done ? await Promise.resolve(d.done(n)).catch(() => false) : false);

  const notifier: Notifier = {
    refresh: async () => (facts = await d.facts()),
    allows: (kind) => {
      if (!facts) return false;
      const g = gate(kind, facts);
      return g === "send" || g === "hold";
    },
    offer: async (n, onClick) => {
      const f = facts ?? (await notifier.refresh());
      const g = gate(n.kind, f);
      if (g === "off" || g === "quiet") {
        log("notify", `${String(n.kind)}_${g}`);
        return g;
      }
      if (n.kind !== "test" && !d.plan.markOnce(SENT_MARK, n.key)) return "repeat";
      if (g === "hold") {
        d.plan.setState(HELD_KEY, [...held().filter((h) => h.key !== n.key), n].slice(-50));
        log("notify", `${String(n.kind)}_held`);
        return "hold";
      }
      deliver(n, [], onClick);
      return "send";
    },
    flush: async () => {
      const list = held();
      if (!list.length) return 0;
      const f = facts ?? (await notifier.refresh());
      if (f.focusRunning) return 0;
      d.plan.setState(HELD_KEY, []);
      const keep: Notice[] = [];
      for (const n of list) if (!handled(n.key) && (!d.still || (await Promise.resolve(d.still(n)).catch(() => true)))) keep.push(n);
      const one = collapse(keep, d.now());
      if (!one) return 0;
      deliver(one, keep);
      return keep.length;
    },
    test: async () => {
      deliver({ kind: "test", key: `test:${d.now()}`, title: "FocusTime", body: "Test notification. Click it to open Settings > Notifications.", buttons: [], route: "settings:notifications", at: d.now() });
    },
    show: (n, onClick) => deliver(n, [], onClick),
    sweep: async () => {
      if (!d.host.close || !d.done) return 0;
      let closed = 0;
      for (const [key, e] of [...shown]) {
        if (!e.handle || e.n.kind === "test") continue;
        // Plain samples stay (they are for looking at); live samples and real ones close.
        if (key.startsWith("sample:") && !key.startsWith("sample:live:")) continue;
        const list = e.n.kind === "held" ? e.list : [e.n];
        let all = list.length > 0;
        for (const x of list) if (!(await isDone(x))) all = false;
        if (!all || shown.get(key) !== e) continue;
        shown.delete(key);
        for (const x of list) d.plan.markOnce(HANDLED_MARK, x.key);
        d.host.close(e.handle);
        log("notify_closed", String(e.n.kind));
        closed++;
      }
      return closed;
    },
    onScreen: () => [...shown.keys()],
    click,
    handled,
    held,
  };
  return notifier;
}
