// The hosted app's host (A1 stub). Desktop-only operations throw HostUnavailable with a plain message; the rest is
// handed in (secrets, snapshots, photos, the in-app notice inbox), so A2 can back them with Key Vault and the database
// and A6 with in-app notifications without changing core modules. Links open in the page that asked ("client").
import { HostUnavailable, type Host, type HostConfig, type HostPaths, type HostSecrets, type Notice, type PhotoCache, type SnapshotStore } from "../types.ts";

/** Where in-app notices go until the page takes them (A6). */
export type NoticeInbox = { add(n: Notice): string; remove(handle: string): void };

export type AzureHostParts = {
  secrets: HostSecrets;
  config: HostConfig;
  snapshots: SnapshotStore;
  photos: PhotoCache;
  inbox: NoticeInbox;
  now?: () => Temporal.Instant;
};

const desktopOnly = (what: string) => () => {
  throw new HostUnavailable(what);
};

/** The hosted app keeps no files: every path is a desktop-only question. */
const noPaths: HostPaths = Object.defineProperties({} as HostPaths, Object.fromEntries(["config", "data", "cache", "runtime", "planDb"].map((k) => [k, { get: desktopOnly(`The ${k} folder`), enumerable: true }])));

export function createAzureHost(p: AzureHostParts): Host {
  let demo = false;
  return {
    kind: "azure",
    secrets: p.secrets,
    config: p.config,
    paths: noPaths,
    snapshots: p.snapshots,
    photos: p.photos,
    files: {
      exportPlan: async () => desktopOnly("Saving an export to a folder")(),
      store: { prepare: desktopOnly("A local plan file"), secure: desktopOnly("A local plan file") },
      demoFlag: { get: () => demo, set: async (on) => void (demo = on) },
    },
    loopback: { listen: async () => desktopOnly("Desktop sign-in")() },
    notifications: {
      show: async (n, shown) => {
        shown?.(p.inbox.add(n));
        // A click in the page routes through the app (A6), never back through here.
        return null;
      },
      close: (h) => p.inbox.remove(h),
      line: () => {},
    },
    links: { open: async () => "client" },
    media: {
      status: async () => ({ playerctl: false, spotify: false }),
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
