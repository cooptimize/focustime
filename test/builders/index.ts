// Test data builders (S1, D454). Every builder returns a valid default and takes overrides, so a test names only what
// it is about: aPto({ date: "2026-11-12" }), aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Thu: "AM" } }).
// Fictional names only (the demo set). Dates default to the week of Mon Nov 2, 2026 in New York, like the e2e clock.
// New and edited tests use these instead of hand-written fixtures (CLAUDE.md, Working style).
import { legacyHours } from "../../config/schema.ts";
import type { MyClient } from "../../sources/dataverse/source.ts";
import type { UserRow } from "../../store/accounts.ts";
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
