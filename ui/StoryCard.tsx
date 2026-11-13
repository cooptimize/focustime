// FN-1: the story card. A work item's title anywhere in FocusTime opens this modal (#/item/<client>/<id>) instead of
// DevOps: its fields, parent and epic and children (each opens its own card), the description and acceptance criteria
// (sanitized on the server), the latest comments, and what FocusTime knows (my to-dos, timeboxes and promises on it).
// Every change goes through the write framework (preview, confirm, read back, audit log, undo): Wrap it up, Add
// comment, Change state, Assign and Dates (Ahead's change set, one fields write), and since ED-1 Edit (title,
// description, acceptance criteria: one item_edit) and Move… (reparent). The footer only copies the DevOps link;
// nothing here opens DevOps. A client the person can't see shows "no access" and reads nothing.
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
import type { EditOffer } from "../actions/types.ts";
import { lookHtml } from "../plan/light-format.ts";
import { CantEdit, CardMore, ChangedSince, changedParts, draftOf, isDirty, LightEditor, MoveEditor, type EditDraft } from "./StoryCardEdit.tsx";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

type Read = { access: false; message: string } | { access: true; card: ItemCard };
type Edit = null | "comment" | "state" | "assign" | "dates" | "move";

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
  // ED-1: what Edit and Move… may do (read with my write PAT), my words while editing, a newer version found on Save,
  // and the one question before typed words are thrown away.
  const [offer, setOffer] = useState<EditOffer | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [stale, setStale] = useState<EditOffer | null>(null);
  const [discard, setDiscard] = useState<null | "close" | "cancel">(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const titleBox = useRef<HTMLInputElement>(null);
  const acBox = useRef<HTMLTextAreaElement | null>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const focusAc = useRef(false);
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
    setOffer(null);
    setDraft(null);
    setStale(null);
    setDiscard(null);
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
  const loadOffer = useCallback(async (): Promise<EditOffer | null> => {
    try {
      const r = await call<{ offer: EditOffer | null }>("devops.edit_offer", { clientKey, itemId });
      setOffer(r.offer);
      return r.offer;
    } catch {
      setOffer(null);
      return null;
    }
  }, [clientKey, itemId]);
  const canWrite = !!card?.canWrite;
  const readAt = card?.readAt;
  // While Edit is open the offer it read stays the base (its revision guards the save); a newer one waits for Save.
  const editing = useRef(false);
  editing.current = !!draft;
  useEffect(() => {
    if (canWrite && !editing.current) void loadOffer();
  }, [canWrite, readAt, loadOffer]);
  const dirty = isDirty(offer, draft);
  const startEdit = (acceptance = false) => {
    if (!offer?.canEdit) return;
    setEdit(null);
    setStale(null);
    setEditError(null);
    focusAc.current = acceptance;
    setDraft(draftOf(offer, acceptance));
  };
  useEffect(() => {
    if (!draft) return;
    if (focusAc.current) {
      focusAc.current = false;
      acBox.current?.focus();
    } else titleBox.current?.focus();
    // Only when the edit opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft]);
  useEffect(() => {
    if (discard) keepBtn.current?.focus();
  }, [discard]);
  const endEdit = () => {
    setDraft(null);
    setStale(null);
    setDiscard(null);
    setEditError(null);
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const cancelEdit = () => (dirty ? setDiscard("cancel") : endEdit());
  const requestClose = () => (dirty ? setDiscard("close") : onClose());
  /** Save: one preview of the parts that changed, guarded by the revision Edit read. */
  const saveEdit = (against?: EditOffer) => {
    const base = against ?? offer;
    if (!base || !draft || !writes) return;
    const rev = against ? against.rev : draft.rev;
    const parts = changedParts(base, draft);
    if (!Object.keys(parts).length) return endEdit();
    setEditError(null);
    void writes.begin(
      clientKey,
      [{ kind: "item_edit", itemId: base.itemId, rev, ...parts }],
      async (r) => {
        if (r.confirmed) {
          endEdit();
          void load(true);
          void loadOffer();
          return;
        }
        // A newer version in DevOps: show what it is now and keep my words.
        if (r.code === "changed" || r.sent) {
          const now = await loadOffer();
          if (now && now.rev !== rev) return void setStale(now);
        }
        if (r.error) setEditError(r.error);
      },
      { inline: true },
    );
  };
  /** Move… and Add to the end: one preview each, at the revision Edit (or the card's offer) read. */
  const writeAt = (change: Parameters<NonNullable<typeof writes>["begin"]>[1][number]) => {
    if (!writes) return;
    void writes.begin(clientKey, [change], async (r) => {
      if (r.confirmed) {
        setEdit(null);
        endEdit();
        void load(true);
        void loadOffer();
      } else if (r.code === "changed") void loadOffer();
      if (!r.confirmed && r.error) setEditError(r.error);
    }, { inline: true });
  };
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
  const canMove = !!offer?.canEdit && offer.parentTypes.length > 0;
  // A Markdown field reads through the light look (the card's sanitized HTML would show its marks as text).
  const shownDescription = offer?.description?.format === "markdown" && offer.description.editable ? lookHtml(offer.description.text) : (card?.description ?? "");
  const shownAcceptance = offer?.acceptance?.format === "markdown" && offer.acceptance.editable ? lookHtml(offer.acceptance.text) : (card?.acceptance ?? "");
  return (
    <div className="cap-backdrop sc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
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
            if (discard) setDiscard(null);
            else if (draft) cancelEdit();
            else if (edit) setEdit(null);
            else onClose();
            return;
          }
          // ED-1: E edits (not while typing); Ctrl+Enter saves while editing.
          if (draft && e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            saveEdit();
            return;
          }
          if (!draft && !edit && (e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target) && offer?.canEdit) {
            e.preventDefault();
            e.stopPropagation();
            startEdit();
          }
        }}
      >
        <div className="cap-dialog-head sc-head">
          <h2 id="sc-title" tabIndex={-1} ref={head} className={draft ? "sc-title-editing" : undefined}>
            {card ? (
              <>
                <TypeIcon clientKey={clientKey} type={card.type} decorative /> <span className="sc-id">#{card.id}</span> {draft ? <span className="sr-only">{card.title}, editing</span> : card.title}
              </>
            ) : (
              `#${itemId}`
            )}
          </h2>
          {draft && offer && (
            <label className="sc-title-box">
              <span className="sr-only">Title</span>
              <input
                ref={titleBox}
                aria-label="Title"
                value={draft.title}
                maxLength={offer.titleMax}
                aria-invalid={!draft.title.trim() || undefined}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && (e.preventDefault(), saveEdit())}
              />
            </label>
          )}
          <CloseButton onClose={requestClose} />
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
                  {canMove && (
                    <button type="button" className="link-btn quiet sc-move-link" aria-expanded={edit === "move"} onClick={() => (endEdit(), setEdit(edit === "move" ? null : "move"))}>
                      Move…
                    </button>
                  )}
                </p>
              )}
              {!card.parent && !card.grandparent && canMove && (
                <p className="sc-parents muted">
                  No parent{" "}
                  <button type="button" className="link-btn quiet sc-move-link" aria-expanded={edit === "move"} onClick={() => (endEdit(), setEdit(edit === "move" ? null : "move"))}>
                    Move…
                  </button>
                </p>
              )}
              <div className="sc-acts">
                {card.canWrite ? (
                  <>
                    <button type="button" className="mini primary" onClick={() => onWrapUp(clientKey, card.id)}>
                      Wrap it up
                    </button>
                    {offer?.canEdit && (
                      <button ref={editBtn} type="button" className="mini" aria-expanded={!!draft} aria-keyshortcuts="E" title="Edit (E)" onClick={() => (draft ? cancelEdit() : startEdit())}>
                        Edit
                      </button>
                    )}
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
                {offer && !offer.canEdit && offer.editNote && <span className="muted sc-edit-note">{offer.editNote}</span>}
                {card.breakDown && card.canWrite && (
                  <button type="button" className="mini" onClick={() => (onClose(), openBreakDown(clientKey, { id: card.id, title: card.title, type: card.type }))}>
                    Break down
                  </button>
                )}
                <CardMore items={[...(canMove ? [{ label: "Move…", run: () => (endEdit(), setEdit("move")) }] : []), { label: "Copy DevOps link", run: () => void copyWorkLink(card.url) }]} />
              </div>
              {edit === "move" && offer && <MoveEditor offer={offer} clientKey={clientKey} onCancel={() => setEdit(null)} onPreview={(parentId) => writeAt({ kind: "reparent", itemId: offer.itemId, rev: offer.rev, parentId })} />}
              {stale && draft && <ChangedSince now={stale} onUse={() => (setDraft({ ...draft, rev: stale.rev }), setOffer(stale), setStale(null), saveEdit(stale))} />}
              {editError && <p className="wrap-error" role="alert">{editError}</p>}
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
                {draft && offer?.description?.editable ? (
                  <LightEditor label="Description" value={draft.description} markdown={offer.description.format === "markdown"} lossy={offer.description.lossy} onChange={(v) => setDraft({ ...draft, description: v })} onSave={() => saveEdit()} />
                ) : (
                  <>
                    {shownDescription ? <div className="sc-html" dangerouslySetInnerHTML={{ __html: shownDescription }} /> : <p className="muted">No description.</p>}
                    {draft && offer?.description && !offer.description.editable && <CantEdit field={offer.description} url={offer.url} onAppend={(text) => writeAt({ kind: "description_update", itemId: offer.itemId, rev: offer.rev, text, part: "description" })} />}
                  </>
                )}
              </section>
              {(card.acceptance || (draft && draft.acceptanceOpen && offer?.acceptance)) && (
                <section className="sc-section" aria-label="Acceptance criteria">
                  <h3>Acceptance criteria</h3>
                  {draft && offer?.acceptance?.editable ? (
                    <LightEditor label="Acceptance criteria" value={draft.acceptance} placeholder="One example and the answer it should give" markdown={offer.acceptance.format === "markdown"} lossy={offer.acceptance.lossy} onChange={(v) => setDraft({ ...draft, acceptance: v })} onSave={() => saveEdit()} boxRef={(el) => (acBox.current = el)} />
                  ) : (
                    <>
                      <div className="sc-html" dangerouslySetInnerHTML={{ __html: shownAcceptance }} />
                      {draft && offer?.acceptance && !offer.acceptance.editable && <CantEdit field={offer.acceptance} url={offer.url} onAppend={(text) => writeAt({ kind: "description_update", itemId: offer.itemId, rev: offer.rev, text, part: "acceptance" })} />}
                    </>
                  )}
                </section>
              )}
              {!card.acceptance && offer?.canEdit && offer.acceptance?.editable && !(draft && draft.acceptanceOpen) && (
                <button type="button" className="link-btn quiet sc-add-ac" onClick={() => (draft ? (focusAc.current = true, setDraft({ ...draft, acceptanceOpen: true })) : startEdit(true))}>
                  Add acceptance criteria
                </button>
              )}
              {draft && (
                <div className="sc-save" role="group" aria-label="Save your edit">
                  {discard ? (
                    <p className="sc-discard" role="alert">
                      <span>Discard your changes?</span>
                      <button type="button" className="mini" onClick={() => (discard === "close" ? onClose() : endEdit())}>
                        Discard
                      </button>
                      <button ref={keepBtn} type="button" className="mini primary" onClick={() => setDiscard(null)}>
                        Keep editing
                      </button>
                    </p>
                  ) : (
                    <>
                      <span className="muted">
                        Nothing is written until you confirm the preview.<span className="sc-save-key"> Ctrl+Enter saves.</span>
                      </span>
                      <button type="button" className="mini" onClick={cancelEdit}>
                        Cancel
                      </button>
                      {/* While DevOps has a newer version, the banner's Save again is the one way on. */}
                      {!stale && (
                        <button type="button" className="mini primary" disabled={!draft.title.trim()} onClick={() => saveEdit()}>
                          Save
                        </button>
                      )}
                    </>
                  )}
                </div>
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
