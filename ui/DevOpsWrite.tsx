import { whenText } from "./labels.ts";
// DevOps writes in the window (step 14). Every change opens one preview dialog: org, project, item, each field before
// and after, link changes, the identity it writes as and who can see it. Confirm writes (with the rev test), reads
// back, and only then says so; a refusal because the item changed offers Reload (a fresh preview), anything not
// confirmed offers Retry. Clients without a write PAT get "Enable DevOps writes" (Settings > Clients) instead.
import { CloseButton } from "./CloseButton.tsx";
import { categoryWord } from "../plan/process.ts";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { draftRowState, draftRowText, prepareAgain } from "../plan/capture-prepare.ts";
import { CreateDraftCtx, WRITING_POLL_MS } from "./createdraft-ctx.ts";
import type { DevOpsLogView, DevOpsPreview, DevOpsResult, DraftAiView } from "../actions/types.ts";
import type { StateInfo } from "../plan/devopswrite.ts";
import type { DraftStory } from "../plan/types.ts";
import { parentChoices } from "../plan/devopswrite.ts";
import { DevOpsWork } from "./work.ts";
import { ActionRefusal, call } from "./api.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { DraftTitle } from "./DraftEditor.tsx";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

export type DevOpsChange =
  | { kind: "state"; itemId: number; state: string; comment?: string; followUpId?: number }
  | { kind: "comment"; itemId: number; text: string }
  | { kind: "create"; draftId: number; /** PV-1: the story's type (the parent type's default child), when the parent takes it. */ type?: string }
  /** PV-1: Take one: a teammate's open story assigned to me. */
  | { kind: "assign"; itemId: number }
  /** AH-1: my pending changes in Ahead for one item (dates, size, assignee), one patch. */
  | { kind: "fields"; itemId: number }
  | { kind: "target_date"; itemId: number; date: string; /** Step 17: Save dates to DevOps (where the process has Start Date). */ startDate?: string }
  | { kind: "undo"; writeId: number }
  /** AP-1: a bug, story or feature from an ask in a client chat. */
  | { kind: "request_create"; chatId: string; messageId: string; level: "bug" | "story" | "feature" }
  /** CV-1: from a conversation: an item (the path of action, the original messages appended by the server), a suggested comment, a description change. */
  | { kind: "conversation_create"; conversationId: number; commitmentId?: number; title: string; description: string; level: "bug" | "story" | "feature"; type?: string; parentId?: number; includeInternal?: boolean; /** CV-4: the ticked images (all, when absent). */ images?: number[]; /** CV-5 */ acceptance?: string; assign?: "me" | "none" }
  | { kind: "conversation_comment"; suggestionId: number; includeInternal?: boolean; text?: string }
  /** CV-5: "Also add a comment on the item" after Link to item (a conversation, or my promise by commitmentId). */
  | { kind: "conversation_comment"; conversationId: number; itemId: number; text?: string }
  | { kind: "conversation_comment"; commitmentId: number; itemId: number; text?: string }
  | { kind: "description_update"; suggestionId: number; after?: string };

export type DevOpsWriteEnv = {
  /** Clients with a checked write PAT. */
  can: (clientKey: string) => boolean;
  /**
   * Preview one change or several (at most 10), then the dialog. PV-1: `settled` hears how it ended once: confirmed
   * (every change confirmed), or not, and whether anything was sent to DevOps (a cancel before Confirm sends nothing).
   */
  begin: (clientKey: string, changes: DevOpsChange[], settled?: Settled) => Promise<void>;
  /** The state picker for "Mark done in DevOps". */
  markDone: (t: { clientKey: string; itemId: number; title: string; followUpId?: number }) => void;
  /** The create preview, with the draft's saved values (step 15.3: edited in the draft editor). */
  create: (clientKey: string, drafts: DraftStory[]) => void;
  targetDate: (t: { clientKey: string; itemId: number; title: string; current: string | null }) => void;
  enable: (clientKey: string) => void;
  /** Bumps after every DevOps write, so the write log reloads. */
  version: number;
  /** Retry a logged write that didn't confirm (it checks DevOps first). */
  retry: (id: number) => Promise<void>;
};
export const DevOpsWriteCtx = createContext<DevOpsWriteEnv | null>(null);
export const useDevOpsWrite = () => useContext(DevOpsWriteCtx);

type Row = { preview: DevOpsPreview; result: DevOpsResult | { error: string; status: number } | null };
export type Settled = (r: { confirmed: boolean; sent: boolean }) => void;
type Flow = { clientKey: string; changes: DevOpsChange[]; rows: Row[]; busy: boolean; error: string | null; settled?: Settled | undefined };
/** CP-1: how the preview names and colors a client. */
type ClientLook = { name: (clientKey: string) => string; color: (clientKey: string) => string | undefined };
type Ask =
  | { kind: "state"; clientKey: string; itemId: number; title: string; followUpId?: number }
  | { kind: "target"; clientKey: string; itemId: number; title: string; current: string | null };

/** The DevOps write flow, owned by App. `onDone` reloads the week (a draft became an item, a follow-up closed). */
export function useDevOpsWriteFlow(o: { allowed: readonly string[]; onDone: () => void; openSettings: () => void; client?: ClientLook }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [version, setVersion] = useState(0);
  const { onDone: reload, openSettings } = o;
  const onDone = useCallback(() => (setVersion((v) => v + 1), reload()), [reload]);
  const begin = useCallback(
    async (clientKey: string, changes: DevOpsChange[], settled?: Settled) => {
      try {
        const r = await call<{ previews: DevOpsPreview[]; nothing: string[]; refused?: { itemId: number | null; error: string }[] }>("devops.preview", { clientKey, changes });
        // AH-1: items of a change set that were refused (a conflict, no right) are said once; the rest go on.
        if (r.refused?.length) notify(r.refused.length === 1 ? r.refused[0]!.error : `${r.refused.length} items weren't previewed: ${r.refused.map((x) => (x.itemId ? `#${x.itemId}` : "one")).join(", ")}. See the review.`);
        if (!r.previews.length) return void (r.refused?.length ? null : notify(r.nothing[0] ?? "Nothing to change in DevOps"), settled?.({ confirmed: false, sent: false }));
        setFlow({ clientKey, changes, rows: r.previews.map((preview) => ({ preview, result: null })), busy: false, error: null, settled });
      } catch (e) {
        settled?.({ confirmed: false, sent: false });
        if (e instanceof ActionRefusal && e.code === "no_write_pat") return void notify(`${e.message}.`);
        notify(errText(e));
      }
    },
    [],
  );
  const confirm = useCallback(
    async (f: Flow) => {
      setFlow({ ...f, busy: true, error: null });
      try {
        let rows: Row[];
        if (f.rows.some((r) => r.result)) {
          // Trying again: a logged write that didn't confirm is retried by its log entry (it checks before writing).
          rows = [];
          for (const r of f.rows) {
            const res = r.result;
            if (res && "entry" in res && !res.confirmed && res.entry.status !== "refused") rows.push({ ...r, result: await call<DevOpsResult>("devops.retry", { id: res.entry.id }).catch((e: unknown) => ({ error: errText(e), status: 0 })) });
            else rows.push(r);
          }
        } else {
          const out = await call<{ results: (DevOpsResult | { error: string; status: number })[] }>("devops.confirm", { previewIds: f.rows.map((r) => r.preview.previewId) });
          rows = f.rows.map((r, i) => ({ ...r, result: out.results[i] ?? null }));
        }
        onDone();
        const ok = rows.filter((r) => r.result && "confirmed" in r.result && r.result.confirmed);
        if (ok.length === rows.length) {
          setFlow(null);
          f.settled?.({ confirmed: true, sent: true });
          notify(ok.length === 1 ? (ok[0]!.result as DevOpsResult).message : `${ok.length} changes made in DevOps`);
        } else setFlow({ ...f, rows, busy: false, error: null });
      } catch (e) {
        setFlow({ ...f, busy: false, error: errText(e) });
      }
    },
    [onDone],
  );
  const env: DevOpsWriteEnv = {
    can: (k) => o.allowed.includes(k),
    begin,
    markDone: (t) => setAsk({ kind: "state", ...t }),
    create: (clientKey, drafts) => void begin(clientKey, drafts.slice(0, 10).map((d) => ({ kind: "create" as const, draftId: d.id }))),
    targetDate: (t) => setAsk({ kind: "target", ...t }),
    enable: () => openSettings(),
    version,
    retry: async (id) => {
      try {
        const r = await call<DevOpsResult>("devops.retry", { id });
        notify(r.message);
      } catch (e) {
        notify(errText(e));
      }
      onDone();
    },
  };
  const dialog = flow ? (
    <PreviewDialog flow={flow} client={o.client} onConfirm={() => void confirm(flow)} onReload={() => void begin(flow.clientKey, flow.changes, flow.settled)} onImages={(ids) => void begin(flow.clientKey, flow.changes.map((c) => (c.kind === "conversation_create" ? { ...c, images: ids } : c)), flow.settled)} onClose={() => (setFlow(null), flow.settled?.({ confirmed: false, sent: flow.rows.some((r) => r.result && "entry" in r.result) }))} />
  ) : ask ? (
    <AskDialog ask={ask} onClose={() => setAsk(null)} onPreview={(changes) => (setAsk(null), void begin(ask.clientKey, changes))} />
  ) : null;
  return { env, dialog };
}

function useModalFocus<T extends HTMLElement>() {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const first = useRef<T>(null);
  useEffect(() => {
    first.current?.focus();
    return () => back.current?.focus?.();
  }, []);
  return first;
}
function Modal({ label, busy, onClose, children, wide }: { label: string; busy?: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className={`cap-dialog write-dialog devops${wide ? " batch" : ""}`}
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function PreviewDialog({ flow, client, onConfirm, onReload, onImages, onClose }: { flow: Flow; client?: ClientLook | undefined; onConfirm: () => void; onReload: () => void; /** CV-4: ticked images changed: preview again with these. */ onImages: (ids: number[]) => void; onClose: () => void }) {
  const first = useModalFocus<HTMLButtonElement>();
  const { rows, busy, error } = flow;
  const p0 = rows[0]!.preview;
  const done = (r: Row) => !!r.result && "confirmed" in r.result && r.result.confirmed;
  const tried = rows.some((r) => r.result);
  const changed = rows.some((r) => r.result && "entry" in r.result && r.result.entry.status === "refused" && r.result.changed);
  const retryable = rows.some((r) => r.result && ("error" in r.result ? r.result.status !== 410 && r.result.status !== 409 : !r.result.confirmed && r.result.entry.status !== "refused"));
  const label = rows.length === 1 ? p0.summary : `${rows.length} DevOps changes`;
  const clientWord = client?.name(flow.clientKey) ?? flow.clientKey;
  return (
    <Modal label={label} busy={busy} onClose={onClose} wide={rows.length > 1}>
      <div className="cap-dialog-head">
        <h2>{label}</h2>
        <CloseButton onClose={onClose} disabled={busy} />
      </div>
      {p0.op === "create" && (
        <p className="cd-client dw-client" style={{ "--c": client?.color(flow.clientKey) } as CSSProperties}>
          <span className="swatch" aria-hidden="true" />
          Creating in {clientWord}'s DevOps
        </p>
      )}
      <dl className="wd-where">
        <dt>Where</dt>
        <dd>
          DevOps · {clientWord} · {p0.org} · {p0.project}
        </dd>
        <dt>Writes as</dt>
        <dd>{p0.identity}</dd>
      </dl>
      <div className="dw-rows">
        {rows.map((r) => (
          <section key={r.preview.previewId} className={`dw-row${done(r) ? " done" : ""}`} aria-label={r.preview.item}>
            <h3>
              {r.preview.item}
              {rows.length > 1 && <span className="muted"> · {r.preview.summary}</span>}
            </h3>
            <table className="wd-fields">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  {r.preview.op !== "create" && <th scope="col">Now</th>}
                  <th scope="col">{r.preview.op === "create" ? "Will be" : "After"}</th>
                </tr>
              </thead>
              <tbody>
                {r.preview.fields.map((f) => (
                  <tr key={f.label} className={f.changed && r.preview.op !== "create" ? "changed" : ""}>
                    <th scope="row">{f.label}</th>
                    {r.preview.op !== "create" && <td>{f.before ?? "(none)"}</td>}
                    <td>{f.after ?? "(none)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.preview.attachments && r.preview.attachments.length > 0 && <AttachPicker list={r.preview.attachments} disabled={busy || tried} onChange={onImages} />}
            {[...r.preview.links, ...r.preview.notes].map((n) => (
              <p key={n} className="muted dw-note">
                {n}
              </p>
            ))}
            {r.result && (
              <p className={done(r) ? "dw-ok" : "set-problem"} role={done(r) ? "status" : "alert"}>
                {"error" in r.result ? r.result.error : r.result.message}
              </p>
            )}
          </section>
        ))}
      </div>
      <p className="wd-visibility">
        <strong>Who can see it:</strong> {p0.visibility}
      </p>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <div className="wd-actions">
        {!tried ? (
          <button ref={first} type="button" className="commit" disabled={busy} onClick={onConfirm}>
            {busy ? "Writing and checking…" : rows.length === 1 ? confirmLabel(p0) : `Make all ${rows.length} changes in DevOps`}
          </button>
        ) : changed ? (
          <button ref={first} type="button" className="commit" disabled={busy} onClick={onReload}>
            Reload and review again
          </button>
        ) : retryable ? (
          <button ref={first} type="button" className="commit" disabled={busy} onClick={onConfirm}>
            {busy ? "Checking…" : "Retry"}
          </button>
        ) : null}
        <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>
          {tried ? "Close" : "Not now"}
        </button>
        <span className="muted">Logged in Settings &gt; Data, with Undo.</span>
      </div>
    </Modal>
  );
}
/**
 * CV-4: a create's images from the conversation, as thumbnails with a checkbox each (all ticked to begin with). They
 * are read from Teams only when shown, and again with my sign-in when I confirm; FocusTime keeps no copy.
 */
function AttachPicker({ list, disabled, onChange }: { list: NonNullable<DevOpsPreview["attachments"]>; disabled: boolean; onChange: (ids: number[]) => void }) {
  const ticked = list.filter((a) => a.ticked).map((a) => a.id);
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  return (
    <fieldset className="dw-attach">
      <legend>
        {/* CV-5: one switch for all of them, ticked as CV-4 does; each image can still be left out. */}
        <label className="dw-attach-all">
          <input type="checkbox" checked={ticked.length > 0} ref={(el) => void (el && (el.indeterminate = ticked.length > 0 && ticked.length < list.length))} disabled={disabled} onChange={(e) => onChange(e.target.checked ? list.map((a) => a.id) : [])} /> Attach {list.length === 1 ? "1 image" : `${list.length} images`}
        </label>{" "}
        <span className="muted">· {ticked.length} of {list.length}</span>
      </legend>
      <ul>
        {list.map((a, n) => (
          <li key={a.id}>
            <label>
              <input type="checkbox" checked={a.ticked} disabled={disabled} aria-label={`Attach image ${n + 1} from ${a.sender}${a.description ? `: ${a.description}` : ""}`} onChange={(e) => onChange(e.target.checked ? [...ticked, a.id] : ticked.filter((x) => x !== a.id))} />
              {gone.has(a.id) ? <span className="dw-attach-gone muted">Image in Teams</span> : <img src={a.src} alt={a.description ?? ""} loading="lazy" decoding="async" onError={() => setGone((g) => new Set(g).add(a.id))} />}
              <span className="dw-attach-who muted">{a.description ?? a.sender}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
const confirmLabel = (p: DevOpsPreview) =>
  p.op === "create" ? "Create in DevOps" : p.op === "comment" ? "Add comment in DevOps" : p.op === "state" ? "Change state in DevOps" : p.op === "target_date" ? "Set target date in DevOps" : "Undo in DevOps";

/** The small form before a preview: a state and comment, or a date. */
function AskDialog({ ask, onClose, onPreview }: { ask: Ask; onClose: () => void; onPreview: (c: DevOpsChange[]) => void }) {
  const first = useModalFocus<HTMLSelectElement & HTMLTextAreaElement & HTMLInputElement>();
  const [states, setStates] = useState<StateInfo[] | null>(null);
  const [state, setState] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState(ask.kind === "target" ? ask.current ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (ask.kind !== "state") return;
    call<{ states: StateInfo[]; completed: string | null; state: string }>("devops.states", { clientKey: ask.clientKey, itemId: ask.itemId })
      .then((r) => {
        setStates(r.states);
        setCurrent(r.state);
        setState(r.completed ?? r.states[0]?.name ?? "");
      })
      .catch((e: unknown) => setError(errText(e)));
  }, [ask]);
  const title = ask.kind === "state" ? `Mark done in DevOps: #${ask.itemId}` : `Set target date: #${ask.itemId}`;
  return (
    <Modal label={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.kind === "state") onPreview([{ kind: "state", itemId: ask.itemId, state, ...(text.trim() ? { comment: text.trim() } : {}), ...(ask.followUpId ? { followUpId: ask.followUpId } : {}) }]);
          else onPreview([{ kind: "target_date", itemId: ask.itemId, date }]);
        }}
      >
        <div className="cap-dialog-head">
          <h2>{title}</h2>
          <CloseButton onClose={onClose} />
        </div>
        <p className="muted">{ask.title}</p>
        {ask.kind === "state" &&
          (states ? (
            <label className="set-field">
              <span className="set-label">State (now {current})</span>
              <select ref={first} value={state} onChange={(e) => setState(e.target.value)}>
                {states.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({categoryWord(s.category)})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            !error && <p className="muted">Reading the states from DevOps…</p>
          ))}
        {ask.kind === "state" && (
          <label className="set-field">
            <span className="set-label">Comment (optional, shown in the item's discussion)</span>
            <textarea value={text} maxLength={4000} rows={3} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        {ask.kind === "target" && (
          <label className="set-field">
            <span className="set-label">Target date</span>
            <input ref={first} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="set-problem" role="alert">
            {error}
          </p>
        )}
        <div className="wd-actions">
          <button type="submit" className="commit" disabled={(ask.kind === "state" && !state) || (ask.kind === "target" && !date)}>
            Preview
          </button>
          <button type="button" className="mini quiet" onClick={onClose}>
            Not now
          </button>
          <span className="muted">Nothing is written until you confirm the preview.</span>
        </div>
      </form>
    </Modal>
  );
}

/** A write action, or "Enable DevOps writes" for a client without a write PAT. */
export function DevOpsAction({ clientKey, label, onRun, className = "mini" }: { clientKey: string; label: string; onRun: (env: DevOpsWriteEnv) => void; className?: string }): ReactNode {
  const env = useDevOpsWrite();
  if (!env) return null;
  if (!env.can(clientKey))
    return (
      <button type="button" className={`${className} quiet dw-enable`} onClick={() => env.enable(clientKey)} title={`DevOps is read-only for this client until you add your own write PAT in Settings > Clients`}>
        Enable DevOps writes
      </button>
    );
  return (
    <button type="button" className={className} onClick={() => onRun(env)}>
      {label}
    </button>
  );
}

/**
 * "Create in DevOps" for one draft (or several under one parent). A draft with no parent first asks for one (D257):
 * that client's open features for a story, open epics for a draft feature. Nothing is created without a parent.
 */
export function CreateInDevOps({ drafts, label }: { drafts: DraftStory[]; label?: string }): ReactNode {
  const env = useDevOpsWrite();
  const work = useContext(DevOpsWork);
  const [choosing, setChoosing] = useState(false);
  const d0 = drafts[0];
  if (!env || !d0) return null;
  const loose = drafts.filter((d) => d.parentItemId === null);
  if (loose.length && drafts.length > 1) return null;
  if (!loose.length) return <DevOpsAction clientKey={d0.clientKey} label={label ?? "Create in DevOps"} onRun={(w) => w.create(d0.clientKey, drafts)} />;
  const kind = d0.level === "feature" ? "epic" : "feature";
  if (!choosing) return <DevOpsAction clientKey={d0.clientKey} label={label ?? "Create in DevOps"} onRun={() => setChoosing(true)} />;
  const options = parentChoices(work.get(d0.clientKey)?.items ?? [], d0.level === "feature" ? "feature" : "story");
  const choose = async (parentItemId: number) => {
    try {
      const r = await call<{ draft: DraftStory }>("draft.set_parent", { id: d0.id, parentItemId });
      setChoosing(false);
      env.create(d0.clientKey, [r.draft]);
    } catch (e) {
      notify(errText(e));
    }
  };
  return (
    <span className="dw-parent" role="group" aria-label={`Choose a parent for ${d0.title}`}>
      {options.length ? (
        <select autoFocus aria-label={`Parent ${kind}`} value="" onChange={(e) => e.target.value && void choose(Number(e.target.value))}>
          <option value="">Choose a parent {kind}…</option>
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              #{i.id} {i.title}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted dw-hint">No open {kind}s for this client in DevOps yet. Add one there first</span>
      )}
      <button type="button" className="mini quiet" onClick={() => setChoosing(false)}>
        Cancel
      </button>
    </span>
  );
}

/**
 * Drafts not yet in DevOps, per client, each with Create in DevOps (the Inbox). CP-1: each row says what it needs
 * (Ready to create, Needs a parent, AI off: plain draft, AI still writing…, or Add a write PAT for <client>) and keeps
 * my own title; Create in DevOps opens the side by side preview. The list looks again while AI is writing.
 */
export function DraftsToAdd({ drafts, clientName, onChanged }: { drafts: DraftStory[]; clientName: (k: string) => string; onChanged: () => void }): ReactNode {
  const env = useDevOpsWrite();
  const openCreate = useContext(CreateDraftCtx);
  const now = new Date().toISOString();
  const states = drafts.map((d) => draftRowState(d, { canWrite: !!env?.can(d.clientKey), now }));
  const writing = states.includes("writing");
  useEffect(() => {
    if (!writing) return;
    const t = setTimeout(onChanged, WRITING_POLL_MS * 2);
    return () => clearTimeout(t);
  }, [writing, onChanged, drafts]);
  if (!drafts.length) return null;
  return (
    <section className="co-section dw-drafts-section" aria-label="Drafts to add in DevOps">
      <h3>
        Drafts to add in DevOps <span className="muted">{drafts.length}</span>
      </h3>
      <ul className="inbox-list">
        {drafts.map((d, i) => (
          <li key={d.id} className="cap-item">
            <p className="cap-text">
              <span className="cap-tag">{d.level === "feature" ? "Draft feature" : "Draft story"}</span>
              <DraftTitle draft={d} />
              <span className="muted">
                {" "}
                · {clientName(d.clientKey)}
                {d.parentItemId !== null ? ` · under #${d.parentItemId}` : ""}
              </span>
              <span className={`dw-draft-state ${states[i]}`} data-state={states[i]} title={d.ai?.note ?? undefined}>
                {draftRowText(states[i]!, d, clientName(d.clientKey))}
              </span>
            </p>
            {!env ? null : states[i] === "no_pat" ? (
              <button type="button" className="mini quiet dw-enable" onClick={() => env.enable(d.clientKey)}>Add a write PAT for {clientName(d.clientKey)}</button>
            ) : openCreate ? (
              <button type="button" className="mini" onClick={() => openCreate(d.id)}>Create in DevOps</button>
            ) : (
              <CreateInDevOps drafts={[d]} />
            )}
            <DraftMenu d={d} writing={states[i] === "writing"} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * UI-7: a draft row's ⋯: Prepare again (re-runs the AI version with the same caps and rules; shown once a prepare ran,
 * with a write PAT and AI available for the client now; disabled while AI is writing) and Delete (DevOps isn't touched).
 * Opening it reads the draft once for whether AI is available.
 */
function DraftMenu({ d, writing, onChanged }: { d: DraftStory; writing: boolean; onChanged: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DraftAiView | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    call<DraftAiView>("draft.get", { id: d.id }).then((v) => live && setView(v), () => live && setView(null));
    return () => void (live = false);
  }, [open, d.id, d.ai?.state]);
  const again = view ? prepareAgain(view.draft, { canWrite: view.canWrite, aiOn: view.aiOn, now: view.now }) : "hidden";
  const runAgain = async () => {
    setRunning(true);
    setOpen(false);
    // The row shows AI still writing… while it runs, then the new version.
    const shown = setTimeout(onChanged, 300);
    try {
      await call<DraftAiView>("draft.prepare", { id: d.id, again: true });
    } catch (e) {
      notify(errText(e));
    } finally {
      clearTimeout(shown);
      setRunning(false);
      onChanged();
    }
  };
  const remove = async () => {
    setOpen(false);
    try {
      await call("draft.remove", { id: d.id });
      notify(`Draft deleted: ${d.title}`);
      onChanged();
    } catch (e) {
      notify(errText(e));
    }
  };
  return (
    <span className="fu-more">
      <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={open} aria-label={`More for: ${d.title}`} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))}>
          {again !== "hidden" && (
            <button type="button" role="menuitem" disabled={running || writing || again === "writing"} title={running || writing || again === "writing" ? "AI is writing" : "Ask the AI for its version again"} onClick={() => void runAgain()}>
              Prepare again
            </button>
          )}
          <button type="button" role="menuitem" autoFocus title="Delete this local draft (DevOps isn't touched)" onClick={() => void remove()}>Delete</button>
        </span>
      )}
    </span>
  );
}

const OP_WORD: Record<string, string> = { state: "State changed", comment: "Comment added", create: "Created", target_date: "Target date set", undo_state: "Undo: state put back", undo_comment: "Undo: comment deleted", undo_create: "Undo: set to Removed", undo_target_date: "Undo: target date put back", description: "Description changed", undo_description: "Undo: description put back", fields: "Dates, size or owner changed", undo_fields: "Undo: dates, size and owner put back", feedback: "Feedback sent" };
const DW_STATUS: Record<string, string> = { pending: "Not finished", confirmed: "Confirmed", unconfirmed: "Not confirmed", failed: "Failed", refused: "Refused" };
const fmt = (v: Record<string, string | null>) => Object.entries(v).map(([k, x]) => `${k}: ${x ?? "(empty)"}`).join(", ");

/** Settings > Data (step 14): every DevOps write, newest first, with the values before and after, Undo and Retry. */
export function DevOpsWriteLog(): ReactNode {
  const env = useDevOpsWrite();
  const [log, setLog] = useState<DevOpsLogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<DevOpsLogView>("devops.log", {}).then(setLog, (e: unknown) => setError(errText(e)));
  }, [env?.version]);
  if (!log && !error) return null;
  return (
    <section className="write-log dw-log" aria-label="DevOps write log">
      <h3>DevOps write log</h3>
      <p className="muted">Every change FocusTime made in DevOps, with your write PAT, and the feedback you sent (made by FocusTime's own identity, with no undo). Nothing is ever deleted: undoing a new item sets it to Removed.</p>
      {error && <p className="set-problem">{error}</p>}
      {log && !log.entries.length && <p className="muted">Nothing written to DevOps yet.</p>}
      {log && log.entries.length > 0 && (
        <table className="wl-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Where</th>
              <th scope="col">Result</th>
              <th scope="col">Before → after</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((e) => (
              <tr key={e.id} className={`wl-${e.status}`}>
                <td>{whenText(e.at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</td>
                <td>
                  {OP_WORD[e.op] ?? e.op} <strong>{e.itemId !== null ? `#${e.itemId} ` : ""}{e.title}</strong>
                </td>
                <td>{e.org} · {e.project}<div className="muted">as {e.identity}</div></td>
                <td>
                  {DW_STATUS[e.status] ?? e.status}
                  {e.undoneBy !== null && <span className="muted"> · undone</span>}
                  {e.attempts > 1 && <span className="muted"> · {e.attempts} tries</span>}
                  {e.message && e.status !== "confirmed" && <div className="muted">{e.message}</div>}
                </td>
                <td className="muted">{Object.keys(e.before).length ? fmt(e.before) : "Nothing (new)"} → {fmt(e.after)}</td>
                <td>
                  {e.undoable && <button type="button" className="mini" onClick={() => void env?.begin(e.clientKey, [{ kind: "undo", writeId: e.id }])}>Undo</button>}
                  {e.retryable && <button type="button" className="mini" onClick={() => void env?.retry(e.id)}>Retry</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
