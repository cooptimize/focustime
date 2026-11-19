// MC-5: one proposal on a call's page. Folded, three lines: the tick, its title, its main button (Create, Keep or Add
// comment), Skip and the chevron; then its fields in one line; then the words it came from on one line (a click opens
// the Transcript at that line). Open (the chevron, a click on line 2, or by itself when DevOps needs an empty field or
// refused it): the title is a box and the fields sit in a grid, with Description and size, and for a feature Create and
// break down. What a proposal writes, and that every DevOps write goes through the one preview, is unchanged.
import { useEffect, useState } from "react";
import { isFeatureTier } from "../../plan/needed.ts";
import { CALL_ROW, PAGE_TEXT, type ProposalCheck } from "../../plan/call-words.ts";
import { proposalWords, toReview, type Proposal } from "../../plan/meetings.ts";
import { BreakDownButton } from "../BreakDownPanel.tsx";
import { Icon } from "../icons.tsx";
import { TextBox } from "../TextBox.tsx";
import { GapFields, type useNewOptions } from "./GapFields.tsx";

const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Line 2: a new item's level, parent, assignee and date; a promise's whose and by when; a comment's story. */
export function fieldsLine(p: Proposal): string {
  const b = p.body;
  if (b.kind === "gap") {
    const who = b.assignTo === undefined || b.assignTo === "me" ? PAGE_TEXT.me : b.assignTo ? b.assignTo : PAGE_TEXT.nobody;
    return [b.type, b.parentId !== null ? PAGE_TEXT.under(b.parentId, b.parentTitle ?? null) : PAGE_TEXT.noParent, who, b.date ? dayLabel(b.date) : PAGE_TEXT.noDate].join(" · ");
  }
  if (b.kind === "commitment")
    return [`${b.side === "unknown" ? CALL_ROW.noOwner : b.who}${b.toName ? ` to ${b.toName}` : ""}`, b.due ? PAGE_TEXT.by(dayLabel(b.due)) : PAGE_TEXT.noDate, b.side === "cooptimize" ? `in ${b.who.split(/\s+/)[0]}'s Promises` : b.side === "client" ? "in your Waiting on" : null].filter(Boolean).join(" · ");
  return PAGE_TEXT.on(b.itemId, b.itemTitle);
}

export type ProposalProps = {
  p: Proposal;
  check: ProposalCheck | undefined;
  err: string | null;
  ticked: boolean;
  editable: boolean;
  can: boolean;
  busy: boolean;
  clientKey: string;
  opts: ReturnType<typeof useNewOptions>;
  today: string;
  open: boolean;
  onOpen: (on: boolean) => void;
  onTick: (on: boolean) => void;
  onEdit: (patch: Record<string, unknown>) => void;
  onSend: () => void;
  onSendBreakDown?: () => void;
  onKeep: () => void;
  onSkip: (on: boolean) => void;
  onEnable: () => void;
  /** The Transcript view at a line (while the transcript is kept). */
  onQuote?: ((line: number) => void) | undefined;
};

export function ProposalRow({ p, check, err, ticked, editable, can, busy, clientKey, opts, today, open, onOpen, onTick, onEdit, onSend, onSendBreakDown, onKeep, onSkip, onEnable, onQuote }: ProposalProps) {
  const b = p.body;
  // RQ-1: a new item at the feature tier (the lowest portfolio level of the client's process, never a type's name).
  const featureTier = b.kind === "gap" && isFeatureTier(opts?.levels, b.type);
  const live = toReview(p);
  const main = proposalWords(b);
  const [text, setText] = useState(main);
  useEffect(() => setText(main), [main]);
  const field = b.kind === "gap" ? "title" : b.kind === "commitment" ? "what" : "text";
  const save = () => text.trim() && text.trim() !== main && onEdit({ [field]: text.trim() });
  const needs = check?.needs ?? [];
  const blocked = check?.blocked ?? null;
  const stuck = needs.length > 0 || !!check?.cant || !!blocked;
  const failed = p.state === "failed";
  const state = p.state === "confirmed" ? (p.result?.message ?? (b.kind === "commitment" ? (b.side === "cooptimize" ? "Added to Promises" : "Noted with this call") : "Done")) : p.state === "skipped" ? "Skipped" : null;
  const mainLabel = b.kind === "commitment" ? PAGE_TEXT.keep : failed ? CALL_ROW.tryAgain : b.kind === "gap" ? PAGE_TEXT.create : PAGE_TEXT.comment;
  const q = p.quotes?.[0] ?? null;
  const editing = open && editable && live;
  const body = `mtg-body-${p.id}`;
  return (
    <article id={`mtg-prop-${p.id}`} tabIndex={-1} className={`mtg-prop mc5 ${p.state}${ticked ? " ticked" : ""}${stuck ? " stuck" : ""}${open ? " is-open" : ""}`} aria-label={main} data-prop={p.id}>
      <div className="mtg-p1">
        <label className="mtg-tick">
          {editable && live && !blocked && <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Select: ${main}`} />}
        </label>
        {editing ? (
          b.kind === "comment" ? <TextBox minRows={2} maxRows={8} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Comment" /> : <input className="mtg-title-box" value={text} maxLength={b.kind === "gap" ? 255 : 200} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label={b.kind === "gap" ? "Title" : "What"} />
        ) : (
          <p className="mtg-main" title={main}>{main}</p>
        )}
        {editable && (
          <span className="mtg-prop-actions">
            {live && !blocked && (b.kind === "commitment" ? (
              <button type="button" className="mini primary" disabled={busy} onClick={onKeep}>{mainLabel}</button>
            ) : can ? (
              <button type="button" className="mini primary" disabled={busy || stuck} aria-describedby={needs.length ? `mtg-need-${p.id}` : undefined} title={stuck ? "Fill in what's needed first" : "Opens the DevOps preview; nothing is written until you confirm it"} onClick={onSend}>{mainLabel}</button>
            ) : (
              <button type="button" className="mini quiet dw-enable" onClick={onEnable} title="DevOps is read-only for this client until you add your own write PAT in Settings › Connections › DevOps">Enable DevOps writes</button>
            ))}
            {live && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(true)}>{CALL_ROW.skip}</button>}
            {p.state === "skipped" && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(false)}>{CALL_ROW.bringBack}</button>}
            {/* RQ-1: a feature created from this call can be broken down from its row. */}
            {p.state === "confirmed" && featureTier && b.kind === "gap" && p.result?.itemId ? <BreakDownButton clientKey={clientKey} item={{ id: p.result.itemId, title: b.title, type: b.type }} short /> : null}
          </span>
        )}
        <button type="button" className="mini quiet icon-only mtg-chev" aria-expanded={open} aria-controls={body} aria-label={`${PAGE_TEXT.details}: ${main}`} title={PAGE_TEXT.details} onClick={() => onOpen(!open)} data-prop-open="">
          <Icon name={open ? "up" : "next"} />
        </button>
      </div>
      {!open && (
        <button type="button" className="mtg-p2" onClick={() => onOpen(true)} aria-label={`${PAGE_TEXT.details}: ${fieldsLine(p)}`}>
          {fieldsLine(p)}
        </button>
      )}
      {q ? (
        <button type="button" className="mtg-p3" disabled={!onQuote} onClick={() => onQuote?.(q.n)} aria-label={PAGE_TEXT.openQuote(q.speaker)} title={q.text}>
          <span className="mtg-who">{q.speaker}</span>
          {q.at && <span className="mtg-at">{q.at}</span>}
          <span className="mtg-said">{q.text}</span>
        </button>
      ) : p.quotes === null ? (
        <p className="mtg-p3 gone">{PAGE_TEXT.quoteGone}</p>
      ) : null}
      {open && (
        <div className="mtg-open" id={body}>
          {b.kind === "gap" ? (
            <GapFields b={b} id={p.id} clientKey={clientKey} opts={opts} today={today} editable={editable && live} check={check} onEdit={onEdit} />
          ) : (
            <p className="muted mtg-where">{fieldsLine(p)}</p>
          )}
          {live && editable && can && featureTier && onSendBreakDown && !failed && !blocked && (
            <button type="button" className="mini mtg-breakdown" disabled={busy || stuck} title={stuck ? "Fill in what's needed first" : CALL_ROW.createAndBreakDownWhy} onClick={onSendBreakDown}>{CALL_ROW.createAndBreakDown}</button>
          )}
          {p.quotes && p.quotes.length > 1 && (
            <div className="mtg-quotes">
              {p.quotes.slice(1).map((x) => (
                <button key={x.n} type="button" className="mtg-p3" disabled={!onQuote} onClick={() => onQuote?.(x.n)} aria-label={PAGE_TEXT.openQuote(x.speaker)} title={x.text}>
                  <span className="mtg-who">{x.speaker}</span>
                  {x.at && <span className="mtg-at">{x.at}</span>}
                  <span className="mtg-said">{x.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {live && needs.length > 0 && <p id={`mtg-need-${p.id}`} className={open && b.kind === "gap" ? "sr-only" : "mtg-need"} role="status">{CALL_ROW.needs(needs.map((n) => n.name), b.kind === "gap" ? b.type : null)}</p>}
      {live && check?.cant && <p className="mtg-need" role="status">{check.cant}</p>}
      {live && blocked && <p className="mtg-need" role="note">{blocked}</p>}
      {"namesRemoved" in b && b.namesRemoved && <p className="names-removed">Another client's name was removed: "another client" is written instead.</p>}
      {failed && p.result?.message && <p className="mtg-state-line problem" role="alert">{p.result.message}</p>}
      {err && <p className="mtg-state-line problem" role="alert">{err}</p>}
      {state && <p className="mtg-state-line">{state}</p>}
    </article>
  );
}

/** MC-5: a proposal opens by itself when DevOps needs an empty field (RQ-1), the form can't fill one, or a write was refused or failed. */
export const opensItself = (p: Proposal, check: ProposalCheck | undefined, err: string | null) => toReview(p) && (!!check?.needs?.length || !!check?.cant || !!err || p.state === "failed");
