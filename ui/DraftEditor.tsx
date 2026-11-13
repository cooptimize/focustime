// The draft editor (step 15.3): one dialog for a local draft story or draft feature, opened from Plan the week, Plan the
// day and the Inbox. Title, description, acceptance criteria (stories, when the process has the field), client, parent
// (the shared lookup over the client's open features or epics), size for stories, start and target dates for features,
// and the area and iteration it will inherit from the parent (read-only). Edits save locally (draft.update); Create in
// DevOps writes these values after its preview. Plan it adds it to a block (the 15.2 target order); Delete is local.
import { TextBox } from "./TextBox.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { SIZES, type DraftStory, type Size } from "../plan/types.ts";
import { call } from "./api.ts";
import { captureClients, useClientFeatures } from "./Capture.tsx";
import { DevOpsAction } from "./DevOpsWrite.tsx";
import { ItemLookup, NO_ITEM, parentPool, type ItemValue } from "./ItemLookup.tsx";
import { MenuCtx } from "./Menus.tsx";
import { addStep } from "./menu.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { descriptionMax, NO_ANSWERS, storedOf, withCarried, type Answers } from "../plan/three-questions.ts";
import { ThreeQuestions } from "./ThreeQuestions.tsx";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** Opens the editor for a draft. App provides it; null outside App (the title then shows as plain text). */
export const DraftEditorCtx = createContext<((d: DraftStory) => void) | null>(null);

/** A draft's title as a button that opens the editor. */
export function DraftTitle({ draft, className }: { draft: DraftStory; className?: string }): ReactNode {
  const open = useContext(DraftEditorCtx);
  if (!open) return <span className={className}>{draft.title}</span>;
  return (
    <button type="button" className={`link-btn draft-title${className ? ` ${className}` : ""}`} title="Edit this draft" onClick={(e) => (e.stopPropagation(), open(draft))}>
      {draft.title}
    </button>
  );
}

const NO_POOL = { items: [], children: [] };

export function DraftEditor({ draft, data, onClose, onChanged }: { draft: DraftStory; data: WeekLoadData; onClose: () => void; onChanged: () => void }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const feature = draft.level === "feature";
  const [title, setTitle] = useState(draft.title);
  // TP-1b: a TP-1 draft's other words (its fourth line and choices) show once at the end of the description, to keep
  // or delete; nothing changes in the store until the person saves.
  const shownDescription = withCarried(draft.description, draft.carried);
  const [description, setDescription] = useState(shownDescription ?? "");
  const [acceptance, setAcceptance] = useState(draft.acceptance ?? "");
  const [client, setClient] = useState(draft.clientKey);
  const [parent, setParent] = useState<ItemValue>(draft.parentItemId ? { itemId: draft.parentItemId, title: null, url: null, text: "" } : NO_ITEM);
  const [size, setSize] = useState<Size>(draft.size);
  const [start, setStart] = useState(draft.startDate ?? "");
  const [target, setTarget] = useState(draft.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // TP-1b: the three questions, as the New form asks them.
  const [answers, setAnswers] = useState<Answers>(draft.answers ?? NO_ANSWERS);
  const answersChanged = storedOf(answers) !== storedOf(draft.answers);
  const features = useClientFeatures(client, true);
  const choices = feature ? features?.epics : features?.features;
  const pool = useMemo(() => parentPool(choices, feature ? "epic" : "feature"), [choices, feature]);
  const chosen = parent.itemId !== null ? choices?.find((c) => c.id === parent.itemId) : undefined;
  // The parent's title and link once DevOps answers.
  useEffect(() => {
    if (chosen && parent.title === null) setParent({ itemId: chosen.id, title: chosen.title, url: chosen.url ?? null, text: "" });
  }, [chosen, parent.title]);
  const { env, open: openMenu } = useContext(MenuCtx);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const b = back.current;
    return () => b?.focus?.();
  }, []);
  const clientName = (k: string) => clients.find((c) => c.clientKey === k)?.clientName ?? k;
  // TP-1b: the third question is the acceptance; a separate box only when the draft already holds acceptance text (CP-1's AI version, an older draft).
  const showAc = !feature && !!draft.acceptance?.trim() && (features?.acceptanceField ?? features?.status !== "ok");
  const startAfter = feature && start && target && start > target;
  const dirty =
    title.trim() !== draft.title || (description.trim() || null) !== (shownDescription ?? null) || (acceptance.trim() || null) !== (draft.acceptance ?? null) || client !== draft.clientKey ||
    parent.itemId !== draft.parentItemId || size !== draft.size || (start || null) !== (draft.startDate ?? null) || (target || null) !== (draft.targetDate ?? null) || answersChanged;

  /** Saves the edits (only what changed); the saved draft, or null when it didn't save. */
  const save = async (): Promise<DraftStory | null> => {
    if (!title.trim()) return (setError("A draft needs a title"), null);
    if (startAfter) return (setError("The start date is after the target date"), null);
    if (!dirty) return draft;
    setBusy(true);
    setError(null);
    try {
      const input: Record<string, unknown> = { id: draft.id };
      if (title.trim() !== draft.title) input.title = title.trim();
      // A TP-1 draft's save sends its description as shown (carried words kept or deleted) and its answers, once.
      if (draft.carried || (description.trim() || null) !== (draft.description ?? null)) input.description = description.trim() || null;
      if (!feature && (acceptance.trim() || null) !== (draft.acceptance ?? null)) input.acceptance = acceptance.trim() || null;
      if (client !== draft.clientKey) input.clientKey = client;
      if (parent.itemId !== draft.parentItemId || client !== draft.clientKey) input.parentItemId = parent.itemId;
      if (!feature && size !== draft.size) input.size = size;
      if (feature && (start || null) !== (draft.startDate ?? null)) input.startDate = start || null;
      if (feature && (target || null) !== (draft.targetDate ?? null)) input.targetDate = target || null;
      if (answersChanged || draft.carried) input.answers = storedOf(answers) ? answers : null;
      const r = await call<{ draft: DraftStory }>("draft.update", input);
      onChanged();
      return r.draft;
    } catch (e) {
      setError(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const kind = feature ? "Draft feature" : "Draft story";
  const parentWord = feature ? "epic" : "feature";
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog draft-editor"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${kind}: ${draft.title}`}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save().then((d) => d && (notify(`Draft saved: ${d.title}`), onClose()));
          }}
        >
          <div className="cap-dialog-head">
            <h2>{kind}</h2>
            <span className="muted">Saved on this computer until you create it in DevOps.</span>
            <CloseButton onClose={onClose} disabled={busy} />
          </div>
          <label className="set-field">
            <span className="set-label">Title</span>
            <input ref={first} value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <ThreeQuestions answers={answers} onChange={setAnswers} idPrefix={`de-q-${draft.id}`} layout="stack" />
          <label className="set-field">
            <span className="set-label">Description</span>
            <TextBox value={description} minRows={4} maxRows={14} maxLength={descriptionMax(draft.carried)} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {showAc && (
            <label className="set-field">
              <span className="set-label">Acceptance criteria{features?.status !== "ok" ? " (written only when the process has the field)" : ""}</span>
              <TextBox value={acceptance} minRows={3} maxRows={12} maxLength={8000} onChange={(e) => setAcceptance(e.target.value)} />
            </label>
          )}
          <div className="draft-row">
            <label className="set-field">
              <span className="set-label">Client</span>
              <select value={client} onChange={(e) => (setClient(e.target.value), setParent(NO_ITEM))}>
                {!clients.some((c) => c.clientKey === client) && <option value={client}>{client}</option>}
                {clients.map((c) => (
                  <option key={c.clientKey} value={c.clientKey}>
                    {c.clientName}
                  </option>
                ))}
              </select>
            </label>
            {!feature ? (
              <span className="set-field">
                <span className="set-label" id={`draft-size-${draft.id}`}>Size</span>
                <span className="cap-size" role="group" aria-labelledby={`draft-size-${draft.id}`}>
                  {SIZES.map((z) => (
                    <button key={z} type="button" className="mini" aria-pressed={size === z} onClick={() => setSize(z)}>
                      {z}
                    </button>
                  ))}
                </span>
              </span>
            ) : (
              <>
                <label className="set-field">
                  <span className="set-label">Start date</span>
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="set-field">
                  <span className="set-label">Target date</span>
                  <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <label className="set-field">
            <span className="set-label">Parent {parentWord}</span>
            <ItemLookup
              clientKey={client}
              value={parent}
              onChange={setParent}
              label={`Parent ${parentWord}`}
              pool={(features?.status === "ok" ? pool : undefined) ?? NO_POOL}
              placeholder={!features ? `Loading ${parentWord}s…` : features.status !== "ok" ? `DevOps unavailable: no ${parentWord}s to choose` : `Search ${clientName(client)}'s open ${parentWord}s`}
            />
          </label>
          <dl className="draft-inherit" aria-label="From the parent">
            <dt>Area</dt>
            <dd>{chosen?.areaPath ?? (parent.itemId ? "Read from the parent when created" : "From the parent")}</dd>
            <dt>Iteration</dt>
            <dd>{chosen?.iterationPath ?? (parent.itemId ? "Read from the parent when created" : "From the parent")}</dd>
          </dl>
          {error && (
            <p className="set-problem" role="alert">
              {error}
            </p>
          )}
          {startAfter && <p className="set-problem">The start date is after the target date.</p>}
          <div className="wd-actions draft-actions">
            <button type="submit" className="commit" disabled={busy || !title.trim()}>
              {dirty ? "Save" : "Done"}
            </button>
            {env && (
              <button
                type="button"
                className="mini"
                disabled={busy}
                title="Add it to a block: this client's blocks first"
                onClick={async (e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const d = await save();
                  if (!d) return;
                  onClose();
                  openMenu({ x: r.left, y: r.bottom + 4 }, addStep(env, d.clientKey, { draftId: d.id, title: d.title, size: d.size }));
                }}
              >
                Add to a block
              </button>
            )}
            <DevOpsAction
              clientKey={client}
              label="Create in DevOps"
              onRun={async (w) => {
                const d = await save();
                if (!d) return;
                // QC-1: straight to the preview; a parent is optional (no parent: the project's default area and iteration).
                onClose();
                w.create(d.clientKey, [d]);
              }}
            />
            <button
              type="button"
              className="mini quiet danger"
              disabled={busy}
              title="Delete this local draft (DevOps isn't touched)"
              onClick={async () => {
                try {
                  await call("draft.remove", { id: draft.id });
                  notify(`Draft deleted: ${draft.title}`);
                  onChanged();
                  onClose();
                } catch (e) {
                  setError(errText(e));
                }
              }}
            >
              Delete
            </button>
            <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
