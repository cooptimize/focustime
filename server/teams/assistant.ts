// TB-1: the assistant service as AS-1 proposed it (one brain, two front ends: the in-app panel and this bot). The bot
// codes against exactly this shape; when AS-1 merges, these types come from its module and this file goes, and if its
// final types differ the bot adapts to them. Nothing in server/teams calls an AI provider or an action itself: reads
// are answered by the assistant (or a quick command), and every write is a proposal the person confirms.

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

export type HandleResult = {
  turnId: string;
  status: HandleStatus;
  reply: string;
  cards: readonly AssistantCard[];
  proposals: readonly Proposal[];
  links: readonly AssistantLink[];
};

export type ConfirmResult =
  | { status: "ok"; message: string; undo?: { label: string; url?: string } | null; links?: readonly AssistantLink[] }
  | { status: "changed"; message: string; proposal: Proposal }
  | { status: "not_allowed" | "expired" | "gone"; message: string };

export type AssistantService = {
  handle(i: { person: AssistantPerson; channel: "teams"; text: string; context: TeamsContext }): Promise<HandleResult>;
  confirm(i: { person: AssistantPerson; proposalId: string; edits?: Record<string, unknown> }): Promise<ConfirmResult>;
  cancel(i: { person: AssistantPerson; proposalId: string }): Promise<void>;
};

/** Proposals expire after this long (AS-1); a card past it shows Expired. */
export const PROPOSAL_MINUTES = 15;
