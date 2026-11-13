// ADM-1: what the admin console reads and does on this FocusTime (server/main.ts hands in the stores; the demo has
// its own in server/demo.ts). Names, dates, counts and yes or no only: never anyone's plan, picks, follow-ups,
// captures, focus sessions, tokens, PATs, AI request text, or chat messages. Each read below is a count or a flag.
import type { StandardsPort } from "../actions/standards.ts";
import type { StatusRegistry } from "../actions/status-rows.ts";
import type { AdminCheck } from "../actions/admin.ts";
import type { AdminOps, PersonHealth } from "../actions/admin-actions.ts";
import type { OrgRuntime } from "../actions/org.ts";
import { LATE_STEPS, SETUP_STEPS, type SetupState } from "../plan/setup.ts";
import type { ClientChat } from "../plan/requests.ts";
import type { ConversationCounts } from "../store/conversation-store.ts";
import type { DirectoryRead } from "../sources/dataverse/directory.ts";
import type { UserRow } from "../store/accounts.ts";
import type { UserSecretAccount } from "../store/user-secrets.ts";
import type { BuildInfo } from "./buildinfo.ts";
import type { Logger } from "../log/logger.ts";

export type AdminOpsDeps = {
  /** KB-1: the synced standards. */
  standards?: StandardsPort;
  /** RB-1: Code's view log and each client's code status. */
  code?: AdminOps["code"];
  /** DV-1: the status rows registry Admin › Status renders (DevOps polling, and later sources). */
  statusRows?: StatusRegistry;
  check: AdminCheck;
  org: OrgRuntime;
  groupId: string | null;
  breakGlass: readonly string[];
  tenantId: string | null;
  users: () => Promise<UserRow[]>;
  /** Only what Admin › People shows from a person's store: Setup's progress and which clients have a DevOps identity. */
  personStore: (userId: string, zone: string | null) => { setupState(): Promise<SetupState>; devopsIdentities(): Promise<{ clientKey: string }[]> };
  /** IN-1: whether a person has the FocusTime app in Teams (a 1:1 chat with the bot, not removed); null: unknown here. */
  teamsApp?: ((userId: string) => Promise<boolean>) | null;
  /** IN-1: each person's latest request in a live session. */
  lastSeen?: () => Promise<Map<string, string>>;
  /** IN-1: the app's public URL and the Teams app's link (null where the Teams app isn't set up). */
  invite?: { appUrl: string; teamsAppLink: string | null };
  /** Whether a secret is there (never its value). */
  hasSecret: (userId: string, account: UserSecretAccount) => Promise<boolean>;
  chats: () => Promise<ClientChat[]>;
  /** CV-1's counts for a day (never text or ids); null where there is no conversation store. */
  conversationCounts?: ((day: string) => Promise<ConversationCounts>) | null;
  ai: () => Promise<{ provider: string; keyConfigured: boolean }>;
  appSpentMicros: () => Promise<number>;
  /** FB-1: where Send feedback goes (each person sends with their own DevOps write PAT); null when nothing is set. */
  feedback: () => Promise<{ org: string; project: string; parentId: number } | null>;
  build: BuildInfo;
  /** Dataverse's people and leads, read with the app's reader; null when Dataverse isn't set up here. */
  directory: (() => Promise<{ ok: true; read: DirectoryRead } | { ok: false; message: string }>) | null;
  removePerson: (userId: string) => Promise<void>;
  /** ADM-2: when the scheduler last ran each job (by name), for Admin › Status; absent: unknown. */
  lastRuns?: () => Record<string, string>;
  /** AH-2: Admin › Clients' scope facts per client (the poller's store). */
  scope?: AdminOps["scope"];
  /** AH-3: each client's DevOps assignees from the poller's store (emails stay on the server). */
  assignees?: AdminOps["assignees"];
  log: Logger;
};

/** Setup's state in a word: done, skipped (closed with steps left), started, or not started. */
export function setupWord(st: SetupState): PersonHealth["setup"] {
  // VM-2: the late steps (Your VM) don't change the word for people who finished before they existed.
  const v = SETUP_STEPS.filter((k) => !LATE_STEPS.has(k)).map((k) => st[k]);
  if (v.every((x) => x === "done")) return "done";
  if (v.every((x) => !x)) return "not_started";
  return v.some((x) => x === "skipped" || x === "dismissed") ? "skipped" : "started";
}

const writePat = (clientKey: string): UserSecretAccount => `devops-write-pat:${clientKey}`;

export function createAdminOps(d: AdminOpsDeps): AdminOps {
  let lastDirectory: { ok: boolean; message: string | null } = { ok: true, message: null };
  const ops: AdminOps = {
    ...(d.standards ? { standards: d.standards } : {}),
    ...(d.code ? { code: d.code } : {}),
    ...(d.statusRows ? { statusRows: d.statusRows } : {}),
    ...(d.scope ? { scope: d.scope } : {}),
    ...(d.assignees ? { assignees: d.assignees } : {}),
    check: d.check,
    org: d.org,
    groupId: d.groupId,
    breakGlass: d.breakGlass,
    tenantId: d.tenantId,
    ...(d.invite ? { invite: d.invite } : {}),
    async people() {
      const out: PersonHealth[] = [];
      const seen = d.lastSeen ? await d.lastSeen().catch(() => new Map<string, string>()) : new Map<string, string>();
      for (const u of await d.users()) {
        if (u.deletedAt) continue;
        const store = d.personStore(u.id, u.timeZone);
        const [st, ids, ms, gs, teams] = await Promise.all([
          store.setupState().catch((): SetupState => ({})),
          store.devopsIdentities().catch(() => []),
          d.hasSecret(u.id, "outlook-refresh-token").catch(() => false),
          d.hasSecret(u.id, "google-refresh-token").catch(() => false),
          d.teamsApp ? d.teamsApp(u.id).catch(() => null) : Promise.resolve(null),
        ]);
        let writes = 0;
        for (const i of ids) if (await d.hasSecret(u.id, writePat(i.clientKey)).catch(() => false)) writes++;
        const s = seen.get(u.id);
        const lastActiveAt = s && s > u.lastSignInAt ? s : u.lastSignInAt;
        out.push({ id: u.id, name: u.displayName || u.upn, email: u.email ?? u.upn, lastSignInAt: u.lastSignInAt, setup: setupWord(st), sources: { microsoft: ms, google: gs, devopsWrites: writes }, teamsApp: teams, lastActiveAt });
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
          ? { ok: true, message: `Stories go under #${setup.parentId} in ${setup.project}, created by each person with their own DevOps write PAT` }
          : { ok: false, message: "No feedback destination is set (Admin › Organization)" },
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
      await d.org.store.replaceDirectory(r.read.people, r.read.leads, r.read.clients, r.read.accounts, r.read.identities);
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
