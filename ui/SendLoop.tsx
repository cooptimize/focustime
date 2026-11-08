// LP-1: Close the loop by sending the update. Three steps in one place wherever a promise shows (the Inbox pane and
// sheet, Today, Week's block panel, Close out): Draft (Send by Teams, Email, Comment or Call, each saying where it
// goes; the text, editable, with what it was drafted from; Mark this promise kept, on; Also add it as a comment, off;
// a state change from the item's own process), Preview (where it goes, who sees it inside and outside Cooptimize, the
// final text after the client check, each DevOps part's own preview, that a sent message can't be undone) and Sent
// (what landed, the link, Undo for the promise kept, Retry). One Send button. When FocusTime can't send that way for
// me yet, the preview offers the message prefilled in Teams or Outlook and Mark sent instead. "Close without sending"
// is IB-1's form (ui/CloseLoop.tsx), unchanged.
import { useEffect, useId, useState, type ReactNode } from "react";
import { call } from "./api.ts";
import { CloseLoop, type CloseLoopValue } from "./CloseLoop.tsx";
import type { LoopDraftView, LoopPreviewView, LoopResultView } from "../actions/loop-types.ts";
import { CHANNEL_LABEL, sendLine, type LoopChannel } from "../plan/loop.ts";
import type { CloseHow } from "../plan/types.ts";

type Step = { kind: "draft" } | { kind: "preview"; p: LoopPreviewView } | { kind: "sent"; r: LoopResultView } | { kind: "without" };
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

const SEND_LABEL: Record<LoopPreviewView["mode"], string> = { post: "Send in Teams", draft: "Create Outlook draft", send: "Send email now", comment: "Post comment", note: "Save call note" };

export function SendLoop({ promiseKey, who, demo = false, compact = false, onClosed, onCancel, closeWithout, initialHow = null }: {
  promiseKey: string;
  who: string | null;
  /** Demo mode: the consent link isn't offered (the demo has no sign-in). */
  demo?: boolean;
  compact?: boolean;
  /** The loop closed (or a draft was saved): the caller reloads, with the words for its notice. */
  onClosed: (notice: string) => void;
  onCancel: () => void;
  /** IB-1's Close the loop, kept as "Close without sending". */
  closeWithout: (v: CloseLoopValue) => Promise<string | null>;
  /** Close without sending starts on the promise's own channel (a follow-up's), as before. */
  initialHow?: CloseHow | null;
}) {
  const [draft, setDraft] = useState<LoopDraftView | null>(null);
  const [step, setStep] = useState<Step>({ kind: "draft" });
  const [channel, setChannel] = useState<LoopChannel>("teams");
  const [target, setTarget] = useState<"chat" | "direct" | null>(null);
  const [emailMode, setEmailMode] = useState<"draft" | "send">("draft");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [kept, setKept] = useState(true);
  const [comment, setComment] = useState(false);
  const [state, setState] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let live = true;
    call<LoopDraftView>("loop.draft", { key: promiseKey })
      .then((d) => {
        if (!live) return;
        setDraft(d);
        setText(d.text);
        setSubject(d.subject);
        setChannel(d.initial);
        setTarget(d.channels.find((c) => c.channel === "teams")?.targets?.[0]?.kind ?? null);
      })
      .catch((e) => live && setError(errText(e)));
    return () => void (live = false);
  }, [promiseKey]);

  const title = who ? `Close the loop with ${who}` : "Close the loop";
  const head = (n: 1 | 2 | 3) => (
    <div className="sl-head">
      {!compact && <h4 className="close-loop-title">{title}</h4>}
      <ol className="sl-steps" aria-label="Steps">
        {["Draft", "Preview", "Sent"].map((s, i) => (
          <li key={s} aria-current={i + 1 === n ? "step" : undefined} className={i + 1 < n ? "done" : undefined}>{s}</li>
        ))}
      </ol>
    </div>
  );

  if (step.kind === "without")
    return (
      <div className="send-loop">
        <CloseLoop who={who} compact={compact} initialHow={initialHow} onSubmit={closeWithout} onCancel={() => setStep({ kind: "draft" })} />
      </div>
    );

  if (!draft)
    return (
      <form className="send-loop close-loop" aria-label={title} onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
        {head(1)}
        {error ? <p className="set-problem" role="alert">{error}</p> : <p className="muted">Drafting…</p>}
        <div className="sl-actions">
          <button type="button" className="sl-link" onClick={() => setStep({ kind: "without" })}>Close without sending</button>
          <button type="button" className="mini" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    );

  const opt = draft.channels.find((c) => c.channel === channel)!;
  const waiting = draft.sends.find((s) => s.state === "draft");
  const canDevops = !!draft.item?.canComment;
  const words = channel === "call" ? note : text;

  // GD-2: o is the flag's one click: the same preview with another client's names as "another client".
  const preview = async (o: { text?: string; subject?: string } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const p = await call<LoopPreviewView>("loop.preview", {
        key: promiseKey, channel, text: o.text ?? words, kept,
        ...(channel === "teams" && target ? { target } : {}),
        ...(channel === "email" ? { emailMode, subject: o.subject ?? subject } : {}),
        ...(canDevops && channel !== "devops" && comment ? { comment: true } : {}),
        ...(canDevops && state ? { state } : {}),
      });
      setStep({ kind: "preview", p });
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  const send = async (p: LoopPreviewView) => {
    setBusy(true);
    setError(null);
    try {
      // GD-2: my own words go as written once I've seen the flag (the button says so).
      const r = await call<LoopResultView>("loop.send", { previewId: p.previewId, ...(p.mentions ? { mentionsOk: true } : {}) });
      setStep({ kind: "sent", r });
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  const markSent = async (o: { sendId?: number; channel?: LoopChannel }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<LoopResultView>("loop.mark_sent", { key: promiseKey, kept, ...(o.sendId ? { sendId: o.sendId } : { channel: o.channel, text: words }) });
      setStep({ kind: "sent", r });
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };

  if (step.kind === "sent") {
    const r = step.r;
    const linkLabel = r.send.channel === "teams" ? "Open in Teams" : r.send.channel === "email" ? (r.send.state === "draft" ? "Open draft" : "Open in Outlook") : r.send.channel === "devops" ? "Open in DevOps" : null;
    return (
      <section className="send-loop close-loop" aria-label={title}>
        {head(3)}
        <p className={r.ok ? "sl-result" : "sl-result bad"} role={r.ok ? "status" : "alert"}>{r.message}</p>
        {r.parts.length > 0 && (
          <ul className="sl-parts">
            {r.parts.map((x) => (
              <li key={x.kind} className={x.ok ? "ok" : "bad"}>{x.ok ? "✓ " : "✗ "}{x.message}</li>
            ))}
          </ul>
        )}
        <div className="sl-actions">
          {r.send.link && linkLabel && <a className="mini" href={r.send.link} target="_blank" rel="noreferrer">{linkLabel}</a>}
          {r.send.state === "draft" && <button type="button" className="mini primary" disabled={busy} onClick={() => void markSent({ sendId: r.send.id })}>I sent it</button>}
          {r.retry && r.send.state === "unconfirmed" && (
            <button type="button" className="mini" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                setStep({ kind: "sent", r: await call<LoopResultView>("loop.retry", { sendId: r.send.id }) });
              } catch (e) {
                setError(errText(e));
              }
              setBusy(false);
            }}>Retry</button>
          )}
          {r.retry && r.send.state === "failed" && <button type="button" className="mini primary" disabled={busy} onClick={() => void preview()}>Retry</button>}
          {r.send.kept && (
            <button type="button" className="mini" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const u = await call<{ message: string }>("loop.undo_kept", { sendId: r.send.id });
                onClosed(u.message);
              } catch (e) {
                setError(errText(e));
              }
              setBusy(false);
            }}>Undo promise kept</button>
          )}
          <button type="button" className="mini" onClick={() => (r.ok || r.send.state === "draft" ? onClosed(r.closed ? "Loop closed" : r.send.state === "draft" ? "Draft in Outlook" : r.message) : onCancel())}>Done</button>
        </div>
        {error && <p className="set-problem" role="alert">{error}</p>}
      </section>
    );
  }

  if (step.kind === "preview") {
    const p = step.p;
    return (
      <section className="send-loop close-loop" aria-label={title} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setStep({ kind: "draft" }))}>
        {head(2)}
        <dl className="sl-facts">
          <dt className="close-loop-label">Send by</dt>
          <dd>{CHANNEL_LABEL[p.channel]}{p.mode === "draft" ? " · an Outlook draft" : p.mode === "send" ? " · send now" : ""}</dd>
          <dt className="close-loop-label">Who sees it</dt>
          <dd>
            <span className="sl-line">{p.line}</span>
            {p.audience && p.audience.outside > 0 && (
              <span className="sl-outside">Outside Cooptimize: {p.audience.outsideNames.join(", ")}</span>
            )}
            {p.audienceNote && <span className="sl-outside">{p.audienceNote}</span>}
          </dd>
          {p.subject && (
            <>
              <dt className="close-loop-label">Subject</dt>
              <dd>{p.subject}</dd>
            </>
          )}
        </dl>
        <div className="sl-text" aria-label="The message">{p.text}</div>
        {p.mentions && (
          <div className="mention-flag" role="alert">
            <p>{p.mentions.line}</p>
            <button type="button" className="mini" disabled={busy} onClick={() => {
              const m = p.mentions!;
              if (channel === "call") setNote(m.text);
              else setText(m.text);
              if (m.subject !== undefined) setSubject(m.subject);
              void preview({ text: m.text, ...(m.subject !== undefined ? { subject: m.subject } : {}) });
            }}>Replace with “another client”</button>
          </div>
        )}
        {p.blocked && <p className="sl-blocked" role="alert">{p.blocked}</p>}
        {!p.blocked && (
          <ul className="sl-then">
            {p.channel !== "devops" && <li>{p.kept ? (p.mode === "draft" ? "Marked kept when you tell FocusTime you sent it" : "Then the promise is marked kept (with Undo)") : "The promise stays open"}</li>}
            {p.devops.map((d) => (
              <li key={d.preview.previewId}>
                Then in DevOps: {d.kind === "comment" ? "a comment on " : "the state of "}{d.preview.item}
                {d.preview.fields.filter((f) => f.changed).map((f) => (
                  <span key={f.label} className="sl-field"> · {f.label}: {f.before ?? "none"} → {f.after ?? "none"}</span>
                ))}
              </li>
            ))}
            {p.devopsNotes.map((n) => <li key={n} className="muted">{n}</li>)}
          </ul>
        )}
        {p.final && !p.fallback && <p className="sl-final">{p.final}</p>}
        {p.fallback && !p.blocked && (
          <div className="sl-fallback">
            <p>{p.fallback.note}</p>
            {p.fallback.consent && !demo && <a className="mini" href={`/auth/microsoft/login?consent=${p.fallback.consent}`}>Allow sending from FocusTime</a>}
          </div>
        )}
        <div className="sl-actions sl-sticky">
          {p.fallback && !p.blocked ? (
            <>
              <a className="mini primary" href={p.fallback.open} target="_blank" rel="noreferrer">{p.fallback.label}</a>
              {/* A group chat can't be prefilled: copy the text to paste there. */}
              <button type="button" className="mini" onClick={() => void navigator.clipboard?.writeText(p.text).then(() => setCopied(true), () => {})}>{copied ? "Copied" : "Copy text"}</button>
              <button type="button" className="mini" disabled={busy} onClick={() => void markSent({ channel: p.channel })}>Mark sent</button>
            </>
          ) : (
            <button type="button" className="mini primary sl-send" disabled={busy || !!p.blocked} onClick={() => void send(p)}>{busy ? "Sending…" : p.mentions ? `${SEND_LABEL[p.mode]} as written` : SEND_LABEL[p.mode]}</button>
          )}
          {p.call && <a className="mini" href={p.call} target="_blank" rel="noreferrer">Call in Teams</a>}
          <button type="button" className="mini" onClick={() => setStep({ kind: "draft" })}>Back to the draft</button>
        </div>
        {error && <p className="set-problem" role="alert">{error}</p>}
      </section>
    );
  }

  const choice = (c: (typeof draft.channels)[number]): ReactNode => (
    <button key={c.channel} type="button" role="radio" aria-checked={channel === c.channel} className="close-loop-choice sl-choice" disabled={!c.available} title={c.reason ?? undefined} onClick={() => setChannel(c.channel)}>
      <span className="sl-choice-name">{c.label}</span>
      <span className="sl-choice-where">{c.available ? c.where : c.reason}</span>
    </button>
  );
  return (
    <form className="send-loop close-loop" aria-label={title} onSubmit={(e) => (e.preventDefault(), void preview())} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      {head(1)}
      {waiting && (
        <div className="sl-waiting">
          <span>{sendLine(waiting)}.</span>
          {waiting.link && <a className="mini" href={waiting.link} target="_blank" rel="noreferrer">Open draft</a>}
          <button type="button" className="mini primary" disabled={busy} onClick={() => void markSent({ sendId: waiting.id })}>I sent it</button>
        </div>
      )}
      {draft.noRecipient && <p className="sl-blocked">{draft.noRecipient}</p>}
      <div className="close-loop-how sl-how" role="radiogroup" aria-labelledby={`${id}-by`}>
        <span id={`${id}-by`} className="close-loop-label sl-legend">Send by</span>
        {draft.channels.map(choice)}
      </div>
      {channel === "teams" && (opt.targets?.length ?? 0) > 1 && (
        <div className="sl-targets" role="radiogroup" aria-label="Where in Teams">
          {opt.targets!.map((t) => (
            <label key={t.kind}><input type="radio" name={`${id}-t`} checked={target === t.kind} onChange={() => setTarget(t.kind)} /> {t.line}</label>
          ))}
        </div>
      )}
      {channel === "email" && (
        <>
          <div className="sl-targets" role="radiogroup" aria-label="Email">
            <label><input type="radio" name={`${id}-m`} checked={emailMode === "draft"} onChange={() => setEmailMode("draft")} /> Create Outlook draft</label>
            <label><input type="radio" name={`${id}-m`} checked={emailMode === "send"} onChange={() => setEmailMode("send")} /> Send now</label>
          </div>
          <label className="close-loop-note">
            <span className="close-loop-label">Subject</span>
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </>
      )}
      {channel === "call" ? (
        <label className="close-loop-note" htmlFor={`${id}-note`}>
          <span className="close-loop-label">What you agreed</span>
          <textarea id={`${id}-note`} value={note} maxLength={4000} rows={3} placeholder={`What you and ${who ? who.split(" ")[0] : "they"} agreed`} onChange={(e) => setNote(e.target.value)} />
        </label>
      ) : (
        <label className="close-loop-note" htmlFor={`${id}-text`}>
          <span className="close-loop-label">Message</span>
          <textarea id={`${id}-text`} value={text} maxLength={4000} rows={compact ? 4 : 5} onChange={(e) => setText(e.target.value)} />
          <span className="sl-from muted">{draft.draftedFrom}{draft.aiNote ? ` ${draft.aiNote}` : ""}</span>
          {draft.namesRemoved && <span className="names-removed">{draft.namesRemoved}: the AI's draft had one, and "another client" is written instead.</span>}
        </label>
      )}
      <div className="sl-checks">
        {channel !== "devops" && (
          <label><input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} /> Mark this promise kept when it's sent</label>
        )}
        {canDevops && channel !== "devops" && channel !== "call" && (
          <label><input type="checkbox" checked={comment} onChange={(e) => setComment(e.target.checked)} /> Also add it as a comment on #{draft.item!.id}</label>
        )}
        {canDevops && draft.item!.states.length > 0 && (
          <label className="sl-state">
            <span>Also set #{draft.item!.id} ({draft.item!.state}) to</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">No change</option>
              {draft.item!.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="sl-actions sl-sticky">
        <button type="submit" className="mini primary" disabled={busy || !opt.available || !words.trim()}>{busy ? "Checking…" : "Preview"}</button>
        <button type="button" className="sl-link" onClick={() => setStep({ kind: "without" })}>Close without sending</button>
        <button type="button" className="mini" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="set-problem" role="alert">{error}</p>}
    </form>
  );
}
