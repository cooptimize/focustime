// The hosted app's host (A1 stub). Desktop-only operations throw HostUnavailable with a plain message; the rest is
// handed in (secrets, snapshots, photos, the in-app notice inbox), so A2 can back them with Key Vault and the database
// and A6 with in-app notifications without changing core modules. Links open in the page that asked ("client").
import { HostUnavailable, type Host, type KeyProvider, type HostConfig, type HostPaths, type HostSecrets, type Notice, type PhotoCache, type SnapshotStore } from "../types.ts";

/** Where in-app notices go until the page takes them (A6). */
export type NoticeInbox = { add(n: Notice): string; remove(handle: string): void };

export type AzureHostParts = {
  secrets: HostSecrets;
  config: HostConfig;
  snapshotsFor: (userId: string) => SnapshotStore;
  photos: PhotoCache;
  inbox: NoticeInbox;
  keys?: KeyProvider;
  now?: () => Temporal.Instant;
};

const desktopOnly = (what: string) => () => {
  throw new HostUnavailable(what);
};

/** The hosted app keeps no files: every path is a desktop-only question. */
const noPaths: HostPaths = Object.defineProperties({} as HostPaths, Object.fromEntries(["config", "data", "cache", "runtime", "planDb"].map((k) => [k, { get: desktopOnly(`The ${k} folder`), enumerable: true }])));

export function createAzureHost(p: AzureHostParts): Host {
  let demo = false;
  // Shown notices not yet closed, by handle (each resolves its show() when closed).
  const open = new Map<string, () => void>();
  let seq = 0;
  return {
    kind: "azure",
    secrets: p.secrets,
    // A4: the data key wrapped by a Key Vault key, unwrapped by the app's managed identity.
    keys: p.keys ?? { dataKey: async () => desktopOnly("The data key (Key Vault, step A4)")() },
    config: p.config,
    paths: noPaths,
    snapshotsFor: p.snapshotsFor,
    photos: p.photos,
    files: {
      exportPlan: async () => desktopOnly("Saving an export to a folder")(),
      store: { prepare: desktopOnly("A local plan file"), secure: desktopOnly("A local plan file") },
      demoFlag: { get: () => demo, set: async (on) => void (demo = on) },
    },
    loopback: { listen: async () => desktopOnly("Desktop sign-in")() },
    notifications: {
      // P1: a notice stays shown until FocusTime closes it (its occasion was handled, Q91), like a desktop one that
      // waits to be clicked, so the notifier can close it; a click in the page routes through the app, never back
      // through here. The in-app list and push are fed by the person's notifier (server/ticks.ts).
      show: (n, shown) =>
        new Promise<string | null>((resolve) => {
          const h = `${p.inbox.add(n)}-${++seq}`;
          open.set(h, () => resolve(null));
          shown?.(h);
        }),
      close: (h) => {
        open.get(h)?.();
        open.delete(h);
        p.inbox.remove(h.replace(/-\d+$/, ""));
      },
      line: () => {},
    },
    links: { open: async () => "client" },
    media: {
      status: async () => ({ players: false, spotify: false }),
      transition: async () => null,
      open: async () => desktopOnly("Opening a playlist from the server")(),
      endSound: () => {},
    },
    launch: {
      reopen: async () => false,
      openWindow: () => {},
      detached: async () => desktopOnly("Starting a program")(),
      takeOpenRequest: async () => null,
      publish: async () => null,
      unpublish: async () => {},
    },
    clock: { now: p.now ?? (() => Temporal.Now.instant()), zone: () => Temporal.Now.timeZoneId() },
    facts: () => ({ kind: "azure", service: false, configPath: null }),
  };
}
