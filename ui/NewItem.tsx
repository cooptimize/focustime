// QC-1: one New form for a story, a feature, an epic or any level a client's process has, wherever a person is working
// (Ahead's toolbar and rows, the command menu and Shift+N, the block panel's Add box, Capture, Break down, a draft's
// row). Title is the only thing to type: client, level and type, parent, assignee and target date start from where it
// was opened. Create in DevOps opens the write framework's preview (confirm, read back, audit log, undo); Save as draft
// keeps it local. Without the client's write PAT it says so in one line and Save as draft is the way. No browser
// controls: the app's own select, date field and people list (AH-5). Works with no AI; a draft's AI version is offered.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { aOr, formDefaults, parentTypesOf, TITLE_MAX, type NewOptions, type NewPlace } from "../plan/quick-create.ts";
import type { DraftStory } from "../plan/types.ts";
import { PeopleField } from "./ahead/Editors.tsx";
import { call } from "./api.ts";
import { Segmented } from "./CellPopover.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { useDraftView } from "./CreateDraft.tsx";
import { DateField } from "./DatePicker.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { SelectField } from "./SelectField.tsx";
import { TextBox } from "./TextBox.tsx";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { answersEmpty, descriptionMax, NO_ANSWERS, withCarried, type Answers } from "../plan/three-questions.ts";
import { ThreeQuestions } from "./ThreeQuestions.tsx";
import { usePhone } from "./viewport.ts";
import { Icon } from "./icons.tsx";

export type { NewPlace };
/** What the opener hears back: the item it made (Ahead selects it, the panel places it) or the draft it saved. */
export type NewHooks = {
  onCreated?: (c: Created) => void;
  onDraft?: (d: DraftStory) => void;
  /** The block panel: the draft is put on the block first, so the created item takes its place there (or it stays as a draft). */
  place?: (d: DraftStory) => Promise<void>;
};
export type Created = { clientKey: string; itemId: number; url: string | null; title: string; type: string; parentId: number | null; assignTo: string | null };
export type OpenNew = (place: NewPlace, hooks?: NewHooks) => void;
/** App provides it; null outside App (the form then isn't offered). */
export const NewItemCtx = createContext<OpenNew | null>(null);
export const useOpenNew = () => useContext(NewItemCtx);
/** Every open screen hears a new item at once (Ahead rereads and selects it); DV-2's signal carries it to others. */
export const CREATED_EVENT = "focustime:devops-created";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const optionsMemo = new Map<string, Promise<NewOptions>>();
/** Forget what was read (after a create: the new item can be a parent next). */
export const forgetNewOptions = () => optionsMemo.clear();

/** What the form reads per client, fresh each time it opens (a PAT added in Settings shows at once); kept only while it is open. */
function useOptions(clientKey: string | null): { opts: NewOptions | null; error: string | null } {
  const [opts, setOpts] = useState<NewOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpts(null);
    setError(null);
    if (!clientKey) return;
    let live = true;
    const p = optionsMemo.get(clientKey) ?? call<NewOptions>("new.options", { clientKey });
    optionsMemo.set(clientKey, p);
    p.then((o) => live && setOpts(o), (e: unknown) => (optionsMemo.delete(clientKey), live && setError(errText(e))));
    return () => void (live = false);
  }, [clientKey]);
  return { opts, error };
}

type Client = { clientKey: string; clientName: string };

export function NewItemDialog({ place, hooks, clients, colors, today, onClose }: { place: NewPlace; hooks: NewHooks; clients: readonly Client[]; colors: (k: string) => string | undefined; today: string; onClose: () => void }) {
  const w = useDevOpsWrite();
  // Read fresh on every open: my write PAT, the process and the parents can change between opens.
  useState(() => forgetNewOptions());
  const [draftId, setDraftId] = useState<number | null>(place.from === "draft" || place.from === "capture" ? place.draftId : null);
  // A draft (from Capture or a draft's row): its own values, and its AI version once it is there (never required).
  const dv = useDraftViewMaybe(draftId);
  const draft = dv?.view?.draft ?? null;
  const [clientKey, setClientKey] = useState<string | null>(place.clientKey ?? (clients.length === 1 ? clients[0]!.clientKey : null));
  const { opts, error: optsError } = useOptions(clientKey);
  const [type, setType] = useState<string | null>(null);
  const [title, setTitle] = useState(place.from === "panel" || place.from === "capture" ? place.title : "");
  const [parentId, setParentId] = useState<number | null>(place.from === "ahead_row" || place.from === "breakdown" ? place.parent.id : null);
  const [assignTo, setAssignTo] = useState<string>("me");
  const [target, setTarget] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState("");
  const [size, setSize] = useState("");
  // TP-1b: three optional questions under Title (under More on the phone).
  const phone = usePhone();
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  useEffect(() => titleRef.current?.focus(), [opts?.clientKey]);

  // The defaults for where it was opened, once the client's levels are read (a client change starts over).
  const filled = useRef<string | null>(null);
  useEffect(() => {
    if (!opts || filled.current === opts.clientKey) return;
    const first = filled.current === null;
    filled.current = opts.clientKey;
    const d = formDefaults(place, opts.levels, (r) => opts.levels.find((l) => l.rung === r)?.default ?? null);
    if (!first) return void (setType(d.type), setParentId(null));
    setType(d.type);
    if (d.parentId !== null) setParentId(d.parentId);
  }, [opts]); // eslint-disable-line react-hooks/exhaustive-deps
  // A draft fills the form once: my own words, its type (or its level's default), parent, owner, date, description.
  const fromDraft = useRef(false);
  useEffect(() => {
    if (!draft || !opts || fromDraft.current || draft.clientKey !== opts.clientKey) return;
    fromDraft.current = true;
    const levelType = draft.itemType && opts.levels.some((l) => l.types.includes(draft.itemType!)) ? draft.itemType : (draft.level === "story" ? opts.levels.find((l) => l.kind === "requirement") : opts.levels.filter((l) => l.kind === "portfolio").at(-1))?.default ?? null;
    setTitle(draft.title);
    setType(levelType);
    setParentId(draft.parentItemId);
    setAssignTo(draft.assignTo === "none" ? "" : (draft.assignTo ?? "me"));
    setTarget(draft.targetDate ?? null);
    // A TP-1 draft's other words (its fourth line and choices) show once at the end of the description.
    const shown = withCarried(draft.description, draft.carried) ?? "";
    setDescription(shown);
    if (shown) setMore(true);
    if (draft.answers) {
      setAnswers(draft.answers);
      if (phone) setMore(true);
    }
  }, [draft, opts]);
  useEffect(() => {
    if (draft && !clientKey) setClientKey(draft.clientKey);
  }, [draft, clientKey]);

  const clientName = clients.find((c) => c.clientKey === clientKey)?.clientName ?? clientKey ?? "";
  const ladder = useMemo(() => opts?.levels.map((l) => l.types) ?? [], [opts]);
  const types = useMemo(() => opts?.levels.flatMap((l) => l.types) ?? [], [opts]);
  const allowedParents = useMemo(() => (type ? new Set(parentTypesOf(ladder, type)) : new Set<string>()), [ladder, type]);
  const parents = useMemo(() => (opts?.parents ?? []).filter((p) => allowedParents.has(p.type)), [opts, allowedParents]);
  // A row's parent that the pool doesn't list (out of scope) still shows by its title.
  const rowParent = place.from === "ahead_row" || place.from === "breakdown" ? place.parent : null;
  const parentChoice = parentId !== null ? (parents.find((p) => p.id === parentId) ?? (rowParent?.id === parentId ? { id: rowParent.id, title: rowParent.title, type: rowParent.type } : null)) : null;
  // Changing the type keeps the parent only when it can still hold it.
  useEffect(() => {
    if (parentId !== null && parentChoice && !allowedParents.has(parentChoice.type)) setParentId(null);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  const canWrite = !!opts?.canWrite && !!w?.can(clientKey ?? "");
  const color = clientKey ? colors(clientKey) : undefined;
  const trimmed = title.replace(/\s+/g, " ").trim();
  const titleProblem = !trimmed ? null : trimmed.length > TITLE_MAX ? `A DevOps title is at most ${TITLE_MAX} characters. This one is ${trimmed.length}` : null;
  const sizeNum = size.trim() ? Number(size) : null;
  const sizeProblem = sizeNum !== null && (!Number.isFinite(sizeNum) || sizeNum < 0) ? "Size is a number" : null;
  const ready = !!clientKey && !!type && !!trimmed && !titleProblem && !sizeProblem && !busy;
  const ai = draft?.ai?.title ? draft.ai : null;

  const create = async () => {
    if (!ready || !w || !clientKey || !type) return;
    setBusy(true);
    setError(null);
    setHidden(true);
    const madeTitle = trimmed;
    let did = draftId;
    if (did === null && hooks.place) {
      // The panel: saved and placed first, so the confirmed item replaces it on the block; cancelled, it stays a draft there.
      try {
        const r = await call<{ draft: DraftStory }>("draft.add", draftBody());
        await hooks.place(r.draft);
        placedHere.current = true;
        did = r.draft.id;
        setDraftId(did);
      } catch (e) {
        setHidden(false);
        setBusy(false);
        setError(errText(e));
        return;
      }
    }
    const change = { kind: "new_item" as const, title: madeTitle, type, parentId, assignTo: assignTo === "me" ? "me" : assignTo || null, date: target, description: description.trim() || null, size: sizeNum, ...(did !== null ? { draftId: did } : {}), ...answersPart() };
    await w.begin(clientKey, [change], (r) => {
      if (r.confirmed && r.created?.[0]) {
        forgetNewOptions();
        const c: Created = { clientKey, itemId: r.created[0].itemId, url: r.created[0].url, title: madeTitle, type, parentId, assignTo: change.assignTo };
        window.dispatchEvent(new CustomEvent(CREATED_EVENT, { detail: c }));
        hooks.onCreated?.(c);
        placedHere.current = false;
        onClose();
        return;
      }
      // Not confirmed: the form comes back as I left it, with why when DevOps or FocusTime refused.
      setHidden(false);
      setBusy(false);
      if (r.error) setError(r.error);
      requestAnimationFrame(() => titleRef.current?.focus());
    }, { inline: true });
  };
  // The panel's draft that this form placed, until it is created: closing keeps it on the block, said once.
  const placedHere = useRef(false);
  const close = () => {
    if (placedHere.current) notify("Kept on the block as a draft. Create it in DevOps from its More menu, or drop it");
    onClose();
  };
  // The answers go only when something is in them (a title-only create sends what it always did), or to clear a draft's.
  const answersPart = (): { answers?: Answers | null } => (!answersEmpty(answers) ? { answers } : draft?.answers || draft?.carried ? { answers: null } : {});
  const draftBody = () => ({ clientKey: clientKey!, title: trimmed, ...(type ? { type } : {}), parentItemId: parentId, assignTo: assignTo === "me" ? null : assignTo || "none", description: description.trim() || null, targetDate: target, ...answersPart() });
  const saveDraft = async () => {
    if (!clientKey || !trimmed || titleProblem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = draftBody();
      const r = draftId !== null ? await call<{ draft: DraftStory }>("draft.save", { id: draftId, ...body }) : await call<{ draft: DraftStory }>("draft.add", body);
      if (draftId === null && hooks.place) await hooks.place(r.draft);
      notify(hooks.place ? `Saved as a draft on the block. Create it in DevOps from its row when you're ready` : `Saved as a draft for ${clientName}. Create it in DevOps from its row when you're ready`);
      hooks.onDraft?.(r.draft);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const typeOptions = types.map((t) => ({ value: t, label: t }));
  const parentOptions = [{ key: "", label: "None", search: "none no parent" }, ...parents.map((p) => ({ key: String(p.id), label: `#${p.id} ${p.title}`, search: `${p.id} ${p.title} ${p.type}`, sub: p.type })), ...(parentChoice && !parents.some((p) => p.id === parentChoice.id) ? [{ key: String(parentChoice.id), label: `#${parentChoice.id} ${parentChoice.title}`, sub: parentChoice.type }] : [])];
  const parentWords = [...allowedParents].join(" or ").toLowerCase();

  return (
    <div className="cap-backdrop nf-backdrop" hidden={hidden} onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div
        className="cap-dialog new-form"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={clientKey ? `New in ${clientName}'s DevOps` : "New work item"}
        style={color ? ({ "--c": color } as CSSProperties) : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            close();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            // Ctrl+Enter from anywhere in the form: the preview (or, without my write PAT, Save as draft).
            e.preventDefault();
            e.stopPropagation();
            if (!trimmed) return void setError("Type a title");
            if (!opts || opts.clientKey !== clientKey) return;
            if (canWrite) void create();
            else void saveDraft();
          }
        }}
      >
        <div className="cap-dialog-head cd-head">
          <h2 className="cd-client">
            {clientKey && <span className="swatch" aria-hidden="true" />}
            {clientKey ? `New in ${clientName}'s DevOps` : "New work item"}
          </h2>
          <CloseButton onClose={close} disabled={busy} />
        </div>
        <div className="nf-grid">
          <span className="set-label" id="nf-client">Client</span>
          {draftId !== null && clientKey ? (
            // A draft belongs to its client.
            <span className="nf-fixed">{clientName}</span>
          ) : (
            <SelectField label="Client" value={clientKey ?? ""} options={clients.map((c) => ({ key: c.clientKey, label: c.clientName }))} onChange={(k) => (setClientKey(k), setParentId(null))} className="nf-select" empty="Choose a client" />
          )}
          <span className="set-label" id="nf-type">Level</span>
          <span className="nf-types">
            {!clientKey ? <span className="muted">Choose a client first</span> : !opts ? <span className="muted">{optsError ?? "Reading the client's process…"}</span> : types.length ? <Segmented label="Level" options={typeOptions} value={type} onChange={setType} /> : <span className="muted">{opts.problem}</span>}
          </span>
          <label className="set-label" htmlFor="nf-title">Title</label>
          <span className="nf-title">
            <input
              id="nf-title"
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX + 100}
              placeholder={type ? `What is this ${type.toLowerCase()}?` : "What is it?"}
              autoComplete="off"
              onChange={(e) => (setTitle(e.target.value), error === "Type a title" && setError(null))}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                // Until the client's options are read, Enter waits (never a draft by mistake while my PAT is being checked).
                if (!trimmed) return void setError("Type a title");
                if (!opts || opts.clientKey !== clientKey) return;
                if (canWrite) void create();
                else void saveDraft();
              }}
            />
            {titleProblem && <span className="set-problem nf-line" role="alert">{titleProblem}</span>}
          </span>
          {!phone && <ThreeQuestions answers={answers} onChange={setAnswers} idPrefix="nf-q" />}
          <span className="set-label">Parent</span>
          <span className="nf-parent">
            {type && !allowedParents.size ? (
              <span className="muted">{aOr(type.toLowerCase()).replace(/^a/, "A")} is at the top: no parent</span>
            ) : (
              <>
                <SelectField label="Parent" value={parentId === null ? "" : String(parentId)} options={parentOptions} onChange={(k) => setParentId(k ? Number(k) : null)} className="nf-select" />
                <span className="muted nf-why">{parents.length ? `Optional. Any open ${parentWords}` : type ? `Optional. No open ${parentWords} to choose` : "Optional"}</span>
              </>
            )}
          </span>
          <span className="set-label">Assigned to</span>
          <span className="nf-people">{clientKey ? <PeopleField clientKey={clientKey} value={assignTo} onChange={setAssignTo} /> : <span className="muted">Me</span>}</span>
          <span className="set-label">Target date</span>
          <span className="nf-date">
            <DateField value={target} onChange={setTarget} label="Target date" today={today} placeholder="None" />
            <span className="muted nf-why">Optional</span>
          </span>
        </div>
        <button type="button" className="link-btn nf-more" aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name={more ? "open" : "closed"} /> {phone ? "More: details, description and size" : "More: description and size"}
        </button>
        {more && phone && <ThreeQuestions answers={answers} onChange={setAnswers} idPrefix="nf-q" layout="stack" />}
        {more && (
          <div className="nf-grid nf-more-body">
            <label className="set-label" htmlFor="nf-desc">Description</label>
            <span>
              <TextBox id="nf-desc" minRows={3} maxRows={12} maxLength={descriptionMax(draft?.carried)} value={description} onChange={(e) => setDescription(e.target.value)} />
              {ai && (
                <span className="nf-ai">
                  <span className="muted">AI wrote a version{ai.note === "Another client's name was removed" ? " (another client's name was removed)" : ""}.</span>{" "}
                  <button type="button" className="link-btn" onClick={() => (setTitle(ai.title ?? title), setDescription(ai.description ?? ""))}>
                    Use the AI version
                  </button>
                </span>
              )}
              {!ai && dv?.view && draftId !== null && dv.view.draft.ai?.state === "writing" && <span className="muted nf-ai">AI is still writing a version; yours works now.</span>}
            </span>
            <label className="set-label" htmlFor="nf-size">Size</label>
            <span className="nf-size">
              <input id="nf-size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="None" aria-describedby="nf-size-why" />
              <span className="muted nf-why" id="nf-size-why">{sizeProblem ?? "The process's size field (points or effort), if the type has one"}</span>
            </span>
          </div>
        )}
        {clientKey && opts && !canWrite && (
          <p className="nf-nopat" role="status">
            DevOps is read-only for {clientName} until you add your own write PAT.{" "}
            <button type="button" className="link-btn" onClick={() => (onClose(), w?.enable(clientKey))}>
              Add it in Settings
            </button>
          </p>
        )}
        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions">
          {canWrite && (
            <button type="button" className="commit" disabled={!ready} title="Ctrl+Enter" aria-keyshortcuts="Control+Enter" onClick={() => void create()}>
              {busy ? "Opening the preview…" : "Create in DevOps"}
            </button>
          )}
          <button type="button" className={canWrite ? "mini" : "commit"} disabled={!clientKey || !trimmed || !!titleProblem || busy} onClick={() => void saveDraft()}>
            Save as draft
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={close}>
            Cancel
          </button>
          <span className="muted">{canWrite ? "Nothing is created until you confirm the preview." : "Saved in FocusTime only."}</span>
        </div>
      </div>
    </div>
  );
}

/** The draft's view (with its AI version as it lands), or nothing when the form isn't for a draft. */
function useDraftViewMaybe(draftId: number | null) {
  const v = useDraftView(draftId ?? 0, draftId !== null);
  return draftId === null ? null : v;
}
