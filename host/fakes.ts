// An in-memory Host for tests (A1): every part works without the machine, and records what it was asked to do.
import { Pat } from "../sources/devops/pat.ts";
import { perPerson } from "./per-person.ts";
import { parseConfig, setSystemUserIdInText } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { NEUTRAL_ZONE } from "../week/zone.ts";

const STARTER_TOML = starterToml(NEUTRAL_ZONE);
import { SECRET_ACCOUNTS, SecretError, WRITABLE_ACCOUNTS, type CachedPhoto, type Host, type HostConfig, type HostSecrets, type Notice, type PhotoCache, type Snapshot, type SnapshotStore } from "./types.ts";

export function memorySecrets(initial: Record<string, string> = {}, opts: { locked?: boolean } = {}): HostSecrets & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  const guard = () => {
    if (opts.locked) throw new SecretError("locked");
  };
  const read = (k: string) => {
    guard();
    const v = store.get(k);
    if (v === undefined) throw new SecretError("not_found");
    return v;
  };
  return {
    store,
    get: async (a) => {
      if (!SECRET_ACCOUNTS.includes(a)) throw new Error("Unknown account");
      return read(a);
    },
    set: async (a, v) => {
      if (!WRITABLE_ACCOUNTS.includes(a)) throw new Error("This account is read-only for FocusTime");
      guard();
      store.set(a, v);
    },
    delete: async (a) => {
      if (!WRITABLE_ACCOUNTS.includes(a)) throw new Error("This account is read-only for FocusTime");
      guard();
      store.delete(a);
    },
    state: async (a) => {
      if (opts.locked) return "locked";
      return store.has(a) ? "set" : "missing";
    },
    setApp: async (a, v) => {
      if (!v || v.length > 1024 || /[\r\n]/.test(v)) throw new Error("A secret is one line of 1 to 1024 characters");
      guard();
      store.set(a, v);
    },
    writePat: {
      get: async (k) => new Pat(read(`devops-write-pat:${k}`)),
      set: async (k, v) => {
        if (!v || /\s/.test(v)) throw new Error("A PAT is one line with no spaces");
        guard();
        store.set(`devops-write-pat:${k}`, v);
      },
      clear: async (k) => void store.delete(`devops-write-pat:${k}`),
    },
  };
}

/** Settings kept as config text in memory: validated like the file, with no backups. */
/** A fixed data key for the fake host (tests only). */
export const FAKE_DATA_KEY = new Uint8Array(32).fill(7);

export function memoryConfig(initial = STARTER_TOML, app: string | null = null): HostConfig & { text: () => string } {
  let text = initial;
  return {
    text: () => text,
    app: async () => app,
    load: async () => ({ path: "memory", parsed: parseConfig(text) }),
    raw: async () => text,
    write: async (edit) => {
      const next = edit(text);
      const parsed = parseConfig(next);
      if (!parsed.ok) return { ok: false, parsed };
      text = next;
      return { ok: true, parsed, backup: "memory" };
    },
    saveSystemUserId: async (id) => void (text = setSystemUserIdInText(text, id)),
  };
}

export function memorySnapshots(): SnapshotStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    read: async <T,>(source: string, key: string) => (structuredClone(data.get(`${source}/${key}`)) as Snapshot<T> | undefined) ?? null,
    write: async (source, key, snap) => void data.set(`${source}/${key}`, structuredClone(snap)),
    clear: async (source) => {
      for (const k of [...data.keys()]) if (k.startsWith(`${source}/`)) data.delete(k);
    },
  };
}

export function memoryPhotos(): PhotoCache & { data: Map<string, CachedPhoto> } {
  const data = new Map<string, CachedPhoto>();
  return { data, read: async (id) => data.get(id) ?? null, write: async (id, e) => void data.set(id, e), clear: async () => data.clear() };
}

/** What the fake host was asked to do, in order. */
export type FakeHostLog = { shown: Notice[]; closed: string[]; lines: string[]; links: string[]; launched: string[][]; exports: string[] };

export function createFakeHost(o: { now?: () => Temporal.Instant; zone?: string; secrets?: Record<string, string> } = {}): Host & { record: FakeHostLog } {
  const record: FakeHostLog = { shown: [], closed: [], lines: [], links: [], launched: [], exports: [] };
  let demo = false;
  let n = 0;
  return {
    kind: "local",
    record,
    secrets: memorySecrets(o.secrets),
    keys: { dataKey: async () => FAKE_DATA_KEY },
    config: memoryConfig(),
    paths: { config: "/fake/config.toml", data: "/fake/data", cache: "/fake/cache", runtime: "/fake/run", planDb: ":memory:" },
    snapshotsFor: perPerson(() => memorySnapshots()),
    photos: memoryPhotos(),
    files: {
      exportPlan: async (json) => (record.exports.push(json), "/fake/data/exports/plan.json"),
      store: { prepare: () => {}, secure: () => {} },
      demoFlag: { get: () => demo, set: async (on) => void (demo = on) },
    },
    loopback: {
      listen: async () => ({ redirectUri: "http://localhost:1/", wait: async () => ({ error: "timeout" as const }), close: () => {} }),
    },
    notifications: {
      show: async (notice, shown) => {
        record.shown.push(notice);
        shown?.(String(++n));
        return null;
      },
      close: (h) => void record.closed.push(h),
      line: (t, b) => void record.lines.push(`${t}: ${b}`),
    },
    links: { open: async (url) => (record.links.push(url), "opened") },
    media: { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} },
    launch: {
      reopen: async () => false,
      openWindow: () => {},
      detached: async (argv) => void record.launched.push(argv),
      takeOpenRequest: async () => null,
      publish: async () => null,
      unpublish: async () => {},
    },
    clock: { now: o.now ?? (() => Temporal.Now.instant()), zone: () => o.zone ?? NEUTRAL_ZONE },
    facts: () => ({ kind: "local", service: false, configPath: "/fake/config.toml" }),
  };
}
