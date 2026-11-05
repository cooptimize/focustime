// ADM-1: what the admin console reads and does on this FocusTime (server/main.ts hands in the stores; the demo has
// its own in server/demo.ts). Names, dates, counts and yes or no only: never anyone's plan, picks, follow-ups,
// captures, focus sessions, tokens, PATs, AI request text, or chat messages. Each read below is a count or a flag.
import type { AdminCheck } from "../actions/admin.ts";
import type { AdminOps, PersonHealth } from "../actions/admin-actions.ts";
import type { FeedbackSetup } from "../actions/feedback-types.ts";
import type { OrgRuntime } from "../actions/org.ts";
import { SETUP_STEPS, type SetupState } from "../plan/setup.ts";
import type { ClientChat } from "../plan/requests.ts";
import type { ConversationCounts } from "../store/conversation-store.ts";
import type { DirectoryRead } from "../sources/dataverse/directory.ts";
import type { UserRow } from "../store/accounts.ts";
import type { UserSecretAccount } from "../store/user-secrets.ts";
import type { BuildInfo } from "./buildinfo.ts";
import type { Logger } from "../log/logger.ts";

export type AdminOpsDeps = {
  check: AdminCheck;
  org: OrgRuntime;
  groupId: string | null;
  breakGlass: readonly string[];
  tenantId: string | null;
  users: () => Promise<UserRow[]>;
  /** Only what Admin › People shows from a person's store: Setup's progress and which clients have a DevOps identity. */
  personStore: (userId: string, zone: string | null) => { setupState(): Promise<SetupState>; devopsIdentities(): Promise<{ clientKey: string }[]> };
  /** Whether a secret is there (never its value). */
  hasSecret: (userId: string, account: UserSecretAccount) => Promise<boolean>;
  chats: () => Promise<ClientChat[]>;
  /** CV-1's counts for a day (never text or ids); null where there is no conversation store. */
  conversationCounts?: ((day: string) => Promise<ConversationCounts>) | null;
  ai: () => Promise<{ provider: string; keyConfigured: boolean }>;
  appSpentMicros: () => Promise<number>;
  feedback: () => Promise<FeedbackSetup | null>;
  build: BuildInfo;
  /** Dataverse's people and leads, read with the app's reader; null when Dataverse isn't set up here. */
  directory: (() => Promise<{ ok: true; read: DirectoryRead } | { ok: false; message: string }>) | null;
  removePerson: (userId: string) => Promise<void>;
  /** ADM-2: when the scheduler last ran each job (by name), for Admin › Status; absent: unknown. */
  lastRuns?: () => Record<string, string>;
  log: Logger;
};

/** Setup's state in a word: done, skipped (closed with steps left), started, or not started. */
export function setupWord(st: SetupState): PersonHealth["setup"] {
  const v = SETUP_STEPS.map((k) => st[k]);
  if (v.every((x) => x === "done")) return "done";
  if (v.every((x) => !x)) return "not_started";
  return v.some((x) => x === "skipped" || x === "dismissed") ? "skipped" : "started";
}

const writePat = (clientKey: string): UserSecretAccount => `devops-write-pat:${clientKey}`;

export function createAdminOps(d: AdminOpsDeps): AdminOps {
  let lastDirectory: { ok: boolean; message: string | null } = { ok: true, message: null };
  const ops: AdminOps = {
    check: d.check,
    org: d.org,
    groupId: d.groupId,
    breakGlass: d.breakGlass,
    tenantId: d.tenantId,
    async people() {
      const out: PersonHealth[] = [];
      for (const u of await d.users()) {
        if (u.deletedAt) continue;
        const store = d.personStore(u.id, u.timeZone);
        const [st, ids, ms, gs] = await Promise.all([
          store.setupState().catch((): SetupState => ({})),
          store.devopsIdentities().catch(() => []),
          d.hasSecret(u.id, "outlook-refresh-token").catch(() => false),
          d.hasSecret(u.id, "google-refresh-token").catch(() => false),
        ]);
        let writes = 0;
        for (const i of ids) if (await d.hasSecret(u.id, writePat(i.clientKey)).catch(() => false)) writes++;
        out.push({ id: u.id, name: u.displayName || u.upn, email: u.email ?? u.upn, lastSignInAt: u.lastSignInAt, setup: setupWord(st), sources: { microsoft: ms, google: gs, devopsWrites: writes } });
      }
      return out;
    },
    chatClients: async () => [...new Set([...(await d.chats()).map((c) => c.clientKey), ...(await d.org.store.peopleClients()).map((c) => c.clientKey)])].sort(),
    aiSetUp: d.ai,
    appSpentMicros: d.appSpentMicros,
    async status(day) {
      const [chats, setup, refreshedAt, ai, users, conversations] = await Promise.all([d.chats(), d.feedback().catch(() => null), d.org.store.directoryRefreshedAt(), d.ai(), d.users(), d.conversationCounts ? d.conversationCounts(day).catch(() => null) : Promise.resolve(null)]);
      const names = new Map(users.map((u) => [u.id.toLowerCase(), u.displayName || u.upn]));
      // A chat's name, client, switch and poll state; whose sign-in read it last (a name). Never its messages or members.
      const health = chats.map((c) => ({ chatId: c.chatId, clientKey: c.clientKey, name: c.displayName, reading: c.readOn, polledAt: c.polledAt, state: c.pollState, note: c.pollNote, via: c.tokenUser ? (names.get(c.tokenUser.toLowerCase()) ?? null) : null }));
      const polled = health.map((c) => c.polledAt).filter((x): x is string => !!x).sort();
      return {
        environment: d.build.env,
        version: { env: d.build.env, sha: d.build.sha, pr: d.build.pr, builtAt: d.build.builtAt },
        ai,
        feedback: setup
          ? { ok: setup.state === "ready" || setup.state === "local", message: setup.state === "ready" ? `Ready: stories go under #${setup.parentId}` : setup.state === "local" ? "Preview only in the developer loop" : setup.reason }
          : { ok: false, message: "Couldn't check" },
        dataverse: { refreshedAt, ...lastDirectory },
        chats: health,
        lastPoll: polled.at(-1) ?? null,
        conversations,
        lastRuns: d.lastRuns?.() ?? {},
      };
    },
    async refreshPeople() {
      if (!d.directory) {
        lastDirectory = { ok: false, message: "Dataverse isn't set up for this FocusTime" };
        return { ...lastDirectory, people: 0 };
      }
      const r = await d.directory().catch(() => ({ ok: false as const, message: "" }));
      if (!r.ok) {
        lastDirectory = { ok: false, message: "Dataverse couldn't be read. FocusTime keeps the last levels and leads it read." };
        return { ...lastDirectory, people: 0 };
      }
      await d.org.store.replaceDirectory(r.read.people, r.read.leads, r.read.clients, r.read.accounts);
      d.org.invalidate();
      lastDirectory = { ok: true, message: null };
      return { ok: true, message: null, people: r.read.people.length };
    },
    async removePerson(id) {
      await d.removePerson(id);
      d.log({ source: "plan", op: "data_delete", kind: "admin_removed" });
    },
  };
  return ops;
}
