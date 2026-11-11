// AS-3: the answer to a question, composed on the server from the answer context (assistant/context.ts). Pure. Every
// line names a real thing from the person's own data (a block, a to-do, #id, a promise) with its link, and anything
// that couldn't be read is said plainly ("Monday's status report couldn't be read"), never guessed. Grouped by client,
// because the reader is the person, who sees all of their clients; nothing here is sent to an AI or posted anywhere.
// Suggestions (at most 3) are FocusTime plan proposals (SUGGEST_TOOLS): a tap builds the usual preview, which runs
// only on Confirm.
import type { AnswerContext, CtxBlock, CtxDay, CtxTodo } from "./context.ts";
import type { Link } from "./types.ts";

export const TOPICS = ["plan_check", "capabilities", "agenda", "promises", "waiting", "readiness", "deployments", "status_updates", "done", "calls", "items", "standards", "general"] as const;
export type Topic = (typeof TOPICS)[number];

export type Line = { text: string; link?: Link };
export type Section = { title: string; lines: Line[] };
/** A tap that builds a proposal (`tool`, its args) or sends my words again (`say`). */
export type Suggestion = { label: string; tool: "move_plan" | "confirm_week"; args: Record<string, unknown> } | { label: string; say: string };
export type Refs = { items: { clientKey: string; id: number; title: string }[]; picks: number[]; promises: number[] };
export type Composed = { reply: string; sections: Section[]; suggestions: Suggestion[]; refs: Refs; links: Link[] };

type LinkFn = (href: string, label: string) => Link;

/** How long a block may run over before it's "too much" (the Board's amber is any minute over; this is the answer's). */
const OVER_SLACK = 30;
/** A workday with less free focus time than this, or this many minutes of meetings, is worth a line. */
const LITTLE_FOCUS = 120;
const HEAVY_MEETINGS = 240;

const P = (d: string) => Temporal.PlainDate.from(d);
const short = (d: string) => P(d).toLocaleString("en-US", { weekday: "short" });
const dayLabel = (d: string) => P(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dateLabel = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? P(d.slice(0, 10)).toLocaleString("en-US", { month: "short", day: "numeric" }) : "no date");
const hours = (m: number) => (m < 60 ? `${Math.max(5, Math.round(m / 5) * 5)} min` : `${Math.round(m / 60)}h`);
const about = (m: number) => (m < 60 ? hours(m) : `about ${hours(m)}`);
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const halfWord = (h: string) => (h === "EVE" ? "evening" : h);
/** Gap words mid-line ("needs stories, unassigned"). */
const gapText = (gs: readonly string[]) => gs.map((g) => g.charAt(0).toLowerCase() + g.slice(1)).join(", ");

/** Days that need a word: PTO, little focus time, many meetings, a block with more planned than fits. */
export function overloaded(b: CtxBlock): boolean {
  return !b.pto && b.plannedMinutes > b.freeMinutes + OVER_SLACK;
}
function dayFlags(x: CtxDay): string | null {
  if (x.pto) return "PTO";
  if (x.ptoHalf) return `PTO in the ${x.ptoHalf === "AM" ? "morning" : "afternoon"}`;
  if (x.kind !== "work" || x.workMinutes === 0) return null;
  const parts: string[] = [];
  if (x.meetingMinutes >= HEAVY_MEETINGS) parts.push(`${hours(x.meetingMinutes)} of meetings`);
  if (x.freeMinutes < LITTLE_FOCUS) parts.push(`${x.freeMinutes ? hours(x.freeMinutes) : "no time"} free for focus`);
  return parts.length ? parts.join(", ") : null;
}

function refsOf(ctx: AnswerContext, picks: CtxTodo[], itemIds: { clientKey: string; id: number; title: string }[], promiseIds: number[]): Refs {
  const items = new Map<string, { clientKey: string; id: number; title: string }>();
  for (const i of itemIds) items.set(`${i.clientKey}:${i.id}`, i);
  for (const t of picks) {
    if (t.feature) items.set(`${t.clientKey}:${t.feature.id}`, { clientKey: t.clientKey, id: t.feature.id, title: t.feature.title });
    if (t.itemId !== null && !items.has(`${t.clientKey}:${t.itemId}`)) items.set(`${t.clientKey}:${t.itemId}`, { clientKey: t.clientKey, id: t.itemId, title: t.title });
  }
  void ctx;
  return { items: [...items.values()], picks: picks.map((t) => t.pickId), promises: promiseIds };
}

const promiseHref = (p: { key: string | null; id: number }) => (p.key ? `#/inbox/item/${p.key}` : `#/inbox/promise/${p.id}`);
const blockHref = (date: string, half: string) => `#/week/day/${date}/${half === "EVE" ? "PM" : half}`;

function todoLine(t: CtxTodo, link: LinkFn, withDay = true): Line {
  const when = withDay ? `${short(t.date)} ${halfWord(t.half)}: ` : `${halfWord(t.half)}: `;
  const what = t.deployment ? `Deployment ${t.deployment}, ${t.title}` : t.title;
  const tail = t.itemId ? ` (#${t.itemId})` : "";
  return { text: `${t.done ? "Done: " : ""}${when}${what}${tail}`, link: link(blockHref(t.date, t.half), `Open ${dayLabel(t.date)}`) };
}

/** The friday of a block's week, for "move it to the catch-up day". */
const fridayOf = (d: string) => P(d).subtract({ days: P(d).dayOfWeek - 1 }).add({ days: 4 }).toString();

/**
 * "I'm planning next week. What should I look out for?": days with little focus or PTO, then per client: blocks with
 * more planned than fits, late or due promises, readiness gaps for work dated then, deployments and after-hours time,
 * features with no update for Monday's report, calls to review. Up to 3 suggestions.
 */
function planCheck(ctx: AnswerContext, link: LinkFn): Composed {
  const sections: Section[] = [];
  const dayLines: Line[] = [];
  for (const x of ctx.days) {
    const f = dayFlags(x);
    if (f) dayLines.push({ text: `${x.label}: ${f}`, link: link(`#/week/day/${x.date}`, `Open ${x.label}`) });
  }
  if (dayLines.length) sections.push({ title: "Your days", lines: dayLines });

  const suggestions: Suggestion[] = [];
  const usedTodos: CtxTodo[] = [];
  const itemRefs: Refs["items"] = [];
  const promiseRefs: number[] = [];
  let count = dayLines.length;
  for (const c of ctx.clients) {
    const lines: Line[] = [];
    for (const b of ctx.days.flatMap((x) => x.blocks).filter((b) => b.clientKey === c.key)) {
      if (overloaded(b)) {
        const these = ctx.todos.filter((t) => t.clientKey === c.key && t.date === b.date && t.half === b.half && !t.done);
        usedTodos.push(...these);
        lines.push({ text: `${short(b.date)} ${b.half}: ${about(b.plannedMinutes)} planned, ${b.freeMinutes ? hours(b.freeMinutes) : "no time"} free${b.risk ? ` (${b.risk})` : ""}`, link: link(blockHref(b.date, b.half), `Open ${dayLabel(b.date)}`) });
        const fri = fridayOf(b.date);
        if (these.length && b.date !== fri && suggestions.length < 2)
          suggestions.push({ label: `Move the ${c.name} to-dos from ${short(b.date)} ${b.half} to Fri AM`, tool: "move_plan", args: { fromDate: b.date, fromHalf: b.half, toDate: fri, toHalf: "AM", which: "named", pickIds: these.map((t) => t.pickId) } });
      } else if (b.risk) lines.push({ text: `${short(b.date)} ${b.half}: at risk, ${b.risk}`, link: link(blockHref(b.date, b.half), `Open ${dayLabel(b.date)}`) });
    }
    for (const p of ctx.promises.filter((p) => p.clientKey === c.key)) {
      promiseRefs.push(p.id);
      lines.push({ text: `${p.late ? "Late" : "Due"} promise${p.to ? ` to ${p.to}` : ""}: ${p.what} (${p.late ? "was due" : "due"} ${dateLabel(p.due)})`, link: link(promiseHref(p), "Open the promise") });
    }
    for (const g of ctx.gaps.filter((g) => g.clientKey === c.key)) {
      itemRefs.push({ clientKey: g.clientKey, id: g.id, title: g.title });
      lines.push({ text: `#${g.id} ${g.title}: ${gapText(g.gaps)}${g.target ? ` (target ${dateLabel(g.target)})` : ""}`, link: link(`#/ahead/item/${g.id}`, `Open #${g.id} in Ahead`) });
    }
    for (const t of ctx.todos.filter((t) => t.clientKey === c.key && t.deployment)) {
      usedTodos.push(t);
      lines.push(todoLine(t, link));
    }
    for (const f of (ctx.statusMissing ?? []).filter((f) => f.clientKey === c.key)) {
      itemRefs.push(f);
      lines.push({ text: `#${f.id} ${f.title}: no update yet for Monday's report`, link: link("#/status", "Open Status") });
    }
    for (const k of ctx.calls.filter((k) => k.clientKey === c.key)) lines.push({ text: `${k.meeting} on ${dateLabel(k.date)}: ${k.kind === "upload" ? "a transcript to upload" : "proposals to review"}`, link: link("#/meetings", "Open Client calls") });
    count += lines.length;
    if (lines.length) sections.push({ title: c.name, lines });
  }
  if (ctx.afterHours.minutes > 0) {
    sections.push({ title: "After hours", lines: [{ text: `${about(ctx.afterHours.minutes)} after hours: ${ctx.afterHours.parts.slice(0, 3).map((p) => `${p.title} ${short(p.date)}`).join(", ")}`, link: link("#/week", "Open Week") }] });
    count += 1;
  }
  if (ctx.unknown.length) sections.push({ title: "Not known", lines: ctx.unknown.map((u) => ({ text: u })) });
  const weekStart = ctx.period.from;
  if ((ctx.period.kind === "next_week" || ctx.period.kind === "this_week") && ctx.confirmed[weekStart] === false && suggestions.length < 3)
    suggestions.push({ label: ctx.period.kind === "next_week" ? "Confirm next week" : "Confirm this week", tool: "confirm_week", args: { weekStart } });
  const reply = count
    ? `For ${ctx.period.label}, ${plural(count, "thing")} to look at${ctx.clients.length > 1 ? `, by client` : ""}.`
    : `Nothing stands out for ${ctx.period.label}: no overloaded blocks, late promises, readiness gaps, deployments or missing updates${ctx.unknown.length ? ", though some of it couldn't be read" : ""}.`;
  const links = [link("#/week/add", "Open Add work")];
  if (ctx.gaps.length) links.push(link("#/ahead/fix", "Open Gaps"));
  if (ctx.statusMissing?.length) links.push(link("#/status", "Open Status"));
  return { reply, sections, suggestions: suggestions.slice(0, 3), refs: refsOf(ctx, usedTodos, itemRefs, promiseRefs), links };
}

/** Lines grouped by client, one section each. */
function byClient<T extends { clientKey: string | null }>(ctx: AnswerContext, rows: T[], line: (r: T) => Line): Section[] {
  const out: Section[] = [];
  for (const c of ctx.clients) {
    const lines = rows.filter((r) => r.clientKey === c.key).map(line);
    if (lines.length) out.push({ title: c.name, lines });
  }
  const none = rows.filter((r) => r.clientKey === null).map(line);
  if (none.length) out.push({ title: "No client", lines: none });
  return out;
}

const notKnown = (ctx: AnswerContext, about: string): Section[] => {
  const u = ctx.unknown.filter((x) => x.toLowerCase().includes(about));
  return u.length ? [{ title: "Not known", lines: u.map((text) => ({ text })) }] : [];
};

function agenda(ctx: AnswerContext, link: LinkFn): Composed {
  const sections: Section[] = [];
  for (const x of ctx.days) {
    const todos = ctx.todos.filter((t) => t.date === x.date);
    const lines: Line[] = [];
    const f = dayFlags(x);
    if (f) lines.push({ text: f });
    for (const b of x.blocks) lines.push({ text: `${b.half}: ${b.clientName} block, ${b.freeMinutes ? `${hours(b.freeMinutes)} free` : "no free time"}${b.plannedMinutes ? `, ${about(b.plannedMinutes)} planned` : ""}${b.risk ? ` (${b.risk})` : ""}`, link: link(blockHref(b.date, b.half), `Open ${x.label}`) });
    for (const t of todos) lines.push({ ...todoLine(t, link, false), text: `${todoLine(t, link, false).text} · ${ctx.clients.find((c) => c.key === t.clientKey)?.name ?? t.clientKey}` });
    if (x.meetingMinutes && !f) lines.push({ text: `${hours(x.meetingMinutes)} of meetings` });
    if (lines.length) sections.push({ title: x.label, lines });
  }
  const todos = ctx.todos.filter((t) => !t.done);
  const meet = ctx.days.reduce((n, x) => n + x.meetingMinutes, 0);
  const blocks = ctx.days.reduce((n, x) => n + x.blocks.length, 0);
  const pto = ctx.days.filter((x) => x.pto);
  const reply = pto.length && pto.length === ctx.days.filter((x) => x.kind === "work").length && ctx.days.length
    ? `You're off ${ctx.period.label}.`
    : `${ctx.period.label[0]!.toUpperCase()}${ctx.period.label.slice(1)}: ${plural(blocks, "block")}, ${plural(todos.length, "to-do")} planned${meet ? `, ${hours(meet)} of meetings` : ""}${todos.length ? "" : ". Nothing is planned yet"}.`;
  return { reply, sections: [...sections, ...notKnown(ctx, "week")], suggestions: [], refs: refsOf(ctx, ctx.todos, [], []), links: [link(ctx.period.from === ctx.period.to ? `#/week/day/${ctx.period.from}` : "#/week", "Open Week")] };
}

function promises(ctx: AnswerContext, link: LinkFn, lateOnly: boolean): Composed {
  const rows = ctx.promises.filter((p) => !lateOnly || p.late);
  const late = rows.filter((p) => p.late).length;
  const sections = byClient(ctx, rows, (p) => ({ text: `${p.late ? "Late" : "Due"}${p.to ? `, to ${p.to}` : ""}: ${p.what} (${p.late ? "was due" : "due"} ${dateLabel(p.due)})`, link: link(promiseHref(p), "Open the promise") }));
  const reply = !rows.length ? (lateOnly ? "No promises are late." : `No promises are late or due ${ctx.period.label}.`) : lateOnly ? `${plural(late, "promise is", "promises are")} late.` : `${plural(late, "promise is", "promises are")} late and ${rows.length - late} due ${ctx.period.label}.`;
  return { reply, sections, suggestions: [], refs: refsOf(ctx, [], [], rows.map((p) => p.id)), links: [link("#/inbox/promises", "Open Promises")] };
}

function waiting(ctx: AnswerContext, link: LinkFn): Composed {
  const sections = byClient(ctx, ctx.waiting, (w) => ({ text: `${w.who ? `${w.who}: ` : ""}${w.title}${w.due ? ` (${w.late ? "was due" : "due"} ${dateLabel(w.due)})` : ""}`, link: link(`#/inbox/item/${w.key}`, "Open in the Inbox") }));
  return { reply: ctx.waiting.length ? `You're waiting on ${plural(ctx.waiting.length, "thing")}${ctx.waiting.some((w) => w.late) ? `, ${ctx.waiting.filter((w) => w.late).length} late` : ""}.` : "You're not waiting on anyone right now.", sections: [...sections, ...notKnown(ctx, "inbox")], suggestions: [], refs: refsOf(ctx, [], [], []), links: [link("#/inbox/waiting", "Open Waiting on")] };
}

function readiness(ctx: AnswerContext, link: LinkFn): Composed {
  const sections = byClient(ctx, ctx.gaps, (g) => ({ text: `#${g.id} ${g.title}: ${gapText(g.gaps)}${g.target ? ` (target ${dateLabel(g.target)})` : ""}${g.why === "planned" ? ", you have to-dos under it" : ""}`, link: link(`#/ahead/item/${g.id}`, `Open #${g.id} in Ahead`) }));
  const n = ctx.gaps.length;
  const reply = n ? `${plural(n, "item isn't", "items aren't")} ready for ${ctx.period.label}.` : `Everything dated or planned for ${ctx.period.label} has its stories, a target date, an owner and a size${ctx.unknown.some((u) => u.startsWith("Ahead")) ? ", as far as I can tell (Ahead couldn't be read)" : ""}.`;
  return { reply, sections: [...sections, ...notKnown(ctx, "ahead")], suggestions: [], refs: refsOf(ctx, [], ctx.gaps.map((g) => ({ clientKey: g.clientKey, id: g.id, title: g.title })), []), links: [link("#/ahead/fix", "Open Gaps")] };
}

function deployments(ctx: AnswerContext, link: LinkFn): Composed {
  const deps = ctx.todos.filter((t) => t.deployment);
  const sections = byClient(ctx, deps, (t) => todoLine(t, link));
  const other = ctx.afterHours.parts.filter((p) => !deps.some((t) => t.pickId === p.pickId));
  if (other.length) sections.push({ title: "Other after-hours time", lines: other.map((p) => ({ text: `${short(p.date)}: ${p.title}, ${hours(p.minutes)} (${p.why})`, link: link(`#/week/day/${p.date}`, `Open ${dayLabel(p.date)}`) })) });
  const reply = deps.length
    ? `${plural(deps.length, "deployment")} ${ctx.period.label}${ctx.afterHours.minutes ? `, ${about(ctx.afterHours.minutes)} after hours in all` : ""}.`
    : `No deployments ${ctx.period.label}${ctx.afterHours.minutes ? `, but ${about(ctx.afterHours.minutes)} after hours` : ""}.`;
  return { reply, sections, suggestions: [], refs: refsOf(ctx, deps, [], []), links: [link("#/week", "Open Week")] };
}

function statusUpdates(ctx: AnswerContext, link: LinkFn): Composed {
  if (ctx.statusMissing === null) return { reply: "I couldn't read Monday's status report, so I don't know which features still need an update.", sections: notKnown(ctx, "status"), suggestions: [], refs: refsOf(ctx, [], [], []), links: [link("#/status", "Open Status")] };
  const sections = byClient(ctx, ctx.statusMissing, (f) => ({ text: `#${f.id} ${f.title}`, link: link("#/status", "Open Status") }));
  const n = ctx.statusMissing.length;
  return { reply: n ? `${plural(n, "feature has", "features have")} no update yet for ${ctx.statusTitle ?? "Monday's report"}.` : `Every feature on ${ctx.statusTitle ?? "Monday's report"} has an update.`, sections: [...sections, ...notKnown(ctx, "status")], suggestions: [], refs: refsOf(ctx, [], ctx.statusMissing, []), links: [link("#/status", "Open Status")] };
}

function done(ctx: AnswerContext, link: LinkFn): Composed {
  const rows = ctx.todos.filter((t) => t.done);
  const sections = byClient(ctx, rows, (t) => todoLine(t, link));
  const open = ctx.todos.filter((t) => !t.done && t.date < ctx.today).length;
  const one = ctx.clients.length === 1 ? ` for ${ctx.clients[0]!.name}` : "";
  return { reply: rows.length ? `${plural(rows.length, "to-do")} done ${ctx.period.label}${one}${open ? `, ${open} from earlier days not done yet` : ""}.` : `Nothing marked done ${ctx.period.label}${one} yet.`, sections, suggestions: [], refs: refsOf(ctx, rows, [], []), links: [link("#/week", "Open Week")] };
}

function calls(ctx: AnswerContext, link: LinkFn): Composed {
  const sections = byClient(ctx, ctx.calls, (k) => ({ text: `${k.meeting} on ${dateLabel(k.date)}: ${k.kind === "upload" ? "a transcript to upload" : "proposals to review"}`, link: link("#/meetings", "Open Client calls") }));
  return { reply: ctx.calls.length ? `${plural(ctx.calls.length, "client call")} to review.` : "No client calls are waiting for your review.", sections, suggestions: [], refs: refsOf(ctx, [], [], []), links: [link("#/meetings", "Open Client calls")] };
}

/**
 * "What can you help me with here exactly?": what the assistant does, with 4 to 6 examples from my own week (my
 * blocks, to-dos, items, promises and clients), each a tap that asks it.
 */
function capabilities(ctx: AnswerContext, link: LinkFn): Composed {
  const ex: string[] = [];
  const add = (s: string | null) => void (s && ex.length < 6 && !ex.includes(s) && ex.push(s));
  const nameOf = (k: string) => ctx.clients.find((c) => c.key === k)?.name ?? k;
  const later = ctx.todos.filter((t) => !t.done && t.date >= ctx.today && t.half !== "EVE");
  const first = later[0];
  if (first) {
    const fri = fridayOf(first.date);
    const to = first.date === fri ? "Monday AM" : "Friday AM";
    add(`Move the ${nameOf(first.clientKey)} to-dos from ${P(first.date).toLocaleString("en-US", { weekday: "long" })} ${first.half} to ${to}`);
  }
  const withItem = ctx.todos.find((t) => t.itemId !== null && !t.done);
  if (withItem) add(`Mark #${withItem.itemId} done and comment that it's ready for review`);
  add("I'm planning next week. What should I look out for?");
  const promise = ctx.promises[0];
  if (promise?.to) add(`Close the loop with ${promise.to}`);
  const gapClient = ctx.gaps[0]?.clientKey ?? ctx.clients[0]?.key;
  if (gapClient) add(`What's not ready for ${nameOf(gapClient)} next week?`);
  if (ctx.statusMissing?.length) add("Which features still need an update for Monday?");
  const c = ctx.clients[0];
  if (c) add(`What did I get done this week for ${c.name}?`);
  add("Which promises are late?");
  add("What's on my plate tomorrow?");
  const reply = "I answer questions about your plan and make changes you confirm: moving to-dos, confirming a day or week, updating DevOps items, dates and owners in Ahead, sends, captures, deployments and closing the loop. Nothing changes until you press Confirm. Some things to try, from your week:";
  return { reply, sections: [{ title: "Try asking", lines: ex.map((text) => ({ text })) }], suggestions: ex.slice(0, 6).map((s) => ({ label: s, say: s })), refs: refsOf(ctx, [], [], []), links: [link("#/commands", "Open the command menu"), link("#/guide/ask", "Read Ask in the Guide")] };
}

export function compose(topic: Topic, ctx: AnswerContext, link: LinkFn, o: { lateOnly?: boolean } = {}): Composed {
  switch (topic) {
    case "plan_check": return planCheck(ctx, link);
    case "capabilities": return capabilities(ctx, link);
    case "agenda": return agenda(ctx, link);
    case "promises": return promises(ctx, link, !!o.lateOnly);
    case "waiting": return waiting(ctx, link);
    case "readiness": return readiness(ctx, link);
    case "deployments": return deployments(ctx, link);
    case "status_updates": return statusUpdates(ctx, link);
    case "done": return done(ctx, link);
    case "calls": return calls(ctx, link);
    // items, standards and general are the service's (they need the resolver or the model).
    case "items":
    case "standards":
    case "general": return planCheck(ctx, link);
  }
}

/** The plain text of a composed answer (Teams' fallback, history, the eval script): the reply, then each section. */
export function asText(c: Pick<Composed, "reply" | "sections">): string {
  return [c.reply, ...c.sections.map((s) => `${s.title}\n${s.lines.map((l) => `- ${l.text}`).join("\n")}`)].join("\n\n");
}
