// Demo sources (step 15, D272): the same shapes as the real Dataverse, Outlook, Google and DevOps sources, served from
// sources/demo/data.ts. They are given no fetch, keyring or cache directory, so they can't reach anything outside.
import type { CalendarSource } from "../calendar/source.ts";
import type { DataverseSource } from "../dataverse/source.ts";
import type { DevOpsSource } from "../devops/source.ts";
import type { CalEvent, ClientWork, SourceId, SourceResult } from "../../week/types.ts";
import { DEMO_CLIENTS, DEMO_ME, DEMO_PEOPLE, demoGoogle, demoOutlook, demoPatterns, demoPortfolio, demoPto, demoWork, isDemoClient } from "./data.ts";

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
  const outlook = calendar("outlook", demoOutlook);
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
