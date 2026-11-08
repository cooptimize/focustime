// Demo data (step 15, D272): a realistic, fictional week for showing FocusTime without real client data. Every date is
// generated from the week asked for, so the demo always looks current. No real people, clients, meetings or items.
import type { PtoEntry } from "../../week/pto.ts";
import { scopeOf, type ProjectAreas, type ScopeItem } from "../../plan/devops-scope.ts";
import type { ScopeDeps } from "../devops/source.ts";
import { buildProcessModel, looksOf, type ProcessModel, type ProcessOverrides } from "../../plan/process.ts";
import type { DemoItem } from "./devops.ts";
import type { CalEvent, ClientPortfolio, ClientWork, FocusPattern, IsoDate, PortfolioChild, PortfolioItem, WorkItem } from "../../week/types.ts";

export const DEMO_TZ = "America/New_York";
export const DEMO_ME = "d3300000-0000-4000-8000-000000000001";

/** The demo's clients: key, name, color, DevOps org and project. */
export const DEMO_CLIENTS = [
  { key: "Cooptimize", name: "Cooptimize", color: "#4a7fd4", org: "cooptimize-demo", project: "Internal" },
  { key: "Northwind", name: "Northwind Foods", color: "#1f9e8f", org: "northwind-demo", project: "Portal" },
  { key: "Harbor", name: "Harbor Health", color: "#7b68ee", org: "harbor-demo", project: "Patient Experience" },
  { key: "Atlas", name: "Atlas Freight", color: "#d2892a", org: "atlas-demo", project: "Logistics" },
] as const;
export type DemoClientKey = (typeof DEMO_CLIENTS)[number]["key"];

/** Fictional teammates (help finder, Who suggestions). */
export const DEMO_PEOPLE = [
  { id: "d3300000-0000-4000-8000-000000000011", name: "Jordan Lee", email: "jordan.lee@example.com", aadId: "a4d00000-0000-4000-8000-000000000011" },
  { id: "d3300000-0000-4000-8000-000000000012", name: "Priya Shah", email: "priya.shah@example.com", aadId: "a4d00000-0000-4000-8000-000000000012" },
  { id: "d3300000-0000-4000-8000-000000000013", name: "Sam Ortiz", email: "sam.ortiz@example.com", aadId: "a4d00000-0000-4000-8000-000000000013" },
  { id: "d3300000-0000-4000-8000-000000000014", name: "Taylor Kim", email: "taylor.kim@example.com", aadId: "a4d00000-0000-4000-8000-000000000014" },
];
/** Step 16.3: their fictional Teams presence (availability, activity). */
export const DEMO_PRESENCE: Record<string, { availability: string; activity: string }> = {
  "a4d00000-0000-4000-8000-000000000011": { availability: "Available", activity: "Available" },
  "a4d00000-0000-4000-8000-000000000012": { availability: "Busy", activity: "InAMeeting" },
  "a4d00000-0000-4000-8000-000000000013": { availability: "Away", activity: "Away" },
  "a4d00000-0000-4000-8000-000000000014": { availability: "DoNotDisturb", activity: "DoNotDisturb" },
};

/** The config the demo runs with (held in memory; never the real file). */
export const DEMO_CONFIG = `# FocusTime demo configuration (in memory only)
[dataverse]
environment_url = "https://demo.crm.dynamics.com"
tenant_id = "00000000-0000-4000-8000-0000000000d1"
client_id = "00000000-0000-4000-8000-0000000000d2"
my_email = "you@example.com"
my_systemuserid = "${DEMO_ME}"

[hours]
time_zone = "${DEMO_TZ}"
lunch = "12:30-12:30"
mon = ["09:00-17:00"]
tue = ["09:00-17:00"]
wed = ["09:00-17:00"]
thu = ["09:00-17:00"]
fri = []
sat = []
sun = []

[risk]
meeting_watch_minutes = 90
meeting_at_risk_minutes = 150
min_focus_window_minutes = 90

[[standing_blocks]]
day = "Mon"
half = "AM"
client = "Cooptimize"

[clients]
${DEMO_CLIENTS.map((c) => `${c.key} = "${c.color}"`).join("\n")}

[outlook]
tenant_id = "00000000-0000-4000-8000-0000000000d1"
client_id = "00000000-0000-4000-8000-0000000000d3"

[google]
client_id = "demo.apps.googleusercontent.com"
calendars = ["primary"]

[ui]
view_range = "business"
`;

const plus = (monday: IsoDate, days: number) => Temporal.PlainDate.from(monday).add({ days }).toString();
const at = (date: IsoDate, hm: string) => Temporal.PlainDateTime.from(`${date}T${hm}`).toZonedDateTime(DEMO_TZ).toString({ timeZoneName: "never" });

/** Focus Time patterns: Northwind Mon PM and all Wednesday, Harbor Tue and Thu AM, Atlas Tue and Thu PM. */
export function demoPatterns(): FocusPattern[] {
  return [
    { id: "demo-ft-nw", clientKey: "Northwind", clientName: "Northwind", clientFullName: "Northwind Foods", startDate: "2026-01-05", endDate: null, active: true, days: { Mon: "PM", Wed: "AllDay" } },
    { id: "demo-ft-hh", clientKey: "Harbor", clientName: "Harbor", clientFullName: "Harbor Health", startDate: "2026-03-02", endDate: null, active: true, days: { Tue: "AM", Thu: "AM" } },
    { id: "demo-ft-at", clientKey: "Atlas", clientName: "Atlas", clientFullName: "Atlas Freight", startDate: "2026-06-01", endDate: null, active: true, days: { Tue: "PM", Thu: "PM" } },
  ];
}

/** Work meetings (Outlook) for the week starting `monday`. */
export function demoOutlook(monday: IsoDate): CalEvent[] {
  const o = (id: string, day: number, title: string, from: string, to: string, extra: Partial<CalEvent> = {}): CalEvent => {
    const d = plus(monday, day);
    return { id: `outlook:demo-${id}-${d}`, source: "outlook", title, start: at(d, from), end: at(d, to), allDay: false, showAs: "busy", isPersonal: false, responseStatus: "accepted", ...extra };
  };
  return [
    ...[0, 1, 2].map((d) => o(`standup${d}`, d, "Team standup", "09:00", "09:15")),
    o("prop", 0, "Proposal review with Jordan", "11:00", "11:45"),
    o("nwstatus", 0, "Northwind weekly status", "13:00", "13:30"),
    o("nwmodel", 0, "Northwind data model review", "15:00", "16:00"),
    o("hhplan", 1, "Harbor sprint planning", "10:00", "11:00"),
    o("atref", 1, "Atlas backlog refinement", "13:00", "14:00"),
    o("atdemo", 1, "Atlas stakeholder demo", "14:00", "15:30", { showAs: "tentative", responseStatus: "tentative" }),
    o("nwshop", 2, "Northwind requirements workshop", "09:30", "11:30"),
    o("lunch", 2, "Lunch and learn: Power Automate", "12:00", "12:45", { showAs: "tentative", responseStatus: "tentative" }),
    o("allhands", 4, "Cooptimize all hands", "11:00", "11:30"),
    // U5.1: a three-day all-day event (Wed to Fri, end exclusive), shown as free: a chip on each day it covers.
    { id: `outlook:demo-summit-${plus(monday, 2)}`, source: "outlook", title: "Fabrikam partner summit 2026", start: plus(monday, 2), end: plus(monday, 5), allDay: true, showAs: "free", isPersonal: false, responseStatus: "accepted" },
  ];
}

/** Step 16: who organizes each demo meeting (all fictional); every one is a meeting I'm invited to. */
export function demoOrganizer(id: string): string {
  if (/nw/.test(id)) return "Dana Morales";
  if (/hh/.test(id)) return "Chris Park";
  if (/at(ref|demo)/.test(id)) return "Morgan Diaz";
  if (/lunch/.test(id)) return "Priya Shah";
  return "Jordan Lee";
}

/**
 * QF-1: the weekdays the demo's PTO day and its afternoon out fall on, never today (so Today always has content in a
 * demo): PTO on Thursday, or the next weekday when today is Thursday; out on Wednesday afternoon, or Tuesday when today
 * is Wednesday. The same weekdays every week, from today's.
 */
export function demoDays(today: IsoDate): { pto: number; out: number } {
  const dow = Temporal.PlainDate.from(today).dayOfWeek;
  return { pto: dow === 4 ? 5 : 4, out: dow === 3 ? 2 : 3 };
}

/** Personal events (Google): one crosses the morning and afternoon seam on Monday; DM-1: an afternoon out (QF-1: never today). */
export function demoGoogle(monday: IsoDate, today: IsoDate): CalEvent[] {
  const g = (id: string, day: number, title: string, from: string, to: string): CalEvent => {
    const d = plus(monday, day);
    return { id: `google-demo-${id}-${d}`, source: "google", title, start: at(d, from), end: at(d, to), allDay: false, showAs: "busy", isPersonal: true };
  };
  return [g("dentist", 0, "Dentist", "12:00", "13:00"), g("pickup", 1, "School pickup", "15:30", "16:00"), g("run", 2, "Run club", "17:30", "18:30"), g("out", demoDays(today).out - 1, "Out: school event", "13:30", "16:30")];
}

/** PTO: Thursday is a day off (QF-1: Friday when today is Thursday, so never today). */
export function demoPto(from: IsoDate, to: IsoDate, today: IsoDate): PtoEntry[] {
  const out: PtoEntry[] = [];
  const day = demoDays(today).pto;
  for (let d = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(d, Temporal.PlainDate.from(to)) <= 0; d = d.add({ days: 1 }))
    if (d.dayOfWeek === day) out.push({ date: d.toString(), title: "Day off", trackerId: `demo-pto-${d}` });
  return out;
}

type Raw = [id: number, type: string, state: string, parent: number | null, title: string, assignee: string | null, target?: IsoDate | null];
/** "You": the demo's person, as the items name them. */
export const ME = "You";
/** Work items per client, in backlog order: id, type, state, parent, title, assignee ("You" is me), target date. */
const ITEMS: Record<DemoClientKey, Raw[]> = {
  Cooptimize: [
    [4410, "Feature", "Active", null, "Internal reporting refresh", ME, "2026-11-20"],
    [4411, "User Story", "Active", 4410, "Timesheet summary query", ME],
    [4412, "User Story", "New", 4410, "Utilization chart", ME],
    [4420, "User Story", "New", null, "Onboarding guide for new hires", ME],
    // Step 17: on track (two of four done, target well ahead).
    [4430, "Feature", "Active", null, "Knowledge base search", ME, "2026-12-18"],
    [4431, "User Story", "Closed", 4430, "Index the wiki pages", ME],
    [4432, "User Story", "Closed", 4430, "Search box in the portal", "Jordan Lee"],
    [4433, "User Story", "Active", 4430, "Rank results by team", ME],
    [4434, "User Story", "New", 4430, "Search analytics", "Jordan Lee"],
  ],
  Northwind: [
    [1100, "Epic", "Active", null, "Customer portal redesign", "Jordan Lee"],
    [1110, "Feature", "Active", 1100, "Order history export", ME, "2026-11-13"],
    [1111, "User Story", "Active", 1110, "Export orders to CSV", ME, "2026-10-30"],
    [1112, "User Story", "New", 1110, "Filter orders by date range", ME, "2026-11-05"],
    [1113, "User Story", "New", 1110, "Export button on the order page", "Priya Shah"],
    [1114, "User Story", "Closed", 1110, "Order export API endpoint", ME],
    [1120, "Feature", "New", 1100, "Supplier onboarding", ME, null],
    // KB-1: a data feature, for Break down with the standards.
    [1160, "Feature", "New", 1100, "Sales reporting: Gold fact and dimensions, semantic model and report", ME, null],
    [1130, "User Story", "Active", null, "Fix login timeout on mobile", ME],
    [1131, "Bug", "Active", null, "Invoice PDF totals round wrong", ME],
    // Step 17: two more features targeting December (a crowded month in Plan ahead).
    [1140, "Feature", "New", 1100, "Loyalty points", ME, "2026-12-11"],
    [1141, "User Story", "New", 1140, "Earn points on orders", ME],
    [1142, "User Story", "New", 1140, "Points balance page", "Priya Shah"],
    [1150, "Feature", "New", 1100, "Store locator", ME, "2026-12-18"],
    [1151, "User Story", "New", 1150, "Map of stores", ME],
  ],
  Harbor: [
    [2210, "Feature", "Active", null, "Patient intake form", ME, "2026-11-27"],
    [2211, "User Story", "Active", 2210, "Insurance card upload", ME, "2026-11-05"],
    [2212, "User Story", "New", 2210, "Validate date of birth", ME],
    [2213, "User Story", "New", 2210, "Intake form accessibility review", "Sam Ortiz", "2026-11-04"],
    // D460: more people on the intake form (Cooptimizers with photos, and someone outside the team: initials).
    [2217, "User Story", "New", 2210, "Intake form translations", "Jordan Lee"],
    [2218, "User Story", "New", 2210, "Intake data export", "Priya Shah", "2026-11-12"],
    [2219, "User Story", "New", 2210, "Front desk review of the intake form", "Morgan Reyes"],
    [2214, "User Story", "Closed", 2210, "Intake form layout", ME],
    [2215, "User Story", "Closed", 2210, "Save a draft intake", "Sam Ortiz"],
    [2216, "User Story", "Closed", 2210, "Intake confirmation email", ME],
    [2220, "Feature", "Active", null, "Appointment reminders", "Priya Shah"],
    [2221, "User Story", "New", 2220, "SMS reminder template", ME],
    [2230, "User Story", "New", null, "Power BI refresh schedule", ME],
    // Step 17: done (every story closed), the feature itself not closed yet.
    [2240, "Feature", "Active", null, "Patient portal login", ME, "2026-10-30"],
    [2241, "User Story", "Closed", 2240, "Sign in with a one-time code", ME],
    [2242, "User Story", "Closed", 2240, "Remember this device", "Sam Ortiz"],
  ],
  Atlas: [
    // Step 17: two Atlas features due in December, a month with few Atlas blocks (a crowded month in Plan ahead).
    [3310, "Feature", "Active", null, "Shipment tracking dashboard", ME, "2026-12-10"],
    [3311, "User Story", "Active", 3310, "Map of active shipments", ME],
    [3312, "User Story", "New", 3310, "Delay alerts", ME],
    [3320, "Epic", "New", null, "Carrier integrations", ME],
    [3330, "User Story", "New", null, "Rate table import", ME],
    [3340, "Feature", "New", null, "Delivery time estimates", ME, "2026-12-17"],
    [3341, "User Story", "New", 3340, "Estimate from carrier history", ME],
    // PL-1: one I own with only teammates' stories (Watching), and one resolved last week (Finished last week).
    [3350, "Feature", "Active", null, "Carrier rate alerts", ME],
    [3351, "User Story", "Active", 3350, "Rate change feed", "Sam Ortiz"],
    [3352, "User Story", "New", 3350, "Alert settings page", "Sam Ortiz"],
    [3353, "User Story", "New", 3350, "Weekly rate digest", "Priya Shah"],
    [3360, "Feature", "Resolved", null, "Carrier contact list", ME],
    [3361, "User Story", "Closed", 3360, "Import carrier contacts", ME],
  ],
};

/** Step 16 (Roadmap): stories with no change in a while, and stories with no size yet. Step 17: Atlas's dashboard is stalled. */
const QUIET = new Set([4412, 1112, 3311, 3312]);
/** BH-1: open stories at the bottom of their backlogs that nobody has touched in two months (stale in Backlog). */
const STALE = new Set([1142, 2230, 3330, 3353, 4434]);
/** Step 17: a story blocked by a tag (Harbor's intake form reads Blocked). */
const BLOCKED = new Set([2212, 3341]);
/** Step 17: DevOps Start Date on some features (the demo process has the field); the rest are estimated in Plan ahead. */
const START: Record<number, IsoDate> = { 4410: "2026-10-26", 1110: "2026-10-19", 2210: "2026-10-12", 4430: "2026-11-09" };
const UNSIZED = new Set([1113, 2213]);
/** DM-1: descriptions where the demo shows them (Break down reads Supplier onboarding's; the rest are one line). */
const DESCRIPTIONS: Record<number, string> = {
  1120: "<div>Suppliers sign up through the portal instead of emailing the purchasing team. They enter company details, upload their certificates and choose payment terms; purchasing reviews and approves each one.</div><div>Today onboarding takes about two weeks of back and forth.</div>",
  1160: "<div>Sales numbers in one place: a Gold fact table for sales orders, a customer dimension, a semantic model over them and a sales report in Power BI.</div>",
  1110: "<div>Customers export their order history from the portal, filtered by date, as CSV.</div>",
  2210: "<div>Patients complete the intake form before their first visit, on a phone or at home.</div>",
};
const ACCEPTANCE: Record<number, string> = {
  1120: "<div>A supplier can save a draft and come back to it.</div><div>Purchasing gets one notification per new supplier.</div><div>Certificates are PDF or image files up to 10 MB.</div>",
};

const client = (k: DemoClientKey) => DEMO_CLIENTS.find((c) => c.key === k)!;
const urlOf = (k: DemoClientKey, id: number) => `https://dev.azure.com/${client(k).org}/${encodeURIComponent(client(k).project)}/_workitems/edit/${id}`;
const isPortfolio = (t: string) => t === "Feature" || t === "Epic";
const category = (s: string) => (s === "New" ? "Proposed" : s === "Closed" ? "Completed" : s === "Resolved" ? "Resolved" : s === "Removed" ? "Removed" : "InProgress");
const emailOf = (who: string | null) => (who === ME ? "you@example.com" : who ? (CLIENT_STAFF[who] ?? DEMO_PEOPLE.find((p) => p.name === who)?.email ?? null) : null);

/** DM-1: the items a demo session's DevOps starts with (sources/demo/devops.ts keeps them, with every write). */
export function demoItems(): DemoItem[] {
  const out: DemoItem[] = [];
  for (const c of DEMO_CLIENTS) {
    const rows = [...ITEMS[c.key].map((r) => [r, false] as const), ...(PROJECT_ONLY[c.key] ?? []).map((r) => [r, true] as const)];
    rows.forEach(([r, projectOnly], n) => {
      const [id, type, state, parent, title, who, target] = r;
      out.push({
        clientKey: c.key, id, rev: 3 + (id % 7), type, state, parent, title, who, whoEmail: emailOf(who), target: target ?? null, start: START[id] ?? null,
        size: isPortfolio(type) || UNSIZED.has(id) ? null : 3, changedAt: STALE.has(id) ? "2026-09-04T15:00:00Z" : QUIET.has(id) ? "2026-10-09T15:00:00Z" : "2026-10-30T15:00:00Z", order: n + 1, blocked: BLOCKED.has(id),
        description: DESCRIPTIONS[id] ?? "<div>A fictional work item for the FocusTime demo.</div>", acceptance: ACCEPTANCE[id] ?? "", projectOnly, createdBy: null, area: c.key !== "Northwind" ? c.project : projectOnly ? `${c.project}\\Finance` : `${c.project}\\Web`, iteration: `${c.project}\\Sprint 23`, relations: [],
      });
    });
  }
  return out;
}
/** The names the demo knows for DevOps emails (an assignee written by email reads back as that person). */
export function demoDevOpsPeople(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of DEMO_PEOPLE) out[p.email.toLowerCase()] = p.name;
  for (const [name, email] of Object.entries(CLIENT_STAFF)) out[email.toLowerCase()] = name;
  return out;
}

/** What the demo's reads need from its DevOps: one client's items in backlog order. */
export type DemoItems = { items: (k: DemoClientKey) => DemoItem[] };

function item(k: DemoClientKey, i: DemoItem): WorkItem {
  return {
    id: i.id, title: i.title, type: i.type, state: i.state, stateCategory: category(i.state), level: isPortfolio(i.type) ? "portfolio" : "story", ...(isPortfolio(i.type) ? { tier: i.type === "Epic" ? ("epic" as const) : ("feature" as const) } : {}),
    order: i.order, parentId: i.parent, changedAt: i.changedAt, url: urlOf(k, i.id), tags: [], blocked: false, changedByMe: false,
    assignedTo: i.who === ME ? "You" : i.who, assignedToMe: i.who === ME, targetDate: i.target,
    // Step 16.4: the fictional assignee's email (DevOps uniqueName), matched to the demo team by email.
    assignedToEmail: i.whoEmail,
  };
}

/** One item as the Week reads it (CV-5's live state of a linked item), or null. */
export function demoWorkItem(d: DemoItems, k: DemoClientKey, id: number): WorkItem | null {
  const i = d.items(k).find((x) => x.id === id);
  return i ? item(k, i) : null;
}

/** WT-1: the demo's process (fictional, shaped like Agile): what its types look like and where they sit. */
const DEMO_STATES = [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }];
const demoType = (name: string, icon: string, color: string) => ({ name, icon: { id: icon }, color, states: DEMO_STATES });
export function demoProcess(k: DemoClientKey, overrides: ProcessOverrides = {}): ProcessModel {
  const lvl = (type: "portfolio" | "requirement" | "task", rank: number, types: string[]) => ({ type, rank, workItemTypes: types.map((name) => ({ name })), defaultWorkItemType: { name: types[0] } });
  return buildProcessModel({
    org: client(k).org, project: client(k).project, process: "Agile", fetchedAt: "2026-10-30T15:00:00Z",
    teamSettings: { bugsBehavior: "asTasks" }, processConfig: { bugWorkItems: { workItemTypes: [{ name: "Bug" }] } },
    teamBacklogs: { value: [lvl("portfolio", 4, ["Epic"]), lvl("portfolio", 3, ["Feature"]), lvl("requirement", 2, ["User Story"]), lvl("task", 1, ["Task", "Bug"])] },
    types: [demoType("Epic", "icon_crown", "E06C00"), demoType("Feature", "icon_trophy", "773B93"), demoType("User Story", "icon_book", "009CCC"), demoType("Task", "icon_clipboard", "A4880A"), demoType("Bug", "icon_insect", "CC293D")],
  }, overrides);
}

const live = (i: DemoItem) => category(i.state) !== "Removed";
const mineOrScope = (d: DemoItems, k: DemoClientKey) => d.items(k).filter((i) => !i.projectOnly && live(i));

/** One client's DevOps read: my open items in board order, and the open children of my features and epics. */
export function demoWork(d: DemoItems, k: DemoClientKey, fetchedAt: string): ClientWork {
  const all = mineOrScope(d, k).map((r) => item(k, r)).filter((i) => i.stateCategory !== "Completed");
  const mine = all.filter((i) => i.assignedToMe);
  const mineIds = new Set(mine.map((i) => i.id));
  const children = all.filter((i) => !mineIds.has(i.id) && i.parentId !== null);
  return { clientKey: k, clientName: client(k).name, status: "ok", fetchedAt, fromCache: false, items: mine, children, watched: [], committed: [], types: looksOf(demoProcess(k)) };
}

/** One client's features and epics for Plan the week, with every child (any state). */
export function demoPortfolio(d: DemoItems, k: DemoClientKey, fetchedAt: string): ClientPortfolio {
  const rows = mineOrScope(d, k);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const all = rows.map((r) => item(k, r));
  const child = (c: WorkItem): PortfolioChild => {
    const r = byId.get(c.id)!;
    return {
      id: c.id, title: c.title, type: c.type, state: c.state, stateCategory: c.stateCategory, open: c.stateCategory !== "Completed", level: c.level, order: c.order, url: c.url, assignedTo: c.assignedTo ?? null, assignedToEmail: c.assignedToEmail ?? null, mine: !!c.assignedToMe,
      changedAt: r.changedAt, size: r.size, blocked: r.blocked, targetDate: c.targetDate ?? null,
    };
  };
  const items: PortfolioItem[] = all
    .filter((i) => i.level === "portfolio")
    .map((i) => ({
      id: i.id, title: i.title, type: i.type, state: i.state, stateCategory: i.stateCategory, tier: i.tier ?? "feature", order: i.order, parentId: i.parentId, url: i.url,
      targetDate: i.targetDate ?? null, startDate: byId.get(i.id)!.start, assignedTo: i.assignedTo ?? null, mine: !!i.assignedToMe,
      why: i.assignedToMe ? ["assigned"] : ["parent"],
      children: all.filter((c) => c.parentId === i.id).map(child),
      areaPath: client(k).project, iterationPath: `${client(k).project}\\Sprint 23`,
    }));
  return { clientKey: k, clientName: client(k).name, status: "ok", fetchedAt, fromCache: false, items, targetFields: { Feature: "Microsoft.VSTS.Scheduling.TargetDate", Epic: "Microsoft.VSTS.Scheduling.TargetDate", "User Story": "Microsoft.VSTS.Scheduling.TargetDate" }, startFields: { Feature: "Microsoft.VSTS.Scheduling.StartDate", Epic: "Microsoft.VSTS.Scheduling.StartDate" }, sizeField: "Microsoft.VSTS.Scheduling.StoryPoints", acceptanceField: true };
}

export const isDemoClient = (k: string): k is DemoClientKey => DEMO_CLIENTS.some((c) => c.key === k);

/** AH-3: Cooptimizers' client logins on Harbor's DevOps (fictional): Priya's is in Dataverse, Sam's only suggested. */
export const DEMO_LOGINS: Record<string, string> = { "Ext-Priya Shah": "ext-priya.shah@harbor.example", "Ext-Sam Ortiz": "ext-sam.ortiz@harbor.example" };
const CLIENT_STAFF: Record<string, string> = { "Dana Fields": "dana.fields@northwind.example", "Omar Reyes": "omar.reyes@northwind.example", ...DEMO_LOGINS };
/**
 * AH-2: the client's own work beside ours in Northwind's project (fictional): an area of their finance program, by
 * their own staff (not Cooptimizers). Only Ahead reads it (the store has the whole project; Week starts from my items).
 * AH-3: Harbor's own work signed in with client logins: Priya's (linked) shows as Priya Shah, Sam's as DevOps has it.
 */
const PROJECT_ONLY: Partial<Record<DemoClientKey, Raw[]>> = {
  Northwind: [
    [1700, "Epic", "Active", null, "Finance close automation", "Dana Fields"],
    [1710, "Feature", "Active", 1700, "Month-end journal import", "Dana Fields", "2026-12-04"],
    [1711, "User Story", "New", 1710, "Map ledger accounts", "Omar Reyes"],
    [1712, "User Story", "New", 1710, "Journal approval step", null],
    [1720, "Feature", "New", 1700, "Vendor payment run", "Omar Reyes"],
  ],
  Harbor: [
    [2250, "Feature", "Active", null, "Referral tracking", "Ext-Priya Shah", "2026-11-26"],
    [2251, "User Story", "New", 2250, "Referral source field", "Ext-Sam Ortiz"],
  ],
};
/** AH-2: the demo projects' areas and teams: Northwind's has two areas below its root; the others only the root. */
export function demoAreas(k: DemoClientKey): ProjectAreas {
  const root = client(k).project;
  if (k !== "Northwind") return { root, paths: [root], areasProblem: null, teams: [{ name: `${root} Team`, otherField: false, areas: [{ path: root, sub: true }] }], teamsProblem: null, readAt: "2026-10-30T15:00:00Z" };
  return {
    root, paths: [root, `${root}\\Web`, `${root}\\Finance`], areasProblem: null, teamsProblem: null, readAt: "2026-10-30T15:00:00Z",
    teams: [
      { name: `${root} Team`, otherField: false, areas: [{ path: root, sub: true }] },
      { name: "Web", otherField: false, areas: [{ path: `${root}\\Web`, sub: true }] },
      { name: "Finance", otherField: false, areas: [{ path: `${root}\\Finance`, sub: true }] },
    ],
  };
}
const areaOf = (k: DemoClientKey, i: DemoItem) => (k !== "Northwind" ? client(k).project : i.projectOnly ? `${client(k).project}\\Finance` : `${client(k).project}\\Web`);

/** AH-2: the demo's items as the scope rules read them (every level, the project-only ones too). */
export function demoScopeItems(d: DemoItems, k: DemoClientKey): ScopeItem[] {
  return d.items(k).filter((r) => r.state !== "Closed" && live(r)).map((r) => ({ id: r.id, parentId: r.parent, area: areaOf(k, r), assigneeEmail: r.whoEmail, portfolio: isPortfolio(r.type) }));
}

/**
 * AH-1: one client's items for Ahead, every level, as the central store would give them (fictional). Harbor's process
 * sizes stories in Effort; the others in Story Points (two processes, D657). AH-2: through the client's scope (the
 * same rules as the hosted app's); outside it only with `whole`. DM-1: the revisions are the demo DevOps's own, so a
 * save's `test /rev` matches what Ahead showed.
 */
export function demoAheadClient(d: DemoItems, k: DemoClientKey, fetchedAt: string, sc: { deps: ScopeDeps | null; whole: boolean } = { deps: null, whole: false }): import("../../actions/types.ts").AheadClient {
  const model = demoProcess(k);
  const rows = d.items(k).filter(live);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const all = rows.map((r) => item(k, r)).filter((i) => i.stateCategory !== "Completed" || rows.some((r) => r.parent === i.id));
  const result = sc.deps ? scopeOf(demoScopeItems(d, k), sc.deps.rule, { areas: demoAreas(k), isCooptimizer: sc.deps.isCooptimizer, me: "you@example.com" }) : null;
  const inScope = (id: number) => !result || result.all || result.ids.has(id);
  const open = all.filter((i) => i.stateCategory !== "Completed");
  const keep = new Set(open.filter((i) => sc.whole || inScope(i.id)).map((i) => i.id));
  for (const id of [...keep]) for (let p = all.find((i) => i.id === id)?.parentId ?? null; p !== null; p = all.find((i) => i.id === p)?.parentId ?? null) keep.add(p);
  const sizeRef = k === "Harbor" ? "Microsoft.VSTS.Scheduling.Effort" : "Microsoft.VSTS.Scheduling.StoryPoints";
  const portfolioTypes = [...model.levels.top, ...model.levels.parent];
  const storyTypes = model.levels.child;
  const map = (types: readonly string[], ref: string) => Object.fromEntries(types.map((t) => [t, ref]));
  return {
    clientKey: k, clientName: client(k).name, status: "ok", fetchedAt, project: client(k).project, me: "you@example.com",
    startFields: map(portfolioTypes, "Microsoft.VSTS.Scheduling.StartDate"),
    targetFields: map([...portfolioTypes, ...storyTypes], "Microsoft.VSTS.Scheduling.TargetDate"),
    sizeFields: map(storyTypes, sizeRef),
    fieldNames: { "Microsoft.VSTS.Scheduling.StartDate": "Start Date", "Microsoft.VSTS.Scheduling.TargetDate": "Target Date", [sizeRef]: k === "Harbor" ? "Effort" : "Story Points" },
    types: looksOf(model),
    scope: { kind: result?.kind ?? "whole", automatic: result?.kind === "automatic", all: result ? result.all : true, inScope: open.filter((i) => inScope(i.id)).length, total: open.length, problem: result?.problem ?? null, whole: sc.whole },
    items: all.filter((i) => keep.has(i.id)).map((i) => {
      const r = byId.get(i.id)!;
      return {
        id: i.id, rev: r.rev, title: i.title, type: i.type, state: i.state, stateCategory: i.stateCategory,
        level: model.types.find((t) => t.name === i.type)?.level ?? null, rung: model.ladder.findIndex((x) => x.includes(i.type)),
        parentId: i.parentId,
        assignee: i.assignedToMe ? { name: "Alex Rivera", email: "you@example.com" } : i.assignedTo ? { name: i.assignedTo, email: i.assignedToEmail ?? null } : null,
        start: r.start, target: r.target,
        size: i.level === "portfolio" || i.stateCategory === "Completed" ? null : r.size,
        url: i.url, changedAt: r.changedAt, inScope: inScope(i.id), order: i.order,
      };
    }),
    // AH-3: Harbor Health's demo project has no backlog order field, so its Fix next ranks by target date.
    orderField: k === "Harbor" ? null : "Microsoft.VSTS.Common.StackRank",
    // AH-5: each type's states from the demo's process model, for Grid's State editor.
    states: Object.fromEntries(model.types.map((t) => [t.name, t.states.map((x) => ({ name: x.name, category: x.category, color: x.color }))])),
  };
}

/** AH-5: the client's own staff on each demo project's teams (fictional, outside Cooptimize). */
const DEMO_CLIENT_STAFF: Record<DemoClientKey, { email: string; name: string }[]> = {
  Cooptimize: [],
  Northwind: [{ email: "morgan.lee@northwind.example", name: "Morgan Lee" }, { email: "ines.duarte@northwind.example", name: "Ines Duarte" }],
  Harbor: [{ email: "noor.haddad@harbor.example", name: "Noor Haddad" }],
  Atlas: [{ email: "casey.ward@atlas.example", name: "Casey Ward" }],
};

/** AH-5: the people on a demo project's teams, as the central poller would read them: its assignees and its own staff. */
export function demoProjectPeople(d: DemoItems, k: DemoClientKey): { email: string; name: string }[] {
  return [...demoAssignees(d, k), ...(DEMO_CLIENT_STAFF[k] ?? [])];
}

/** AH-3: who is assigned work in a demo project (DevOps email and display name), as the central store would say. */
export function demoAssignees(d: DemoItems, k: DemoClientKey): { email: string; name: string }[] {
  const out = new Map<string, { email: string; name: string }>();
  for (const r of d.items(k)) {
    if (!r.who || !r.whoEmail) continue;
    if (!out.has(r.whoEmail)) out.set(r.whoEmail, { email: r.whoEmail, name: r.who === ME ? "Alex Rivera" : r.who });
  }
  return [...out.values()];
}
