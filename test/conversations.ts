// CV-1 test helpers: the conversations pipeline on the shared store (SQLite in memory), a fake provider behind the real
// ai/ service (switches, guards, the app's cap, the request log), and the worked examples' people. Names are fictional
// (the repo's names rule): the two worked examples from the step keep their shape with other names.
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { UpdateAnswer } from "../plan/conversations.ts";
import type { ClientChat, TeamsMessage } from "../plan/requests.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aChatMember, aClientChat, aCommitmentAnswer, aConversationUpdate, anAiApp, anAiPerson, anUpdateAnswer, aTeamsMessage, aWorkItem, HOME_TENANT } from "./builders/index.ts";
import { runPipeline, type PipelineDeps } from "../actions/conversations-pipeline.ts";

export const NOW = "2026-11-04T21:00:00Z";
export const ZONE = "America/Chicago";
export const EVAN = aChatMember({ displayName: "Evan Ford" });
export const LENA = aChatMember({ displayName: "Lena Hart" });
export const SAM = aChatMember({ displayName: "Sam Tester" });
export const BLAKE = aChatMember({ displayName: "Blake Novak", external: true });
export const CHAT = aClientChat({ chatId: "19:contoso-alliance@thread.v2", clientKey: "contoso", displayName: "Contoso Analytics Alliance", members: [EVAN, LENA, SAM, BLAKE] });

export function world(o: { respond?: (c: ProviderCall) => string | { ok: false; kind: "provider"; status: number }; appCapUsd?: number; allowed?: string[]; use?: boolean } = {}) {
  let now = NOW;
  const clock = () => Temporal.Instant.from(now);
  const conn = sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") }));
  const teams = createTeamsStore(conn, clock);
  const convs = createConversationStore(conn, clock, teams);
  const calls: ProviderCall[] = [];
  const provider = stubProvider({ respond: (c) => (calls.push(c), o.respond ? o.respond(c) : JSON.stringify(anUpdateAnswer())) });
  const ai = createAi({
    provider: async () => provider,
    app: anAiApp({ provider: "openai", appCapUsd: o.appCapUsd ?? 100 }),
    person: async () => anAiPerson({ use: o.use ?? true, allowedClients: o.allowed ?? ["contoso", "fabrikam"] }),
    guard: async () => ({ directory: [], homeDomains: ["contoso.example"], forbidden: [] }),
    log: convs.appAiLog,
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => now,
    cap: "app",
  });
  const users = [EVAN, LENA, SAM].map((m) => ({ id: m.userId!, name: m.displayName!, deleted: false }));
  const deps = (chat: ClientChat, more: Partial<PipelineDeps> = {}): PipelineDeps => ({
    teams, convs, users, homeTenant: HOME_TENANT, now, clientName: chat.clientKey === "contoso" ? "Contoso Supply" : "Fabrikam", ai, zone: ZONE, ackPhrases: [], items: [aWorkItem({ id: 4101, title: "Movement dashboard refresh" })],
    author: async () => ({ zone: ZONE, promisePhrases: ["i'll", "i will", "tonight"] }), ...more,
  });
  const say = async (chat: ClientChat, from: typeof EVAN, at: string, text: string, more: Partial<TeamsMessage> = {}) => {
    const m = aTeamsMessage({ chatId: chat.chatId, clientKey: chat.clientKey, senderId: from.userId, senderName: from.displayName, senderTenant: from.tenantId, createdAt: at, modifiedAt: at, fetchedAt: at, text, ...more });
    if (!(await teams.chat(chat.chatId))) await teams.addChat({ chatId: chat.chatId, clientKey: chat.clientKey, kind: chat.kind, displayName: chat.displayName, webUrl: null, members: chat.members, by: EVAN.userId! });
    await teams.saveMessages([m]);
    return m;
  };
  return { conn, teams, convs, calls, deps, say, ai, users, now: () => now, setNow: (t: string) => void (now = t), run: (chat: ClientChat, batch: TeamsMessage[], more: Partial<PipelineDeps> = {}) => runPipeline(deps(chat, more), chat, batch) };
}

/** The fake provider's answer for the CSC-shaped example, read from the request's own input (refs only). */
export function cscAnswer(c: ProviderCall): string {
  const input = JSON.parse(c.input) as { people: { ref: string; name: string }[]; open_conversations: { ref: string }[]; messages: { ref: string; from: string; text: string }[] };
  const ref = (name: string) => input.people.find((p) => p.name === name)!.ref;
  const conv = input.open_conversations[0]?.ref ?? "n1";
  const commit = input.messages.find((m) => /development queue/.test(m.text));
  const a: UpdateAnswer = {
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: conv, confident_new_topic: false })),
    conversations: [
      aConversationUpdate({
        ref: conv,
        title: "Movement Dashboard quantity gap on 4417001",
        summary: commit ? "Movement Dashboard quantity gap on 4417001 (~7.7k lb vs the BOM report).\nCause looks like BOM bridging.\nEvan is adding it to the dev queue." : "Movement Dashboard quantity gap on 4417001 (~7.7k lb vs the BOM report).\nEvan and Lena are looking into it.",
        owner: ref("Evan Ford"),
        change: commit ? "Evan will add the fix to the dev queue" : "New question from Blake",
        commitments: commit ? [aCommitmentAnswer({ who: commit.from, what: "Add the BOM bridging fix to the dev queue", implies_item: true, messages: [commit.ref] })] : [],
      }),
    ],
  };
  return JSON.stringify(a);
}

