// CP-1: Create in DevOps from a captured draft. One dialog, the client named at the top in its color: my own text and
// the AI version side by side (Use this on either, and the chosen side is editable), the parent picked or confirmed,
// then Preview in DevOps opens the write framework's preview (confirm, read back, audit log, undo). Nothing is created
// here. While AI is still writing it says so and keeps my text usable; AI off is a plain draft, no error.
import { StandardsNote } from "./StandardsNote.tsx";
import { TextBox } from "./TextBox.tsx";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DraftAiView, WeekLoadData } from "../actions/types.ts";
import { draftRowState, draftRowText, prepareAgain } from "../plan/capture-prepare.ts";
import type { DraftStory } from "../plan/types.ts";
import { call } from "./api.ts";
import { captureClients, useClientFeatures } from "./Capture.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { ItemLookup, NO_ITEM, parentPool, type ItemValue } from "./ItemLookup.tsx";
import { clientColor } from "./labels.ts";
import { WRITING_POLL_MS } from "./createdraft-ctx.ts";
export { CreateDraftCtx } from "./createdraft-ctx.ts";


type Side = "mine" | "ai";
type Fields = { title: string; description: string; acceptance: string };
const NO_POOL = { items: [], children: [] };
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

const mineOf = (d: DraftStory): Fields => ({ title: d.title, description: d.description ?? "", acceptance: d.acceptance ?? "" });
const aiOf = (d: DraftStory): Fields | null => (d.ai?.title ? { title: d.ai.title, description: d.ai.description ?? "", acceptance: d.ai.acceptance ?? "" } : null);

/** The draft, kept fresh: prepares it once when it never ran, and reads again while AI is writing. */
export function useDraftView(draftId: number, prepare: boolean): { view: DraftAiView | null; error: string | null; reload: () => void; again: () => Promise<void>; running: boolean } {
  const [view, setView] = useState<DraftAiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [running, setRunning] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = async () => {
      try {
        let v = await call<DraftAiView>("draft.get", { id: draftId });
        if (prepare && !asked.current && v.canWrite && !v.draft.ai && !v.draft.devopsId) {
          asked.current = true;
          if (live) setView(v);
          v = await call<DraftAiView>("draft.prepare", { id: draftId });
        }
        if (!live) return;
        setView(v);
        // Look again while AI writes, or while a prepare already asked for (by an earlier run) hasn't landed yet.
        const waiting = asked.current && v.canWrite && !v.draft.ai && !v.draft.devopsId;
        if (waiting || draftRowState(v.draft, { canWrite: v.canWrite, now: v.now }) === "writing") timer = setTimeout(() => void look(), WRITING_POLL_MS);
      } catch (e) {
        if (live) setError(errText(e));
      }
    };
    void look();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, prepare, n]);
  // UI-7: Prepare again: the same prepare once more (its caps and rules), then the fresh view.
  const again = async () => {
    setRunning(true);
    setError(null);
    try {
      setView(await call<DraftAiView>("draft.prepare", { id: draftId, again: true }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setRunning(false);
    }
  };
  return { view, error, reload: () => setN((x) => x + 1), again, running };
}

export function CreateDraftDialog({ draftId, data, onClose, onChanged }: { draftId: number; data: WeekLoadData; onClose: () => void; onChanged: () => void }): ReactNode {
  const { view, error: loadError, again, running } = useDraftView(draftId, true);
  const w = useDevOpsWrite();
  const clients = useMemo(() => captureClients(data), [data]);
  const draft = view?.draft ?? null;
  const client = draft?.clientKey ?? null;
  const clientName = client ? (clients.find((c) => c.clientKey === client)?.clientName ?? client) : "";
  const feature = draft?.level === "feature";
  const parentWord = feature ? "epic" : "feature";
  const features = useClientFeatures(client, !!draft);
  const choices = feature ? features?.epics : features?.features;
  const pool = useMemo(() => parentPool(choices, feature ? "epic" : "feature"), [choices, feature]);
  const [side, setSide] = useState<Side | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [parent, setParent] = useState<ItemValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);

  const ai = draft ? aiOf(draft) : null;
  const state = draft && view ? draftRowState(draft, { canWrite: view.canWrite, now: view.now }) : null;
  // The AI side once it is there (unless I already chose); my own text until then.
  const chosen: Side = side ?? (ai ? "ai" : "mine");
  useEffect(() => {
    if (!draft || side) return;
    setFields(chosen === "ai" && ai ? ai : mineOf(draft));
  }, [draft?.id, draft?.ai?.state, draft?.ai?.ranAt, side]);
  const againState = draft && view ? prepareAgain(draft, { canWrite: view.canWrite, aiOn: view.aiOn, now: view.now }) : "hidden";
  const runAgain = async () => {
    await again();
    // A fresh AI version replaces the AI side's fields (my own side stays as I left it).
    if (chosen === "ai") setSide(null);
  };
  const aiParent = chosen === "ai" ? (draft?.ai?.parentId ?? null) : null;
  const parentId = parent ? parent.itemId : (draft?.parentItemId ?? aiParent);
  const parentChoice = parentId !== null ? choices?.find((c) => c.id === parentId) : undefined;
  const parentValue: ItemValue = parent ?? (parentId !== null ? { itemId: parentId, title: parentChoice?.title ?? null, url: parentChoice?.url ?? null, text: "" } : NO_ITEM);
  const use = (s: Side) => {
    if (!draft) return;
    setSide(s);
    setFields(s === "ai" && ai ? ai : mineOf(draft));
    setParent(null);
  };

  const preview = async () => {
    if (!draft || !fields || !w || !client) return;
    if (!fields.title.trim()) return void setError("A title is needed");
    if (parentId === null) return void setError(`Choose a parent ${parentWord} first: area and iteration come from it`);
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = { id: draft.id };
      if (fields.title.trim() !== draft.title) patch.title = fields.title.trim();
      if ((fields.description.trim() || null) !== (draft.description ?? null)) patch.description = fields.description.trim() || null;
      if (!feature && (fields.acceptance.trim() || null) !== (draft.acceptance ?? null)) patch.acceptance = fields.acceptance.trim() || null;
      if (parentId !== draft.parentItemId) patch.parentItemId = parentId;
      if (Object.keys(patch).length > 1) await call("draft.update", patch);
      onChanged();
      const type = chosen === "ai" ? (draft.ai?.type ?? null) : null;
      onClose();
      void w.begin(client, [{ kind: "create", draftId: draft.id, ...(type ? { type } : {}) }]);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const color = client ? clientColor(client, data.clients) : undefined;
  // Typing keeps the side I'm on (the AI version arriving later doesn't replace my edits).
  const set = (k: keyof Fields) => (v: string) => (side ? null : setSide(chosen), setFields((f) => (f ? { ...f, [k]: v } : f)));
  const column = (s: Side) => {
    const here = s === chosen;
    const words = s === "ai" ? ai : draft ? mineOf(draft) : null;
    return (
      <section className={`cd-side${here ? " chosen" : ""}`} aria-label={s === "ai" ? "AI version" : "Yours"}>
        <header className="cd-side-head">
          <h3>{s === "ai" ? "AI version" : "Yours"}</h3>
          {here ? <span className="cd-using">Using this</span> : words && <button type="button" className="mini" onClick={() => use(s)}>Use this</button>}
          {s === "ai" && againState !== "hidden" && (
            <button type="button" className="mini quiet cd-again" disabled={busy || running || againState === "writing"} title={running || againState === "writing" ? "AI is writing" : "Ask the AI for its version again"} onClick={() => void runAgain()}>
              Prepare again
            </button>
          )}
        </header>
        {/* GD-2: the check after generation replaced another client's name in the AI version. */}
        {s === "ai" && ai && <StandardsNote s={draft?.ai?.standards} />}
        {s === "ai" && ai && draft?.ai?.note === "Another client's name was removed" && <p className="names-removed">Another client's name was removed: "another client" is written instead. Edit freely.</p>}
        {s === "ai" && !ai ? (
          <p className="muted cd-ai-note" role="status">{running || state === "writing" ? "AI still writing…" : draft && state ? draftRowText(state === "no_pat" ? "plain" : state, draft, clientName) : ""}</p>
        ) : here && fields ? (
          <>
            <label className="set-field"><span className="set-label">Title</span><input value={fields.title} maxLength={200} onChange={(e) => set("title")(e.target.value)} /></label>
            <label className="set-field"><span className="set-label">Description</span><TextBox minRows={4} maxRows={14} maxLength={8000} value={fields.description} onChange={(e) => set("description")(e.target.value)} /></label>
            {!feature && <label className="set-field"><span className="set-label">Acceptance criteria</span><TextBox minRows={4} maxRows={12} maxLength={8000} value={fields.acceptance} onChange={(e) => set("acceptance")(e.target.value)} /></label>}
            <p className="muted cd-type">Type: {s === "ai" && draft?.ai?.type ? draft.ai.type : "the process default"}</p>
          </>
        ) : words ? (
          <dl className="cd-read">
            <dt>Title</dt><dd>{words.title}</dd>
            <dt>Description</dt><dd>{words.description || <span className="muted">(none)</span>}</dd>
            {!feature && <><dt>Acceptance criteria</dt><dd className="cd-pre">{words.acceptance || <span className="muted">(none)</span>}</dd></>}
            <dt>Type</dt><dd>{s === "ai" && draft?.ai?.type ? draft.ai.type : "The process default"}</dd>
          </dl>
        ) : null}
      </section>
    );
  };

  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog create-draft"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={client ? `Creating in ${clientName}'s DevOps` : "Create in DevOps"}
        style={color ? ({ "--c": color } as CSSProperties) : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head cd-head">
          <h2 className="cd-client">
            <span className="swatch" aria-hidden="true" />
            {client ? `Creating in ${clientName}'s DevOps` : "Create in DevOps"}
          </h2>
          <span className="muted">{feature ? "A new feature" : "A new story"}, from your capture. Nothing is created until you confirm the preview.</span>
          <CloseButton onClose={onClose} disabled={busy} />
        </div>
        {!view ? (
          <p className="muted" role="status">{loadError ?? "Loading the draft…"}</p>
        ) : !view.canWrite ? (
          <div className="cd-nopat">
            <p>DevOps is read-only for {clientName} until you add your own write PAT.</p>
            <button type="button" className="commit" onClick={() => (onClose(), w?.enable(client!))}>Add a write PAT for {clientName}</button>
          </div>
        ) : (
          <>
            <div className="cd-sides">
              {column("mine")}
              {column("ai")}
            </div>
            <div className="set-field cd-parent">
              <span className="set-label">Parent {parentWord}</span>
              <ItemLookup
                clientKey={client}
                value={parentValue}
                onChange={setParent}
                label={`Parent ${parentWord}`}
                pool={(features?.status === "ok" ? pool : undefined) ?? NO_POOL}
                placeholder={!features ? `Loading ${parentWord}s…` : features.status !== "ok" ? `DevOps unavailable: no ${parentWord}s to choose` : `Search ${clientName}'s open ${parentWord}s`}
              />
              {aiParent !== null && !parent && draft?.parentItemId === null && <span className="muted cd-why">Suggested by AI{draft.ai?.parentReason ? `: ${draft.ai.parentReason}` : ""}</span>}
            </div>
          </>
        )}
        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions">
          {view?.canWrite && (
            <button type="button" className="commit" disabled={busy || !fields?.title.trim() || parentId === null} title={parentId === null ? `Choose a parent ${parentWord} first` : undefined} onClick={() => void preview()}>
              Preview in DevOps
            </button>
          )}
          <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>Not now</button>
          {view?.canWrite && parentId === null && <span className="muted">Needs a parent {parentWord}</span>}
        </div>
      </div>
    </div>
  );
}
