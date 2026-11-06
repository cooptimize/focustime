import type { ProcessOverrides } from "../../plan/process.ts";
// Demo sources (step 15, D272): the same shapes as the real Dataverse, Outlook, Google and DevOps sources, served from
// sources/demo/data.ts. They are given no network, keyring or cache directory, so they can't reach anything outside.
// DM-1: DevOps and Outlook read from the session's in-memory DevOps and calendar (devops.ts, outlook.ts), which the
// demo's writes change, so a write reads back and shows everywhere.
import type { CalendarSource } from "../calendar/source.ts";
import type { DataverseSource } from "../dataverse/source.ts";
import type { DevOpsSource, ScopeDeps } from "../devops/source.ts";
import type { CalEvent, ClientWork, SourceId, SourceResult } from "../../week/types.ts";
import { createGraphWriter, type GraphWriter } from "../graph/write.ts";
import type { DemoOutlook } from "./outlook.ts";
import { demoDirectory } from "./directory.ts";
import { DEMO_CLIENTS, DEMO_ME, DEMO_PEOPLE, demoGoogle, demoOutlook, demoPatterns, demoPortfolio, demoProcess, demoPto, demoWork, demoWorkItem, isDemoClient, demoAheadClient, type DemoClientKey } from "./data.ts";
import { itemUrlOf, type DemoDevOps } from "./devops.ts";
import { demoKatSent } from "./seeds/status.ts";
import { typeOf } from "../../plan/process.ts";

const NO = "Demo data: nothing leaves FocusTime";

/** `processOverrides`: the demo team's process Rules (ADM-1), applied to the demo's process models. */
/** `scope` (AH-2): the demo team's scope per client (Admin › Clients in the demo) and its Cooptimizers. */
export function createDemoSources(world: DemoDevOps, cal: DemoOutlook, now: () => string, processOverrides: (clientKey: string) => Promise<ProcessOverrides> = async () => ({}), scope: (clientKey: string) => Promise<ScopeDeps | null> = async () => null) {
  const ok = <T>(source: SourceId, items: T[]): SourceResult<T> => ({ source, status: "ok", fetchedAt: now(), fromCache: false, items });
  const dataverse: DataverseSource = {
    load: async () => ok("dataverse", demoPatterns()),
    following: async () => ok("dataverse", demoPatterns()),
    resolveUserId: async () => ({ ok: true, id: DEMO_ME }),
    // DM-1: where each demo client's DevOps is (the demo's own fictional orgs; never a PAT, the demo has none).
    devopsTargets: async (keys: string[]) => ({ ok: true, targets: DEMO_CLIENTS.filter((c) => keys.includes(c.key)).map((c) => ({ accountId: `demo-${c.key}`, clientKey: c.key, clientName: c.name, org: c.org, project: c.project, projectName: c.project, email: "you@example.com", pat: null })) }),
    accountTargets: async () => ({ ok: true, targets: [] }),
    myClients: async () => DEMO_CLIENTS.map((c) => ({ clientKey: c.key, clientName: c.key === "Cooptimize" ? c.name : c.key, devops: true, devopsEmail: "you@example.com" })),
    pto: async (from: string, to: string) => ok("pto", demoPto(from, to)),
    teammates: async () => ({ ok: true, people: DEMO_PEOPLE }),
    clientTeam: async () => ({ ok: true, accountId: null, patterns: [], workers: [] }),
    teamPto: async () => ({ ok: true, away: [] }),
    // ADM-1: fictional levels and client leads (Admin › People in the demo).
    directory: async () => ({ ok: true, read: demoDirectory() }),
    // SR-1: Kat sent each demo client's report last Monday a few minutes after 7:00 AM ET (seeds/status.ts).
    statusSent: async (keys: string[]) => ({ ok: true, sent: Object.fromEntries(keys.map((k) => [k, isDemoClient(k) ? demoKatSent(now(), k) : null])) }),
  };
  const calendar = (id: "outlook" | "google", events: (monday: string) => CalEvent[]): CalendarSource => ({
    id,
    load: async (weekStart: string) => ok(id, events(weekStart)),
    connect: async () => ({ status: "failed", message: NO }),
    disconnect: async () => {},
  });
  // DM-1: the demo's Outlook (sources/demo/outlook.ts) behind the app's own Graph writer: timeboxes on Outlook, help
  // invites, my own events and RSVPs are written there, read back and undone, and nothing leaves FocusTime.
  const writer: GraphWriter = createGraphWriter({ fetch: cal.fetch, token: async () => "demo", invalidate: () => {}, log: () => {} });
  const answered = (e: CalEvent): CalEvent => {
    const r = cal.answer(e.id.replace(/^outlook:/, ""));
    return r ? { ...e, responseStatus: r === "tentativelyAccepted" ? "tentative" : r === "declined" ? "declined" : "accepted" } : e;
  };
  const weekEvents = (monday: string) => {
    const from = Temporal.PlainDate.from(monday), to = from.add({ days: 7 });
    const inWeek = (e: CalEvent) => Temporal.PlainDate.compare(Temporal.PlainDate.from(e.start.slice(0, 10)), from) >= 0 && Temporal.PlainDate.compare(Temporal.PlainDate.from(e.start.slice(0, 10)), to) < 0;
    return [...demoOutlook(monday).map(answered), ...cal.ownEvents().filter(inWeek)];
  };
  const outlook = { ...calendar("outlook", weekEvents), write: { access: async () => ({ status: "write" as const }), writer } };
  const google = calendar("google", demoGoogle);
  const last = new Map<string, ClientWork>();
  const work = (k: DemoClientKey) => demoWork(world, k, now());
  const portfolio = (k: DemoClientKey) => demoPortfolio(world, k, now());
  const ahead = async (k: DemoClientKey, whole: boolean) => demoAheadClient(world, k, now(), { deps: await scope(k).catch(() => null), whole });
  const devops: DevOpsSource = {
    load: async (clients) => {
      const out = clients.filter((c) => isDemoClient(c.clientKey)).map((c) => work(c.clientKey as DemoClientKey));
      for (const w of out) last.set(w.clientKey, w);
      return out;
    },
    lookup: (clientKey, id) => {
      const w = last.get(clientKey) ?? (isDemoClient(clientKey) ? work(clientKey) : null);
      return w ? [...w.items, ...w.children].find((i) => i.id === id) ?? null : null;
    },
    orgOf: (clientKey) => DEMO_CLIENTS.find((c) => c.key === clientKey)?.org ?? null,
    last: (clientKey) => last.get(clientKey) ?? null,
    portfolio: async (clients) => clients.filter((c) => isDemoClient(c.clientKey)).map((c) => portfolio(c.clientKey as DemoClientKey)),
    description: async (_clientKey, id) => world.description(id) ?? "A fictional work item for the FocusTime demo.",
    forget: (clientKey) => void last.delete(clientKey),
    // DM-1: Break down reads the feature, its children and comments from the demo's DevOps, and a few of the same
    // client's past features as examples (the demo's own items, fictional).
    featureSignals: async (clientKey, id) => {
      const f = isDemoClient(clientKey) ? world.items(clientKey).find((i) => i.id === id) : undefined;
      if (!f || !isDemoClient(clientKey)) return { ok: false, message: `#${id} isn't in the demo's DevOps` };
      const model = demoProcess(clientKey, await processOverrides(clientKey));
      const t = typeOf(model, f.type);
      if (!t?.needsBreakdown) return { ok: false, message: `#${id} is a ${f.type}, which isn't broken down here` };
      const childTypes = t.validChildren;
      const c = DEMO_CLIENTS.find((x) => x.key === clientKey)!;
      const epic = f.parent !== null ? world.item(f.parent) : null;
      return {
        ok: true,
        value: {
          feature: { id: f.id, title: f.title, type: f.type, state: f.state, priority: 2, tags: [], areaPath: c.project, iterationPath: `${c.project}\\Sprint 23`, description: world.description(f.id) ?? "", acceptance: world.acceptance(f.id) ?? "", parentId: f.parent, url: itemUrlOf(clientKey, f.id) },
          epic: epic ? { id: epic.id, title: epic.title, type: epic.type, description: world.description(epic.id) ?? "" } : null,
          children: world.items(clientKey).filter((x) => x.parent === f.id).map((x) => ({ id: x.id, title: x.title, type: x.type, state: x.state })),
          comments: world.comments(f.id),
          storyType: childTypes[0] ?? "User Story",
          childTypes: [...childTypes],
        },
      };
    },
    exemplarPool: async (clientKey) => {
      if (!isDemoClient(clientKey)) return { ok: true, value: [] };
      const items = world.items(clientKey).filter((i) => !i.projectOnly);
      const value = items.filter((i) => i.type === "Feature" && items.filter((x) => x.parent === i.id).length >= 2).map((i) => ({
        id: i.id, title: i.title, description: world.description(i.id) ?? "", tags: [], areaPath: DEMO_CLIENTS.find((c) => c.key === clientKey)!.project, parentId: i.parent, changedAt: i.changedAt,
        stories: items.filter((x) => x.parent === i.id).map((x) => ({ title: x.title, description: world.description(x.id) ?? "", hasAcceptance: !!x.acceptance, size: x.size })),
      }));
      return { ok: true, value };
    },
    // PL-1: last week's features by id (any state), their states for resolved musts, and this week's state changes:
    // Atlas's stories haven't moved (its Watching row turns amber from Wednesday); the others' have.
    featureTrees: async (clients, ids) => clients.filter((c) => isDemoClient(c.clientKey)).map((c) => ({ clientKey: c.clientKey, items: portfolio(c.clientKey as DemoClientKey).items.filter((i) => (ids[c.clientKey] ?? []).includes(i.id)) })),
    itemStates: async (clients, ids) =>
      clients.filter((c) => isDemoClient(c.clientKey)).map((c) => {
        const p = portfolio(c.clientKey as DemoClientKey).items;
        const all = [...p.map((i) => [i.id, i.stateCategory] as const), ...p.flatMap((i) => i.children.map((x) => [x.id, x.stateCategory] as const))];
        return { clientKey: c.clientKey, states: Object.fromEntries(all.filter(([id]) => (ids[c.clientKey] ?? []).includes(id))) };
      }),
    stateChanges: async (clientKey) => ({ known: true, itemIds: clientKey === "Atlas" || !isDemoClient(clientKey) ? [] : portfolio(clientKey).items.flatMap((i) => i.children.filter((x) => x.open).map((x) => x.id)) }),
    // AH-1: Ahead's items, every level, as the store would give them.
    aheadItems: async (clients, o = {}) => Promise.all(clients.filter((c) => isDemoClient(c.clientKey)).map((c) => ahead(c.clientKey as DemoClientKey, !!o.whole))),
    // CV-5: a conversation's linked items (their live state), and Link's search, from the same items.
    linkedItems: async (ref, ids) => {
      if (!isDemoClient(ref.clientKey)) return null;
      const k = ref.clientKey;
      return world.items(k).filter((i) => ids.includes(i.id)).map((i) => ({ ...demoWorkItem(world, k, i.id)! }));
    },
    searchItems: async (ref, query, limit = 20) => {
      if (!isDemoClient(ref.clientKey)) return null;
      const r = await ahead(ref.clientKey, false);
      const q = query.trim().toLowerCase().replace(/^#/, "");
      const words = q.split(/\s+/).filter(Boolean);
      return r.items.filter((i) => i.inScope && i.stateCategory !== "Completed" && i.stateCategory !== "Removed").filter((i) => !q || String(i.id) === q || words.every((w) => i.title.toLowerCase().includes(w))).sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, limit);
    },
    // SR-1: Status reads the demo's feature comments (seeded by seeds/status.ts, and any the demo's writes add) and
    // its activity log (the seeded story changes, mine or a teammate's).
    featureComments: async (clientKey, ids) => (isDemoClient(clientKey) ? { ok: true, comments: Object.fromEntries(ids.filter((id) => world.item(id)?.clientKey === clientKey).map((id) => [id, world.reportComments(id)])), failed: [] } : { ok: false, message: "Not a demo client" }),
    activity: async (clientKey, since) => ({ known: true, rows: isDemoClient(clientKey) ? world.activity(clientKey).filter((r) => Temporal.Instant.compare(Temporal.Instant.from(r.changedAt), Temporal.Instant.from(since)) >= 0) : [] }),
    processModels: async (keys) => Promise.all(keys.map(async (clientKey) => (isDemoClient(clientKey) ? { clientKey, ok: true as const, model: demoProcess(clientKey, await processOverrides(clientKey)) } : { clientKey, ok: false as const, message: "Not a demo client" }))),
  };
  return { dataverse, outlook, google, devops };
}
