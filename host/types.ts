// The host boundary (A1): every operating system touch FocusTime makes goes through one Host, chosen at startup
// (FOCUSTIME_HOST=local|azure). Core modules (week/, plan/, actions/, sources/, store/) import this file only, never an
// implementation: host/local is the developer loop on one Linux machine, host/azure is the hosted web app.
// This module is types and plain values only, so anything may import it.
import type { Pat } from "../sources/devops/pat.ts";
import type { Notice } from "../plan/notify.ts";

export type { Notice };
import type { TimerLike } from "../plan/focussound.ts";
import type { ParseResult } from "../config/schema.ts";
import type { WriteResult } from "../config/edit.ts";

export type HostKind = "local" | "azure";

/** A desktop-only operation asked of the hosted app. The message is plain and safe to show. */
export class HostUnavailable extends Error {
  readonly code = "not_available";
  constructor(what: string) {
    super(`${what} is not available in the hosted app`);
    this.name = "HostUnavailable";
  }
}

// ---- Secrets ----

/**
 * App secrets set up outside FocusTime: read-only, except Settings may replace the first two. A2: the "FocusTime" Entra
 * registration's client secret (written by infra/scripts/app-registration.sh, never by FocusTime). A3: the SQL login's
 * password for a local SQL Server container (npm run db:up writes it; the hosted app signs in with its identity).
 * AI-0: the OpenAI API key for the developer loop, only when [ai] provider = "openai" (the hosted app reads ft-openai-key
 * from Key Vault; docs/azure/runbook.md).
 */
export type AppSecretAccount = "dataverse-client-secret" | "google-client-secret" | "entra-client-secret" | "sql-password" | "openai-api-key";
/** Refresh tokens FocusTime writes after sign-in and clears on disconnect. */
export type RefreshTokenAccount = "outlook-refresh-token" | "google-refresh-token";
export type SecretAccount = AppSecretAccount | RefreshTokenAccount;
export const SECRET_ACCOUNTS: readonly SecretAccount[] = ["dataverse-client-secret", "google-client-secret", "entra-client-secret", "sql-password", "openai-api-key", "outlook-refresh-token", "google-refresh-token"];
export const WRITABLE_ACCOUNTS: readonly RefreshTokenAccount[] = ["outlook-refresh-token", "google-refresh-token"];

export type SecretErrorKind = "not_found" | "unavailable" | "locked";
/** Why a secret couldn't be read or written. Never carries the value. */
export class SecretError extends Error {
  readonly kind: SecretErrorKind;
  constructor(kind: SecretErrorKind) {
    super(`Secret storage: ${kind}`);
    this.name = "SecretError";
    this.kind = kind;
  }
}
export type SecretState = "set" | "missing" | "locked" | "unavailable";

/** The secret store: values go in and come out here only, never logged, cached, exported or returned to the UI. */
export type HostSecrets = {
  get(account: SecretAccount): Promise<string>;
  set(account: RefreshTokenAccount, value: string): Promise<void>;
  delete(account: RefreshTokenAccount): Promise<void>;
  /** Whether an account has an entry, without keeping its value. */
  state(account: SecretAccount): Promise<SecretState>;
  /** An app client secret entered in Settings. */
  setApp(account: AppSecretAccount, value: string): Promise<void>;
  /** Personal DevOps write PATs, one per client; read back only wrapped in Pat. */
  writePat: {
    get(clientKey: string): Promise<Pat>;
    set(clientKey: string, value: string): Promise<void>;
    clear(clientKey: string): Promise<void>;
  };
};

// ---- Paths and files ----

/** Where FocusTime keeps its files. The hosted app has none (its data is in the database). */
export type HostPaths = {
  config: string;
  data: string;
  cache: string;
  runtime: string;
  planDb: string;
};

/** Last good snapshot per source per week (normalized fields only; no secrets, tokens or raw bodies). */
export type Snapshot<T> = { fetchedAt: string; items: T[]; children?: T[] };
export type SnapshotStore = {
  read<T>(source: string, key: string): Promise<Snapshot<T> | null>;
  write<T>(source: string, key: string, snap: Snapshot<T>): Promise<void>;
  /** Drops every snapshot of one source (a calendar's disconnect). */
  clear(source: string): Promise<void>;
};

export type CachedPhoto = { fetchedAt: string; photo: { type: string; bytes: Uint8Array } | null };
/** Profile photos, kept 7 days; never in the plan store; cleared on sign-out. */
export type PhotoCache = {
  read(id: string): Promise<CachedPhoto | null>;
  write(id: string, entry: CachedPhoto): Promise<void>;
  clear(): Promise<void>;
};

/** The local plan store's file: its folder made private before opening, the file and its backups kept 0600. */
export type StoreFiles = {
  prepare(path: string): void;
  secure(path: string): void;
};

export type HostFiles = {
  /** Writes a plan export and returns where it went. */
  exportPlan(json: string): Promise<string>;
  store: StoreFiles;
  /** Whether demo mode was left on (a flag next to the store), and switching it. */
  demoFlag: { get(): boolean; set(on: boolean): Promise<void> };
};

// ---- Settings ----

export type LoadedConfig = { path: string; parsed: ParseResult; created?: boolean };
/** The person's settings (local: config.toml with backups; hosted: the database in A2). */
export type HostConfig = {
  /** A2: the app config's text (local: ~/.config/focustime/app.toml), null when there is none; env overrides it. */
  app(): Promise<string | null>;
  load(): Promise<LoadedConfig>;
  /** A2: the settings file's text as it is (read once more to seed its owner's settings rows); null when none. */
  raw(): Promise<string | null>;
  /** Validates the edited text before anything is written; keeps a backup. */
  write(edit: (text: string) => string): Promise<WriteResult>;
  saveSystemUserId(id: string): Promise<void>;
};

// ---- Sign-in ----

export type LoopbackResult = { code: string } | { error: "denied" | "timeout" | "failed" };
/** A one-shot listener for a desktop OAuth redirect (authorization code + PKCE). */
export type LoopbackListener = {
  redirectUri: string;
  wait(state: string, timeoutMs: number, page: (ok: boolean) => string): Promise<LoopbackResult>;
  close(): void;
};
export type Loopback = { listen(redirectHost: "localhost" | "127.0.0.1"): Promise<LoopbackListener> };

// ---- Notifications, links, media, launch ----

/** Shows notices and routes their clicks: resolves with the action key chosen (OPEN_KEY for the body), or null. */
export type HostNotifications = {
  show(n: Notice, shown?: (handle: string) => void): Promise<string | null>;
  /** Withdraws a shown notice whose occasion was handled. */
  close(handle: string): void;
  /** One plain line with no buttons or click. */
  line(title: string, body: string): void;
};

export type HostLinks = {
  /**
   * Opens a link in the person's browser. "opened": the host did it; "client": the page that asked opens it (the
   * hosted app, where the server can't reach the person's screen).
   */
  open(url: string): Promise<"opened" | "client">;
};

export type MediaControl = {
  /** players: whether music players can be paused and resumed here. */
  status: () => Promise<{ players: boolean; spotify: boolean }>;
  /** Pause or resume players on a timer change (only when enabled and a player control is there). Never throws. */
  transition: (prev: TimerLike, next: TimerLike, enabled: boolean) => Promise<"pause" | "play" | null>;
  /** Opens one validated playlist target (https:// or spotify:). */
  open: (target: string) => Promise<void>;
};
export type HostMedia = MediaControl & {
  /** A short sound when a session ends. Fire and forget. */
  endSound(): void;
};

export type HostLaunch = {
  /** Brings the app to the front (or opens a window), when the host can. */
  reopen(): Promise<boolean>;
  /** Opens the app window on its launch link at first start. */
  openWindow(url: string): void;
  /** Starts a program from an argument array (no shell), detached. Desktop only. */
  detached(argv: string[]): Promise<void>;
  /** A view the launcher asked for (capture), taken once. */
  takeOpenRequest(): Promise<string | null>;
  /** Writes the launch link where the launcher reads it (private), and removes it on stop. */
  publish(url: string): Promise<string | null>;
  unpublish(): Promise<void>;
};

// ---- Clock and process facts ----

export type HostClock = {
  now(): Temporal.Instant;
  /** The neutral default time zone for someone who hasn't set one: the host clock's. */
  zone(): string;
};

/** What the UI may show about how FocusTime runs. */
export type HostFacts = {
  kind: HostKind;
  /** Running under the developer service (systemd). */
  service: boolean;
  /** The config file shown in Settings; null when there is none to show. */
  configPath: string | null;
};

/**
 * A2: the app's data key (32 bytes), which seals each person's secrets in the store (store/user-secrets.ts). Local:
 * kept in the host's secret store (account data-key, made on first use). Hosted (A4): wrapped by a Key Vault key.
 */
export type KeyProvider = { dataKey: () => Promise<Uint8Array> };


export interface Host {
  readonly kind: HostKind;
  secrets: HostSecrets;
  keys: KeyProvider;
  config: HostConfig;
  paths: HostPaths;
  /** A2: each person's own snapshot cache (one person's last good week never shows for another). */
  snapshotsFor(userId: string): SnapshotStore;
  photos: PhotoCache;
  files: HostFiles;
  loopback: Loopback;
  notifications: HostNotifications;
  links: HostLinks;
  media: HostMedia;
  launch: HostLaunch;
  clock: HostClock;
  facts(): HostFacts;
}
