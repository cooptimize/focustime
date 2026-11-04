// Test data builders (S1, D454). Every builder returns a valid default and takes overrides, so a test names only what
// it is about: aPto({ date: "2026-11-12" }), aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Thu: "AM" } }).
// Fictional names only (the demo set). Dates default to the week of Mon Nov 2, 2026 in New York, like the e2e clock.
// New and edited tests use these instead of hand-written fixtures (CLAUDE.md, Working style).
import { legacyHours } from "../../config/schema.ts";
import type { MyClient } from "../../sources/dataverse/source.ts";
import type { UserRow } from "../../store/accounts.ts";
import type { FeedbackDraft, Sender, Where } from "../../plan/feedback.ts";
import { buildWeek, type BuildWeekInput } from "../../week/build.ts";
import type { PtoDay } from "../../week/pto.ts";
import type { CalEvent, DayPart, FocusPattern, IsoDate, Week, WeekConfig, WorkItem, WorkWeekday } from "../../week/types.ts";

export const ZONE = "America/New_York";
/** Monday of the default week (the e2e clock's week). */
export const WEEK = "2026-11-02";

let seq = 0;
const next = () => ++seq;

/** A signed-in person (an account row). */
export function aUser(o: Partial<UserRow> = {}): UserRow {
  const n = next();
  return {
    id: `user-${n}`,
    tenantId: "tenant-demo",
    upn: `person${n}@contoso.example`,
    displayName: `Person ${n}`,
    email: `person${n}@contoso.example`,
    timeZone: ZONE,
    createdAt: "2026-10-01T12:00:00Z",
    lastSignInAt: "2026-11-02T14:00:00Z",
    deletedAt: null,
    ...o,
  };
}

/** One of my clients, as Dataverse lists it. `name` sets both the key (lowercased) and the name. */
export function aClient(o: Partial<MyClient> & { name?: string } = {}): MyClient {
  const { name, ...rest } = o;
  const clientName = name ?? rest.clientName ?? "Adatum";
  return { clientKey: clientName.toLowerCase().replace(/[^a-z0-9]+/g, ""), clientName, devops: true, devopsEmail: null, ...rest };
}

/** A Focus Time pattern from Dataverse (the input every week is built from): this client on these days. */
export function aFocusBlock(o: Partial<FocusPattern> & { client?: MyClient; days?: Partial<Record<WorkWeekday, DayPart>> } = {}): FocusPattern {
  const { client = aClient(), ...rest } = o;
  return { id: `ft-${next()}`, clientKey: client.clientKey, clientName: client.clientName, startDate: "2026-01-05", endDate: null, active: true, days: { Mon: "AM" }, ...rest };
}

/** A PTO day from Dataverse. */
export function aPto(o: Partial<PtoDay> & { date?: IsoDate } = {}): PtoDay {
  return { date: o.date ?? "2026-11-05", titles: o.titles ?? ["PTO"], ...o };
}

/** PTO days keyed by date, as buildWeek and the plan screens take them. */
export const ptoMap = (...days: PtoDay[]): Record<IsoDate, PtoDay> => Object.fromEntries(days.map((d) => [d.date, d]));

/** "2026-11-02T10:00" (New York) or a full ISO time with an offset. */
const local = (t: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(t) || t.length === 10 ? t : Temporal.PlainDateTime.from(t).toZonedDateTime(ZONE).toString({ timeZoneName: "never" }));

/** A calendar meeting: Outlook, busy, accepted, 10:00 to 10:30 on Monday unless told otherwise. */
export function aMeeting(o: Partial<CalEvent> = {}): CalEvent {
  return { id: `m-${next()}`, source: "outlook", title: "Meeting", allDay: false, showAs: "busy", isPersonal: false, responseStatus: "accepted", ...o, start: local(o.start ?? `${WEEK}T10:00`), end: local(o.end ?? `${WEEK}T10:30`) };
}

/** Out of office in Outlook (show-as oof): Thursday morning, 9:00 to 12:30, unless told otherwise. */
export function anOutOfOffice(o: Partial<CalEvent> = {}): CalEvent {
  return aMeeting({ title: "Away", showAs: "oof", start: "2026-11-05T09:00", end: "2026-11-05T12:30", ...o });
}

/** A DevOps work item assigned to me: a story, active. */
export function aWorkItem(o: Partial<WorkItem> = {}): WorkItem {
  const id = o.id ?? 1000 + next();
  return {
    id,
    title: `Work item ${id}`,
    type: "User Story",
    state: "Active",
    stateCategory: "InProgress",
    level: "story",
    order: null,
    parentId: null,
    changedAt: "2026-10-30T15:00:00Z",
    url: `https://dev.azure.com/contoso/demo/_workitems/edit/${id}`,
    assignedTo: "Me",
    assignedToMe: true,
    ...o,
  };
}

/** Week settings: 9 to 5 with lunch at 12:30 in New York, the usual risk thresholds, no standing blocks. */
export function aWeekConfig(o: Partial<WeekConfig> = {}): WeekConfig {
  return {
    hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: ZONE }),
    thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 },
    standingBlocks: [],
    ...o,
  };
}

/** A built week (Week's own logic): the default week, no focus blocks, meetings or PTO unless given. */
export function aWeek(o: Partial<Omit<BuildWeekInput, "pto">> & { pto?: PtoDay[] | BuildWeekInput["pto"] } = {}): Week {
  const { pto, ...rest } = o;
  return buildWeek({ weekStart: WEEK, patterns: [], events: [], config: aWeekConfig(), ...rest, pto: Array.isArray(pto) ? ptoMap(...pto) : (pto ?? {}) });
}

/** F1: "Include where I am" as the window sends it. */
export function aWhere(o: Partial<Where> = {}): Where {
  return { view: "Today › Plan", version: "prod · #42 · abc1234 · built Nov 2, 2026", browser: "Chrome 141 on Windows", screen: "1920×1080, window 1920×960", ...o };
}

/** F1: what a person typed in Send feedback (an idea, with where I am, unless overridden). */
export function aFeedbackDraft(o: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return { kind: "idea", text: "Show the week's free hours on the Week tab", where: aWhere(), ...o };
}

/** F1: who sends feedback, from an account row. */
export const aSender = (u: UserRow = aUser()): Sender => ({ name: u.displayName, email: u.email });
// T-2: Teams delivery chats. Fictional tenants: Cooptimize's (HOME_TENANT) and one client's (CLIENT_TENANT).
export const HOME_TENANT = "11111111-1111-4111-8111-111111111111";
export const CLIENT_TENANT = "22222222-2222-4222-8222-222222222222";

/** A chat member; a Cooptimizer by default (`external: true` puts them in the client's tenant). */
export function aChatMember(o: Partial<import("../../plan/chats.ts").ChatMember> & { external?: boolean } = {}): import("../../plan/chats.ts").ChatMember {
  const n = next();
  const { external, ...rest } = o;
  return { userId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, displayName: `Person ${n}`, email: `person${n}@${external ? "fabrikam" : "contoso"}.example`, tenantId: external ? CLIENT_TENANT : HOME_TENANT, ...rest };
}

/** AP-1: a chat message as the rules see it: from a client person by default, plain text, nothing attached. */
export function aMessage(o: Partial<import("../../plan/asks.ts").IncomingMessage> = {}): import("../../plan/asks.ts").IncomingMessage {
  const n = next();
  return {
    chatId: "19:fabrikam@thread.v2",
    messageId: String(1_700_000_000_000 + n),
    clientKey: "fabrikam",
    authorId: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
    authorTenant: CLIENT_TENANT,
    createdAt: "2026-11-04T15:00:00Z",
    text: "The weekly report shows last month's totals",
    hasImage: false,
    hasFile: false,
    replyToId: null,
    mentionedUserIds: [],
    ...o,
  };
}

/** A Teams group chat as the picker lists it. */
export function aChat(o: Partial<import("../../plan/chats.ts").ChatSummary> = {}): import("../../plan/chats.ts").ChatSummary {
  const n = next();
  return { id: `19:chat${n}@thread.v2`, topic: `Chat ${n}`, webUrl: null, lastUpdated: "2026-10-20T15:00:00Z", lastRead: null, members: [aChatMember(), aChatMember({ external: true })], moreMembers: false, ...o };
}

// ---- AI-0 ----

/** A client as the AI guard knows it (fictional names, contoso/fabrikam style). */
export function aClientEntry(o: Partial<import("../../ai/guard.ts").ClientEntry> = {}): import("../../ai/guard.ts").ClientEntry {
  return { key: "fabrikam", names: ["Fabrikam Inc"], projects: ["Fabrikam Portal"], itemIds: [4101, 4102], ...o };
}

/** App-level AI settings for tests: cheap round prices so costs are easy to read ($1 per million in, $2 out). */
export function anAiApp(o: Partial<import("../../ai/service.ts").AiAppSettings> = {}): import("../../ai/service.ts").AiAppSettings {
  return { provider: "stub", model: "test-model", reasoningEffort: null, timeoutMs: 5_000, maxOutputTokens: { default: 500 }, prices: { inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2 }, appCapUsd: 100, ...o };
}

/** A person's AI settings with both switches on for one client. */
export function anAiPerson(o: Partial<import("../../ai/types.ts").AiPersonSettings> = {}): import("../../ai/types.ts").AiPersonSettings {
  return { use: true, monthlyCapUsd: 10, allowedClients: ["fabrikam"], ...o };
}

/** An OpenAI Responses API body with a structured answer and its usage. */
export function anOpenAiResponse(value: unknown, usage: { input?: number; cached?: number; output?: number } = {}, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "resp_test",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", annotations: [], text: JSON.stringify(value) }] }],
    usage: { input_tokens: usage.input ?? 100, input_tokens_details: { cached_tokens: usage.cached ?? 0 }, output_tokens: usage.output ?? 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: (usage.input ?? 100) + (usage.output ?? 20) },
    ...o,
  };
}

/** AP-2: an "asks.classify" answer: a bug needing attention this week, no likely item, by default. */
export function aClassifyAnswer(o: Partial<import("../../plan/asks-ai.ts").ClassifyAnswer> = {}): import("../../plan/asks-ai.ts").ClassifyAnswer {
  return { kind: "bug", urgency: "this_week", item_type: "bug", title: "Totals report shows last month", description: "The client says the totals report still shows last month's numbers.", likely_existing_item: null, reason: "It describes something that is wrong in a report.", ...o };
}

/** AP-2: a "promises.extract" answer: a promise with no date, by default. */
export function aPromiseAnswer(o: Partial<import("../../plan/asks-ai.ts").PromiseAnswer> = {}): import("../../plan/asks-ai.ts").PromiseAnswer {
  return { is_promise: true, what: "Send the corrected totals", due_hint: null, to_whom: null, answers_message_id: null, reason: "It commits to sending something.", ...o };
}
