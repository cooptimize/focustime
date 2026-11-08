// SR-1: Week › Status. A preview of Monday's status report (Kat sends it; FocusTime never does) and the comments that
// feed it, across my clients. Edit (the default) has a box per feature: new lines (each its own DevOps comment, its own
// bullet on Monday), in-place edits of my own comments in the window, and Draft (AI, one request per client). Preview
// reads like the email. Nothing is written until Push all: one preview of every line and edit across clients, then the
// write framework's own writes, each read back, logged and undoable, with a result per line and Retry.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { StatusClient, StatusComment, StatusFeature, StatusLoad } from "../plan/status-types.ts";
import type { DevOpsPreview, DevOpsResult } from "../actions/types.ts";
import { call } from "./api.ts";
import { CloseButton } from "./CloseButton.tsx";
import { MentionFlag, Modal } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import { WorkLink } from "./WorkLink.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** A line waiting for Push all: a new comment on a feature, or an edit of one of my comments. */
export type Line = { key: string; clientKey: string; itemId: number; kind: "comment" | "comment_edit"; commentId: number | null; text: string; from: "me" | "ai" };
type Refused = { itemId: number | null; error: string; code: string | null; key?: string };
type Batch = { previews: DevOpsPreview[]; nothing: string[]; refused: Refused[] };
/** A line that went to DevOps: its write (for Undo) and how it ended. */
type Pushed = { key: string; clientKey: string; itemId: number; text: string; kind: Line["kind"]; ok: boolean; message: string; writeId: number | null; undone?: boolean };

const STORE = "focustime.status.lines";
const BATCH = 10;

/** Unsent lines survive a reload in this browser only (a convenience; never the record). */
function savedLines(report: string): Line[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as { report?: string; lines?: Line[] } | null;
    return v?.report === report && Array.isArray(v.lines) ? v.lines.filter((l) => l && typeof l.key === "string" && typeof l.text === "string") : [];
  } catch {
    return [];
  }
}
function saveLines(report: string, lines: Line[]) {
  try {
    if (lines.length) localStorage.setItem(STORE, JSON.stringify({ report, lines }));
    else localStorage.removeItem(STORE);
  } catch {
    /* private window or blocked storage: lines live for this page only */
  }
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

const when = (iso: string, zone?: string) => {
  try {
    return Temporal.Instant.from(iso).toZonedDateTimeISO(zone ?? Temporal.Now.timeZoneId()).toPlainDateTime().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

export function StatusView({ switcher, colors, readOnly, version, onChanged }: { switcher?: React.ReactNode; colors: Record<string, string>; readOnly: boolean; version: unknown; onChanged: () => void }) {
  const [data, setData] = useState<StatusLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">(readOnly ? "preview" : "edit");
  const [lines, setLines] = useState<Line[]>([]);
  const [drafting, setDrafting] = useState<Record<string, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  const [push, setPush] = useState<{ batches: { clientKey: string; batch: Batch; lines: Line[] }[]; busy: boolean; results: Pushed[] | null } | null>(null);
  const [pushed, setPushed] = useState<Pushed[]>([]);
  const [undoing, setUndoing] = useState<{ p: Pushed; preview: DevOpsPreview | null; busy: boolean; error: string | null; done: string | null } | null>(null);
  const loaded = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await call<StatusLoad>("status.load", {});
      setData(d);
      setError(null);
      if (loaded.current !== d.reportDate) {
        loaded.current = d.reportDate;
        setLines(savedLines(d.reportDate));
      }
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => {
    if (data) saveLines(data.reportDate, lines);
  }, [data, lines]);

  const change = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = (c: StatusClient, f: StatusFeature, text = "", from: Line["from"] = "me") => setLines((ls) => [...ls, { key: newKey(), clientKey: c.clientKey, itemId: f.id, kind: "comment", commentId: null, text, from }]);
  const edit = (c: StatusClient, f: StatusFeature, cm: StatusComment) => setLines((ls) => (ls.some((l) => l.kind === "comment_edit" && l.commentId === cm.id) ? ls : [...ls, { key: newKey(), clientKey: c.clientKey, itemId: f.id, kind: "comment_edit", commentId: cm.id, text: cm.text, from: "me" }]));

  const ready = lines.filter((l) => l.text.trim() && !(l.kind === "comment_edit" && sameAsNow(data, l)));

  // AI: one request per client (Draft on one feature asks for that feature only); a draft lands in a new line.
  const draft = async (c: StatusClient, ids: number[] | null) => {
    const k = ids ? `${c.clientKey}:${ids.join(",")}` : c.clientKey;
    setDrafting((d) => ({ ...d, [k]: true }));
    setDraftNote((n) => ({ ...n, [c.clientKey]: "" }));
    try {
      const r = await call<{ ai: string; message: string | null; drafts: { itemId: number; text: string }[]; namesRemoved?: string }>("status.draft", { clientKey: c.clientKey, ...(ids ? { itemIds: ids } : {}) });
      if (r.ai !== "ok") setDraftNote((n) => ({ ...n, [c.clientKey]: r.message ?? "AI couldn't draft this time" }));
      // GD-2: the check after generation replaced another client's name; say so on the draft.
      if (r.ai === "ok" && r.namesRemoved) setDraftNote((n) => ({ ...n, [c.clientKey]: `${r.namesRemoved}: the AI's draft had one, and "another client" is written instead. Edit freely.` }));
      const got = r.drafts.filter((d) => d.text.trim());
      if (r.ai === "ok" && !got.length) setDraftNote((n) => ({ ...n, [c.clientKey]: "Nothing to draft from: no story activity, notes or captures this week" }));
      setLines((ls) => [...ls, ...got.filter((d) => !ls.some((l) => l.itemId === d.itemId && l.from === "ai" && l.text === d.text)).map((d) => ({ key: newKey(), clientKey: c.clientKey, itemId: d.itemId, kind: "comment" as const, commentId: null, text: d.text, from: "ai" as const }))]);
    } catch (e) {
      setDraftNote((n) => ({ ...n, [c.clientKey]: errText(e) }));
    } finally {
      setDrafting((d) => ({ ...d, [k]: false }));
    }
  };

  // Push all: preview every line, a client at a time in batches of 10, then show them together.
  const startPush = async () => {
    const byClient = new Map<string, Line[]>();
    for (const l of ready) (byClient.get(l.clientKey) ?? byClient.set(l.clientKey, []).get(l.clientKey)!).push(l);
    setPush({ batches: [], busy: true, results: null });
    const batches: { clientKey: string; batch: Batch; lines: Line[] }[] = [];
    try {
      for (const [clientKey, ls] of byClient) {
        for (let i = 0; i < ls.length; i += BATCH) {
          const part = ls.slice(i, i + BATCH);
          try {
            const batch = await call<Batch>("devops.preview", { clientKey, changes: part.map((l) => ({ key: l.key, kind: l.kind, itemId: l.itemId, text: l.text.trim(), ...(l.kind === "comment_edit" ? { commentId: l.commentId } : {}) })) });
            batches.push({ clientKey, batch, lines: part });
          } catch (e) {
            batches.push({ clientKey, batch: { previews: [], nothing: [], refused: part.map((l) => ({ itemId: l.itemId, error: errText(e), code: null, key: l.key })) }, lines: part });
          }
        }
      }
      setPush({ batches, busy: false, results: null });
    } catch (e) {
      setError(errText(e));
      setPush(null);
    }
  };
  // GD-2: the flag's one click for a batch: preview it again with "another client" written, and keep the boxes in step.
  const replacePush = async (i: number) => {
    if (!push) return;
    const b = push.batches[i]!;
    setPush({ ...push, busy: true });
    try {
      const batch = await call<Batch>("devops.preview", { clientKey: b.clientKey, changes: b.lines.map((l) => ({ key: l.key, kind: l.kind, itemId: l.itemId, text: l.text.trim(), mentions: "replace", ...(l.kind === "comment_edit" ? { commentId: l.commentId } : {}) })) });
      const after = new Map(batch.previews.map((p) => [p.key, p.fields[0]?.after ?? null]));
      const lines2 = b.lines.map((l) => (after.get(l.key) ? { ...l, text: after.get(l.key)!, from: "me" as const } : l));
      setLines((ls) => ls.map((l) => lines2.find((x) => x.key === l.key) ?? l));
      setPush({ ...push, busy: false, batches: push.batches.map((x, j) => (j === i ? { ...x, batch, lines: lines2 } : x)) });
    } catch (e) {
      setError(errText(e));
      setPush({ ...push, busy: false });
    }
  };
  const confirmPush = async () => {
    if (!push) return;
    setPush({ ...push, busy: true });
    const results: Pushed[] = [];
    for (const b of push.batches) {
      const ids = b.batch.previews.map((p) => p.previewId);
      if (!ids.length) continue;
      let r: { results: (DevOpsResult | { error: string; status: number })[] } | null = null;
      try {
        // GD-2: lines I wrote go as written once I've seen the flag (the button says so).
        r = await call("devops.confirm", { previewIds: ids, ...(b.batch.previews.some((p) => p.mentions?.length) ? { mentionsOk: true } : {}) });
      } catch (e) {
        for (const p of b.batch.previews) {
          const l = b.lines.find((x) => x.key === p.key)!;
          results.push({ key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: false, message: errText(e), writeId: null });
        }
        continue;
      }
      b.batch.previews.forEach((p, i) => {
        const l = b.lines.find((x) => x.key === p.key)!;
        const res = r!.results[i]!;
        results.push("error" in res ? { key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: false, message: res.error, writeId: null } : { key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: res.confirmed, message: res.message, writeId: res.entry.id });
      });
    }
    setPush({ ...push, busy: false, results });
    // A line that went in leaves the boxes; one that didn't stays, with its reason, for Retry.
    const ok = new Set(results.filter((x) => x.ok).map((x) => x.key));
    setLines((ls) => ls.filter((l) => !ok.has(l.key)));
    setPushed((p) => [...results.filter((x) => x.ok || x.writeId !== null), ...p.filter((x) => !results.some((y) => y.key === x.key))]);
    await load();
    onChanged();
  };
  // Retry a write that went out but wasn't read back (the write framework checks first and never posts twice).
  const retry = async (p: Pushed) => {
    if (p.writeId === null) return;
    try {
      const r = await call<DevOpsResult>("devops.retry", { id: p.writeId });
      setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, ok: r.confirmed, message: r.message } : x)));
      if (r.confirmed) setLines((ls) => ls.filter((l) => l.key !== p.key));
      await load();
    } catch (e) {
      setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, message: errText(e) } : x)));
    }
  };
  const startUndo = async (p: Pushed) => {
    setUndoing({ p, preview: null, busy: true, error: null, done: null });
    try {
      const r = await call<{ preview?: DevOpsPreview; nothing?: string }>("devops.preview", { clientKey: p.clientKey, change: { kind: "undo", writeId: p.writeId } });
      setUndoing({ p, preview: r.preview ?? null, busy: false, error: r.nothing ?? null, done: null });
    } catch (e) {
      setUndoing({ p, preview: null, busy: false, error: errText(e), done: null });
    }
  };
  const confirmUndo = async () => {
    if (!undoing?.preview) return;
    setUndoing({ ...undoing, busy: true });
    try {
      const r = await call<DevOpsResult>("devops.confirm", { previewId: undoing.preview.previewId });
      setUndoing({ ...undoing, busy: false, done: r.message, error: r.confirmed ? null : r.message });
      if (r.confirmed) setPushed((all) => all.map((x) => (x.key === undoing.p.key ? { ...x, undone: true } : x)));
      await load();
      onChanged();
    } catch (e) {
      setUndoing({ ...undoing, busy: false, error: errText(e) });
    }
  };

  const counts = useMemo(() => (data ? liveCounts(data, lines) : null), [data, lines]);

  return (
    <main className="status-view" aria-label="Status">
      <header className="page-head">
        <div className="ph-title">
          <h2>{data?.title ?? "Status report"}</h2>
          <span className="muted st-sends">{data?.sends ?? "Kat sends it Monday 7:00 AM"}</span>
        </div>
        <ModeArea>
          {!readOnly && (
            <span className="st-toggle" data-tour="st-toggle" role="group" aria-label="Show">
              <button type="button" className="ms-btn" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Edit</button>
              <button type="button" className="ms-btn" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
            </span>
          )}
          {switcher}
        </ModeArea>
      </header>
      <p className="muted st-intro">What Monday's report will show for your features, a heading each with this week's comments. Add your own lines here; Kat sends the email, not FocusTime.</p>
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data ? (
        <p className="muted">Reading this week's comments…</p>
      ) : (
        <>
          <div className="st-bar">
            <p className="st-count" role="status">{counts!.line}</p>
            {!readOnly && (
              <span className="st-push" data-tour="st-push">
                {ready.length > 0 && <span className="muted">{ready.length === 1 ? "1 line to push" : `${ready.length} lines to push`}</span>}
                <button type="button" className="commit" disabled={!ready.length || !!push} onClick={() => void startPush()}>Push all</button>
              </span>
            )}
          </div>
          {pushed.length > 0 && <PushedList pushed={pushed} data={data} onRetry={(p) => void retry(p)} onUndo={(p) => void startUndo(p)} onClear={() => setPushed([])} />}
          {!data.clients.length && <p className="muted">No clients with DevOps this week. The features you plan or work on show here.</p>}
          {data.clients.map((c) => (
            <ClientSection key={c.clientKey} c={c} color={clientColor(c.clientKey, colors)} mode={readOnly ? "preview" : mode} lines={lines.filter((l) => l.clientKey === c.clientKey)} drafting={drafting} draftNote={draftNote[c.clientKey] ?? ""}
              onAdd={addLine} onEdit={edit} onChange={change} onRemove={remove} onDraft={(ids) => void draft(c, ids)} />
          ))}
        </>
      )}
      {push && <PushDialog push={push} data={data} onConfirm={() => void confirmPush()} onReplace={(i) => void replacePush(i)} onClose={() => setPush(null)} />}
      {undoing && <UndoDialog u={undoing} onConfirm={() => void confirmUndo()} onClose={() => setUndoing(null)} />}
    </main>
  );
}

/** An edit that says what the comment says now isn't a change. */
function sameAsNow(data: StatusLoad | null, l: Line): boolean {
  const cm = data?.clients.flatMap((c) => [...c.features, ...c.also]).find((f) => f.id === l.itemId)?.thisWeek?.find((x) => x.id === l.commentId);
  return !!cm && cm.text.trim() === l.text.trim();
}

/** The count at the top, with lines not pushed yet shown as "ready" rather than counted. */
function liveCounts(d: StatusLoad, lines: Line[]): { line: string } {
  const pending = new Set(lines.filter((l) => l.kind === "comment" && l.text.trim()).map((l) => `${l.clientKey}:${l.itemId}`));
  const fs = d.clients.flatMap((c) => c.features.map((f) => ({ c, f })));
  const ready = fs.filter(({ c, f }) => !(f.thisWeek?.length) && pending.has(`${c.clientKey}:${f.id}`)).length;
  return { line: `${d.countLine}${ready ? ` · ${ready} ready to push` : ""}` };
}

function ClientSection({ c, color, mode, lines, drafting, draftNote, onAdd, onEdit, onChange, onRemove, onDraft }: {
  c: StatusClient; color: string; mode: "edit" | "preview"; lines: Line[]; drafting: Record<string, boolean>; draftNote: string;
  onAdd: (c: StatusClient, f: StatusFeature, text?: string) => void; onEdit: (c: StatusClient, f: StatusFeature, cm: StatusComment) => void; onChange: (key: string, patch: Partial<Line>) => void; onRemove: (key: string) => void; onDraft: (ids: number[] | null) => void;
}) {
  const sent = c.window.source === "kat" && c.window.katSentAt ? `Kat last sent ${c.clientName}'s report ${when(c.window.katSentAt)}` : c.window.note;
  const canDraft = mode === "edit" && c.canWrite && c.ai === "ok" && c.features.length > 0;
  return (
    <section className={`st-client${mode === "preview" ? " st-email" : ""}`} style={{ "--c": color } as CSSProperties} aria-label={c.clientName}>
      <header className="st-client-head">
        <h3 className="carry-client-name">
          <span className="swatch" aria-hidden="true" />
          {c.clientName}
        </h3>
        {canDraft && (
          <button type="button" className="mini" disabled={!!drafting[c.clientKey]} onClick={() => onDraft(null)} title={`Suggested lines for every ${c.clientName} feature, from this week's activity (one AI request)`}>
            {drafting[c.clientKey] ? "Drafting…" : "Draft all"}
          </button>
        )}
      </header>
      {sent && <p className="muted st-sent">{sent}</p>}
      {c.status !== "ok" ? <p className="set-problem">{c.message}</p> : c.message && <p className="set-problem">{c.message}</p>}
      {draftNote && <p className="muted st-note" role="status">{draftNote}</p>}
      {mode === "edit" && !c.canWrite && c.features.length > 0 && <p className="muted st-note">Read only: add your DevOps write access for {c.clientName} in <a href="#/settings/devops/devops-write">Settings › DevOps</a> to write here.</p>}
      {c.status === "ok" && !c.features.length && <p className="muted">Nothing planned or worked on for {c.clientName} this week.</p>}
      <div className="st-features">
        {c.features.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} drafting={!!drafting[`${c.clientKey}:${f.id}`] || !!drafting[c.clientKey]} onAdd={onAdd} onEdit={onEdit} onChange={onChange} onRemove={onRemove} onDraft={() => onDraft([f.id])} />
        ))}
      </div>
      {mode === "edit" && c.also.length > 0 && (
        <details className="st-also">
          <summary>Also assigned to you ({c.also.length})</summary>
          <p className="muted st-note">Not on this week's plan and no story touched. They show in Monday's report only if someone comments.</p>
          <div className="st-features">
            {c.also.map((f) => (
              <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} drafting={false} onAdd={onAdd} onEdit={onEdit} onChange={onChange} onRemove={onRemove} onDraft={null} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function FeatureBlock({ c, f, mode, lines, drafting, onAdd, onEdit, onChange, onRemove, onDraft }: {
  c: StatusClient; f: StatusFeature; mode: "edit" | "preview"; lines: Line[]; drafting: boolean;
  onAdd: (c: StatusClient, f: StatusFeature, text?: string) => void; onEdit: (c: StatusClient, f: StatusFeature, cm: StatusComment) => void; onChange: (key: string, patch: Partial<Line>) => void; onRemove: (key: string) => void; onDraft: (() => void) | null;
}) {
  const comments = f.thisWeek ?? [];
  const added = lines.filter((l) => l.kind === "comment");
  const editOf = (id: number) => lines.find((l) => l.kind === "comment_edit" && l.commentId === id);
  const empty = !comments.length && !added.some((l) => l.text.trim());
  const writable = mode === "edit" && c.canWrite;

  if (mode === "preview") {
    // As Monday's email reads: the heading, then each comment as a bullet and its author; lines not pushed yet in italics.
    return (
      <article className="st-feature" aria-label={f.title}>
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        {f.thisWeek === null ? (
          <p className="set-problem st-line">Comments couldn't be read</p>
        ) : comments.length || added.length ? (
          <ul className="st-bullets">
            {comments.map((cm) => {
              const e = editOf(cm.id);
              return <li key={cm.id} className={e ? "st-pending" : ""}>{e ? e.text : cm.text} <span className="st-author">· {cm.author}</span></li>;
            })}
            {added.filter((l) => l.text.trim()).map((l) => <li key={l.key} className="st-pending">{l.text} <span className="st-author">· you, not pushed yet</span></li>)}
          </ul>
        ) : (
          <p className="st-none">No update yet</p>
        )}
      </article>
    );
  }

  return (
    <article className={`st-feature${empty ? " st-empty" : ""}`} aria-label={f.title}>
      <div className="st-feature-head">
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        <span className="muted st-meta">#{f.id} · {f.state}</span>
        {f.thisWeek !== null && (comments.length ? <span className="st-has">{comments.length === 1 ? "1 update" : `${comments.length} updates`}</span> : <span className="st-badge">No update yet</span>)}
      </div>
      {f.thisWeek === null && <p className="set-problem st-line">This feature's comments couldn't be read. Try again in a minute.</p>}
      {comments.length > 0 && (
        <ul className="st-comments" aria-label="This week">
          {comments.map((cm) => {
            const e = editOf(cm.id);
            return (
              <li key={cm.id} className={`st-comment who-${cm.who}`}>
                {e ? (
                  <LineBox line={e} label={`Edit your comment on ${f.title}`} onChange={onChange} onRemove={onRemove} removeLabel="Cancel edit" />
                ) : (
                  <>
                    <span className="st-text">{cm.text}</span>
                    <span className="st-by">
                      <span className="st-author">{cm.who === "mine" ? "You" : cm.author}{cm.who === "coop" ? " · Coop" : ""}</span>
                      <span className="muted"> · {when(cm.at)}</span>
                      {writable && cm.editable && <button type="button" className="link-btn" onClick={() => onEdit(c, f, cm)}>Edit</button>}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {writable && (
        <div className="st-new">
          {added.map((l) => (
            <LineBox key={l.key} line={l} label={`New line for ${f.title}`} onChange={onChange} onRemove={onRemove} removeLabel="Remove" />
          ))}
          <span className="st-adds">
            <button type="button" className="mini" data-tour="st-add" onClick={() => onAdd(c, f)}>+ Add a line</button>
            {onDraft && c.ai === "ok" && <button type="button" className="mini quiet" data-tour="st-draft" disabled={drafting} onClick={onDraft}>{drafting ? "Drafting…" : "Draft"}</button>}
          </span>
        </div>
      )}
      {f.hints.length > 0 && (c.ai !== "ok" || !writable ? (
        <div className="st-hints">
          <p className="st-hints-head">This week</p>
          <ul>{f.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      ) : (
        <details className="st-hints">
          <summary>What a draft uses ({f.hints.length})</summary>
          <ul>{f.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </details>
      ))}
      {f.lastWeek.length > 0 && (
        <details className="st-last">
          <summary>Last week ({f.lastWeek.length})</summary>
          <ul>{f.lastWeek.map((cm) => <li key={cm.id}>{cm.text} <span className="st-author">· {cm.who === "mine" ? "You" : cm.author}</span></li>)}</ul>
        </details>
      )}
    </article>
  );
}

function LineBox({ line, label, onChange, onRemove, removeLabel }: { line: Line; label: string; onChange: (key: string, patch: Partial<Line>) => void; onRemove: (key: string) => void; removeLabel: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!line.text) ref.current?.focus();
  }, [line.text]);
  // GD-2 point 6: these lines feed the client's status report; another client's name is flagged as I type (a pause).
  const [flag, setFlag] = useState<{ names: string[]; replaced: string } | null>(null);
  useEffect(() => {
    const text = line.text.trim();
    if (text.length < 3) return void setFlag(null);
    let live = true;
    const t = window.setTimeout(() => {
      call<{ names: string[]; replaced: string[] }>("boundary.check", { clientKey: line.clientKey, texts: [line.text] }).then(
        (r) => live && setFlag(r.names.length ? { names: r.names, replaced: r.replaced[0] ?? line.text } : null),
        () => live && setFlag(null),
      );
    }, 500);
    return () => ((live = false), window.clearTimeout(t));
  }, [line.text, line.clientKey]);
  return (
    <div className={`st-box${line.from === "ai" ? " st-suggested" : ""}${line.kind === "comment_edit" ? " st-editing" : ""}`}>
      <textarea ref={ref} aria-label={label} rows={2} maxLength={4000} value={line.text} placeholder="What moved this week, and what's next" onChange={(e) => onChange(line.key, { text: e.target.value, from: "me" })} />
      {flag && <MentionFlag names={flag.names} where="this client's status report" onReplace={() => onChange(line.key, { text: flag.replaced, from: "me" })} />}
      <span className="st-box-foot">
        <span className="muted">{line.kind === "comment_edit" ? "Edits your comment" : line.from === "ai" ? "Suggested: edit it before you push" : "A new comment, its own bullet on Monday"}</span>
        <button type="button" className="link-btn" onClick={() => onRemove(line.key)}>{removeLabel}</button>
      </span>
    </div>
  );
}

function featureTitle(data: StatusLoad | null, clientKey: string, itemId: number): string {
  const c = data?.clients.find((x) => x.clientKey === clientKey);
  return [...(c?.features ?? []), ...(c?.also ?? [])].find((f) => f.id === itemId)?.title ?? `#${itemId}`;
}

function PushDialog({ push, data, onConfirm, onReplace, onClose }: { push: { batches: { clientKey: string; batch: Batch; lines: Line[] }[]; busy: boolean; results: Pushed[] | null }; data: StatusLoad | null; onConfirm: () => void; onReplace: (batch: number) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [push.busy]);
  const n = push.batches.reduce((s, b) => s + b.batch.previews.length, 0);
  const refused = push.batches.flatMap((b) => b.batch.refused.map((r) => ({ b, r })));
  const name = (k: string) => data?.clients.find((c) => c.clientKey === k)?.clientName ?? k;
  const result = (key: string | undefined) => push.results?.find((r) => r.key === key) ?? null;
  const flagged = push.batches.some((b) => b.batch.previews.some((p) => p.mentions?.length));
  const label = n === 1 ? "Push 1 line to DevOps" : `Push ${n} lines to DevOps`;
  return (
    <Modal label={label} busy={push.busy} onClose={onClose} wide>
      <div className="cap-dialog-head">
        <h2>{push.results ? "Pushed to DevOps" : label}</h2>
        <CloseButton onClose={onClose} disabled={push.busy} />
      </div>
      {!push.batches.length && push.busy && <p className="muted">Checking each line with DevOps…</p>}
      <div className="dw-rows">
        {push.batches.map((b, i) => ({ b, i })).filter(({ b }) => b.batch.previews.length || b.batch.refused.length).map(({ b, i }) => {
          const p0 = b.batch.previews[0];
          return (
            <section key={`${b.clientKey}${i}`} className="st-push-client" aria-label={name(b.clientKey)}>
              <h3>{name(b.clientKey)}</h3>
              {p0 && <p className="muted dw-note">DevOps · {p0.org} · {p0.project} · writes as {p0.identity}</p>}
              {b.batch.previews.map((p) => {
                const r = result(p.key);
                return (
                  <div key={p.previewId} className={`dw-row${r?.ok ? " done" : ""}`}>
                    <h4>{p.item} <span className="muted">· {p.op === "comment_edit" ? "edit your comment" : "new comment"}</span></h4>
                    {p.op === "comment_edit" ? (
                      <table className="wd-fields"><tbody>
                        <tr><th scope="row">Now</th><td>{p.fields[0]?.before ?? ""}</td></tr>
                        <tr className="changed"><th scope="row">After</th><td>{p.fields[0]?.after ?? ""}</td></tr>
                      </tbody></table>
                    ) : (
                      <p className="st-preview-text">{p.fields[0]?.after ?? ""}</p>
                    )}
                    {p.mentions?.length && !push.results ? <MentionFlag names={p.mentions} where={`${name(b.clientKey)}'s DevOps and Monday's report`} disabled={push.busy} onReplace={() => onReplace(i)} /> : null}
                    {r && <p className={r.ok ? "dw-ok" : "set-problem"} role={r.ok ? "status" : "alert"}>{r.message}</p>}
                  </div>
                );
              })}
              {b.batch.refused.map((r) => {
                const l = b.lines.find((x) => x.key === r.key);
                return (
                  <div key={r.key ?? r.error} className="dw-row st-refused">
                    <h4>{l ? featureTitle(data, b.clientKey, l.itemId) : "A line"} <span className="muted">· not pushed</span></h4>
                    {l && <p className="st-preview-text">{l.text}</p>}
                    <p className="set-problem" role="alert">{r.error}</p>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {push.batches[0]?.batch.previews[0] && <p className="wd-visibility"><strong>Who can see it:</strong> {push.batches[0].batch.previews[0].visibility}</p>}
      {refused.length > 0 && !push.results && <p className="muted">{refused.length === 1 ? "1 line can't be pushed" : `${refused.length} lines can't be pushed`}: {refused.length === 1 ? "it stays" : "they stay"} in {refused.length === 1 ? "its box" : "their boxes"} to fix.</p>}
      <div className="wd-actions">
        {!push.results ? (
          <button ref={first} type="button" className="commit" disabled={push.busy || !n} onClick={onConfirm}>{push.busy ? "Writing and checking…" : flagged ? `${label} as written` : label}</button>
        ) : null}
        <button type="button" className="mini quiet" disabled={push.busy} onClick={onClose}>{push.results ? "Close" : "Not now"}</button>
        <span className="muted">Each line is its own write, logged in Settings &gt; Data with Undo.</span>
      </div>
    </Modal>
  );
}

function PushedList({ pushed, data, onRetry, onUndo, onClear }: { pushed: Pushed[]; data: StatusLoad; onRetry: (p: Pushed) => void; onUndo: (p: Pushed) => void; onClear: () => void }) {
  return (
    <section className="st-pushed" aria-label="Pushed">
      <header className="st-pushed-head">
        <h3>Pushed just now</h3>
        <button type="button" className="link-btn" onClick={onClear}>Hide</button>
      </header>
      <ul>
        {pushed.map((p) => (
          <li key={p.key} className={p.ok ? "ok" : "bad"}>
            <span className="st-pushed-what">{featureTitle(data, p.clientKey, p.itemId)}: {p.text.length > 90 ? `${p.text.slice(0, 89)}…` : p.text}</span>
            <span className={p.ok ? "muted" : "set-problem"}>{p.undone ? "Undone" : p.message}</span>
            {!p.ok && p.writeId !== null && <button type="button" className="mini" onClick={() => onRetry(p)}>Retry</button>}
            {p.ok && !p.undone && p.writeId !== null && <button type="button" className="mini quiet" onClick={() => onUndo(p)}>Undo</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function UndoDialog({ u, onConfirm, onClose }: { u: { p: Pushed; preview: DevOpsPreview | null; busy: boolean; error: string | null; done: string | null }; onConfirm: () => void; onClose: () => void }) {
  const p = u.preview;
  return (
    <Modal label={p?.summary ?? "Undo"} busy={u.busy} onClose={onClose}>
      <div className="cap-dialog-head">
        <h2>{p?.summary ?? "Undo"}</h2>
        <CloseButton onClose={onClose} disabled={u.busy} />
      </div>
      {p && (
        <>
          <p className="muted dw-note">{p.item} · DevOps · {p.org} · {p.project}</p>
          <table className="wd-fields"><tbody>
            <tr><th scope="row">Now</th><td>{p.fields[0]?.before ?? "(none)"}</td></tr>
            <tr className="changed"><th scope="row">After</th><td>{p.fields[0]?.after ?? "(none)"}</td></tr>
          </tbody></table>
        </>
      )}
      {u.error && <p className="set-problem" role="alert">{u.error}</p>}
      {u.done && !u.error && <p className="dw-ok" role="status">{u.done}</p>}
      <div className="wd-actions">
        {p && !u.done && <button type="button" className="commit" disabled={u.busy} onClick={onConfirm}>{u.busy ? "Undoing…" : "Undo in DevOps"}</button>}
        <button type="button" className="mini quiet" disabled={u.busy} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
