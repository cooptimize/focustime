// The local host (A1): the developer loop on one Linux machine. Secret Service through secret-tool, XDG folders,
// notify-send, playerctl, PipeWire, xdg-open and Chromium. Only server/ imports this; core modules see the Host type.
import type { Host } from "../types.ts";
import { clearWritePat, deleteSecret, getSecret, getWritePat, secretState, setAppSecret, setSecret, setWritePat } from "./keyring.ts";
import { localPaths } from "./paths.ts";
import { createSnapshotStore } from "./snapshots.ts";
import { createPhotoCache } from "./photos.ts";
import { localFiles } from "./files.ts";
import { createLoopback } from "./loopback.ts";
import { closeDesktopNotification, desktopNotify, notifySend } from "./notify.ts";
import { localLaunch, localLinks, type LaunchOptions } from "./launch.ts";
import { mediaControl, playEndSound } from "./media.ts";

export type LocalHostOptions = Omit<LaunchOptions, "runtimeDir" | "service"> & {
  /** The server's clock (real time, or a pinned start running forward with --clock). */
  now: () => Temporal.Instant;
  env?: NodeJS.ProcessEnv;
};

export function createLocalHost(o: LocalHostOptions): Host {
  const env = o.env ?? process.env;
  const paths = localPaths(env);
  const service = !!env.INVOCATION_ID;
  const launch = localLaunch({ ...o, runtimeDir: paths.runtime, service });
  return {
    kind: "local",
    secrets: {
      get: (a) => getSecret(a),
      set: (a, v) => setSecret(a, v),
      delete: (a) => deleteSecret(a),
      state: (a) => secretState(a),
      setApp: (a, v) => setAppSecret(a, v),
      writePat: { get: (k) => getWritePat(k), set: (k, v) => setWritePat(k, v), clear: (k) => clearWritePat(k) },
    },
    paths,
    snapshots: createSnapshotStore(paths.cache),
    photos: createPhotoCache(paths.cache),
    files: localFiles(paths),
    loopback: createLoopback(),
    notifications: {
      show: (n, shown) => (o.headless ? Promise.resolve(null) : desktopNotify(n, shown)),
      close: (h) => closeDesktopNotification(h),
      line: (title, body) => (o.headless ? undefined : notifySend(title, body)),
    },
    links: localLinks(launch.detached),
    media: { ...mediaControl({ open: launch.detached }), endSound: playEndSound },
    launch,
    clock: { now: o.now, zone: () => Temporal.Now.timeZoneId() },
    facts: () => ({ kind: "local", service, configPath: paths.config }),
  };
}
