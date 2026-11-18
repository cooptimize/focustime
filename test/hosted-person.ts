// ID-1: a person as the hosted app has them: their Dataverse user and work email kept with their sign-in (the stored
// identity), never in their settings. Their sources behave like the real ones: the Dataverse source lists their clients
// only with a Dataverse user, and the DevOps source reads a client's items only with one (the real devopsTargets
// answers "Your Dataverse user id is not resolved yet" without it). Every read records the Dataverse user it ran with,
// so a test can say whose identity a request used. Fictional people and clients only.
import { IDENTITY_KEY, type StoredIdentity } from "../actions/account.ts";
import type { ActionContext, MeetingsPort } from "../actions/dispatch.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall, TranscribeCall } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { setValue } from "../config/edit.ts";
import { starterToml } from "../config/starter.ts";
import type { MeetingSeries } from "../plan/meetings.ts";
import type { Conn } from "../store/sql/conn.ts";
import { createMeetingStore, type NewSeries } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { anAiApp, aWorkItem, withTeam } from "./builders/index.ts";

export const NOW = "2026-11-17T15:00:00Z";
const ZONE = "America/New_York";

/** Two fictional people, each with their own sign-in and Dataverse user. */
export const ANA = { oid: "0a0a0a0a-1111-4222-8333-444455556666", dv: "11111111-2222-4333-8444-555566667777", email: "ana@cooptimize.example", name: "Ana Example" };
export const BEN = { oid: "0b0b0b0b-1111-4222-8333-444455556666", dv: "22222222-3333-4444-8555-666677778888", email: "ben@cooptimize.example", name: "Ben Example" };
export type Who = typeof ANA;

/** The gap the AI is asked about, in the answer the stub gives. */
export const ANSWER = JSON.stringify({
  gaps: [{ type: "User Story", parentId: 1201, title: "Holiday calendar import", description: "Import the client's holidays.", lines: [2] }],
  commitments: [],
  comments: [],
  // MC-2: the answer has a summary now (the schema requires one).
  summary: [],
});

export type Reads = { devops: (string | null)[]; myClients: (string | null)[] };

/**
 * One hosted person's action context. `inSettings`: their Dataverse user and email are in their own settings instead
 * (the local app), with nothing kept with the sign-in.
 */
export async function hostedPerson(db: Conn, who: Who, o: { inSettings?: boolean; meetings?: MeetingsPort; reads?: Reads; calls?: ProviderCall[]; heard?: TranscribeCall[]; allowed?: string[]; more?: Partial<ActionContext> } = {}) {
  // As store/user-settings.ts gives them: the work email from the sign-in, never the Dataverse user.
  let toml = setValue(`${starterToml(ZONE)}\n[clients.contoso]\nname = "Contoso"\n`, "dataverse", "my_email", who.email);
  if (o.inSettings) toml = setValue(toml, "dataverse", "my_systemuserid", who.dv);
  const parsed = withTeam(parseConfig(toml), { ai: { on: true, allowed: o.allowed ?? ["contoso", "fabrikam"] } });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const plan = planStoreOn(db, { userId: who.oid, now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE) });
  const ident: StoredIdentity = { oid: who.oid, tid: "t", name: who.name, username: who.email, email: who.email, signedInAt: NOW, systemUserId: o.inSettings ? null : who.dv, systemUserEmail: o.inSettings ? null : who.email };
  await plan.setAccountState(IDENTITY_KEY, ident);
  const reads = o.reads ?? { devops: [], myClients: [] };
  const items = [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })];
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "settings", parsed }),
    now: () => NOW,
    saveSystemUserId: async () => {},
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
    // As the real Dataverse source: a person's clients only with their Dataverse user. Fabrikam is theirs in Dataverse
    // only (not in their settings), as most of a hosted person's clients are.
    makeDataverse: (dv: { mySystemUserId: string | null }) => ({
      myClients: async () => {
        reads.myClients.push(dv.mySystemUserId);
        return dv.mySystemUserId ? [{ clientKey: "contoso", clientName: "Contoso" }, { clientKey: "fabrikam", clientName: "Fabrikam" }] : null;
      },
    }),
    // As the real DevOps source: the client's items only with a Dataverse user (devopsTargets refuses without one).
    makeDevOps: (dv: { mySystemUserId: string | null }) => ({
      last: () => null,
      load: async (refs: { clientKey: string; clientName: string }[]) => {
        reads.devops.push(dv.mySystemUserId);
        return refs.map((r) => (dv.mySystemUserId
          ? { clientKey: r.clientKey, clientName: r.clientName, status: "ok", fetchedAt: NOW, fromCache: false, items, children: [] }
          : { clientKey: r.clientKey, clientName: r.clientName, status: "misconfigured", message: "Your Dataverse user id is not resolved yet", fetchedAt: null, fromCache: false, items: [], children: [] }));
      },
      processModels: async () => [],
    }),
    ai: {
      app: anAiApp({ transcribe: { model: "gpt-transcribe", perMinuteUsd: 0.0045 } }),
      provider: async () => stubProvider({ respond: (c) => (o.calls?.push(c), ANSWER), transcript: async (t) => (o.heard?.push(t), { ok: true, text: "Move the export" }) }),
      appSpend: { get: async () => 0, add: async () => {} },
    },
    ...(o.meetings ? { meetings: o.meetings } : {}),
    ...o.more,
  } as unknown as ActionContext;
  return { ctx, plan, reads };
}

/** The meeting store and its people, with one upload call on Contoso that `who` reviews. */
export async function aCall(db: Conn, people: readonly Who[]): Promise<{ port: MeetingsPort; series: MeetingSeries }> {
  const store = createMeetingStore(db, () => Temporal.Instant.from(NOW));
  const s: NewSeries = {
    clientKey: "contoso", name: "Contoso sync", role: "status", source: "upload", detected: "upload", organizer: "unknown", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3aid1%40thread.v2/0", eventId: null,
    registrantId: people[0]!.oid, weekday: 2, start: "10:00", minutes: 60, zone: ZONE, interval: 1, reviewers: people.map((p) => p.oid), attendees: [],
  };
  const series = await store.addSeries(s);
  return { port: { store, users: async () => people.map((p) => ({ id: p.oid, name: p.name, emails: [p.email] })) }, series };
}
