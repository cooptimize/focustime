// Demo data (step 15, D272): a realistic, fictional week for showing Coopilot without real client data. Every date is
// generated from the week asked for, so the demo always looks current. No real people, clients, meetings or items.
import type { PtoEntry } from "../../week/pto.ts";
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
  { id: "d3300000-0000-4000-8000-000000000011", name: "Jordan Lee", email: "jordan.lee@example.com" },
  { id: "d3300000-0000-4000-8000-000000000012", name: "Priya Shah", email: "priya.shah@example.com" },
  { id: "d3300000-0000-4000-8000-000000000013", name: "Sam Ortiz", email: "sam.ortiz@example.com" },
  { id: "d3300000-0000-4000-8000-000000000014", name: "Alex Kim", email: "alex.kim@example.com" },
];

/** The config the demo runs with (held in memory; never the real file). */
export const DEMO_CONFIG = `# Coopilot demo configuration (in memory only)
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

/** Personal events (Google): one crosses the morning and afternoon seam on Monday. */
export function demoGoogle(monday: IsoDate): CalEvent[] {
  const g = (id: string, day: number, title: string, from: string, to: string): CalEvent => {
    const d = plus(monday, day);
    return { id: `google-demo-${id}-${d}`, source: "google", title, start: at(d, from), end: at(d, to), allDay: false, showAs: "busy", isPersonal: true };
  };
  return [g("dentist", 0, "Dentist", "12:00", "13:00"), g("pickup", 1, "School pickup", "15:30", "16:00"), g("run", 2, "Run club", "17:30", "18:30")];
}

/** PTO: Thursday is a day off. */
export function demoPto(from: IsoDate, to: IsoDate): PtoEntry[] {
  const out: PtoEntry[] = [];
  for (let d = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(d, Temporal.PlainDate.from(to)) <= 0; d = d.add({ days: 1 }))
    if (d.dayOfWeek === 4) out.push({ date: d.toString(), title: "Day off", trackerId: `demo-pto-${d}` });
  return out;
}

type Raw = [id: number, type: string, state: string, parent: number | null, title: string, assignee: string | null, target?: IsoDate | null];
const ME = "You";
/** Work items per client: id, type, state, parent, title, assignee ("You" is me), target date. */
const ITEMS: Record<DemoClientKey, Raw[]> = {
  Cooptimize: [
    [4410, "Feature", "Active", null, "Internal reporting refresh", ME, "2026-11-20"],
    [4411, "User Story", "Active", 4410, "Timesheet summary query", ME],
    [4412, "User Story", "New", 4410, "Utilization chart", ME],
    [4420, "User Story", "New", null, "Onboarding guide for new hires", ME],
  ],
  Northwind: [
    [1100, "Epic", "Active", null, "Customer portal 2.0", "Jordan Lee"],
    [1110, "Feature", "Active", 1100, "Order history export", ME, "2026-11-13"],
    [1111, "User Story", "Active", 1110, "Export orders to CSV", ME],
    [1112, "User Story", "New", 1110, "Filter orders by date range", ME],
    [1113, "User Story", "New", 1110, "Export button on the order page", "Priya Shah"],
    [1114, "User Story", "Closed", 1110, "Order export API endpoint", ME],
    [1120, "Feature", "New", 1100, "Supplier onboarding", ME, null],
    [1130, "User Story", "Active", null, "Fix login timeout on mobile", ME],
    [1131, "Bug", "Active", null, "Invoice PDF totals round wrong", ME],
  ],
  Harbor: [
    [2210, "Feature", "Active", null, "Patient intake form", ME, "2026-11-27"],
    [2211, "User Story", "Active", 2210, "Insurance card upload", ME],
    [2212, "User Story", "New", 2210, "Validate date of birth", ME],
    [2213, "User Story", "New", 2210, "Intake form accessibility review", "Sam Ortiz"],
    [2214, "User Story", "Closed", 2210, "Intake form layout", ME],
    [2215, "User Story", "Closed", 2210, "Save a draft intake", "Sam Ortiz"],
    [2216, "User Story", "Closed", 2210, "Intake confirmation email", ME],
    [2220, "Feature", "Active", null, "Appointment reminders", "Priya Shah"],
    [2221, "User Story", "New", 2220, "SMS reminder template", ME],
    [2230, "User Story", "New", null, "Power BI refresh schedule", ME],
  ],
  Atlas: [
    [3310, "Feature", "Active", null, "Shipment tracking dashboard", ME, null],
    [3311, "User Story", "Active", 3310, "Map of active shipments", ME],
    [3312, "User Story", "New", 3310, "Delay alerts", ME],
    [3320, "Epic", "New", null, "Carrier integrations", ME],
    [3330, "User Story", "New", null, "Rate table import", ME],
  ],
};

/** Step 16 (Roadmap): stories with no change in a while, and stories with no size yet. */
const QUIET = new Set([4412, 1112]);
const UNSIZED = new Set([1113, 2213]);

const client = (k: DemoClientKey) => DEMO_CLIENTS.find((c) => c.key === k)!;
const urlOf = (k: DemoClientKey, id: number) => `https://dev.azure.com/${client(k).org}/${encodeURIComponent(client(k).project)}/_workitems/edit/${id}`;
const isPortfolio = (t: string) => t === "Feature" || t === "Epic";
const category = (s: string) => (s === "New" ? "Proposed" : s === "Closed" ? "Completed" : "InProgress");

function item(k: DemoClientKey, r: Raw, order: number): WorkItem {
  const [id, type, state, parent, title, who, target] = r;
  return {
    id, title, type, state, stateCategory: category(state), level: isPortfolio(type) ? "portfolio" : "story", ...(isPortfolio(type) ? { tier: type === "Epic" ? ("epic" as const) : ("feature" as const) } : {}),
    order, parentId: parent, changedAt: "2026-10-30T15:00:00Z", url: urlOf(k, id), tags: [], blocked: false, changedByMe: false,
    assignedTo: who === ME ? "You" : who, assignedToMe: who === ME, targetDate: target ?? null,
  };
}

/** One client's DevOps read: my open items in board order, and the open children of my features and epics. */
export function demoWork(k: DemoClientKey, fetchedAt: string): ClientWork {
  const all = ITEMS[k].map((r, n) => item(k, r, n + 1)).filter((i) => i.stateCategory !== "Completed");
  const mine = all.filter((i) => i.assignedToMe);
  const mineIds = new Set(mine.map((i) => i.id));
  const children = all.filter((i) => !mineIds.has(i.id) && i.parentId !== null);
  return { clientKey: k, clientName: client(k).name, status: "ok", fetchedAt, fromCache: false, items: mine, children, watched: [], committed: [] };
}

/** One client's features and epics for Plan the week, with every child (any state). */
export function demoPortfolio(k: DemoClientKey, fetchedAt: string): ClientPortfolio {
  const all = ITEMS[k].map((r, n) => item(k, r, n + 1));
  const child = (c: WorkItem): PortfolioChild => ({
    id: c.id, title: c.title, type: c.type, state: c.state, stateCategory: c.stateCategory, open: c.stateCategory !== "Completed", level: c.level, order: c.order, url: c.url, assignedTo: c.assignedTo ?? null, mine: !!c.assignedToMe,
    changedAt: QUIET.has(c.id) ? "2026-10-09T15:00:00Z" : c.changedAt, size: UNSIZED.has(c.id) ? null : 3,
  });
  const items: PortfolioItem[] = all
    .filter((i) => i.level === "portfolio")
    .map((i) => ({
      id: i.id, title: i.title, type: i.type, state: i.state, stateCategory: i.stateCategory, tier: i.tier ?? "feature", order: i.order, parentId: i.parentId, url: i.url,
      targetDate: i.targetDate ?? null, assignedTo: i.assignedTo ?? null, mine: !!i.assignedToMe,
      why: i.assignedToMe ? ["assigned"] : ["parent"],
      children: all.filter((c) => c.parentId === i.id).map(child),
      areaPath: client(k).project, iterationPath: `${client(k).project}\\Sprint 23`,
    }));
  return { clientKey: k, clientName: client(k).name, status: "ok", fetchedAt, fromCache: false, items, targetFields: { Feature: "Microsoft.VSTS.Scheduling.TargetDate", Epic: "Microsoft.VSTS.Scheduling.TargetDate" }, sizeField: "Microsoft.VSTS.Scheduling.StoryPoints", acceptanceField: true };
}

export const isDemoClient = (k: string): k is DemoClientKey => DEMO_CLIENTS.some((c) => c.key === k);
