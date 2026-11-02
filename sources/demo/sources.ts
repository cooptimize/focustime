// Demo sources (step 15, D272): the same shapes as the real Dataverse, Outlook, Google and DevOps sources, served from
// sources/demo/data.ts. They are given no fetch, keyring or cache directory, so they can't reach anything outside.
import type { CalendarSource } from "../calendar/source.ts";
import type { DataverseSource } from "../dataverse/source.ts";
import type { DevOpsSource } from "../devops/source.ts";
import type { CalEvent, ClientWork, SourceId, SourceResult } from "../../week/types.ts";
import type { GraphWriter } from "../graph/write.ts";
import { DEMO_CLIENTS, DEMO_ME, DEMO_PEOPLE, demoGoogle, demoOrganizer, demoOutlook, demoPatterns, demoPortfolio, demoPto, demoWork, isDemoClient } from "./data.ts";

const NO = "Demo data: nothing leaves Coopilot";

export function createDemoSources(now: () => string) {
  const ok = <T>(source: SourceId, items: T[]): SourceResult<T> => ({ source, status: "ok", fetchedAt: now(), fromCache: false, items });
  const dataverse: DataverseSource = {
    load: async () => ok("dataverse", demoPatterns()),
    following: async () => ok("dataverse", demoPatterns()),
    resolveUserId: async () => ({ ok: true, id: DEMO_ME }),
    devopsTargets: async () => ({ ok: true, targets: [] }),
    myClients: async () => DEMO_CLIENTS.map((c) => ({ clientKey: c.key, clientName: c.key === "Cooptimize" ? c.name : c.key, devops: true, devopsEmail: "you@example.com" })),
    pto: async (from: string, to: string) => ok("pto", demoPto(from, to)),
    teammates: async () => ({ ok: true, people: DEMO_PEOPLE }),
    clientTeam: async () => ({ ok: true, accountId: null, patterns: [], workers: [] }),
    teamPto: async () => ({ ok: true, away: [] }),
  };
  const calendar = (id: "outlook" | "google", events: (monday: string) => CalEvent[]): CalendarSource => ({
    id,
    load: async (weekStart: string) => ok(id, events(weekStart)),
    connect: async () => ({ status: "failed", message: NO }),
    disconnect: async () => {},
  });
  // Step 16: a read-only stand-in for Outlook's write side, so the event menus (RSVP) and their previews show in demo
  // mode. It reads the fictional meetings only; every write method refuses, and dispatch refuses confirm in demo anyway.
  const meetings = (startIso: string, endIso: string) => {
    const out: CalEvent[] = [];
    const a = Temporal.Instant.from(startIso), b = Temporal.Instant.from(endIso);
    for (let m = Temporal.PlainDate.from(startIso.slice(0, 10)).subtract({ days: 7 }); Temporal.PlainDate.compare(m, Temporal.PlainDate.from(endIso.slice(0, 10))) <= 0; m = m.add({ days: 7 })) {
      const monday = m.subtract({ days: m.dayOfWeek - 1 }).toString();
      for (const e of demoOutlook(monday)) if (Temporal.Instant.compare(Temporal.Instant.from(e.start), b) < 0 && Temporal.Instant.compare(Temporal.Instant.from(e.end), a) > 0 && !out.some((x) => x.id === e.id)) out.push(e);
    }
    return out;
  };
  const response = (e: CalEvent) => (e.responseStatus === "tentative" ? "tentativelyAccepted" : e.responseStatus === "declined" ? "declined" : "accepted");
  const graphId = (e: CalEvent) => e.id.replace(/^outlook:/, "");
  const refuse = async (): Promise<never> => {
    throw new Error(NO);
  };
  const writer = {
    calendar: async () => ({ name: "Calendar", owner: "you@example.com" }),
    scan: async (startIso: string, endIso: string) =>
      meetings(startIso, endIso).map((e) => ({
        id: graphId(e), start: Temporal.Instant.from(e.start).toString(), end: Temporal.Instant.from(e.end).toString(), showAs: e.showAs ?? "busy", subject: null,
        facts: { isOrganizer: false, others: 4, recurring: false, allDay: false, marker: null, webLink: null, response: response(e), organizer: demoOrganizer(graphId(e)), proposals: true },
      })),
    meeting: async (id: string) => {
      const date = /(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
      const e = date ? meetings(`${date}T00:00:00Z`, `${date}T23:59:59Z`).find((x) => graphId(x) === id) : undefined;
      return e ? { id, subject: e.title, start: Temporal.Instant.from(e.start).toString(), end: Temporal.Instant.from(e.end).toString(), marker: null, isOrganizer: false, others: 4, isCancelled: false, response: response(e), organizer: demoOrganizer(id), allowNewTimeProposals: true } : null;
    },
    get: async () => null, findByMarker: async () => null, ownEditable: async () => null, getInvite: async () => null,
    create: refuse, update: refuse, remove: refuse, updateOwn: refuse, createInvite: refuse, cancel: refuse, respond: refuse,
  } satisfies GraphWriter;
  const outlook = { ...calendar("outlook", demoOutlook), write: { access: async () => ({ status: "write" as const }), writer } };
  const google = calendar("google", demoGoogle);
  const last = new Map<string, ClientWork>();
  const devops: DevOpsSource = {
    load: async (clients) => {
      const out = clients.filter((c) => isDemoClient(c.clientKey)).map((c) => demoWork(c.clientKey as never, now()));
      for (const w of out) last.set(w.clientKey, w);
      return out;
    },
    lookup: (clientKey, id) => {
      const w = last.get(clientKey) ?? (isDemoClient(clientKey) ? demoWork(clientKey, now()) : null);
      return w ? [...w.items, ...w.children].find((i) => i.id === id) ?? null : null;
    },
    orgOf: (clientKey) => DEMO_CLIENTS.find((c) => c.key === clientKey)?.org ?? null,
    last: (clientKey) => last.get(clientKey) ?? null,
    portfolio: async (clients) => clients.filter((c) => isDemoClient(c.clientKey)).map((c) => demoPortfolio(c.clientKey as never, now())),
    description: async () => "A fictional work item for the Coopilot demo.",
    forget: (clientKey) => void last.delete(clientKey),
  };
  return { dataverse, outlook, google, devops };
}
