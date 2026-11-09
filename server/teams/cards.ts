// TB-1: the bot's Adaptive Cards (schema 1.5, what Teams needs for Action.Execute). Pure: plain JSON from the
// assistant's results. A result card has a title, lines and links into the app. A proposal card is the usual preview
// (who sees it, each field before and after) with Confirm and Cancel; a tap is an adaptiveCard/action invoke with the
// verb and the proposal id, and the card is replaced by its outcome (Done, Couldn't do it, Expired, Cancelled, or a
// new preview when things changed). Each Action.Execute falls back to Action.Submit for older clients.
// AS-2: a question card has one button per choice (verb "answer"; a tap answers it once, as if I'd typed the choice),
// and a done card for moved to-dos has Undo (verb "undo", the same assistant.undo as the panel's).
import type { AssistantLink, Proposal, Question } from "./assistant.ts";

export type Card = { type: "AdaptiveCard"; $schema: string; version: "1.5"; body: unknown[]; actions?: unknown[] };
export const CARD_TYPE = "application/vnd.microsoft.card.adaptive";
export type Verb = "confirm" | "cancel" | "undo" | "refresh";
/** What a tap sends back: the verb and the proposal (TB-3: which DevOps write, for its Undo). Nothing else is trusted from it. */
export type TapData = { ft: Verb; proposalId: string; writeId?: number };
/** AS-2: a choice's tap: the question's card id, the choice's value and its label (what I "said"). */
export type AnswerTap = { ft: "answer"; questionId: string; value: string; label: string; asked?: number };

export const card = (body: unknown[], actions?: unknown[]): Card => ({ type: "AdaptiveCard", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", version: "1.5", body, ...(actions?.length ? { actions } : {}) });
export const text = (t: string, o: Record<string, unknown> = {}) => ({ type: "TextBlock", text: t, wrap: true, ...o });
export const title = (t: string) => text(t, { weight: "Bolder", size: "Medium" });
export const muted = (t: string) => text(t, { isSubtle: true, size: "Small", spacing: "Small" });
export const openUrl = (l: AssistantLink) => ({ type: "Action.OpenUrl", title: l.label, url: l.url });
const small = (t: string) => text(t, { spacing: "Small" });
/** Where a done card's Undo goes: a link, this proposal's moves or one of its DevOps writes (TB-3), or a capture (TB-2's own tap). */
export type DoneUndo = { label: string; url?: string; proposalId?: string; writeId?: number; captureId?: number };
const captureUndo = (label: string, captureId: number) => {
  const data = { ft: "capture_undo", captureId };
  return { type: "Action.Execute", title: label, verb: "capture_undo", data, fallback: { type: "Action.Submit", title: label, data } };
};
/** TB-3: outside FocusTime a card links only to a DevOps item or a standards article (what the panel opens too). */
const OUTSIDE = /^(dev\.azure\.com|[a-z0-9-]+\.visualstudio\.com|github\.com)$/i;
/** Links must be FocusTime's own pages (absolute, on the public URL), DevOps or the standards repo; anything else is dropped. */
export const safeLinks = (links: readonly AssistantLink[] | undefined, publicUrl: string): AssistantLink[] => {
  const origin = new URL(publicUrl).origin;
  return (links ?? []).filter((l) => {
    try {
      const u = new URL(l.url);
      return (u.origin === origin || (u.protocol === "https:" && OUTSIDE.test(u.hostname))) && l.label.trim().length > 0;
    } catch {
      return false;
    }
  }).slice(0, 6);
};

const tap = (verb: Verb, label: string, proposalId: string, style?: "positive", writeId?: number) => {
  const data: TapData = { ft: verb, proposalId, ...(writeId !== undefined ? { writeId } : {}) };
  return { type: "Action.Execute", title: label, verb, data, ...(style ? { style } : {}), fallback: { type: "Action.Submit", title: label, data } };
};
export const shown = (v: string | null) => (v === null || v === "" ? "(none)" : v);

export const MAX_PREVIEW_ROWS = 20;
/** Characters of before and after a preview shows; the card has to stay under Teams' size limit. */
export const MAX_PREVIEW_CHARS = 12_000;
const LONG = 120;

/**
 * The preview with Confirm and Cancel, as the panel shows it: what, where, who it writes as, who sees it, each field's
 * before and after, and any notes. `again`: things changed since the last preview, so it says so first. A DevOps change
 * that can't be shown in full has no Confirm here (a description's rule: the whole before and after, always seen first);
 * it opens in FocusTime, on the same proposal. A long list of FocusTime moves keeps Confirm and says how many more.
 */
export function proposalCard(p: Proposal, o: { again?: string | null; publicUrl?: string } = {}): Card {
  const body: unknown[] = [];
  if (o.again) body.push(text(o.again, { color: "Warning" }));
  body.push(title(p.title));
  if (p.summary || p.target) body.push(muted([p.summary, p.target].filter(Boolean).join(": ")));
  if (p.identity) body.push(muted(`Writes as ${p.identity}`));
  body.push(muted(`Who sees it: ${p.whoSees}`));
  let left = MAX_PREVIEW_CHARS;
  let cut = false;
  const fit = (v: string | null) => {
    const t = shown(v);
    if (t.length <= left) return (left -= t.length), t;
    cut = true;
    const part = t.slice(0, Math.max(0, left));
    left = 0;
    return `${part}…`;
  };
  const rows = p.changes.slice(0, MAX_PREVIEW_ROWS);
  const more = p.changes.length - rows.length;
  const isLong = (c: Proposal["changes"][number]) => (c.before?.length ?? 0) > LONG || (c.after?.length ?? 0) > LONG || /\n/.test(`${c.before ?? ""}${c.after ?? ""}`);
  const short = rows.filter((c) => !isLong(c));
  if (short.length) body.push({ type: "FactSet", facts: short.map((c) => ({ title: c.field, value: `${fit(c.before)} → ${fit(c.after)}` })) });
  for (const c of rows.filter(isLong)) {
    body.push(text(c.field, { weight: "Bolder", spacing: "Small" }));
    if (c.before !== null) body.push(muted("Before"), small(fit(c.before)));
    body.push(muted("After"), small(fit(c.after)));
  }
  if (p.note) body.push(muted(p.note));
  const deep = o.publicUrl && p.turnId ? `${o.publicUrl.replace(/\/+$/, "")}/#/ask/${p.turnId}` : null;
  const whole = !cut && more === 0;
  const external = p.system === "DevOps";
  if (more) body.push(muted(`And ${more} more. Open in FocusTime to see them all.`));
  if (cut) body.push(text(external ? "This is too long to show in full here. Read it and confirm in FocusTime." : "This is too long to show in full here.", { color: "Warning", spacing: "Small" }));
  const canConfirm = whole || !external;
  if (canConfirm) body.push(muted("Nothing changes until you confirm. This expires in 15 minutes."));
  const links = deep ? [...(whole ? [] : [{ label: "Open in FocusTime", url: deep }]), ...(p.editable?.length ? [{ label: "Edit in FocusTime", url: deep }] : [])] : [];
  return card(body, [...(canConfirm ? [tap("confirm", "Confirm", p.id, "positive")] : []), tap("cancel", "Cancel", p.id), ...links.map(openUrl)]);
}

export function doneCard(p: { title: string; message: string; undo?: DoneUndo | null; links?: readonly AssistantLink[]; parts?: readonly { label: string; ok: boolean; message: string; undo?: DoneUndo }[] }, publicUrl: string): Card {
  const links = safeLinks([...(p.undo?.url ? [{ label: p.undo.label, url: p.undo.url }] : []), ...(p.links ?? [])], publicUrl);
  const parts = (p.parts ?? []).map((x) => text(`${x.ok ? "✓" : "✗"} ${x.label}: ${x.message}`, { spacing: "Small", ...(x.ok ? {} : { color: "Attention" }) }));
  const undoOf = (u: DoneUndo | null | undefined): unknown[] => (u?.proposalId ? [tap("undo", u.label, u.proposalId, undefined, u.writeId)] : u?.captureId !== undefined ? [captureUndo(u.label, u.captureId)] : []);
  const undo: unknown[] = [...undoOf(p.undo), ...(p.parts ?? []).flatMap((x) => undoOf(x.undo))];
  // AS-2: a compound update with a part that didn't go says so in its title; each part has its own line.
  const partly = (p.parts ?? []).some((x) => !x.ok);
  return card([text(`${partly ? "Partly done" : "Done"}: ${p.title}`, { weight: "Bolder", color: partly ? "Warning" : "Good" }), ...(parts.length ? parts : [text(p.message, { spacing: "Small" })])], [...undo, ...links.map(openUrl)]);
}

/** AS-2: the assistant's question, one button per choice (at most 6), and "or just type it". */
export function questionCard(q: Question, questionId: string): Card {
  const actions = q.choices.slice(0, 6).map((c) => {
    const data: AnswerTap = { ft: "answer", questionId, value: c.value, label: c.label.slice(0, 200), ...(q.asked !== undefined ? { asked: q.asked } : {}) };
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
  if (d.asked !== undefined && (typeof d.asked !== "number" || !Number.isInteger(d.asked) || d.asked <= 0)) return null;
  return { ft: "answer", questionId: d.questionId, value: d.value, label: d.label, ...(d.asked !== undefined ? { asked: d.asked } : {}) };
}
export const failedCard = (title: string, reason: string): Card => card([text(`Couldn't do it: ${title}`, { weight: "Bolder", color: "Attention" }), text(reason, { spacing: "Small" })]);
/** TB-3: `proposalId` adds Refresh: a new preview from what's there now. Nothing acts on the old one. */
export const expiredCard = (title: string, proposalId?: string): Card => card([text(`Expired: ${title}`, { weight: "Bolder", isSubtle: true }), muted(proposalId ? "Nothing changed. Refresh for a new preview from what's there now." : "Nothing changed. Ask again for a fresh preview.")], proposalId ? [tap("refresh", "Refresh", proposalId)] : undefined);
export const timedOutCard = (q: string): Card => card([text(q, { isSubtle: true }), muted("That timed out, so FocusTime looks again and asks from what's there now.")]);
export const cancelledCard = (title: string): Card => card([text(`Cancelled: ${title}`, { weight: "Bolder", isSubtle: true }), muted("Nothing changed.")]);
export const workingCard = (title: string): Card => card([text(title, { weight: "Bolder" }), muted("Working on it…")]);

/** A card attachment for an activity. */
export const attach = (c: Card) => ({ contentType: CARD_TYPE, content: c });

/** The tap's data, when it is one of ours. */
export function tapOf(value: unknown): TapData | null {
  const v = value as { action?: { verb?: unknown; data?: unknown }; ft?: unknown; proposalId?: unknown } | null;
  const d = (v && typeof v === "object" && v.action && typeof v.action === "object" ? v.action.data : v) as { ft?: unknown; proposalId?: unknown } | null;
  const verb = v?.action?.verb ?? d?.ft;
  if (!d || (verb !== "confirm" && verb !== "cancel" && verb !== "undo" && verb !== "refresh")) return null;
  if (typeof d.proposalId !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(d.proposalId)) return null;
  const w = (d as { writeId?: unknown }).writeId;
  if (w !== undefined && (typeof w !== "number" || !Number.isInteger(w) || w <= 0)) return null;
  return { ft: verb, proposalId: d.proposalId, ...(typeof w === "number" ? { writeId: w } : {}) };
}
