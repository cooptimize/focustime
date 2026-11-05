import { whenText } from "./labels.ts";
// DevOps writes in the window (step 14). Every change opens one preview dialog: org, project, item, each field before
// and after, link changes, the identity it writes as and who can see it. Confirm writes (with the rev test), reads
// back, and only then says so; a refusal because the item changed offers Reload (a fresh preview), anything not
// confirmed offers Retry. Clients without a write PAT get "Enable DevOps writes" (Settings > Clients) instead.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DevOpsLogView, DevOpsPreview, DevOpsResult } from "../actions/types.ts";
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
  | { kind: "create"; draftId: number }
  | { kind: "target_date"; itemId: number; date: string; /** Step 17: Save dates to DevOps (where the process has Start Date). */ startDate?: string }
  | { kind: "undo"; writeId: number }
  /** AP-1: a bug, story or feature from an ask in a client chat. */
  | { kind: "request_create"; chatId: string; messageId: string; level: "bug" | "story" | "feature" };

export type DevOpsWriteEnv = {
  /** Clients with a checked write PAT. */
  can: (clientKey: string) => boolean;
  /** Preview one change or several (at most 10), then the dialog. */
  begin: (clientKey: string, changes: DevOpsChange[]) => Promise<void>;
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
type Flow = { clientKey: string; changes: DevOpsChange[]; rows: Row[]; busy: boolean; error: string | null };
type Ask =
  | { kind: "state"; clientKey: string; itemId: number; title: string; followUpId?: number }
  | { kind: "target"; clientKey: string; itemId: number; title: string; current: string | null };

/** The DevOps write flow, owned by App. `onDone` reloads the week (a draft became an item, a follow-up closed). */
export function useDevOpsWriteFlow(o: { allowed: readonly string[]; onDone: () => void; openSettings: () => void }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [version, setVersion] = useState(0);
  const { onDone: reload, openSettings } = o;
  const onDone = useCallback(() => (setVersion((v) => v + 1), reload()), [reload]);
  const begin = useCallback(
    async (clientKey: string, changes: DevOpsChange[]) => {
      try {
        const r = await call<{ previews: DevOpsPreview[]; nothing: string[] }>("devops.preview", { clientKey, changes });
        if (!r.previews.length) return void notify(r.nothing[0] ?? "Nothing to change in DevOps");
        setFlow({ clientKey, changes, rows: r.previews.map((preview) => ({ preview, result: null })), busy: false, error: null });
      } catch (e) {
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
    <PreviewDialog flow={flow} onConfirm={() => void confirm(flow)} onReload={() => void begin(flow.clientKey, flow.changes)} onClose={() => setFlow(null)} />
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

function PreviewDialog({ flow, onConfirm, onReload, onClose }: { flow: Flow; onConfirm: () => void; onReload: () => void; onClose: () => void }) {
  const first = useModalFocus<HTMLButtonElement>();
  const { rows, busy, error } = flow;
  const p0 = rows[0]!.preview;
  const done = (r: Row) => !!r.result && "confirmed" in r.result && r.result.confirmed;
  const tried = rows.some((r) => r.result);
  const changed = rows.some((r) => r.result && "entry" in r.result && r.result.entry.status === "refused" && r.result.changed);
  const retryable = rows.some((r) => r.result && ("error" in r.result ? r.result.status !== 410 && r.result.status !== 409 : !r.result.confirmed && r.result.entry.status !== "refused"));
  const label = rows.length === 1 ? p0.summary : `${rows.length} DevOps changes`;
  return (
    <Modal label={label} busy={busy} onClose={onClose} wide={rows.length > 1}>
      <div className="cap-dialog-head">
        <h2>{label}</h2>
      </div>
      <dl className="wd-where">
        <dt>Where</dt>
        <dd>
          DevOps · {p0.org} · {p0.project}
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
        </div>
        <p className="muted">{ask.title}</p>
        {ask.kind === "state" &&
          (states ? (
            <label className="set-field">
              <span className="set-label">State (now {current})</span>
              <select ref={first} value={state} onChange={(e) => setState(e.target.value)}>
                {states.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.category === "InProgress" ? "in progress" : s.category.toLowerCase()})
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

/** Drafts not yet in DevOps, per client, each with Create in DevOps (the Inbox). */
export function DraftsToAdd({ drafts, clientName, onChanged }: { drafts: DraftStory[]; clientName: (k: string) => string; onChanged: () => void }): ReactNode {
  if (!drafts.length) return null;
  return (
    <section className="co-section dw-drafts-section" aria-label="Drafts to add in DevOps">
      <h3>
        Drafts to add in DevOps <span className="muted">{drafts.length}</span>
      </h3>
      <ul className="inbox-list">
        {drafts.map((d) => (
          <li key={d.id} className="cap-item">
            <p className="cap-text">
              <span className="cap-tag">{d.level === "feature" ? "Draft feature" : "Draft story"}</span>
              <DraftTitle draft={d} />
              <span className="muted">
                {" "}
                · {clientName(d.clientKey)}
                {d.parentItemId !== null ? ` · under #${d.parentItemId}` : ""}
              </span>
            </p>
            <CreateInDevOps drafts={[d]} />
            <button
              type="button"
              className="mini quiet"
              title="Delete this local draft (DevOps isn't touched)"
              onClick={async () => {
                try {
                  await call("draft.remove", { id: d.id });
                  notify(`Draft deleted: ${d.title}`);
                  onChanged();
                } catch (e) {
                  notify(errText(e));
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const OP_WORD: Record<string, string> = { state: "State changed", comment: "Comment added", create: "Created", target_date: "Target date set", undo_state: "Undo: state put back", undo_comment: "Undo: comment deleted", undo_create: "Undo: set to Removed", undo_target_date: "Undo: target date put back", description: "Description changed", undo_description: "Undo: description put back" };
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
      <p className="muted">Every change FocusTime made in DevOps, with your write PAT. Nothing is ever deleted: undoing a new item sets it to Removed.</p>
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
