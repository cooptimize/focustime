// PH-2: the phone's Inbox one at a time. "Inbox" and "1 of N" (N what the Inbox counts as needing me, the bar's
// number), the three lists one tap away, then one card (built by the Inbox, ui/inbox/InboxPage.tsx, from the lists'
// own words), its actions as full-width buttons (the main one first, the rest under More), the form an action opened,
// Previous and Next (they move without acting), and Up next. The Inbox runs every action; this file only draws.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PHONE_TEXT } from "../../plan/phone-now.ts";
import { Icon } from "../icons.tsx";

const W = PHONE_TEXT.one;

/** One of the item's own actions, as the Inbox has it (ItemActions' Act, or a suggestion's). */
export type OneAct = { id: string; label: string; primary?: boolean; more?: boolean; href?: string; run: () => void };
export type OneLine = { key: string; client: string; color: string; title: string };

export function InboxOne({ index, count, current, card, acts, form, notice, upNext, lists, onList, onPrev, onNext, onPick, onShown }: {
  index: number;
  count: number;
  current: OneLine;
  /** The card's body, from the Inbox. */
  card: ReactNode;
  acts: readonly OneAct[];
  form: ReactNode;
  /** The Inbox's notice (with Undo) and its error line. */
  notice: ReactNode;
  upNext: readonly OneLine[];
  lists: readonly { id: string; label: string; count: number }[];
  onList: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onPick: (key: string) => void;
  /** The item shown changed (the address follows it). */
  onShown?: (key: string) => void;
}) {
  const [more, setMore] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  // A new item: More folds again, and focus goes to its card's heading (a screen reader hears the next item).
  const first = useRef(true);
  useEffect(() => {
    setMore(false);
    onShown?.(current.key);
    if (first.current) return void (first.current = false);
    head.current?.focus({ preventScroll: true });
  }, [current.key]);
  const main = acts.filter((a) => a.primary);
  const rest = acts.filter((a) => !a.primary);
  const button = (a: OneAct) =>
    a.href ? (
      <a key={a.id} className="io-act" href={a.href} target="_blank" rel="noopener noreferrer" data-act={a.id}>
        {a.label}
      </a>
    ) : (
      <button key={a.id} type="button" className={`io-act${a.primary ? " primary" : ""}`} data-act={a.id} onClick={a.run}>
        {a.label}
      </button>
    );
  return (
    <main className="io" aria-label={W.heading}>
      <header className="io-head">
        <h1 className="io-h">{W.heading}</h1>
        <span className="io-of" aria-live="polite">
          {W.of(index + 1, count)}
        </span>
      </header>
      <nav className="io-lists" aria-label={W.lists}>
        {lists.map((l) => (
          <button key={l.id} type="button" className="io-list" onClick={() => onList(l.id)}>
            {l.label} <span className="io-count">{l.count}</span>
          </button>
        ))}
      </nav>
      {notice}
      <article className={`io-card ${current.key.startsWith("v") ? "suggestion" : "promise"}`} data-key={current.key} style={{ "--c": current.color } as CSSProperties} aria-labelledby="io-title">
        <p className="io-client">
          <span className="swatch" aria-hidden="true" />
          {current.client}
        </p>
        <h2 className="io-title" id="io-title" ref={head} tabIndex={-1}>
          {current.title || "(no title)"}
        </h2>
        {card}
      </article>
      <div className="io-acts" role="group" aria-label={W.actionsFor(current.title)}>
        {main.map(button)}
        {rest.length > 0 && (
          <button type="button" className="io-act io-more" aria-expanded={more} aria-label={W.moreFor(current.title)} onClick={() => setMore((v) => !v)}>
            {W.more} <Icon name={more ? "arrow-up" : "arrow-down"} />
          </button>
        )}
        {more && <div className="io-rest">{rest.map(button)}</div>}
      </div>
      {form}
      <div className="io-step">
        <button type="button" className="io-stepbtn" onClick={onPrev} disabled={index <= 0}>
          <Icon name="back" /> {W.previous}
        </button>
        <button type="button" className="io-stepbtn" onClick={onNext} disabled={index >= count - 1}>
          {W.next} <Icon name="next" />
        </button>
      </div>
      {upNext.length > 0 && (
        <section className="io-next" aria-labelledby="io-next-h">
          <h2 className="section-label" id="io-next-h">
            {W.upNext}
          </h2>
          <ul>
            {upNext.map((l) => (
              <li key={l.key}>
                <button type="button" className="io-nextrow" style={{ "--c": l.color } as CSSProperties} onClick={() => onPick(l.key)}>
                  <span className="swatch" aria-hidden="true" />
                  <span className="io-nextclient">{l.client}</span>
                  <span className="io-nexttitle">{l.title || "(no title)"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** The end: nothing needs me now; the lists follow (the Inbox draws them under this line). */
export function InboxEnd() {
  return (
    <p className="io-end" role="status">
      {W.end}
    </p>
  );
}

/** The lists' way back to the one-at-a-time view, while something needs me. */
export function InboxBack({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="io-back" onClick={onBack} aria-label={W.backLabel}>
      <Icon name="back" /> {W.back}
    </button>
  );
}
