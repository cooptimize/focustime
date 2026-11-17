// F1: ⋯ › Send feedback (and "Send feedback" in the command menu). Write: Idea, Problem or Question, one text box,
// "Include where I am" (the view's name, ⋯ › About's version line, the browser and the screen size; nothing else).
// Preview: the exact title and description, where it goes, who it is created as and who can see it; Send or Back.
// Then "Sent. Thanks." with a link to the new item, or a plain error with Copy text, so nothing typed is lost and
// nothing is retried on its own. FB-1: it is sent with the person's own DevOps write PAT; without one the dialog says
// how to turn writes on and offers Copy text only.
// Keys: Enter in the text box goes to the preview (Shift+Enter is a new line); Ctrl+Enter sends from the preview.
// UI-8: UI-3's header on every screen: ‹ Back at the top left on the error (back to the text), the × at the top right
// always, Esc closes. The header never scrolls away; only the body scrolls.
// OP-1: the preview shows through the one DevOps preview's parts (ui/DevOpsWrite.tsx), in the same layout and order:
// Where and Writes as, the new item's fields, Who can see it, then Send and Not now (back to the text, nothing lost).
// It keeps its own action (feedback.preview, feedback.send): it writes to FocusTime's own backlog, not a client's.
import { TextBox } from "./TextBox.tsx";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { aboutLine, type Build } from "./About.tsx";
import { ActionRefusal, call } from "./api.ts";
import { FEEDBACK_KINDS, KIND_LABEL, type FeedbackKind, type Where } from "../plan/feedback.ts";
import { WRITES_HREF, type FeedbackPreview, type FeedbackSent, type FeedbackSetup, type FeedbackStatus } from "../actions/feedback-types.ts";
import { Icon } from "./icons.tsx";
import { PreviewActions, PreviewFields, PreviewFrame, PreviewVisibility, PreviewWhere } from "./DevOpsWrite.tsx";

/** "Chrome 141 on Windows": the browser and system from the user agent, nothing more. */
export function browserName(ua: string): string {
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  const m = /Edg\/(\d+)/.exec(ua) ?? /Firefox\/(\d+)/.exec(ua) ?? /Chrome\/(\d+)/.exec(ua) ?? /Version\/(\d+)[\d.]* Safari/.exec(ua);
  const name = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  return `${name}${m ? ` ${m[1]}` : ""}${os ? ` on ${os}` : ""}`;
}

type Step = { kind: "write" } | { kind: "preview"; p: FeedbackPreview } | { kind: "sent"; r: FeedbackSent } | { kind: "error"; message: string };

export function FeedbackDialog({ view, zone, onClose }: { view: string; zone: string; onClose: () => void }) {
  useReturnFocus();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [text, setText] = useState("");
  const [includeWhere, setIncludeWhere] = useState(true);
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [version, setVersion] = useState("");
  const [step, setStep] = useState<Step>({ kind: "write" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    box.current?.focus();
    call<FeedbackStatus>("feedback.status", {}).then(setStatus, () => setStatus(null));
    fetch("/version", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Build>) : Promise.reject(new Error("version"))))
      .then((b) => setVersion(aboutLine(b, zone)), () => setVersion(""));
  }, [zone]);
  // HK-5: before paint, so the step's button has focus the moment it shows. After paint (useEffect), the text box the
  // preview replaced was already gone and focus sat on the page, so a quick Ctrl+Enter never reached the dialog.
  useLayoutEffect(() => {
    if (step.kind !== "write") primary.current?.focus();
    else box.current?.focus();
  }, [step.kind]);

  const notSetUp = !!status && status.setup.state !== "ready";
  const where = (): Where => ({ view, version, browser: browserName(navigator.userAgent), screen: `${window.screen.width}×${window.screen.height}, window ${window.innerWidth}×${window.innerHeight}` });
  const copy = () => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));

  const toPreview = async () => {
    if (busy || notSetUp) return;
    if (!text.trim()) return setProblem("Write something first");
    setBusy(true);
    setProblem(null);
    try {
      setStep({ kind: "preview", p: await call<FeedbackPreview>("feedback.preview", { kind, text, ...(includeWhere ? { where: where() } : {}) }) });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't make the preview");
    } finally {
      setBusy(false);
    }
  };
  const send = async (p: FeedbackPreview) => {
    if (busy || !p.setUp || p.remaining <= 0) return;
    setBusy(true);
    try {
      setStep({ kind: "sent", r: await call<FeedbackSent>("feedback.send", { previewId: p.previewId }) });
    } catch (e) {
      setStep({ kind: "error", message: e instanceof ActionRefusal || e instanceof Error ? e.message : "Not sent. Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  const copyButton = (
    <button type="button" className="mini" onClick={copy} disabled={!text.trim()}>
      {copied ? "Copied" : "Copy text"}
    </button>
  );

  if (step.kind === "preview") {
    const p = step.p;
    return (
      <PreviewFrame
        label="Send feedback"
        busy={busy}
        onClose={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send(p);
          }
        }}
      >
        <PreviewWhere where={p.write ? `DevOps · ${p.write.org} · ${p.write.project}` : p.destination} identity={p.write?.identity ?? "Not set up yet"} />
        <div className="dw-rows">
          <section className="dw-row feedback-row" aria-label={`New ${KIND_LABEL[kind].toLowerCase()}`}>
            <h3>{p.destination}</h3>
            <PreviewFields create fields={[{ label: "Title", after: p.title }, { label: "Description", after: p.description }, { label: "Tags", after: p.tags.join(", ") }]} />
            {[...(p.write?.links ?? []), ...(p.write?.notes ?? [])].map((l) => (
              <p key={l} className="muted dw-note">{l}</p>
            ))}
          </section>
        </div>
        {p.write && <PreviewVisibility text={p.write.visibility} />}
        {p.message && (p.setup.state === "no_pat" ? <SetupNote setup={p.setup} line={p.message} onClose={onClose} /> : <p className="feedback-note" role="status">{p.message}</p>)}
        <PreviewActions closeLabel="Not now" onClose={() => setStep({ kind: "write" })} busy={busy} note="Sent once; nothing is retried on its own.">
          {p.setUp ? (
            <button ref={primary} type="button" className="commit" disabled={busy || p.remaining <= 0} onClick={() => void send(p)}>
              {busy ? "Sending…" : "Send feedback"} <kbd>Ctrl Enter</kbd>
            </button>
          ) : (
            copyButton
          )}
        </PreviewActions>
      </PreviewFrame>
    );
  }

  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="command-menu feedback-dialog"
        data-overlay="modal"
        role="dialog"
        aria-label="Send feedback"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="command-head">
          {step.kind === "error" && (
            <button ref={step.kind === "error" ? primary : undefined} type="button" className="menu-back" onClick={() => setStep({ kind: "write" })} disabled={busy} aria-label="Back" title="Back to your text">
              <Icon name="back" />
            </button>
          )}
          <span className="command-step-title">Send feedback</span>
          <CloseButton onClose={onClose} disabled={busy} />
        </div>

        {step.kind === "write" && (
          <div className="feedback-body">
            {notSetUp && status && <SetupNote setup={status.setup} line={status.line} onClose={onClose} />}
            <div className="feedback-kinds" role="radiogroup" aria-label="Kind">
              {FEEDBACK_KINDS.map((k) => (
                <label key={k} className={kind === k ? "on" : ""}>
                  <input type="radio" name="feedback-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </div>
            <label className="feedback-text">
              <span className="sr-only">Your feedback</span>
              <TextBox
                ref={box}
                minRows={5}
                maxRows={12}
                maxLength={4000}
                placeholder={kind === "problem" ? "What happened, and what did you expect?" : kind === "question" ? "What would you like to know?" : "What would make FocusTime better?"}
                value={text}
                onChange={(e) => (setText(e.target.value), setProblem(null), setCopied(false))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void toPreview();
                  }
                }}
              />
            </label>
            <label className="feedback-where">
              <input type="checkbox" checked={includeWhere} onChange={(e) => setIncludeWhere(e.target.checked)} />
              Include where I am <span className="muted">(the view, the version, your browser and screen size)</span>
            </label>
            <p className="feedback-hint muted">Nothing else is attached: no plan, clients, work items or screenshots. Enter for the preview, Shift+Enter for a new line.</p>
            {problem && <p className="set-problem" role="alert">{problem}</p>}
            <div className="feedback-actions">
              {notSetUp ? (
                copyButton
              ) : (
                <button ref={primary} type="button" className="commit" disabled={busy || !text.trim()} onClick={() => void toPreview()}>
                  {busy ? "Working…" : "Preview"} <kbd>Enter</kbd>
                </button>
              )}
              <button type="button" className="mini quiet" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </div>
        )}

        {step.kind === "sent" && (
          <div className="feedback-body">
            <p className="feedback-done" role="status">
              {step.r.message}{" "}
              {step.r.url ? (
                <a href={step.r.url} target="_blank" rel="noreferrer">#{step.r.id}</a>
              ) : (
                <>#{step.r.id}</>
              )}
            </p>
            <div className="feedback-actions">
              <button ref={primary} type="button" className="commit" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {step.kind === "error" && (
          <div className="feedback-body">
            <p className="set-problem" role="alert">{step.message}</p>
            <div className="feedback-actions">
              {copyButton}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** FB-1: why Send isn't offered, and for a missing write PAT the way to Settings › Clients. */
function SetupNote({ setup, line, onClose }: { setup: FeedbackSetup; line: string; onClose: () => void }) {
  return (
    <p className="feedback-note" role="status">
      {line}
      {setup.state === "no_pat" && (
        <>
          {" "}
          <a href={WRITES_HREF} onClick={onClose}>
            Open Settings › DevOps
          </a>
        </>
      )}
    </p>
  );
}
