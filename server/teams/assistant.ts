// TB-1: the assistant as the bot sees it (one brain, two front ends: the in-app panel and this bot). TB-3: an answer
// stays the Assistant's own channel-neutral result (cards and links as they are), which server/teams/render.ts draws;
// only ids (strings here, numbers there) and a proposal's shape are adapted for the cards. Nothing in server/teams
// calls an AI provider or an action itself: every message goes to the assistant, and every write is a proposal the
// person confirms.
import type { Assistant, Card as AsCard, Link as AsLink, ProposeInput, Proposal as AsProposal } from "../../assistant/types.ts";
import { cardLinks, toUrl } from "./render.ts";
import type { DoneUndo } from "./cards.ts";

export type AssistantPerson = { userId: string };

/** What the bot knows about where the message came from. Never the message's text (that is `text`). */
export type TeamsContext = { surface: "teams"; conversation: "personal"; locale: string | null; timeZone: string | null };

export type AssistantLink = { label: string; url: string };

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
  /** TB-3: the rest of the preview, as the panel shows it. */
  summary?: string;
  target?: string;
  system?: "DevOps" | "FocusTime";
  identity?: string | null;
  editable?: readonly string[];
  turnId?: number | null;
};

export type HandleStatus = "ok" | "off" | "client_off" | "refused" | "which_client" | (string & {});

/**
 * AS-2: a question with choices (card buttons in Teams). AS-3: an answer's suggested steps come the same way, with
 * `note` saying a tap shows a preview to confirm (`suggest`).
 */
export type Question = { text: string; choices: readonly { label: string; value: string }[]; expiresAt: string; suggest?: boolean; asked?: number };

/** TB-3: the Assistant's result: `cards` and `links` exactly as the panel gets them. */
export type HandleResult = {
  turnId: string;
  status: HandleStatus;
  reply: string;
  cards: readonly AsCard[];
  proposals: readonly Proposal[];
  links: readonly AsLink[];
};

export type ConfirmResult =
  | { status: "ok"; message: string; undo?: DoneUndo | null; links?: readonly AssistantLink[]; parts?: readonly { label: string; ok: boolean; message: string; undo?: DoneUndo }[] }
  | { status: "changed"; message: string; proposal: Proposal }
  | { status: "not_allowed" | "expired" | "gone"; message: string };

export type AssistantService = {
  handle(i: { person: AssistantPerson; channel: "teams"; text: string; context: TeamsContext; answer?: string; asked?: number }): Promise<HandleResult>;
  /** AS-2: a confirmed proposal's moved to-dos, back where they were. */
  undo?(i: { person: AssistantPerson; proposalId: string }): Promise<{ ok: boolean; message: string }>;
  /** TB-3: a fresh preview of a proposal that timed out, or the preview to undo one of its DevOps writes. */
  refresh?(i: { person: AssistantPerson; proposalId: string }): Promise<{ ok: true; proposal: Proposal } | { ok: false; message: string }>;
  undoWrite?(i: { person: AssistantPerson; proposalId: string; writeId: number }): Promise<{ ok: true; proposal: Proposal } | { ok: false; message: string }>;
  confirm(i: { person: AssistantPerson; proposalId: string; edits?: Record<string, unknown> }): Promise<ConfirmResult>;
  cancel(i: { person: AssistantPerson; proposalId: string }): Promise<void>;
  /** TB-2: a proposal a card's button asks for (no AI): FocusTime's plan tools only (assistant/allowlist.ts PROPOSE_TOOLS). */
  propose(i: { person: AssistantPerson; tool: ProposeInput["tool"]; args: Record<string, unknown> }): Promise<{ ok: true; proposal: Proposal } | { ok: false; message: string }>;
};

/** Proposals expire after this long (AS-1); a card past it shows Expired. */
export const PROPOSAL_MINUTES = 15;

/** A proposal as the bot draws it (exported for QT-2's word check). */
export function proposalOf(p: AsProposal): Proposal {
  const note = p.preview.notes.join(" ");
  return { id: String(p.id), title: p.clientName ? `${p.title} (${p.clientName})` : p.title, whoSees: p.whoSees, changes: p.preview.rows.map((r) => ({ field: r.label, before: r.before, after: r.after })), note: note || null, expiresAt: p.expiresAt, summary: p.preview.summary, target: p.preview.target, system: p.preview.system, identity: p.preview.identity, editable: p.editable, turnId: p.turnId ?? null };
}

/**
 * AS-1: the bot's AssistantService on the real assistant (server/assistant.ts's hub, channel "teams"). Ids are numbers
 * in the service and strings here. TB-3: Undo on a result card is the write's own undo, previewed and confirmed there.
 */
export function teamsAssistant(a: Pick<Assistant, "handle" | "confirm" | "cancel" | "propose"> & Partial<Pick<Assistant, "undo" | "refresh" | "undoWrite">>, publicUrl: string): AssistantService {
  const previewed = (r: { ok: true; proposal: AsProposal } | { ok: false; message: string }) => (r.ok ? { ok: true as const, proposal: proposalOf(r.proposal) } : r);
  const idOf = (s: string) => (/^\d{1,10}$/.test(s) ? Number(s) : 0);
  return {
    async handle(i) {
      const r = await a.handle({ person: i.person, channel: "teams", text: i.text, context: { screen: "teams" }, ...(i.answer ? { answer: i.answer } : {}), ...(i.asked !== undefined ? { asked: i.asked } : {}) });
      return { turnId: String(r.turnId), status: r.status, reply: r.reply, cards: r.cards, proposals: r.proposals.map(proposalOf), links: r.links };
    },
    async confirm(i) {
      const edits = Object.fromEntries(Object.entries(i.edits ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      const r = await a.confirm({ person: i.person, proposalId: idOf(i.proposalId), ...(Object.keys(edits).length ? { edits } : {}) });
      if (r.ok) {
        const links = cardLinks(r.result).map((l) => ({ label: l.label, url: toUrl(publicUrl, l.href) }));
        const undo: DoneUndo | null = r.undo?.kind === "moves" ? { label: "Undo", proposalId: String(r.undo.id) } : r.undo?.kind === "plan" ? { label: "Undo", captureId: r.undo.id } : r.undo?.kind === "devops" && !r.parts ? { label: "Undo", proposalId: i.proposalId, writeId: r.undo.id } : null;
        return { status: "ok", message: r.message, undo, links, ...(r.parts ? { parts: r.parts.map((x) => ({ label: x.label, ok: x.ok, message: x.message, ...(x.undo ? { undo: { label: `Undo ${x.label.toLowerCase()}`, proposalId: i.proposalId, writeId: x.undo.id } } : {}) })) } : {}) };
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
    async refresh(i) {
      return a.refresh ? previewed(await a.refresh({ person: i.person, proposalId: idOf(i.proposalId) })) : { ok: false, message: "Ask again for a fresh preview" };
    },
    async undoWrite(i) {
      return a.undoWrite ? previewed(await a.undoWrite({ person: i.person, proposalId: idOf(i.proposalId), writeId: i.writeId })) : { ok: false, message: "Undo it in FocusTime" };
    },
    async propose(i) {
      const r = await a.propose({ person: i.person, tool: i.tool, args: i.args });
      return r.ok ? { ok: true, proposal: proposalOf(r.proposal) } : r;
    },
  };
}
