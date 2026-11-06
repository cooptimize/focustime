// TB-2: the cards the bot sends on its own (morning brief, midday check-in, close out, nudges) and the capture reply.
// Pure: a card is drawn from its model (kept in teams_rhythm), so a tap changes the model and the card is drawn again
// in place. Every card says what it is on its first line, links to the same thing in the app, and says where it was
// turned on. Taps are Action.Execute (an Action.Submit fallback) with the occasion and an op; nothing else in the
// data is trusted, and every id is checked against the person's own store when it runs.
import type { Nudge } from "../../plan/teams-rhythm.ts";
import { card, muted, openUrl, shown, text, type Card } from "./cards.ts";

export type PickState = "open" | "done" | "not_yet" | "moved";
export type PickRow = { id: number; title: string; client: string | null; state: PickState; note?: string | null };
export type Choice = { value: string; label: string };
/** A proposal shown inside the card (Confirm today, Move…, Close out), with its outcome once tapped. */
export type InlineProposal = {
  proposalId: string;
  title: string;
  whoSees: string;
  changes: { field: string; before: string | null; after: string | null }[];
  note: string | null;
  expiresAt: string;
  state: "open" | "done" | "failed" | "expired" | "cancelled";
  message?: string | null;
};
export type BriefBlock = { label: string; client: string | null; meetings: string[]; picks: PickRow[] };

type Base = { occasion: string; date: string; dateLabel: string; test?: boolean; proposal?: InlineProposal | null; notice?: string | null };
export type BriefModel = Base & { kind: "brief"; blocks: BriefBlock[]; promises: string[]; sends: string[]; committed: boolean; destinations: Choice[]; more: number };
export type CheckinModel = Base & { kind: "checkin"; picks: PickRow[]; destinations: Choice[] };
export type CloseoutModel = Base & { kind: "closeout"; picks: PickRow[]; closed: boolean };
export type NudgeModel = { kind: "nudges"; occasion: string; items: Nudge[]; test?: boolean };
/** SR-1: Monday's status report, the features with no update yet (titles of my own clients' features, to me only). */
export type StatusModel = { kind: "status"; occasion: string; line: string; reportLabel: string; clients: { name: string; features: { title: string; url: string | null }[] }[]; more: number; test?: boolean };
export type RhythmModel = BriefModel | CheckinModel | CloseoutModel | NudgeModel | StatusModel;

export type RhythmOp = "done" | "undone" | "not_yet" | "confirm_today" | "move" | "move_rest" | "close_out" | "closeout_text" | "confirm" | "cancel";
export const RHYTHM_OPS: readonly RhythmOp[] = ["done", "undone", "not_yet", "confirm_today", "move", "move_rest", "close_out", "closeout_text", "confirm", "cancel"];
/** What a rhythm tap sends: the card's occasion, the op, a pick or proposal, and the card's inputs by id. */
export type RhythmTap = { ft: "rhythm"; occasion: string; op: RhythmOp; pickId?: number; proposalId?: string; movePick?: string; moveTo?: string; closeoutText?: string };
export type CaptureTap = { ft: "capture_undo"; captureId: number };

const MAX = { blocks: 3, picks: 5, meetings: 3, list: 3, closeoutText: 1000 } as const;
const ROUTE: Record<RhythmModel["kind"], [string, string]> = {
  brief: ["#/today", "Open Today"],
  checkin: ["#/today/checkin", "Open Check-in"],
  closeout: ["#/today", "Open Close out"],
  nudges: ["#/inbox", "Open the Inbox"],
  status: ["#/week/status", "Open Status"],
};
const NAME: Record<RhythmModel["kind"], string> = { brief: "Morning brief", checkin: "Midday check-in", closeout: "Close out", nudges: "Nudges", status: "Status report" };

const abs = (publicUrl: string, route: string) => `${publicUrl.replace(/\/+$/, "")}/${route}`;
const exec = (label: string, data: RhythmTap | CaptureTap, style?: "positive" | "destructive") => ({ type: "Action.Execute", title: label, verb: data.ft, data, ...(style ? { style } : {}), fallback: { type: "Action.Submit", title: label, data } });
const tapOn = (m: { occasion: string }, op: RhythmOp, extra: Partial<RhythmTap> = {}): RhythmTap => ({ ft: "rhythm", occasion: m.occasion, op, ...extra });
const actionSet = (actions: unknown[]) => ({ type: "ActionSet", actions });
const header = (kind: RhythmModel["kind"], label: string | null, test?: boolean) => text(`FocusTime · ${NAME[kind]}${label ? ` · ${label}` : ""}${test ? " (test)" : ""}`, { weight: "Bolder", size: "Medium" });
const footer = (publicUrl: string) => muted(`You turned this on in [Settings › Notifications › In Teams](${abs(publicUrl, "#/settings/notifications")}).`);
const choices = (id: string, label: string, list: readonly Choice[], value?: string) => ({ type: "Input.ChoiceSet", id, label, style: "compact", isRequired: true, errorMessage: "Choose one", value: value ?? list[0]?.value, choices: list.map((c) => ({ title: c.label, value: c.value })) });

function pickLine(p: PickRow, buttons: ("done" | "not_yet")[], m: { occasion: string }, settled: boolean): unknown {
  const mark = p.state === "done" ? "✓" : p.state === "moved" ? "→" : p.state === "not_yet" ? "○" : "•";
  const tail = p.state === "not_yet" ? " · not yet" : p.state === "moved" ? ` · ${p.note ?? "moved"}` : "";
  const line = text(`${mark} ${p.title}${p.client ? ` (${p.client})` : ""}${tail}`, { spacing: "Small", ...(p.state === "done" || p.state === "moved" ? { isSubtle: true } : {}) });
  const acts: unknown[] = [];
  if (!settled && p.state !== "moved") {
    if (p.state === "done") acts.push(exec("Undo", tapOn(m, "undone", { pickId: p.id })));
    else {
      if (buttons.includes("done")) acts.push(exec("Done", tapOn(m, "done", { pickId: p.id }), "positive"));
      if (buttons.includes("not_yet") && p.state !== "not_yet") acts.push(exec("Not yet", tapOn(m, "not_yet", { pickId: p.id })));
    }
  }
  if (!acts.length) return line;
  return { type: "ColumnSet", spacing: "Small", columns: [{ type: "Column", width: "stretch", verticalContentAlignment: "Center", items: [{ ...line, spacing: "None" }] }, { type: "Column", width: "auto", items: [actionSet(acts)] }] };
}

/** The proposal inside a card: the usual preview with Confirm and Cancel, or its outcome. */
function proposalPart(m: { occasion: string }, p: InlineProposal): unknown[] {
  const body: unknown[] = [{ type: "Container", separator: true, spacing: "Medium", items: [] as unknown[] }];
  const items = (body[0] as { items: unknown[] }).items;
  if (p.state === "open") {
    items.push(text(p.title, { weight: "Bolder" }));
    items.push(muted(`Who sees it: ${p.whoSees}`));
    if (p.changes.length) items.push({ type: "FactSet", facts: p.changes.slice(0, 14).map((c) => ({ title: c.field, value: `${shown(c.before)} → ${shown(c.after)}` })) });
    if (p.note) items.push(muted(p.note));
    if (p.message) items.push(text(p.message, { color: "Warning", spacing: "Small" }));
    items.push(muted("Nothing changes until you confirm. This expires in 15 minutes."));
    items.push(actionSet([exec("Confirm", tapOn(m, "confirm", { proposalId: p.proposalId }), "positive"), exec("Cancel", tapOn(m, "cancel", { proposalId: p.proposalId }))]));
  } else if (p.state === "done") {
    items.push(text(`Done: ${p.title}`, { weight: "Bolder", color: "Good" }));
    if (p.message) items.push(text(p.message, { spacing: "Small" }));
  } else if (p.state === "failed") {
    items.push(text(`Couldn't do it: ${p.title}`, { weight: "Bolder", color: "Attention" }));
    if (p.message) items.push(text(p.message, { spacing: "Small" }));
  } else {
    items.push(text(`${p.state === "expired" ? "Expired" : "Cancelled"}: ${p.title}`, { weight: "Bolder", isSubtle: true }));
    items.push(muted(p.state === "expired" ? "Nothing changed. Tap again for a fresh preview." : "Nothing changed."));
  }
  return body;
}

const openProposal = (m: Base) => m.proposal?.state === "open";

export function briefCard(m: BriefModel, publicUrl: string): Card {
  const body: unknown[] = [header("brief", m.dateLabel, m.test)];
  if (!m.blocks.length) body.push(text("No focus blocks today.", { spacing: "Small" }));
  for (const b of m.blocks.slice(0, MAX.blocks)) {
    body.push(text(`${b.label}: ${b.client ?? "Open"}`, { weight: "Bolder", spacing: "Medium" }));
    for (const e of b.meetings.slice(0, MAX.meetings)) body.push(muted(e));
    if (b.meetings.length > MAX.meetings) body.push(muted(`${b.meetings.length - MAX.meetings} more meetings`));
    if (!b.picks.length) body.push(muted("Nothing planned"));
    for (const p of b.picks.slice(0, MAX.picks)) body.push(pickLine(p, [], m, true));
    if (b.picks.length > MAX.picks) body.push(muted(`${b.picks.length - MAX.picks} more to-dos`));
  }
  if (m.more) body.push(muted(`${m.more} more block${m.more === 1 ? "" : "s"} in Today`));
  if (m.promises.length) {
    body.push(text("Promises due today", { weight: "Bolder", spacing: "Medium" }));
    for (const p of m.promises.slice(0, MAX.list)) body.push(text(`• ${p}`, { spacing: "Small" }));
    if (m.promises.length > MAX.list) body.push(muted(`${m.promises.length - MAX.list} more in the Inbox`));
  }
  if (m.sends.length) {
    body.push(text("Sent to you, waiting for your answer", { weight: "Bolder", spacing: "Medium" }));
    for (const s of m.sends.slice(0, MAX.list)) body.push(text(`• ${s}`, { spacing: "Small" }));
    if (m.sends.length > MAX.list) body.push(muted(`${m.sends.length - MAX.list} more in Plan`));
  }
  body.push(muted(m.committed ? "Today is confirmed." : "Today isn't confirmed yet."));
  if (m.notice) body.push(text(m.notice, { color: "Warning", spacing: "Small" }));
  if (m.proposal) body.push(...proposalPart(m, m.proposal));
  body.push(footer(publicUrl));
  const actions: unknown[] = [];
  const open = m.blocks.flatMap((b) => b.picks).filter((p) => p.state === "open" || p.state === "not_yet");
  if (!openProposal(m)) {
    if (!m.committed && m.blocks.some((b) => b.picks.length)) actions.push(exec("Confirm today", tapOn(m, "confirm_today"), "positive"));
    if (open.length && m.destinations.length)
      actions.push({
        type: "Action.ShowCard",
        title: "Move…",
        card: card([choices("movePick", "Which to-do", open.map((p) => ({ value: String(p.id), label: p.title.slice(0, 80) }))), choices("moveTo", "To", m.destinations)], [exec("Show the move", tapOn(m, "move"))]),
      });
  }
  actions.push(openUrl({ label: ROUTE.brief[1], url: abs(publicUrl, ROUTE.brief[0]) }));
  return card(body, actions);
}

export function checkinCard(m: CheckinModel, publicUrl: string): Card {
  const body: unknown[] = [header("checkin", m.dateLabel, m.test), muted("This morning's to-dos. Tap Done for what's finished.")];
  if (!m.picks.length) body.push(text("Nothing was planned this morning.", { spacing: "Small" }));
  const settled = openProposal(m);
  for (const p of m.picks.slice(0, 10)) body.push(pickLine(p, ["done", "not_yet"], m, settled));
  if (m.notice) body.push(text(m.notice, { color: "Warning", spacing: "Small" }));
  if (m.proposal) body.push(...proposalPart(m, m.proposal));
  body.push(footer(publicUrl));
  const rest = m.picks.filter((p) => p.state === "open" || p.state === "not_yet");
  const actions: unknown[] = [];
  if (!settled && rest.length && m.destinations.length)
    actions.push({ type: "Action.ShowCard", title: "Move the rest to…", card: card([muted(`${rest.length} not done`), choices("moveTo", "To", m.destinations)], [exec("Show the move", tapOn(m, "move_rest"))]) });
  actions.push(openUrl({ label: ROUTE.checkin[1], url: abs(publicUrl, ROUTE.checkin[0]) }));
  return card(body, actions);
}

export function closeoutCard(m: CloseoutModel, publicUrl: string): Card {
  const body: unknown[] = [header("closeout", m.dateLabel, m.test), text("What got done today?", { spacing: "Small" })];
  if (!m.picks.length) body.push(muted("Nothing was planned today."));
  const settled = openProposal(m) || m.closed;
  for (const p of m.picks.slice(0, 12)) body.push(pickLine(p, ["done"], m, settled));
  if (!settled) body.push({ type: "Input.Text", id: "closeoutText", isMultiline: true, maxLength: MAX.closeoutText, placeholder: "Or tell me: \"the export and the login fix\", \"all\", \"1 and 3\"", label: "In your words" });
  if (m.closed && !m.proposal) body.push(text("The day is closed out.", { color: "Good", spacing: "Small" }));
  if (m.notice) body.push(text(m.notice, { color: "Warning", spacing: "Small" }));
  if (m.proposal) body.push(...proposalPart(m, m.proposal));
  body.push(footer(publicUrl));
  const actions: unknown[] = [];
  if (!settled) {
    actions.push(exec("Close out the day…", tapOn(m, "close_out"), "positive"));
    actions.push(exec("Send", tapOn(m, "closeout_text")));
  }
  actions.push(openUrl({ label: ROUTE.closeout[1], url: abs(publicUrl, ROUTE.closeout[0]) }));
  return card(body, actions);
}

export function nudgeCard(m: NudgeModel, publicUrl: string): Card {
  const body: unknown[] = [header("nudges", null, m.test)];
  for (const n of m.items) {
    body.push(text(`[${n.title}](${abs(publicUrl, n.route)})${n.clientName ? ` (${n.clientName})` : ""}`, { spacing: "Medium" }));
    body.push(muted(n.line));
  }
  body.push(footer(publicUrl));
  return card(body, [openUrl({ label: ROUTE.nudges[1], url: abs(publicUrl, ROUTE.nudges[0]) })]);
}

/** SR-1: "3 features have no update yet for Monday's report", each by client, linked to DevOps; Open Status. */
export function statusCard(m: StatusModel, publicUrl: string): Card {
  const body: unknown[] = [header("status", m.reportLabel, m.test), text(`${m.line}.`, { spacing: "Small" })];
  for (const c of m.clients) {
    body.push(text(c.name, { weight: "Bolder", spacing: "Medium" }));
    for (const f of c.features) body.push(text(`• ${f.url ? `[${f.title}](${f.url})` : f.title}`, { spacing: "Small" }));
  }
  if (m.more) body.push(muted(`and ${m.more} more`));
  body.push(muted("Kat sends the report Monday 7:00 AM. Add a line in Status and push it to DevOps."));
  body.push(footer(publicUrl));
  return card(body, [openUrl({ label: ROUTE.status[1], url: abs(publicUrl, ROUTE.status[0]) })]);
}

export function rhythmCard(m: RhythmModel, publicUrl: string): Card {
  switch (m.kind) {
    case "brief":
      return briefCard(m, publicUrl);
    case "checkin":
      return checkinCard(m, publicUrl);
    case "closeout":
      return closeoutCard(m, publicUrl);
    case "nudges":
      return nudgeCard(m, publicUrl);
    case "status":
      return statusCard(m, publicUrl);
  }
}

/** The reply to "capture: …": what was saved, where, with Undo; or after Undo, that it's gone. */
export function captureCard(c: { id: number; text: string; undone?: boolean; failed?: string | null }, publicUrl: string): Card {
  if (c.failed) return card([text("Not captured", { weight: "Bolder", color: "Attention" }), text(c.failed, { spacing: "Small" })]);
  if (c.undone) return card([text("FocusTime · Capture", { weight: "Bolder", isSubtle: true }), muted("Removed from Captures.")]);
  return card(
    [text("FocusTime · Captured to sort later", { weight: "Bolder", color: "Good" }), text(c.text.slice(0, 500), { spacing: "Small" }), muted("Saved as you typed it, in Inbox › Captures.")],
    [exec("Undo", { ft: "capture_undo", captureId: c.id }), openUrl({ label: "Open Captures", url: abs(publicUrl, "#/inbox/captures") })],
  );
}

const OCCASION = /^[A-Za-z0-9_.:+-]{1,120}$/;
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2 ** 31 ? v : typeof v === "string" && /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const short = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

/** A tap's data when it is a rhythm or capture tap of ours; null for anything else. */
export function rhythmTapOf(value: unknown): RhythmTap | CaptureTap | null {
  const v = value as { action?: { verb?: unknown; data?: unknown } } | null;
  const d = (v && typeof v === "object" && v.action && typeof v.action === "object" ? v.action.data : v) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  if (d.ft === "capture_undo") {
    const id = posInt(d.captureId);
    return id ? { ft: "capture_undo", captureId: id } : null;
  }
  if (d.ft !== "rhythm" || typeof d.occasion !== "string" || !OCCASION.test(d.occasion) || !RHYTHM_OPS.includes(d.op as RhythmOp)) return null;
  const out: RhythmTap = { ft: "rhythm", occasion: d.occasion, op: d.op as RhythmOp };
  const pickId = posInt(d.pickId);
  if (pickId) out.pickId = pickId;
  if (typeof d.proposalId === "string" && /^\d{1,10}$/.test(d.proposalId)) out.proposalId = d.proposalId;
  const mp = short(d.movePick, 12);
  if (mp) out.movePick = mp;
  const mt = short(d.moveTo, 20);
  if (mt) out.moveTo = mt;
  const ct = short(d.closeoutText, MAX.closeoutText);
  if (ct !== undefined) out.closeoutText = ct;
  return out;
}
