// AS-1: the assistant's reads (also registered actions: assistant.today, lookup.day, items.get) and the cards they give.
// Each takes a client filter: in a request about one client only that client's rows come back; with no client
// ("what's next" across clients) the rows are cards for the person, and the model only hears how many were shown.
import type { ActionName } from "../actions/registry.ts";
import type { ActionResponse, AheadItem, AheadLoad, WeekLoadData } from "../actions/types.ts";
import type { CommitData, SendView } from "../plan/team-types.ts";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { buildRows, isOpen, tierOf } from "../ui/ahead/model.ts";
import { GAP_WORDS } from "../plan/fixnext.ts";
import type { Pick } from "../plan/types.ts";
import { hoursOn } from "../week/hours.ts";
import type { BlockCard, Card, ItemCard, Link, PickCard, PromiseCard, SendCard } from "./types.ts";

export type ReadDeps = {
  /** The person's own action dispatch (the same as the buttons'). */
  run: (action: ActionName, input: unknown) => Promise<ActionResponse>;
  /** The person's today, YYYY-MM-DD, and the instant now. */
  today: string;
  now: string;
  zone: string;
  /** Clients that are mine (clientsOf): nothing of another client's is ever shown. */
  isMine: (clientKey: string) => boolean;
  clientName: (clientKey: string) => string;
  link: (href: string, label: string) => Link;
};

/** What a read gives: cards for the person, facts for the model (one client only), and ids the person may act on. */
export type ReadResult = { cards: Card[]; facts: unknown; itemIds: number[]; pickIds: number[]; error?: string };

const fail = (error: string): ReadResult => ({ cards: [], facts: null, itemIds: [], pickIds: [], error });
const halfName = (h: string) => (h === "AM" ? "morning" : h === "PM" ? "afternoon" : "evening");
const dayName = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const mondayOf = (d: string) => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};

async function data<T>(r: Promise<ActionResponse>): Promise<T | string> {
  const x = await r;
  return x.ok ? (x.data as T) : x.error;
}

function pickCard(d: ReadDeps, p: Pick): PickCard {
  return { kind: "pick", id: p.id, clientKey: p.clientKey, clientName: d.clientName(p.clientKey), title: p.title, date: p.date, half: p.half === "PM" ? "PM" : "AM", time: null, done: p.status === "done", link: d.link(p.date === d.today ? "#/today" : `#/week/day/${p.date}/${p.half}`, p.date === d.today ? "Open Today" : `Open ${dayName(p.date)}`) };
}

/** assistant.today: now (the next pick and what's on), today (open picks, follow-ups and promises due), tonight. */
export async function todayRead(d: ReadDeps, when: "now" | "today" | "tonight", client: string | null): Promise<ReadResult> {
  const w = await data<WeekLoadData>(d.run("week.load", { weekStart: mondayOf(d.today) }));
  if (typeof w === "string") return fail(w);
  const ok = (k: string | null) => !!k && d.isMine(k) && (client === null || k === client);
  const picks = (w.plan?.[d.today]?.picks ?? []).filter((p) => ok(p.clientKey) && p.status !== "dropped");
  const open = picks.filter((p) => p.status === "planned");
  const cards: Card[] = [];
  const facts: Record<string, unknown> = { today: d.today, when };
  if (when === "now") {
    const timed = w.timer?.pickId ? open.find((p) => p.id === w.timer!.pickId) : undefined;
    const hour = Temporal.Instant.from(d.now).toZonedDateTimeISO(d.zone).hour;
    const half = hour < 12 ? "AM" : hour < 17 ? "PM" : "EVE";
    const order = ["AM", "PM", "EVE"];
    const next = timed ?? open.filter((p) => order.indexOf(p.half) >= order.indexOf(half)).sort((a, b) => order.indexOf(a.half) - order.indexOf(b.half) || a.id - b.id)[0];
    if (next) cards.push(pickCard(d, next));
    else cards.push({ kind: "note", text: open.length ? "Nothing planned for the rest of today's blocks." : w.planDay.committed ? "Everything planned for today is done." : "Today isn't planned yet.", link: d.link("#/today", "Open Today") });
    facts.next = next ? { pickId: next.id, title: next.title, half: halfName(next.half), focusRunning: !!timed } : null;
  } else {
    const list = when === "tonight" ? open.filter((p) => p.half === "EVE") : open;
    for (const p of list) cards.push(pickCard(d, p));
    facts.picks = list.map((p) => ({ pickId: p.id, title: p.title, half: halfName(p.half) }));
  }
  const due = w.followUps.filter((f) => ok(f.clientKey) && f.due !== null && f.due <= d.today);
  if (when !== "now") for (const f of due) cards.push({ kind: "note", text: `Follow-up: ${f.what}${f.who ? ` (${f.who})` : ""}${f.due! < d.today ? ", overdue" : ", due today"}`, link: d.link(`#/inbox/${f.id}`, "Open the follow-up") });
  const endOfDay = hoursOn(w.hours, d.today).main?.end ?? "17:00";
  const proms = (w.promises ?? []).filter((p) => ok(p.clientKey) && (p.overdue || p.dueDate <= d.today)).filter((p) => when !== "tonight" || (p.dueAt !== null && Temporal.Instant.from(p.dueAt).toZonedDateTimeISO(d.zone).toPlainTime().toString({ smallestUnit: "minute" }) >= endOfDay));
  if (when !== "now") for (const p of proms) cards.push({ kind: "promise", id: p.id, clientKey: p.clientKey, clientName: p.clientName, who: "You", what: p.what, toWhom: p.toName, due: p.dueAt ?? p.dueDate, link: d.link(`#/inbox/promise/${p.id}`, "Open the promise") } satisfies PromiseCard);
  facts.followUps = when === "now" ? undefined : due.map((f) => ({ what: f.what, who: f.who, due: f.due }));
  facts.promises = when === "now" ? undefined : proms.map((p) => ({ what: p.what, to: p.toName, due: p.dueAt ?? p.dueDate, overdue: p.overdue }));
  return { cards, facts, itemIds: picks.map((p) => p.itemId).filter((x): x is number => x !== null), pickIds: picks.map((p) => p.id) };
}

/** lookup.day: my picks on one day (done marks, focus minutes), the day's block cards, and my latest resume note. */
export async function dayRead(d: ReadDeps, date: string, client: string | null): Promise<ReadResult> {
  const w = await data<WeekLoadData>(d.run("week.load", { weekStart: mondayOf(date) }));
  if (typeof w === "string") return fail(w);
  const ok = (k: string) => d.isMine(k) && (client === null || k === client);
  const picks = (w.plan?.[date]?.picks ?? []).filter((p) => ok(p.clientKey) && p.status !== "dropped");
  const cards: Card[] = [];
  for (const half of ["AM", "PM"] as const) {
    const these = picks.filter((p) => p.half === half);
    const keys = [...new Set(these.map((p) => p.clientKey))];
    for (const k of keys) {
      const mine = these.filter((p) => p.clientKey === k);
      cards.push({
        kind: "block", clientKey: k, clientName: d.clientName(k), date, half, time: half === "AM" ? "Morning" : "Afternoon", status: `${mine.filter((p) => p.status === "done").length} of ${mine.length} done`,
        picks: mine.map((p) => ({ id: p.id, title: p.title, done: p.status === "done", size: p.size ?? "Size?" })), link: d.link(`#/week/day/${date}/${half}`, `Open ${dayName(date)}`),
      } satisfies BlockCard);
    }
  }
  const eve = picks.filter((p) => p.half === "EVE");
  for (const p of eve) cards.push(pickCard(d, p));
  const notes = Object.entries(w.resumeNotes).filter(([k]) => ok(k));
  for (const [k, n] of notes) cards.push({ kind: "note", text: `${d.clientName(k)}, where I left off: ${n.note}` });
  if (!cards.length) cards.push({ kind: "note", text: `Nothing planned on ${dayName(date)}${client ? ` for ${d.clientName(client)}` : ""}.` });
  const facts = {
    date,
    closedOut: !!w.plan?.[date]?.closedOutAt,
    picks: picks.map((p) => ({ pickId: p.id, client: d.clientName(p.clientKey), title: p.title, half: halfName(p.half), done: p.status === "done", focusedMinutes: Math.round((w.focused[p.id] ?? 0) / 60) })),
    resumeNotes: notes.map(([k, n]) => ({ client: d.clientName(k), note: { quoted: n.note } })),
  };
  return { cards, facts, itemIds: picks.map((p) => p.itemId).filter((x): x is number => x !== null), pickIds: picks.map((p) => p.id) };
}

export type FoundItem = { clientKey: string; clientName: string; item: AheadItem; children: AheadItem[]; tier: "epic" | "feature" | "story" | null; parent: AheadItem | null; editable: boolean };

/** One item of my clients from Ahead's store read (nothing fetched from DevOps for it). */
export async function findItem(d: ReadDeps, id: number, client: string | null): Promise<FoundItem | string> {
  const a = await data<AheadLoad>(d.run("ahead.load", {}));
  if (typeof a === "string") return a;
  for (const c of a.clients) {
    if (!d.isMine(c.clientKey) || (client !== null && c.clientKey !== client)) continue;
    const item = c.items.find((i) => i.id === id);
    if (!item) continue;
    const children = c.items.filter((i) => i.parentId === id);
    return { clientKey: c.clientKey, clientName: c.clientName, item, children, tier: tierOf(item), parent: item.parentId === null ? null : (c.items.find((i) => i.id === item.parentId) ?? null), editable: c.editable.includes(id) };
  }
  // With a client, the id isn't repeated: it may be another client's, which this request must not carry.
  return client ? `That item isn't one of ${d.clientName(client)}'s items in FocusTime` : `#${id} isn't one of your clients' items in FocusTime`;
}

export function itemCard(d: ReadDeps, f: FoundItem): ItemCard {
  const open = f.children.filter(isOpen);
  return {
    kind: "item", clientKey: f.clientKey, clientName: f.clientName, id: f.item.id, title: f.item.title, type: f.item.type, state: f.item.state, owner: f.item.assignee?.name ?? null, start: f.item.start, target: f.item.target,
    children: open.slice(0, 10).map((k) => ({ id: k.id, title: k.title, state: k.state, owner: k.assignee?.name ?? null })), link: d.link(`#/ahead/item/${f.item.id}`, `Open #${f.item.id} in Ahead`), devopsUrl: f.item.url.startsWith("https://dev.azure.com/") ? f.item.url : null,
  };
}

/** items.get: state, owner, dates and open children. */
export async function itemRead(d: ReadDeps, id: number, client: string | null): Promise<ReadResult & { found?: FoundItem }> {
  const f = await findItem(d, id, client);
  if (typeof f === "string") return fail(f);
  const card = itemCard(d, f);
  const facts = { id: card.id, type: card.type, title: { quoted: card.title }, state: card.state, owner: card.owner, start: card.start, target: card.target, openChildren: card.children.map((k) => ({ id: k.id, title: { quoted: k.title }, state: k.state, owner: k.owner })) };
  return { cards: [card], facts, itemIds: [id, ...f.children.map((k) => k.id), ...(f.parent ? [f.parent.id] : [])], pickIds: [], found: f };
}

/** Features and epics with readiness gaps (Fix next's rule), soonest target first, at most 8. */
export async function gapsRead(d: ReadDeps, client: string): Promise<ReadResult> {
  const a = await data<AheadLoad>(d.run("ahead.load", {}));
  if (typeof a === "string") return fail(a);
  const c = a.clients.find((x) => x.clientKey === client && d.isMine(x.clientKey));
  if (!c) return fail(`${d.clientName(client)} isn't in Ahead for you`);
  const rows = buildRows(a, c).filter((r) => r.tier !== "story" && r.gaps.length && isOpen(r.item)).sort((x, y) => (x.eff.target ?? "9999").localeCompare(y.eff.target ?? "9999")).slice(0, 8);
  const cards: Card[] = rows.map((r) => ({ ...itemCard(d, { clientKey: c.clientKey, clientName: c.clientName, item: r.item, children: c.items.filter((i) => i.parentId === r.item.id), tier: r.tier, parent: null, editable: r.editable }), state: `${r.item.state} · ${r.gaps.map((g) => GAP_WORDS[g]).join(", ")}` }));
  if (!cards.length) cards.push({ kind: "note", text: `No readiness gaps on ${c.clientName}'s features and epics.`, link: d.link("#/ahead/fix", "Open Fix next") });
  return { cards, facts: rows.map((r) => ({ id: r.item.id, title: { quoted: r.item.title }, gaps: r.gaps.map((g) => GAP_WORDS[g]), target: r.eff.target })), itemIds: rows.map((r) => r.item.id), pickIds: [] };
}

/** What people committed to in this client's conversations I can see (the store's viewer rule). */
export async function commitmentsRead(d: ReadDeps, client: string, person: string | null): Promise<ReadResult> {
  const c = await data<ConversationsData>(d.run("conversations.list", {}));
  if (typeof c === "string") return fail(c);
  const convs = [...c.needsYou, ...c.teammates].filter((x) => x.clientKey === client);
  const want = person?.trim().toLowerCase() ?? null;
  const rows = convs.flatMap((x) => x.commitments.filter((k) => k.state === "open" && (!want || k.whoName.toLowerCase().includes(want))).map((k) => ({ conv: x, k })));
  const cards: Card[] = rows.slice(0, 10).map(({ conv, k }) => ({ kind: "promise", id: k.id, clientKey: conv.clientKey, clientName: conv.clientName, who: k.mine ? "You" : k.whoName, what: k.what, toWhom: null, due: k.dueAt ?? k.dueDate, link: d.link(`#/inbox/conversation/${conv.id}`, "Open the conversation") }) satisfies PromiseCard);
  if (!cards.length) cards.push({ kind: "note", text: `No open commitments${person ? ` from ${person}` : ""} in ${d.clientName(client)}'s conversations.` });
  return { cards, facts: rows.slice(0, 10).map(({ conv, k }) => ({ who: k.mine ? "me" : k.whoName, what: { quoted: k.what }, due: k.dueAt ?? k.dueDate, conversation: { quoted: conv.title } })), itemIds: rows.map(({ k }) => k.item?.id).filter((x): x is number => typeof x === "number"), pickIds: [] };
}

function sendCard(d: ReadDeps, s: SendView): SendCard {
  return { kind: "send", id: s.id, clientKey: s.clientKey, clientName: d.clientName(s.clientKey), title: s.title, to: s.to.name, from: s.from.name, tier: s.kind, weekStart: s.weekStart, state: s.words || s.state, link: d.link(`#/week/commit/${s.weekStart}`, "Open Plan") };
}

/** My sends (this week and next) and the ones sent to me, with their states. */
export async function sendsRead(d: ReadDeps, client: string | null): Promise<ReadResult> {
  const thisWeek = mondayOf(d.today);
  const next = Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString();
  const out: SendView[] = [];
  for (const weekStart of [thisWeek, next]) {
    const c = await data<CommitData>(d.run("team.commit", { weekStart }));
    if (typeof c === "string") return fail(c);
    for (const k of c.clients) if (d.isMine(k.clientKey) && (client === null || k.clientKey === client)) out.push(...k.sent, ...k.incoming);
  }
  const seen = new Set<number>();
  const list = out.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const cards: Card[] = list.slice(0, 12).map((s) => sendCard(d, s));
  if (!cards.length) cards.push({ kind: "note", text: "No sends this week or next.", link: d.link("#/week/commit", "Open Plan") });
  return { cards, facts: list.slice(0, 12).map((s) => ({ title: { quoted: s.title }, from: s.from.name, to: s.to.name, kind: s.kind, week: s.weekStart, state: s.words || s.state })), itemIds: list.map((s) => s.itemId), pickIds: [] };
}
