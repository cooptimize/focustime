// FN-1: the story card. A work item's title anywhere in FocusTime opens this modal (#/item/<client>/<id>) instead of
// DevOps: its fields, parent and epic and children (each opens its own card), the description and acceptance criteria
// (sanitized on the server), the latest comments, and what FocusTime knows (my to-dos, timeboxes and promises on it).
// Every change goes through the write framework (preview, confirm, read back, audit log, undo): Wrap it up, Add
// comment, Change state, Assign and Dates (Ahead's change set, one fields write). The footer only copies the DevOps
// link; nothing here opens DevOps. A client the person can't see shows "no access" and reads nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { COMMENTS_SHOWN, stateTone, type CardLink, type ItemCard } from "../plan/item-card.ts";
import type { AssignPerson } from "../plan/ahead-people.ts";
import { isRemoved } from "../plan/process.ts";
import { call } from "./api.ts";
import { openBreakDown } from "./menu.ts";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { useDevOpsChanged } from "./DevOpsFresh.tsx";
import { TextBox } from "./TextBox.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { CARD_STALE_EVENT, copyWorkLink, openItemCard, type ItemCardTarget } from "./WorkLink.tsx";

type Read = { access: false; message: string } | { access: true; card: ItemCard };
type Edit = null | "comment" | "state" | "assign" | "dates";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const dayText = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "None");
const whenText = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
};
const lastPart = (path: string | null) => (path ? (path.split("\\").pop() ?? path) : "None");
const durText = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);

export function StoryCard({ clientKey, itemId, onClose, onWrapUp }: { clientKey: string; itemId: number; onClose: () => void; onWrapUp: (clientKey: string, itemId: number) => void }) {
  useReturnFocus();
  const writes = useDevOpsWrite();
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allComments, setAllComments] = useState(false);
  const [edit, setEdit] = useState<Edit>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const load = useCallback(
    async (fresh: boolean) => {
      try {
        const r = await call<Read>("item.card", { clientKey, itemId, ...(fresh ? { fresh: true } : {}) });
        setRead(r);
        setError(null);
      } catch (e) {
        setError(errText(e));
      }
    },
    [clientKey, itemId],
  );
  useEffect(() => {
    setRead(null);
    setError(null);
    setAllComments(false);
    setEdit(null);
    void load(false);
  }, [load]);
  useEffect(() => head.current?.focus(), [clientKey, itemId]);
  // DV-2: the item changed in DevOps (its client's version moved): read it again, quietly; an open edit stays.
  // The card reads its item, comments and children from DevOps: a move rereads at most once a minute.
  useDevOpsChanged([clientKey], () => void load(false), { gapMs: 60_000 });
  // Wrap it up wrote this item: read it again.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ItemCardTarget>).detail;
      if (d.clientKey === clientKey && d.itemId === itemId) void load(true);
    };
    window.addEventListener(CARD_STALE_EVENT, on);
    return () => window.removeEventListener(CARD_STALE_EVENT, on);
  }, [clientKey, itemId, load]);
  const card = read?.access ? read.card : null;
  /** A change through the write framework; the card reads DevOps again once it settles. */
  const write = (changes: Parameters<NonNullable<typeof writes>["begin"]>[1], after?: (confirmed: boolean) => void) => {
    if (!writes) return;
    void writes.begin(clientKey, changes, (r) => {
      after?.(r.confirmed);
      if (r.confirmed) {
        setEdit(null);
        void load(true);
      }
    });
  };
  const comments = card ? (allComments ? card.comments : card.comments.slice(0, COMMENTS_SHOWN)) : [];
  return (
    <div className="cap-backdrop sc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cap-dialog story-card"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.stopPropagation();
            e.preventDefault();
            if (edit) setEdit(null);
            else onClose();
          }
        }}
      >
        <div className="cap-dialog-head sc-head">
          <h2 id="sc-title" tabIndex={-1} ref={head}>
            {card ? (
              <>
                <TypeIcon clientKey={clientKey} type={card.type} decorative /> <span className="sc-id">#{card.id}</span> {card.title}
              </>
            ) : (
              `#${itemId}`
            )}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        {error ? (
          <p className="sc-note" role="alert">
            {error}{" "}
            <button type="button" className="mini" onClick={() => void load(true)}>
              Try again
            </button>
          </p>
        ) : !read ? (
          <p className="muted sc-note" role="status">
            Reading #{itemId}…
          </p>
        ) : !read.access ? (
          <p className="sc-note">{read.message}</p>
        ) : (
          card && (
            <>
              <div className="sc-facts">
                <span className={`sc-state tone-${stateTone(card.stateCategory)}`}>{card.state}</span>
                <span>{card.type}</span>
                <span>{card.clientName}</span>
                <span>{card.assignee ? `Assigned to ${card.assignee}` : "Unassigned"}</span>
              </div>
              <dl className="sc-fields">
                <dt>Iteration</dt>
                <dd title={card.iteration ?? undefined}>{lastPart(card.iteration)}</dd>
                <dt>Area</dt>
                <dd title={card.area ?? undefined}>{lastPart(card.area)}</dd>
                {card.size && (
                  <>
                    <dt>{card.size.label}</dt>
                    <dd>{card.size.value ?? "None"}</dd>
                  </>
                )}
                {card.hasRemainingWork && (
                  <>
                    <dt>Remaining Work</dt>
                    <dd>{card.remainingWork !== null ? `${card.remainingWork}h` : "None"}</dd>
                  </>
                )}
                <dt>Start</dt>
                <dd>{dayText(card.start)}</dd>
                <dt>Target</dt>
                <dd>{dayText(card.target)}</dd>
              </dl>
              {(card.grandparent || card.parent) && (
                <p className="sc-parents">
                  {card.grandparent && <LinkChip clientKey={clientKey} l={card.grandparent} />}
                  {card.grandparent && card.parent && <span aria-hidden="true"> › </span>}
                  {card.parent && <LinkChip clientKey={clientKey} l={card.parent} />}
                </p>
              )}
              <div className="sc-acts">
                {card.canWrite ? (
                  <>
                    <button type="button" className="mini primary" onClick={() => onWrapUp(clientKey, card.id)}>
                      Wrap it up
                    </button>
                    <button type="button" className="mini" aria-expanded={edit === "comment"} onClick={() => setEdit(edit === "comment" ? null : "comment")}>
                      Add comment
                    </button>
                    <button type="button" className="mini" aria-expanded={edit === "state"} onClick={() => setEdit(edit === "state" ? null : "state")}>
                      Change state
                    </button>
                    <button type="button" className="mini" aria-expanded={edit === "assign"} onClick={() => setEdit(edit === "assign" ? null : "assign")}>
                      Assign
                    </button>
                    <button type="button" className="mini" aria-expanded={edit === "dates"} onClick={() => setEdit(edit === "dates" ? null : "dates")}>
                      Dates
                    </button>
                  </>
                ) : (
                  <span className="muted">{card.writeNote}</span>
                )}
                {card.breakDown && card.canWrite && (
                  <button type="button" className="mini" onClick={() => (onClose(), openBreakDown(clientKey, { id: card.id, title: card.title, type: card.type }))}>
                    Break down
                  </button>
                )}
              </div>
              {edit === "comment" && <CommentEditor onCancel={() => setEdit(null)} onPreview={(text) => write([{ kind: "comment", itemId: card.id, text }])} />}
              {edit === "state" && <StateEditor card={card} onCancel={() => setEdit(null)} onPreview={(state) => write([{ kind: "state", itemId: card.id, state }])} />}
              {edit === "assign" && <AssignEditor card={card} onCancel={() => setEdit(null)} write={write} />}
              {edit === "dates" && <DatesEditor card={card} onCancel={() => setEdit(null)} write={write} />}
              {(card.todos.length > 0 || card.promises.length > 0) && (
                <section className="sc-section" aria-label="In FocusTime">
                  <h3>In FocusTime</h3>
                  <ul className="sc-list">
                    {card.todos.map((t) => (
                      <li key={`t${t.id}`}>
                        {t.status === "done" ? "✓ " : ""}
                        {dayText(t.date).replace(/, \d{4}$/, "")} {t.half === "EVE" ? "evening" : t.half}
                        {t.timebox ? ` · ${t.timebox}` : ""}
                        {t.status !== "done" && t.leftMinutes ? ` · about ${durText(t.leftMinutes)}` : ""}
                      </li>
                    ))}
                    {card.promises.map((p) => (
                      <li key={p.key}>
                        Promise: {p.what}
                        {p.due ? ` · due ${dayText(p.due).replace(/, \d{4}$/, "")}` : ""}
                        {p.state === "snoozed" ? " · snoozed" : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="sc-section" aria-label="Description">
                <h3>Description</h3>
                {card.description ? <div className="sc-html" dangerouslySetInnerHTML={{ __html: card.description }} /> : <p className="muted">No description.</p>}
              </section>
              {card.acceptance && (
                <section className="sc-section" aria-label="Acceptance criteria">
                  <h3>Acceptance criteria</h3>
                  <div className="sc-html" dangerouslySetInnerHTML={{ __html: card.acceptance }} />
                </section>
              )}
              {card.children.length > 0 && (
                <section className="sc-section" aria-label="Child items">
                  <h3>Child items · {card.children.length}</h3>
                  <ul className="sc-list">
                    {card.children.map((c) => (
                      <li key={c.id}>
                        <LinkChip clientKey={clientKey} l={c} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="sc-section" aria-label="Comments">
                <h3>Comments{card.commentCount ? ` · ${card.commentCount}` : ""}</h3>
                {comments.length ? (
                  <ul className="sc-comments">
                    {comments.map((c) => (
                      <li key={c.id}>
                        <p className="sc-c-who">
                          <strong>{c.author}</strong> <span className="muted">{whenText(c.at)}</span>
                        </p>
                        <div className="sc-html" dangerouslySetInnerHTML={{ __html: c.html }} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No comments yet.</p>
                )}
                {!allComments && card.comments.length > COMMENTS_SHOWN && (
                  <button type="button" className="link-btn" onClick={() => setAllComments(true)}>
                    Show all {card.comments.length}
                  </button>
                )}
                {allComments && card.commentCount > card.comments.length && <p className="muted">The latest {card.comments.length} are shown.</p>}
              </section>
              <div className="sc-foot">
                <span className="muted">Read from DevOps {whenText(card.readAt)}</span>
                <button type="button" className="mini" onClick={() => void copyWorkLink(card.url)}>
                  Copy DevOps link
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

function LinkChip({ clientKey, l }: { clientKey: string; l: CardLink }) {
  return (
    <button type="button" className="link-btn sc-link" onClick={() => openItemCard(clientKey, l.id)}>
      <TypeIcon clientKey={clientKey} type={l.type} decorative /> #{l.id} {l.title}
      {l.state ? <span className="muted"> · {l.state}</span> : null}
    </button>
  );
}

function CommentEditor({ onCancel, onPreview }: { onCancel: () => void; onPreview: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="sc-edit" role="group" aria-label="Add comment">
      <TextBox value={text} minRows={2} maxRows={8} maxLength={4000} placeholder="A comment for DevOps" autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="sc-edit-acts">
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mini primary" disabled={!text.trim()} onClick={() => onPreview(text.trim())}>
          Preview
        </button>
      </div>
    </div>
  );
}

function StateEditor({ card, onCancel, onPreview }: { card: ItemCard; onCancel: () => void; onPreview: (state: string) => void }) {
  const others = card.states.filter((s) => s.name !== card.state && !isRemoved(s.category));
  const [state, setState] = useState(others[0]?.name ?? "");
  if (!others.length) return <p className="sc-edit muted">{card.type} has no other states here.</p>;
  return (
    <div className="sc-edit" role="group" aria-label="Change state">
      <label className="set-field">
        <span className="set-label">
          {card.state} →
        </span>
        <select value={state} autoFocus onChange={(e) => setState(e.target.value)}>
          {others.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
      </label>
      <div className="sc-edit-acts">
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mini primary" disabled={!state} onClick={() => onPreview(state)}>
          Preview
        </button>
      </div>
    </div>
  );
}

type Write = (changes: [{ kind: "fields"; itemId: number }], after?: (confirmed: boolean) => void) => void;

/** Ahead's change set for this one item, then its one fields write; a preview cancelled takes the staged change back out. */
async function stageAndWrite(card: ItemCard, staged: { field: "assignee" | "start" | "target"; value: unknown }[], write: Write): Promise<void> {
  for (const s of staged) await call("ahead.stage", { clientKey: card.clientKey, itemId: card.id, field: s.field, value: s.value });
  write([{ kind: "fields", itemId: card.id }], (confirmed) => {
    if (!confirmed) for (const s of staged) void call("ahead.unstage", { clientKey: card.clientKey, itemId: card.id, field: s.field }).catch(() => {});
  });
}

function AssignEditor({ card, onCancel, write }: { card: ItemCard; onCancel: () => void; write: Write }) {
  const [people, setPeople] = useState<AssignPerson[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call<{ people: AssignPerson[]; problem: string | null }>("ahead.people", { clientKey: card.clientKey }).then(
      (r) => live && (setPeople(r.people), setProblem(r.problem)),
      (e: unknown) => live && setProblem(errText(e)),
    );
    return () => void (live = false);
  }, [card.clientKey]);
  const shown = (people ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const p = people?.find((x) => x.email === chosen);
      await stageAndWrite(card, [{ field: "assignee", value: chosen === "" ? null : p ? { email: p.email, name: p.name } : null }], write);
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  };
  return (
    <div className="sc-edit" role="group" aria-label="Assign">
      <input aria-label="Find a person" placeholder="Find a person" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      {people === null && !problem ? (
        <p className="muted">Reading who can be assigned…</p>
      ) : (
        <select aria-label="Assign to" size={Math.min(8, shown.length + 1)} value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Nobody</option>
          {shown.map((p) => (
            <option key={p.email} value={p.email}>
              {p.name} · {p.domain}
            </option>
          ))}
        </select>
      )}
      {problem && <p className="wrap-error">{problem}</p>}
      <div className="sc-edit-acts">
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mini primary" disabled={busy || people === null} onClick={() => void go()}>
          Preview
        </button>
      </div>
    </div>
  );
}

function DatesEditor({ card, onCancel, write }: { card: ItemCard; onCancel: () => void; write: Write }) {
  const [start, setStart] = useState(card.start ?? "");
  const [target, setTarget] = useState(card.target ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bad = start && target && target < start ? "Target is before Start" : null;
  const go = async () => {
    const staged: { field: "start" | "target"; value: string | null }[] = [];
    if ((start || null) !== card.start) staged.push({ field: "start", value: start || null });
    if ((target || null) !== card.target) staged.push({ field: "target", value: target || null });
    if (!staged.length) return onCancel();
    setBusy(true);
    setProblem(null);
    try {
      await stageAndWrite(card, staged, write);
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  };
  return (
    <div className="sc-edit" role="group" aria-label="Dates">
      <div className="sc-dates">
        <label className="set-field">
          <span className="set-label">Start</span>
          <input type="date" value={start} autoFocus onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="set-field">
          <span className="set-label">Target</span>
          <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      {(bad || problem) && <p className="wrap-error">{bad ?? problem}</p>}
      <div className="sc-edit-acts">
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mini primary" disabled={busy || !!bad} onClick={() => void go()}>
          Preview
        </button>
      </div>
    </div>
  );
}
