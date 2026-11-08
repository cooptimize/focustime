// TB-1: the bot's Adaptive Cards (schema 1.5, what Teams needs for Action.Execute). Pure: plain JSON from the
// assistant's results. A result card has a title, lines and links into the app. A proposal card is the usual preview
// (who sees it, each field before and after) with Confirm and Cancel; a tap is an adaptiveCard/action invoke with the
// verb and the proposal id, and the card is replaced by its outcome (Done, Couldn't do it, Expired, Cancelled, or a
// new preview when things changed). Each Action.Execute falls back to Action.Submit for older clients.
// AS-2: a question card has one button per choice (verb "answer"; a tap answers it once, as if I'd typed the choice),
// and a done card for moved to-dos has Undo (verb "undo", the same assistant.undo as the panel's).
import type { AssistantCard, AssistantLink, Proposal, Question } from "./assistant.ts";

export type Card = { type: "AdaptiveCard"; $schema: string; version: "1.5"; body: unknown[]; actions?: unknown[] };
export const CARD_TYPE = "application/vnd.microsoft.card.adaptive";
export type Verb = "confirm" | "cancel" | "undo";
/** What a tap sends back: the verb and the proposal. Nothing else is trusted from it. */
export type TapData = { ft: Verb; proposalId: string };
/** AS-2: a choice's tap: the question's card id, the choice's value and its label (what I "said"). */
export type AnswerTap = { ft: "answer"; questionId: string; value: string; label: string };

export const card = (body: unknown[], actions?: unknown[]): Card => ({ type: "AdaptiveCard", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", version: "1.5", body, ...(actions?.length ? { actions } : {}) });
export const text = (t: string, o: Record<string, unknown> = {}) => ({ type: "TextBlock", text: t, wrap: true, ...o });
export const title = (t: string) => text(t, { weight: "Bolder", size: "Medium" });
export const muted = (t: string) => text(t, { isSubtle: true, size: "Small", spacing: "Small" });
export const openUrl = (l: AssistantLink) => ({ type: "Action.OpenUrl", title: l.label, url: l.url });
/** Links must be FocusTime's own pages (absolute, on the public URL); anything else is dropped. */
export const ownLinks = (links: readonly AssistantLink[] | undefined, publicUrl: string): AssistantLink[] => {
  const origin = new URL(publicUrl).origin;
  return (links ?? []).filter((l) => {
    try {
      return new URL(l.url).origin === origin && l.label.trim().length > 0;
    } catch {
      return false;
    }
  }).slice(0, 4);
};

export function resultCard(c: AssistantCard, publicUrl: string): Card {
  return card([title(c.title), ...(c.lines ?? []).slice(0, 12).map((l) => text(l, { spacing: "Small" }))], ownLinks(c.links, publicUrl).map(openUrl));
}

const tap = (verb: Verb, label: string, proposalId: string, style?: "positive") => {
  const data: TapData = { ft: verb, proposalId };
  return { type: "Action.Execute", title: label, verb, data, ...(style ? { style } : {}), fallback: { type: "Action.Submit", title: label, data } };
};
export const shown = (v: string | null) => (v === null || v === "" ? "(none)" : v);

/** The preview with Confirm and Cancel. `again`: things changed since the last preview, so it says so first. */
export function proposalCard(p: Proposal, o: { again?: string | null } = {}): Card {
  const body: unknown[] = [];
  if (o.again) body.push(text(o.again, { color: "Warning" }));
  body.push(title(p.title));
  body.push(muted(`Who sees it: ${p.whoSees}`));
  if (p.changes.length)
    body.push({ type: "FactSet", facts: p.changes.slice(0, 10).map((c) => ({ title: c.field, value: `${shown(c.before)} → ${shown(c.after)}` })) });
  if (p.note) body.push(muted(p.note));
  body.push(muted("Nothing changes until you confirm. This expires in 15 minutes."));
  return card(body, [tap("confirm", "Confirm", p.id, "positive"), tap("cancel", "Cancel", p.id)]);
}

export function doneCard(p: { title: string; message: string; undo?: { label: string; url?: string; proposalId?: string } | null; links?: readonly AssistantLink[]; parts?: readonly { label: string; ok: boolean; message: string }[] }, publicUrl: string): Card {
  const links = ownLinks([...(p.undo?.url ? [{ label: p.undo.label, url: p.undo.url }] : []), ...(p.links ?? [])], publicUrl);
  const parts = (p.parts ?? []).map((x) => text(`${x.ok ? "✓" : "✗"} ${x.label}: ${x.message}`, { spacing: "Small", ...(x.ok ? {} : { color: "Attention" }) }));
  const undo = p.undo?.proposalId ? [tap("undo", p.undo.label, p.undo.proposalId)] : [];
  // AS-2: a compound update with a part that didn't go says so in its title; each part has its own line.
  const partly = (p.parts ?? []).some((x) => !x.ok);
  return card([text(`${partly ? "Partly done" : "Done"}: ${p.title}`, { weight: "Bolder", color: partly ? "Warning" : "Good" }), ...(parts.length ? parts : [text(p.message, { spacing: "Small" })])], [...undo, ...links.map(openUrl)]);
}

/** AS-2: the assistant's question, one button per choice (at most 6), and "or just type it". */
export function questionCard(q: Question, questionId: string): Card {
  const actions = q.choices.slice(0, 6).map((c) => {
    const data: AnswerTap = { ft: "answer", questionId, value: c.value, label: c.label.slice(0, 200) };
    return { type: "Action.Execute", title: c.label.slice(0, 80), verb: "answer", data, fallback: { type: "Action.Submit", title: c.label.slice(0, 80), data } };
  });
  // One ActionSet per choice, so long choices stack instead of running off the card's edge.
  // AS-3: a suggested step shows its preview first; nothing changes until Confirm.
  const hint = q.suggest ? "Tap one to see it. A change shows a preview first; nothing changes until you Confirm." : "Tap one, or just type it. This waits 10 minutes.";
  return card([text(q.text, { weight: "Bolder" }), muted(hint), ...actions.map((x) => ({ type: "ActionSet", actions: [x], spacing: "Small" }))]);
}
export const answeredCard = (q: string, label: string): Card => card([text(q, { isSubtle: true }), text(`You chose: ${label}`, { weight: "Bolder" })]);
export const undoneCard = (title: string, message: string): Card => card([text(`Undone: ${title}`, { weight: "Bolder" }), text(message, { spacing: "Small" })]);

/** AS-2: a choice's tap, when it is one of ours. */
export function answerOf(value: unknown): AnswerTap | null {
  const v = value as { action?: { verb?: unknown; data?: unknown } } | null;
  const d = (v && typeof v === "object" && v.action && typeof v.action === "object" ? v.action.data : v) as Partial<AnswerTap> | null;
  const verb = v?.action?.verb ?? d?.ft;
  if (!d || verb !== "answer") return null;
  if (typeof d.questionId !== "string" || !/^q[0-9]{1,12}$/.test(d.questionId)) return null;
  if (typeof d.value !== "string" || !/^[a-z0-9]{1,12}$/.test(d.value) || typeof d.label !== "string" || d.label.length > 200) return null;
  return { ft: "answer", questionId: d.questionId, value: d.value, label: d.label };
}
export const failedCard = (title: string, reason: string): Card => card([text(`Couldn't do it: ${title}`, { weight: "Bolder", color: "Attention" }), text(reason, { spacing: "Small" })]);
export const expiredCard = (title: string): Card => card([text(`Expired: ${title}`, { weight: "Bolder", isSubtle: true }), muted("Nothing changed. Ask again for a fresh preview.")]);
export const cancelledCard = (title: string): Card => card([text(`Cancelled: ${title}`, { weight: "Bolder", isSubtle: true }), muted("Nothing changed.")]);
export const workingCard = (title: string): Card => card([text(title, { weight: "Bolder" }), muted("Working on it…")]);

export function helpCard(publicUrl: string): Card {
  return card(
    [
      title("FocusTime in Teams"),
      text("Ask me about your day or week in your own words. Anything that changes something shows a preview first, and nothing happens until you confirm."),
      { type: "FactSet", facts: [
        { title: "what's next", value: "Your next to-do and meeting" },
        { title: "today", value: "Today's blocks and to-dos" },
        { title: "open FocusTime", value: "A link to the app" },
        { title: "help", value: "This list" },
      ] },
    ],
    [openUrl({ label: "Open FocusTime", url: publicUrl })],
  );
}

/** A card attachment for an activity. */
export const attach = (c: Card) => ({ contentType: CARD_TYPE, content: c });

/** The tap's data, when it is one of ours. */
export function tapOf(value: unknown): TapData | null {
  const v = value as { action?: { verb?: unknown; data?: unknown }; ft?: unknown; proposalId?: unknown } | null;
  const d = (v && typeof v === "object" && v.action && typeof v.action === "object" ? v.action.data : v) as { ft?: unknown; proposalId?: unknown } | null;
  const verb = v?.action?.verb ?? d?.ft;
  if (!d || (verb !== "confirm" && verb !== "cancel" && verb !== "undo")) return null;
  if (typeof d.proposalId !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(d.proposalId)) return null;
  return { ft: verb, proposalId: d.proposalId };
}
