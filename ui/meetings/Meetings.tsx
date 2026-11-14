// MC-1: Client calls, over the page (#/meetings, #/meetings/<occurrence>). The list: the registered calls I review
// or attend and their recent occurrences. The review: "Update <client>'s plan · <meeting> <date>", one row per
// proposal with the words it came from; a reviewer ticks, edits or skips each, then one Confirm shows every change in
// the usual preview and makes them through the existing writes. An attendee who isn't a reviewer can look, not confirm.
import { TextBox } from "../TextBox.tsx";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ActionRefusal, call, uploadMeetingTranscript } from "../api.ts";
import { useReturnFocus } from "../CloseButton.tsx";
import type { DevOpsPreview } from "../../actions/types.ts";
import type { OccurrenceView, SeriesView } from "../../plan/meeting-views.ts";
import type { Proposal, ProposalBody, Quote } from "../../plan/meetings.ts";
import { callLabel, type MineData } from "./calls.ts";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";

type Review = { meeting: SeriesView; occurrence: OccurrenceView; proposals: Proposal[]; transcript: { lines: number; speakers: number } | null; canConfirm: boolean; canWrite: boolean };
type Preview = Pick<DevOpsPreview, "previewId" | "key" | "op" | "summary" | "item" | "identity" | "fields" | "visibility" | "mentions">;
type Prepared = { previews: Preview[]; refused: { error: string; key?: string }[]; nothing: unknown[]; draftOnly: { proposalId: number; title: string; message: string }[]; commitments: { proposalId: number; who: string; side: string; what: string; due: string | null; shows: string }[]; skip: number[] };
type Done = { results: { proposalId: number; ok: boolean; message: string }[]; left: number };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const KIND_HEAD: Record<ProposalBody["kind"], string> = { gap: "New in DevOps", commitment: "Promises", comment: "Comments on DevOps items" };
const NOTE: Record<"decision" | "next_step" | "status", string> = { decision: "Decision", next_step: "Next step", status: "Status" };

export function Meetings({ occurrence, onOpen, onClose, colors }: { occurrence: number | null; onOpen: (id: number | null) => void; onClose: () => void; colors: Record<string, string> }) {
  useReturnFocus();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement | null)?.closest("input, textarea, select, dialog") && (e.preventDefault(), occurrence ? onOpen(null) : onClose());
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [occurrence, onOpen, onClose]);
  return (
    <main className="mtg-view" aria-label="Client calls" tabIndex={-1}>
      {occurrence ? <ReviewScreen id={occurrence} colors={colors} onBack={() => onOpen(null)} /> : <CallsList colors={colors} onOpen={onOpen} onClose={onClose} />}
    </main>
  );
}

function CallsList({ colors, onOpen, onClose }: { colors: Record<string, string>; onOpen: (id: number) => void; onClose: () => void }) {
  const [data, setData] = useState<MineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => call<MineData>("meeting.mine", {}).then(setData, (e: unknown) => setError(errText(e))), []);
  useEffect(() => void load(), [load]);
  return (
    <>
      <header className="page-head">
        <div className="ph-title">
          <h2>Client calls</h2>
          <span className="muted">The weekly calls you review or attend</span>
        </div>
        <button type="button" className="mini" onClick={onClose}>Close</button>
      </header>
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.meetings.length === 0 && <p className="muted">No client calls yet. A FocusTime admin registers a client's weekly call in Admin › Clients › Meetings, and you see it here once you review or attend it.</p>}
      {data?.meetings.map((m) => (
        <section key={m.id} className="mtg-series" style={{ "--c": clientColor(m.clientKey, colors) } as CSSProperties} aria-label={m.name}>
          <header className="mtg-series-head">
            <h3><span className="swatch" aria-hidden="true" /> {m.name}</h3>
            <span className="muted">{m.clientName} · {m.roleLabel} · {m.when} · {m.source === "automatic" ? "Transcript read after the call" : "Transcript uploaded by a reviewer"}</span>
          </header>
          <ul className="mtg-occs">
            {data.occurrences.filter((o) => o.seriesId === m.id).map((o) => {
              const l = callLabel(o, m.mine.review);
              return (
                <li key={o.id} className={l.needsMe ? "needs" : undefined}>
                  <span className="mtg-date">{dayLabel(o.date)}</span>
                  <span className="mtg-state">{l.label}</span>
                  <button type="button" className={`mini${l.needsMe ? " primary" : ""}`} onClick={() => onOpen(o.id)}>
                    {o.state === "needs_upload" && m.mine.review ? "Upload" : o.state === "ready" && m.mine.review && o.open ? "Review" : "Open"}
                  </button>
                </li>
              );
            })}
            {!data.occurrences.some((o) => o.seriesId === m.id) && <li className="muted">Nothing in the last five weeks.</li>}
          </ul>
        </section>
      ))}
    </>
  );
}

function ReviewScreen({ id, colors, onBack }: { id: number; colors: Record<string, string>; onBack: () => void }) {
  const [r, setR] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [prep, setPrep] = useState<{ busy: boolean; data: Prepared | null; error: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await call<Review>("meeting.review", { occurrenceId: id });
      setR(d);
      setKeep(new Set(d.proposals.filter((p) => p.state === "open" || p.state === "failed").map((p) => p.id)));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (error) return (<><BackHead onBack={onBack} title="Client call" /><p className="error-line" role="alert">{error}</p></>);
  if (!r) return (<><BackHead onBack={onBack} title="Client call" /><p className="muted">Loading…</p></>);
  const m = r.meeting;
  const o = r.occurrence;
  const open = r.proposals.filter((p) => p.state === "open" || p.state === "failed");
  const ticked = open.filter((p) => keep.has(p.id));
  const writes = ticked.filter((p) => p.kind !== "commitment").length;
  const color = clientColor(m.clientKey, colors);
  const editable = r.canConfirm;

  const edit = async (p: Proposal, patch: Record<string, unknown>) => {
    try {
      const { proposal } = await call<{ proposal: Proposal }>("meeting.edit", { proposalId: p.id, ...patch });
      setR((x) => (x ? { ...x, proposals: x.proposals.map((y) => (y.id === p.id ? proposal : y)) } : x));
    } catch (e) {
      setNote(errText(e));
    }
  };
  const startConfirm = async () => {
    setPrep({ busy: true, data: null, error: null });
    try {
      setPrep({ busy: false, data: await call<Prepared>("meeting.prepare", { occurrenceId: o.id, keep: ticked.map((p) => p.id) }), error: null });
    } catch (e) {
      setPrep({ busy: false, data: null, error: errText(e) });
    }
  };
  const confirm = async () => {
    if (!prep?.data) return;
    setPrep({ ...prep, busy: true });
    try {
      const previews = prep.data.previews.filter((p) => p.key?.startsWith("p")).map((p) => ({ proposalId: Number(p.key!.slice(1)), previewId: p.previewId }));
      const mentionsOk = prep.data.previews.some((p) => p.mentions?.length);
      setDone(await call<Done>("meeting.confirm", { occurrenceId: o.id, keep: ticked.map((p) => p.id), previews, ...(mentionsOk ? { mentionsOk: true } : {}) }));
      setPrep(null);
      await load();
    } catch (e) {
      setPrep({ ...prep, busy: false, error: errText(e) });
    }
  };

  return (
    <>
      <BackHead onBack={onBack} title={`Update ${m.clientName}'s plan`} sub={`${m.name} · ${dayLabel(o.date)}`} />
      <p className="muted mtg-intro">
        {r.transcript ? `From the transcript (${r.transcript.lines} lines, ${r.transcript.speakers} people). ` : ""}
        {editable ? "Tick what's right, change the words where needed, and skip the rest. Nothing changes until you confirm." : `Only this call's reviewers (${m.reviewers.map((x) => x.name).join(", ")}) can confirm. You can look.`}
      </p>
      {o.aiMessage && <p className="set-problem">{o.aiMessage}</p>}
      {note && <p className="error-line" role="alert">{note}</p>}
      {(o.state === "needs_upload" || o.state === "waiting" || o.state === "failed" || (o.state === "no_transcript" && editable)) && editable && <UploadBox series={m} occ={o} onDone={load} />}
      {o.state === "waiting" && <p className="muted">FocusTime looks for the transcript after the call, every 15 minutes for 3 hours, then hourly up to 12 hours.</p>}
      {done && (
        <section className="mtg-done" role="status" aria-label="What was done">
          <h3>{done.results.filter((x) => x.ok).length} done{done.results.some((x) => !x.ok) ? `, ${done.results.filter((x) => !x.ok).length} didn't go through` : ""}</h3>
          <ul>{done.results.map((x) => <li key={x.proposalId} className={x.ok ? undefined : "problem"}>{x.message}</li>)}</ul>
          <p className="muted">Undo any DevOps change in Settings › Activity.</p>
        </section>
      )}
      {(["gap", "commitment", "comment"] as const).map((kind) => {
        const ps = r.proposals.filter((p) => p.body.kind === kind);
        if (!ps.length) return null;
        return (
          <section key={kind} className="mtg-group" style={{ "--c": color } as CSSProperties} aria-label={KIND_HEAD[kind]}>
            <h3>{KIND_HEAD[kind]} <span className="muted">{ps.length}</span></h3>
            {ps.map((p) => <ProposalRow key={p.id} p={p} ticked={keep.has(p.id)} editable={editable} onTick={(on) => setKeep((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; })} onEdit={(patch) => void edit(p, patch)} />)}
          </section>
        );
      })}
      {o.state === "ready" && !r.proposals.length && <p className="muted">Nothing to propose from this call.</p>}
      {editable && open.length > 0 && (
        <div className="mtg-bar">
          <span role="status">{ticked.length} of {open.length} ticked{writes && !r.canWrite ? " · Enable DevOps writes for this client in Settings › DevOps first" : ""}</span>
          <span className="mtg-bar-actions">
            <button type="button" className="mini" onClick={() => setKeep(new Set())} disabled={!ticked.length}>Untick all</button>
            <button type="button" className="mini primary" disabled={!ticked.length || (writes > 0 && !r.canWrite) || prep?.busy} onClick={() => void startConfirm()}>
              {prep?.busy ? "Preparing…" : `Confirm ${ticked.length}`}
            </button>
          </span>
        </div>
      )}
      {prep && (prep.data || prep.error) && <ConfirmDialog prep={prep} skipped={open.length - ticked.length} onCancel={() => setPrep(null)} onConfirm={() => void confirm()} />}
    </>
  );
}

function BackHead({ onBack, title, sub }: { onBack: () => void; title: string; sub?: string }) {
  return (
    <header className="page-head">
      <div className="ph-title">
        <button type="button" className="mini quiet" onClick={onBack} aria-label="Back to client calls"><Icon name="back" /> Calls</button>
        <h2>{title}</h2>
        {sub && <span className="muted">{sub}</span>}
      </div>
    </header>
  );
}

function Quotes({ qs }: { qs: Quote[] | null }) {
  if (!qs) return <p className="muted mtg-quote-gone">The transcript's words are kept 30 days; these are gone.</p>;
  return (
    <div className="mtg-quotes">
      {qs.map((q) => (
        <blockquote key={q.n}>
          <span className="mtg-who">{q.speaker} · {q.at}</span> {q.text}
        </blockquote>
      ))}
    </div>
  );
}

function ProposalRow({ p, ticked, editable, onTick, onEdit }: { p: Proposal; ticked: boolean; editable: boolean; onTick: (on: boolean) => void; onEdit: (patch: Record<string, unknown>) => void }) {
  const b = p.body;
  const decided = p.state === "confirmed" || p.state === "skipped";
  const main = b.kind === "gap" ? b.title : b.kind === "commitment" ? b.what : b.text;
  const [text, setText] = useState(main);
  useEffect(() => setText(main), [main]);
  const field = b.kind === "gap" ? "title" : b.kind === "commitment" ? "what" : "text";
  const save = () => text.trim() && text.trim() !== main && onEdit({ [field]: text.trim() });
  const where =
    b.kind === "gap" ? `${b.type}${b.parentTitle ? ` under #${b.parentId} ${b.parentTitle}` : ", not under a feature yet (saved as your draft)"}`
    : b.kind === "commitment" ? `${b.who}${b.toName ? ` to ${b.toName}` : ""}${b.due ? ` · due ${dayLabel(b.due)}` : ""} · ${b.side === "cooptimize" ? `in ${b.who.split(/\s+/)[0]}'s Promises` : "noted with this call"}`
    : `${NOTE[b.note]} on #${b.itemId} ${b.itemTitle}`;
  const state = p.state === "confirmed" ? (p.result?.message ?? (b.kind === "commitment" ? (b.side === "client" ? "Noted with this call" : "Added to Promises") : "Done")) : p.state === "skipped" ? "Skipped" : p.state === "failed" ? (p.result?.message ?? "Didn't go through") : null;
  return (
    <article className={`mtg-prop ${p.state}`}>
      <label className="mtg-tick">
        <input type="checkbox" checked={decided ? p.state === "confirmed" : ticked} disabled={!editable || decided} onChange={(e) => onTick(e.target.checked)} aria-label={`Keep: ${main}`} />
      </label>
      <div className="mtg-prop-body">
        {editable && !decided ? (
          b.kind === "comment" ? <TextBox minRows={2} maxRows={8} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Comment" /> : <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label={b.kind === "gap" ? "Title" : "What"} />
        ) : (
          <p className="mtg-main">{main}</p>
        )}
        <p className="muted mtg-where">{where}</p>
        {"namesRemoved" in b && b.namesRemoved && <p className="names-removed">Another client's name was removed: "another client" is written instead.</p>}
        {b.kind === "gap" && b.description && <p className="mtg-desc">{b.description}</p>}
        {b.kind === "comment" && b.inReport && <p className="mtg-report">Will appear in Kat's Monday report</p>}
        <Quotes qs={p.quotes} />
        {state && <p className={`mtg-state-line${p.state === "failed" ? " problem" : ""}`}>{state}</p>}
      </div>
      {editable && !decided && (
        <button type="button" className="mini quiet" onClick={() => onEdit({ skip: true })}>Skip</button>
      )}
      {editable && p.state === "skipped" && (
        <button type="button" className="mini quiet" onClick={() => onEdit({ skip: false })}>Bring back</button>
      )}
    </article>
  );
}

function ConfirmDialog({ prep, skipped, onCancel, onConfirm }: { prep: { busy: boolean; data: Prepared | null; error: string | null }; skipped: number; onCancel: () => void; onConfirm: () => void }) {
  const d = prep.data;
  // On document.body: the page's own layout makes a containing block, so a fixed backdrop inside it stops at its edge.
  return createPortal(
    <div className="mtg-confirm" role="dialog" aria-modal="true" aria-label="Confirm these changes">
      <div className="mtg-confirm-box">
        <h3>Confirm these changes</h3>
        {prep.error && <p className="error-line" role="alert">{prep.error}</p>}
        {d && (
          <>
            {d.previews.length > 0 && (
              <section>
                <h4>In DevOps, as you</h4>
                <ul>
                  {d.previews.map((p) => (
                    <li key={p.previewId}>
                      <strong>{p.summary}</strong> <span className="muted">{p.item} · as {p.identity}</span>
                      <PreviewRows rows={p.fields} />
                      {p.mentions?.length ? <p className="mention-flag" role="alert">This mentions {p.mentions.join(", ")}, and this client's DevOps can be seen by people outside Cooptimize. Edit the proposal to change it, or confirm to save your words as written.</p> : null}
                      <span className="muted mtg-field">{p.visibility}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.refused.length > 0 && (
              <section>
                <h4>Can't be written</h4>
                <ul>{d.refused.map((x, i) => <li key={i} className="problem">{x.error}</li>)}</ul>
              </section>
            )}
            {d.draftOnly.length > 0 && (
              <section>
                <h4>Your drafts</h4>
                <ul>{d.draftOnly.map((x) => <li key={x.proposalId}>{x.title}: {x.message}</li>)}</ul>
              </section>
            )}
            {d.commitments.length > 0 && (
              <section>
                <h4>Promises</h4>
                <ul>{d.commitments.map((c) => <li key={c.proposalId}>{c.who}: {c.what}{c.due ? ` · due ${dayLabel(c.due)}` : ""} <span className="muted">({c.shows})</span></li>)}</ul>
              </section>
            )}
            {skipped > 0 && <p className="muted">{skipped} skipped: nothing is written for {skipped === 1 ? "it" : "them"}.</p>}
          </>
        )}
        <div className="mtg-confirm-actions">
          <button type="button" className="mini" onClick={onCancel}>Cancel</button>
          <button type="button" className="mini primary" disabled={!d || prep.busy} onClick={onConfirm}>{prep.busy ? "Confirming…" : "Confirm"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PreviewRows({ rows }: { rows: DevOpsPreview["fields"] }) {
  return (
    <span className="mtg-fields">
      {rows.filter((f) => f.changed).slice(0, 6).map((f, i) => (
        <span key={i} className="mtg-field">{f.label}: {f.before ? <><s>{clip(f.before)}</s> → </> : null}{clip(f.after ?? "")}</span>
      ))}
    </span>
  );
}
const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 159)}…` : s);

function UploadBox({ series, occ, onDone }: { series: SeriesView; occ: OccurrenceView; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await uploadMeetingTranscript<{ lines: number; proposals: number }>(series.id, occ.date, f);
      setMsg(`Read ${r.lines} lines. ${r.proposals} ${r.proposals === 1 ? "proposal" : "proposals"} to review.`);
      await onDone();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const none = async () => {
    try {
      await call("meeting.no_transcript", { occurrenceId: occ.id });
      await onDone();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  return (
    <section className="mtg-upload" aria-label="Upload the transcript">
      <h3>{occ.state === "waiting" ? "Have the transcript already?" : "Upload the transcript"}</h3>
      <p className="muted">
        {series.source === "upload" ? "This call is organized outside Cooptimize, so FocusTime never reads it. In Teams, open the meeting's recap and download the transcript (.vtt or .docx); if you can't, ask the organizer to send it." : "Download it from the meeting's recap in Teams (.vtt or .docx)."} It's kept 30 days, for this call's reviewers and attendees only.
      </p>
      <span className="mtg-upload-actions">
        <label className="mini primary file-button">
          {busy ? "Reading…" : "Choose a file"}
          <input type="file" accept=".vtt,.docx,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {occ.state !== "no_transcript" && <button type="button" className="mini quiet" onClick={() => void none()}>No transcript this week</button>}
      </span>
      {msg && <p className="muted" role="status">{msg}</p>}
    </section>
  );
}
