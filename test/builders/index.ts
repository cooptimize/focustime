// Test data builders (S1, D454). Every builder returns a valid default and takes overrides, so a test names only what
// it is about: aPto({ date: "2026-11-12" }), aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Thu: "AM" } }).
// Fictional names only (the demo set). Dates default to the week of Mon Nov 2, 2026 in New York, like the e2e clock.
// New and edited tests use these instead of hand-written fixtures (CLAUDE.md, Working style).
import type { AheadClient, AheadItem, AheadLoad } from "../../actions/types.ts";
import { applyOrg } from "../../config/org-apply.ts";
import { resolveRules } from "../../config/org.ts";
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

/** ADM-1: the team's AI rules for tests: AI on for FocusTime and allowed for one client. */
export function anAiRules(o: Partial<import("../../ai/types.ts").AiRules> = {}): import("../../ai/types.ts").AiRules {
  return { on: true, personCapUsd: 10, allowedClients: ["fabrikam"], ...o };
}

/**
 * ADM-1: a parsed config with the team's settings applied, as the server's loadConfig gives it. `ai`: AI on for
 * FocusTime with these clients allowed; `rows`: any other org settings ({scope, key, value}).
 */
export function withTeam<P extends import("../../config/schema.ts").ParseResult>(parsed: P, o: { ai?: { on?: boolean; allowed?: string[] }; rows?: { scope: string; key: string; value: unknown }[]; level?: import("../../config/org.ts").Level | null } = {}): P {
  if (!parsed.ok) return parsed;
  const rows = [
    ...(o.ai ? [{ scope: "org", key: "ai.on", value: o.ai.on ?? true }, ...(o.ai.allowed ?? []).map((k) => ({ scope: `client:${k}`, key: "allow_ai", value: true }))] : []),
    ...(o.rows ?? []),
  ].map((r) => ({ scope: r.scope, key: r.key, value: JSON.stringify(r.value), updatedAt: "2026-11-04T12:00:00Z", updatedBy: null }));
  const rules = resolveRules(rows, { model: "test-model", appCapUsd: 100, inviteDomains: [], feedback: null });
  return { ...parsed, config: applyOrg(parsed.config, rules, { level: o.level ?? null, levelSource: o.level ? "dataverse" : null }) };
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

/** DS-1: a feature's signals: a feature with a description and acceptance, an epic, one existing story, two comments. */
export function aFeatureSignals(o: { feature?: Partial<import("../../plan/stories.ts").FeatureFields> } & Partial<Omit<import("../../plan/stories.ts").FeatureSignals, "feature">> = {}): import("../../plan/stories.ts").FeatureSignals {
  const { feature, ...rest } = o;
  return {
    feature: { id: 240, title: "Monthly export for the finance team", type: "Feature", state: "Active", priority: 2, tags: ["Reporting", "Export"], areaPath: "Contoso\\Reporting", iterationPath: "Contoso\\Sprint 9", description: "Finance needs the monthly totals as a CSV file.", acceptance: "- The file opens in Excel", parentId: 230, url: "https://dev.azure.com/contoso/Contoso/_workitems/edit/240", ...feature },
    epic: { id: 230, title: "Finance reporting", type: "Epic", description: "Everything finance reads each month." },
    children: [{ id: 241, title: "Pick the columns for the export", type: "User Story", state: "Closed" }],
    comments: [{ at: "2026-11-03T10:00:00Z", text: "They also asked for a date filter." }, { at: "2026-10-28T09:00:00Z", text: "Kickoff done." }],
    storyType: "User Story",
    ...rest,
  };
}

/** DS-1: a feature from the same client's project with stories, usable as an example. */
export function anExemplarCandidate(o: Partial<import("../../plan/stories.ts").ExemplarCandidate> = {}): import("../../plan/stories.ts").ExemplarCandidate {
  return {
    id: 300, title: "Quarterly report for sales", description: "Sales wants the quarter's numbers. In one page.", tags: ["Reporting"], areaPath: "Contoso\\Reporting", parentId: 231, changedAt: "2026-10-01T12:00:00Z",
    stories: [
      { title: "Add the quarter filter", description: "Lets sales pick a quarter.", hasAcceptance: true, size: 3 },
      { title: "Show totals per region", description: "One row per region.", hasAcceptance: true, size: 2 },
      { title: "Export the page as PDF", description: "For the board pack.", hasAcceptance: false, size: null },
    ],
    ...o,
  };
}

/** DS-1: one proposal in a Coop v1 answer. */
export function aCoopProposal(o: Partial<import("../../plan/stories.ts").CoopProposal> = {}): import("../../plan/stories.ts").CoopProposal {
  return { id: "P1", title: "Add the date filter to the export", description: "Finance picks the month before exporting.", acceptance_criteria: ["- A month picker shows above the export", "The file has only that month"], depends_on: [], size: "M", evidence: ["comment 2026-11-03"], open_questions: [], ...o };
}

/** DS-1: a "stories.draft" answer (Coop v1 story_proposals) for feature 240 with two proposals, the second after the first. */
export function aProposalsAnswer(o: Partial<import("../../plan/stories.ts").CoopProposals> = {}): import("../../plan/stories.ts").CoopProposals {
  return {
    kind: "story_proposals", version: 1, feature_id: 240,
    proposals: [aCoopProposal(), aCoopProposal({ id: "P2", title: "Email the export to finance", description: "Send the file on the first workday.", acceptance_criteria: ["Finance gets the file by email"], depends_on: ["P1"], size: "S" })],
    rationale: "The columns are done; the filter and delivery are left.",
    set_aside: [{ title: "Pick the columns", why: "already_covered", existing_item_id: 241, reason: "Story #241 did this." }],
    ...o,
  };
}

// ---- CV-1: conversations ----

/** A Teams message as the shared store keeps it: from a client person by default, HTML body, nothing attached. */
export function aTeamsMessage(o: Partial<import("../../plan/requests.ts").TeamsMessage> = {}): import("../../plan/requests.ts").TeamsMessage {
  const n = next();
  const text = o.text ?? "The weekly report shows last month's totals";
  return {
    chatId: "19:fabrikam@thread.v2",
    messageId: String(1_700_000_000_000 + n),
    clientKey: "fabrikam",
    senderId: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
    senderName: `Person ${n}`,
    senderTenant: CLIENT_TENANT,
    createdAt: "2026-11-04T15:00:00Z",
    modifiedAt: o.createdAt ?? "2026-11-04T15:00:00Z",
    html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
    text,
    hasImage: false,
    hasFile: false,
    replyToId: null,
    mentions: [],
    fetchedAt: o.createdAt ?? "2026-11-04T15:00:00Z",
    ...o,
  };
}

/** A registered client chat (shared polling) with its members read. */
export function aClientChat(o: Partial<import("../../plan/requests.ts").ClientChat> = {}): import("../../plan/requests.ts").ClientChat {
  return {
    chatId: "19:fabrikam@thread.v2", clientKey: "fabrikam", kind: "customer", displayName: "Fabrikam Customer Collaboration", webUrl: null, position: 0, members: [aChatMember(), aChatMember({ external: true })],
    membersFetchedAt: "2026-11-04T14:00:00Z", registeredBy: "00000000-0000-4000-8000-000000000001", registeredAt: "2026-11-04T14:00:00Z", readOn: true, readSince: "2026-11-04T14:00:00Z",
    seenAt: null, polledAt: null, fetchedAt: null, retryAt: null, failures: 0, pollState: null, pollNote: null, tokenUser: null, ...o,
  };
}

type UpdateAnswer = import("../../plan/conversations.ts").UpdateAnswer;
/** One conversation in a "conversations.update" answer (a new one, n1, by default). */
export function aConversationUpdate(o: Partial<UpdateAnswer["conversations"][number]> = {}): UpdateAnswer["conversations"][number] {
  return { ref: "n1", title: "Weekly report totals", summary: "The client asks about the weekly report.", owner: null, wrapped_up: false, change: "New question", item_change: null, scope_changed: false, likely_item: null, commitments: [], ...o };
}
/** A commitment in a "conversations.update" answer. */
export function aCommitmentAnswer(o: Partial<UpdateAnswer["conversations"][number]["commitments"][number]> = {}): UpdateAnswer["conversations"][number]["commitments"][number] {
  return { who: "p1", what: "Look into the totals", due: null, to: null, implies_item: false, messages: ["m1"], status_only: false, ...o };
}
/** A whole "conversations.update" answer. */
export function anUpdateAnswer(o: Partial<UpdateAnswer> = {}): UpdateAnswer {
  return { messages: [{ ref: "m1", kind: "work", conversation: "n1", confident_new_topic: false }], conversations: [aConversationUpdate()], ...o };
}

// ---- WT-1: DevOps process responses (fictional projects; shapes as the REST API returns them) ----
type RawProcess = import("../../plan/process.ts").RawProcess;
const st = (spec: string) => spec.split("|").map((s) => {
  const [name, category] = s.split("=");
  return { name: name!, category: category!, color: "b2b2b2" };
});
const aType = (name: string, icon: string, color: string, states: string) => ({ name, icon: { id: icon, url: "https://example.invalid/icon" }, color, isDisabled: false, states: st(states) });
const backlog = (type: "portfolio" | "requirement" | "task", rank: number, types: string[], def = types[0]) => ({ name: `${types[0]}s`, type, rank, isHidden: false, workItemTypes: types.map((name) => ({ name })), defaultWorkItemType: def ? { name: def } : undefined });

/** A client process: Epic, Feature, User Story, Task, Bug with custom states like "01-New", "09-Active", "05-In UAT". */
export function aClientProcess(o: Partial<RawProcess> = {}): RawProcess {
  return {
    org: "contoso",
    project: "Contoso ERP",
    process: "Contoso Agile",
    fetchedAt: "2026-11-02T09:00:00Z",
    teamSettings: { bugsBehavior: "asTasks" },
    processConfig: { bugWorkItems: { workItemTypes: [{ name: "Bug" }] } },
    teamBacklogs: { value: [backlog("portfolio", 4, ["Epic"]), backlog("portfolio", 3, ["Feature"]), backlog("requirement", 2, ["User Story"]), backlog("task", 1, ["Task", "Bug"], "Task")] },
    types: [
      aType("Epic", "icon_crown", "FF7B00", "01-New=Proposed|02-Active=InProgress|90-On Hold=InProgress|Closed=Completed|Removed=Removed"),
      aType("Feature", "icon_trophy", "773B93", "01-Proposed=Proposed|09-Active=InProgress|10-Completed=Resolved|Closed=Completed|99-Not Applicable=Removed"),
      aType("User Story", "icon_book", "009CCC", "01-New=Proposed|02-In Progress=InProgress|05-In UAT=InProgress|Approved - Waiting for PO=InProgress|03-Resolved=Resolved|Approved - Ready for CRP=Completed|07-Blocked=Removed|Removed=Removed"),
      aType("Task", "icon_clipboard", "F2CB1D", "New=Proposed|Active=InProgress|Released=Completed|10-Blocked=Removed|Removed=Removed"),
      aType("Bug", "icon_insect", "CC293D", "01-Not Started=Proposed|02-In Progress=InProgress|Resolved=Resolved|Ready for Go-live=Completed"),
      { ...aType("Test Case", "icon_test_case", "004B50", "Design=Proposed|Ready=InProgress|Closed=Completed"), isDisabled: true },
    ],
    history: { Epic: { items: 11, withChildren: 11, childTypes: { Feature: 134, Issue: 9 } }, Feature: { items: 70, withChildren: 41, childTypes: { "User Story": 143 } } },
    ...o,
  };
}

/** Cooptimize's own process: Domain and Epic at top; Feature, Recurring and Ongoing at parent; User Story; Task. */
export function anInternalProcess(o: Partial<RawProcess> = {}): RawProcess {
  return {
    org: "fabrikam",
    project: "Fabrikam Internal",
    process: "Sociocracy",
    fetchedAt: "2026-11-02T09:00:00Z",
    teamSettings: { bugsBehavior: "asTasks" },
    processConfig: { bugWorkItems: { workItemTypes: [{ name: "Bug" }] } },
    teamBacklogs: { value: [backlog("portfolio", 4, ["Domain", "Epic"], "Epic"), backlog("portfolio", 3, ["Feature", "Ongoing", "Recurring"], "Feature"), backlog("requirement", 2, ["User Story"]), backlog("task", 1, ["Task", "Bug"], "Task")] },
    types: [
      aType("Domain", "icon_crown", "e87025", "Proposed=Proposed|Assigned=InProgress|At Risk=InProgress|Disbanded=Completed"),
      aType("Epic", "icon_crown", "E06C00", "New=Proposed|Active=InProgress|Resolved=InProgress|Closed=Completed|Removed=Removed"),
      aType("Feature", "icon_trophy", "773B93", "New=Proposed|Active=InProgress|Resolved=InProgress|Closed=Completed|Removed=Removed"),
      aType("Recurring", "icon_asterisk", "5c197b", "New=Proposed|Recurring=InProgress|Closed=Completed"),
      aType("Ongoing", "icon_flame", "5c197b", "New=Proposed|Active=InProgress|Closed=Completed"),
      aType("User Story", "icon_book", "0098C7", "New=Proposed|Active=InProgress|Resolved=InProgress|Closed=Completed|Removed=Removed"),
      aType("Task", "icon_clipboard", "A4880A", "New=Proposed|Active=InProgress|Closed=Completed|Removed=Removed"),
      aType("Bug", "icon_insect", "CC293D", "New=Proposed|Active=InProgress|Resolved=Resolved|Closed=Completed"),
    ],
    history: {
      Domain: { items: 7, withChildren: 7, childTypes: { Feature: 31, Recurring: 21, Ongoing: 1 } },
      Feature: { items: 20, withChildren: 9, childTypes: { "User Story": 24 } },
      Recurring: { items: 12, withChildren: 9, childTypes: { "User Story": 18 } },
      Ongoing: { items: 1, withChildren: 0, childTypes: {} },
    },
    ...o,
  };
}

/** PV-1: a feature (portfolio, feature tier) assigned to me. */
export function aFeature(o: Partial<WorkItem> = {}): WorkItem {
  return aWorkItem({ type: "Feature", level: "portfolio", tier: "feature", title: `Feature ${o.id ?? ""}`.trim(), ...o });
}

/** PV-1: a work item type as the UI draws it. Story, Bug at child level; Feature at parent; Epic at top; Task. */
export function aTypeLook(o: Partial<import("../../week/types.ts").TypeLook> & { name: string }): import("../../week/types.ts").TypeLook {
  const level = o.name === "Epic" ? "top" : o.name === "Feature" ? "parent" : o.name === "Task" ? "task" : "child";
  return { icon: null, color: null, level, countsHours: true, needsBreakdown: level === "top" || level === "parent", defaultChild: o.name === "Feature" ? "User Story" : null, ...o };
}
export const TYPE_LOOKS = ["Epic", "Feature", "User Story", "Bug", "Task"].map((name) => aTypeLook({ name }));

/** PV-1: one client's DevOps read: live, with the usual types. */
export function aClientWork(o: Partial<import("../../week/types.ts").ClientWork> = {}): import("../../week/types.ts").ClientWork {
  return { clientKey: "adatum", clientName: "Adatum", status: "ok", fetchedAt: `${WEEK}T09:00:00`, fromCache: false, items: [], children: [], types: TYPE_LOOKS, ...o };
}

/** PV-1: a planned pick for a DevOps item: Monday AM for Adatum, unsized. */
export function aPick(o: Partial<import("../../plan/types.ts").Pick> = {}): import("../../plan/types.ts").Pick {
  const id = o.id ?? next();
  return { id, date: WEEK, half: "AM", clientKey: "adatum", kind: "item", itemId: null, draftId: null, title: `Pick ${id}`, itemType: "User Story", itemUrl: null, size: null, status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, followUpId: null, position: id, createdAt: `${WEEK}T09:00:00-05:00[${ZONE}]`, updatedAt: `${WEEK}T09:00:00-05:00[${ZONE}]`, ...o } as import("../../plan/types.ts").Pick;
}

/** PV-1: an item on a client's week list: a feature must for Adatum this week. */
export function aWeekFeature(o: Partial<import("../../plan/types.ts").WeekFeature> = {}): import("../../plan/types.ts").WeekFeature {
  const id = o.id ?? next();
  return { id, weekStart: WEEK, clientKey: "adatum", itemId: 1, title: `Feature ${o.itemId ?? 1}`, itemType: "Feature", url: null, level: "feature", tier: "must", estimate: null, size: null, parentId: null, slots: [], doneAt: null, position: null, createdAt: `${WEEK}T09:00:00-05:00[${ZONE}]`, updatedAt: `${WEEK}T09:00:00-05:00[${ZONE}]`, ...o };
}

/** ADM-2: an active Dataverse account (store/admin-store.ts DirectoryAccount): a customer named Adatum by default. */
export function anAccount(o: Partial<import("../../store/admin-store.ts").DirectoryAccount> = {}): import("../../store/admin-store.ts").DirectoryAccount {
  const n = next();
  const clientKey = o.clientKey ?? `Account ${n}`;
  return { accountId: `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`, clientKey, name: clientKey, type: "customer", workers: 1, focus: 1, ...o };
}

/** ADM-2: a person in the Dataverse directory, a Cooptimizer (contoso.example) by default. */
export function aDirectoryPerson(o: Partial<import("../../sources/dataverse/directory.ts").DirectoryRead["people"][number]> = {}): import("../../sources/dataverse/directory.ts").DirectoryRead["people"][number] {
  const n = next();
  return { personId: `a4d00000-0000-4000-8000-${String(n).padStart(12, "0")}`, systemUserId: `d3300000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `Person ${n}`, email: `person${n}@contoso.example`, level: "consultant", positionName: "Consultant", guest: false, ...o };
}

/** NV-1: an open follow-up as the week load shows it (due null: no due date). */
export function aFollowUpView(o: Partial<import("../../actions/types.ts").FollowUpView> = {}): import("../../actions/types.ts").FollowUpView {
  return {
    id: 1, kind: "manual", clientKey: "contoso", who: "Dana", whoRef: null, what: "Send the summary", channel: null, due: null, itemId: null, itemUrl: null, draft: null,
    openedAt: "2026-11-02T14:00:00Z", isNew: false, closedAt: null, closeNote: null, closedBy: null, session: null, outcome: null, closeHow: null, snoozedUntil: null,
    origin: null, byHand: true, clientName: "Contoso", dueState: null, hasWho: true, ...o,
  };
}

/** NV-1: one of my promises for the day (Today, the urgent strip, the Inbox badge). */
export function aDayPromise(o: Partial<import("../../plan/conversation-views.ts").DayPromise> = {}): import("../../plan/conversation-views.ts").DayPromise {
  return { id: 1, what: "Send the export", toName: "Dana", clientKey: "contoso", clientName: "Contoso", dueAt: null, dueDate: "2026-11-05", overdue: false, ...o };
}

/** IB-1 slice 4: one Inbox row as inbox.list and inbox.today return it: an open promise in Needs you by default. */
export function anInboxRow(o: Partial<import("../../plan/inbox-items.ts").InboxItemView> = {}): import("../../plan/inbox-items.ts").InboxItemView {
  return { key: "c1", kind: "promise", clientKey: "contoso", at: "2026-11-05T14:00:00Z", views: ["needs_you", "promises"], title: "Send the export", who: "Dana", where: null, due: "2026-11-05", dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null, ...o };
}

/** PL-1: one child of a feature as the DevOps store has it: an open User Story, unassigned. */
export function aPortfolioChild(o: Partial<import("../../week/types.ts").PortfolioChild> = {}): import("../../week/types.ts").PortfolioChild {
  const id = o.id ?? next();
  return { id, title: `Story ${id}`, type: "User Story", state: "Active", stateCategory: "InProgress", open: true, level: "story", order: id, url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, assignedTo: null, assignedToEmail: null, mine: false, ...o };
}

/** PL-1: a feature as the DevOps source's by-id read returns it: open, not mine, no children. */
export function aPortfolioItem(o: Partial<import("../../week/types.ts").PortfolioItem> = {}): import("../../week/types.ts").PortfolioItem {
  const id = o.id ?? next();
  return { id, title: `Feature ${id}`, type: "Feature", state: "Active", stateCategory: "InProgress", tier: "feature", order: id, parentId: null, url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, targetDate: null, assignedTo: null, mine: false, why: [], children: [], ...o };
}

/** CV-3: one person in the PersonPicker, a Cooptimizer by default (their Entra object id as the reference). */
export function aPickerPerson(o: { name?: string; external?: boolean; id?: string } = {}): import("../../actions/people-picker.ts").PickerPerson {
  const n = next();
  const name = o.name ?? `Person ${n}`;
  const id = o.id ?? `p${n}`;
  return o.external
    ? { name, ref: { kind: "external", memberId: id, name }, email: null, external: true }
    : { name, ref: { kind: "cooptimizer", id, name }, email: `${id}@contoso.example`, external: false };
}

// ---- AH-1: Ahead ----

/** One DevOps item as Ahead reads it (a feature by default, assigned to nobody, no dates). */
export function anAheadItem(o: Partial<AheadItem> = {}): AheadItem {
  const id = o.id ?? 1000 + next();
  return { id, rev: 3, title: `Item ${id}`, type: "Feature", state: "Active", stateCategory: "InProgress", level: "parent", rung: 1, parentId: null, assignee: null, start: null, target: null, size: null, url: `https://dev.azure.com/contoso/Portal/_workitems/edit/${id}`, changedAt: "2026-11-01T12:00:00Z", inScope: true, ...o };
}
/** Someone as an assignee. */
export const anAssignee = (name: string, email = `${name.split(" ")[0]!.toLowerCase()}@cooptimize.example`) => ({ name, email });
/** A client's items in Ahead: an Agile-like process (Epic › Feature › User Story; dates on Epic and Feature, Story Points on stories). */
export function anAheadClient(o: Partial<AheadClient> = {}): AheadClient {
  const sizeField = "Microsoft.VSTS.Scheduling.StoryPoints";
  return {
    clientKey: "Northwind", clientName: "Northwind Foods", status: "ok", fetchedAt: "2026-11-02T14:00:00Z", project: "Portal", me: "you@cooptimize.example",
    startFields: { Epic: "Microsoft.VSTS.Scheduling.StartDate", Feature: "Microsoft.VSTS.Scheduling.StartDate" },
    targetFields: { Epic: "Microsoft.VSTS.Scheduling.TargetDate", Feature: "Microsoft.VSTS.Scheduling.TargetDate" },
    sizeFields: { "User Story": sizeField },
    fieldNames: { [sizeField]: "Story Points" },
    types: [],
    items: [],
    orderField: "Microsoft.VSTS.Common.StackRank",
    ...o,
  };
}
/** ahead.load's answer for some clients (nothing pending, nothing editable unless given). */
export function anAheadLoad(clients: (AheadClient & Partial<AheadLoad["clients"][number]>)[], o: Partial<Omit<AheadLoad, "clients">> = {}): AheadLoad {
  return { today: "2026-11-02", clients: clients.map((c) => ({ lead: false, editable: [], note: `Only ${c.clientName}'s leads and the owner can change this.`, canWrite: true, hints: {}, fixGaps: ["needs_stories", "no_dates", "unassigned", "unsized"], ...c })), changes: [], halves: [], automation: false, fixTopN: 30, ...o };
}

/** SR-1: an item of a client's store as Status selects from it: an open feature, unassigned, in backlog order by id. */
export function aReportItem(o: Partial<import("../../plan/status-report.ts").ReportItem> = {}): import("../../plan/status-report.ts").ReportItem {
  const id = o.id ?? next();
  const level = o.level ?? "parent";
  return { id, title: level === "parent" ? `Feature ${id}` : `Story ${id}`, type: level === "parent" ? "Feature" : "User Story", state: "Active", stateCategory: "InProgress", level, parentId: null, assigneeEmail: null, url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, order: id, ...o };
}

/** SR-1: a feature comment as DevOps returns it, by a teammate at Monday noon UTC unless given. */
export function aReportComment(o: Partial<import("../../plan/status-report.ts").RawReportComment> = {}): import("../../plan/status-report.ts").RawReportComment {
  const id = o.id ?? next();
  return { id, text: `Update ${id}`, authorName: "Dana Teammate", authorUnique: "dana@contoso.example", createdAt: "2026-11-02T17:00:00Z", modifiedAt: null, ...o };
}

/** SR-1: what status.load answers for one client, with features that have `updates[i]` comments this week each. */
export function aStatusLoad(o: { clientKey?: string; clientName?: string; updates?: number[]; ids?: number[] } = {}): import("../../plan/status-types.ts").StatusLoad {
  const updates = o.updates ?? [0, 1, 0];
  const features = updates.map((n, i) => {
    const id = o.ids?.[i] ?? next();
    return { id, title: `Feature ${id}`, type: "Feature", state: "Active", url: `https://dev.azure.com/contoso/p/_workitems/edit/${id}`, why: "planned" as const, thisWeek: Array.from({ length: n }, (_, j) => ({ id: id * 10 + j, text: `Update ${j}`, author: "Dana Teammate", at: "2026-11-03T15:00:00Z", who: "teammate" as const, editable: false })), lastWeek: [], hints: [], order: i };
  });
  const without = updates.filter((n) => n === 0).length;
  return {
    reportDate: "2026-11-09",
    title: "Status report · for Monday, Nov 9",
    sends: "Kat sends it Monday 7:00 AM",
    counts: { features: updates.length, withUpdate: updates.length - without, without },
    countLine: `${updates.length} features`,
    clients: [{ clientKey: o.clientKey ?? "Contoso", clientName: o.clientName ?? "Contoso", status: "ok", window: { since: "2026-11-02T12:04:00Z", source: "kat", katSentAt: "2026-11-02T12:04:00Z", prevSince: "2026-10-26T12:04:00Z", note: null }, canWrite: true, ai: "off", aiNote: null, features: features.map(({ order: _o, ...f }) => f), also: [] }],
  };
}
