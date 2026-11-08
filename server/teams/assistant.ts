// TB-1: the assistant as the bot sees it (one brain, two front ends: the in-app panel and this bot). AS-1's service
// (assistant/types.ts) is adapted to this shape by teamsAssistant() below, so the bot and its tests keep their own
// small types. Nothing in server/teams calls an AI provider or an action itself: reads are answered by the assistant
// (or a quick command), and every write is a proposal the person confirms.
import type { Assistant, Card as AsCard, Link as AsLink, ProposeInput, Proposal as AsProposal } from "../../assistant/types.ts";

export type AssistantPerson = { userId: string };

/** What the bot knows about where the message came from. Never the message's text (that is `text`). */
export type TeamsContext = { surface: "teams"; conversation: "personal"; locale: string | null; timeZone: string | null };

export type AssistantLink = { label: string; url: string };

/** A result to show: a title, a few lines, and links into the app (absolute public URLs). */
export type AssistantCard = { title: string; lines?: readonly string[]; links?: readonly AssistantLink[] };

/** One field a write changes, as the preview shows it. */
export type ProposalChange = { field: string; before: string | null; after: string | null };

/** A write the assistant would make, waiting for Confirm: the usual preview (who sees it, before and after). */
export type Proposal = {
  id: string;
  title: string;
  /** Who will see the change ("You only", "Everyone on Northwind's DevOps project"). */
  whoSees: string;
  changes: readonly ProposalChange[];
  /** One line under the changes, when the preview needs it. */
  note?: string | null;
  /** Proposals expire 15 minutes after they are made. */
  expiresAt: string;
};

export type HandleStatus = "ok" | "off" | "client_off" | "refused" | "which_client" | (string & {});

/**
 * AS-2: a question with choices (card buttons in Teams). AS-3: an answer's suggested steps come the same way, with
 * `note` saying a tap shows a preview to confirm (`suggest`).
 */
export type Question = { text: string; choices: readonly { label: string; value: string }[]; expiresAt: string; suggest?: boolean };

export type HandleResult = {
  turnId: string;
  status: HandleStatus;
  reply: string;
  cards: readonly AssistantCard[];
  proposals: readonly Proposal[];
  links: readonly AssistantLink[];
  /** AS-2: the assistant asks instead of giving up. */
  question?: Question | null;
};

export type ConfirmResult =
  | { status: "ok"; message: string; undo?: { label: string; url?: string; proposalId?: string } | null; links?: readonly AssistantLink[]; parts?: readonly { label: string; ok: boolean; message: string }[] }
  | { status: "changed"; message: string; proposal: Proposal }
  | { status: "not_allowed" | "expired" | "gone"; message: string };

export type AssistantService = {
  handle(i: { person: AssistantPerson; channel: "teams"; text: string; context: TeamsContext; answer?: string }): Promise<HandleResult>;
  /** AS-2: a confirmed proposal's moved to-dos, back where they were. */
  undo?(i: { person: AssistantPerson; proposalId: string }): Promise<{ ok: boolean; message: string }>;
  confirm(i: { person: AssistantPerson; proposalId: string; edits?: Record<string, unknown> }): Promise<ConfirmResult>;
  cancel(i: { person: AssistantPerson; proposalId: string }): Promise<void>;
  /** TB-2: a proposal a card's button asks for (no AI): FocusTime's plan tools only (assistant/allowlist.ts PROPOSE_TOOLS). */
  propose(i: { person: AssistantPerson; tool: ProposeInput["tool"]; args: Record<string, unknown> }): Promise<{ ok: true; proposal: Proposal } | { ok: false; message: string }>;
};

/** Proposals expire after this long (AS-1); a card past it shows Expired. */
export const PROPOSAL_MINUTES = 15;

/** AS-1: a card's title, a few lines and its link, for Teams (the service already writes absolute links for "teams"). */
function cardOf(c: AsCard): AssistantCard {
  const links = (l: AsLink | undefined) => (l ? [{ label: l.label, url: l.href }] : []);
  switch (c.kind) {
    case "note":
      return { title: c.text, links: links(c.link) };
    case "item": {
      const dates = c.start || c.target ? [`${c.start ?? "No start"} to ${c.target ?? "no target"}`] : [];
      const kids = c.children.slice(0, 5).map((k) => `#${k.id} ${k.title} · ${k.state}${k.owner ? ` · ${k.owner}` : ""}`);
      return { title: `#${c.id} ${c.title}`, lines: [`${c.clientName} · ${c.type} · ${c.state} · ${c.owner ?? "Unassigned"}`, ...dates, ...kids], links: [...links(c.link), ...(c.devopsUrl ? [{ label: "Open in DevOps", url: c.devopsUrl }] : [])] };
    }
    case "block":
      return { title: `${c.clientName} · ${c.date} ${c.half}`, lines: [`${c.time} · ${c.status}`, ...c.picks.map((p) => `${p.done ? "Done: " : ""}${p.title} (${p.size})`)], links: links(c.link) };
    case "pick":
      return { title: `${c.done ? "Done: " : ""}${c.title}`, lines: [`${c.clientName} · ${c.date} ${c.half}${c.time ? ` · ${c.time}` : ""}`], links: links(c.link) };
    case "send":
      return { title: c.title, lines: [`${c.clientName} · ${c.from} to ${c.to} · ${c.tier === "must" ? "Must" : "Suggested"} · week of ${c.weekStart} · ${c.state}`], links: links(c.link) };
    case "promise":
      return { title: c.what, lines: [`${c.clientName} · ${c.who}${c.toWhom ? ` to ${c.toWhom}` : ""}${c.due ? ` · due ${c.due}` : ""}`], links: links(c.link) };
    case "question":
    case "suggest":
      return { title: c.text, lines: c.choices.map((x) => x.label) };
    // AS-3: one part of an answer: its heading, its lines, and its first two distinct links (more run off a 1:1 card).
    case "section": {
      const seen = new Set<string>();
      const ls = c.lines.flatMap((l) => (l.link && !seen.has(l.link.label) && seen.add(l.link.label) ? [{ label: l.link.label, url: l.link.href }] : [])).slice(0, 3);
      return { title: c.title, lines: c.lines.map((l) => l.text), links: ls };
    }
  }
}

function proposalOf(p: AsProposal): Proposal {
  const note = p.preview.notes.join(" ");
  return { id: String(p.id), title: p.clientName ? `${p.title} (${p.clientName})` : p.title, whoSees: p.whoSees, changes: p.preview.rows.map((r) => ({ field: r.label, before: r.before, after: r.after })), note: note || null, expiresAt: p.expiresAt };
}

/**
 * AS-1: the bot's AssistantService on the real assistant (server/assistant.ts's hub, channel "teams"). Ids are numbers
 * in the service and strings here; a DevOps write's undo is in FocusTime's audit log (Settings › Data).
 */
export function teamsAssistant(a: Pick<Assistant, "handle" | "confirm" | "cancel" | "propose"> & Partial<Pick<Assistant, "undo">>, publicUrl: string): AssistantService {
  const base = publicUrl.replace(/\/$/, "");
  const idOf = (s: string) => (/^\d{1,10}$/.test(s) ? Number(s) : 0);
  return {
    async handle(i) {
      const r = await a.handle({ person: i.person, channel: "teams", text: i.text, context: { screen: "teams" }, ...(i.answer ? { answer: i.answer } : {}) });
      const q = r.cards.find((c) => c.kind === "question" || c.kind === "suggest");
      return { turnId: String(r.turnId), status: r.status, reply: r.reply, cards: r.cards.filter((c) => c.kind !== "question" && c.kind !== "suggest").map(cardOf), proposals: r.proposals.map(proposalOf), links: r.links.map((l) => ({ label: l.label, url: l.href })), question: q && (q.kind === "question" || q.kind === "suggest") ? { text: q.text, choices: q.choices, expiresAt: q.expiresAt, ...(q.kind === "suggest" ? { suggest: true } : {}) } : null };
    },
    async confirm(i) {
      const edits = Object.fromEntries(Object.entries(i.edits ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      const r = await a.confirm({ person: i.person, proposalId: idOf(i.proposalId), ...(Object.keys(edits).length ? { edits } : {}) });
      if (r.ok) {
        const shown = cardOf(r.result);
        const undo = r.undo?.kind === "moves" ? { label: "Undo", proposalId: String(r.undo.id) } : r.undo?.kind === "devops" || r.parts?.some((x) => x.undo) ? { label: "Undo in FocusTime", url: `${base}/#/settings/data` } : null;
        return { status: "ok", message: r.message, undo, links: shown.links ?? [], ...(r.parts ? { parts: r.parts.map((x) => ({ label: x.label, ok: x.ok, message: x.message })) } : {}) };
      }
      if (r.reason === "changed" && r.proposal) return { status: "changed", message: r.message, proposal: proposalOf(r.proposal) };
      return { status: r.reason === "changed" ? "gone" : r.reason, message: r.message };
    },
    async cancel(i) {
      await a.cancel({ person: i.person, proposalId: idOf(i.proposalId) });
    },
    async undo(i) {
      if (!a.undo) return { ok: false, message: "Undo it in FocusTime" };
      const r = await a.undo({ person: i.person, proposalId: idOf(i.proposalId) });
      return { ok: r.ok, message: r.message };
    },
    async propose(i) {
      const r = await a.propose({ person: i.person, tool: i.tool, args: i.args });
      return r.ok ? { ok: true, proposal: proposalOf(r.proposal) } : r;
    },
  };
}
