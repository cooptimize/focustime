// F1: ⋯ › Send feedback (and "Send feedback" in the command menu). Write: Idea, Problem or Question, one text box,
// "Include where I am" (the view's name, ⋯ › About's version line, the browser and the screen size; nothing else).
// Preview: the exact title and description, and where it goes; Send or Back. Then "Sent. Thanks." with a link to the
// new item, or a plain error with Copy text, so nothing typed is lost and nothing is retried on its own.
// Keys: Enter in the text box goes to the preview (Shift+Enter is a new line); Ctrl+Enter sends from the preview.
// UI-8: UI-3's header on every screen: ‹ Back at the top left on the preview and the error (back to the text), the ×
// at the top right always, Esc closes. The header never scrolls away; only the body scrolls.
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useEffect, useRef, useState } from "react";
import { aboutLine, type Build } from "./About.tsx";
import { ActionRefusal, call } from "./api.ts";
import { FEEDBACK_KINDS, KIND_LABEL, NOT_SET_UP, type FeedbackKind, type Where } from "../plan/feedback.ts";
import type { FeedbackPreview, FeedbackSent, FeedbackStatus } from "../actions/feedback-types.ts";

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
  useEffect(() => {
    if (step.kind !== "write") primary.current?.focus();
    else box.current?.focus();
  }, [step.kind]);

  const notSetUp = status?.setup.state === "not_set_up";
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
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && step.kind === "preview") {
            e.preventDefault();
            void send(step.p);
          }
        }}
      >
        <div className="command-head">
          {(step.kind === "preview" || step.kind === "error") && (
            <button ref={step.kind === "error" ? primary : undefined} type="button" className="menu-back" onClick={() => setStep({ kind: "write" })} disabled={busy} aria-label="Back" title="Back to your text">
              ‹
            </button>
          )}
          <span className="command-step-title">{step.kind === "preview" ? "Send feedback: preview" : "Send feedback"}</span>
          <CloseButton onClose={onClose} disabled={busy} />
        </div>

        {step.kind === "write" && (
          <div className="feedback-body">
            {notSetUp && (
              <p className="feedback-note" role="status">
                {status?.notSetUp ?? NOT_SET_UP}
              </p>
            )}
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
              <textarea
                ref={box}
                rows={5}
                maxLength={4000}
                placeholder={kind === "problem" ? "What happened, and what did you expect?" : kind === "question" ? "What would you like to know?" : "What would make FocusTime better?"}
                value={text}
                onChange={(e) => (setText(e.target.value), setProblem(null), setCopied(false))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
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

        {step.kind === "preview" && (
          <div className="feedback-body">
            <dl className="feedback-preview">
              <dt>Title</dt>
              <dd className="feedback-title">{step.p.title}</dd>
              <dt>Description</dt>
              <dd className="feedback-desc">{step.p.description}</dd>
              <dt>Tags</dt>
              <dd>{step.p.tags.join(", ")}</dd>
            </dl>
            <p className="feedback-dest">{step.p.destination}.</p>
            {step.p.message && <p className="feedback-note" role="status">{step.p.message}</p>}
            <div className="feedback-actions">
              {step.p.mode === "live" && step.p.setUp ? (
                <button ref={primary} type="button" className="commit" disabled={busy || step.p.remaining <= 0} onClick={() => void send(step.p)}>
                  {busy ? "Sending…" : "Send"} <kbd>Ctrl Enter</kbd>
                </button>
              ) : step.p.setUp ? (
                <button ref={primary} type="button" className="commit" disabled={busy} onClick={() => void send(step.p)}>
                  {busy ? "Working…" : "Done"} <kbd>Ctrl Enter</kbd>
                </button>
              ) : (
                copyButton
              )}
            </div>
          </div>
        )}

        {step.kind === "sent" && (
          <div className="feedback-body">
            {step.r.sent ? (
              <p className="feedback-done" role="status">
                {step.r.message}{" "}
                {step.r.url ? (
                  <a href={step.r.url} target="_blank" rel="noreferrer">#{step.r.id}</a>
                ) : (
                  <>#{step.r.id}</>
                )}
              </p>
            ) : (
              <p className="feedback-note" role="status">{step.r.message}</p>
            )}
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
