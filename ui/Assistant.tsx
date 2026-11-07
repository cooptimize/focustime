// AS-1: the assistant panel. One side panel (a bottom sheet on the phone) over the app: my questions and its answers
// as cards, proposals with their preview and Confirm / Edit / Cancel, and push-to-talk. It calls only the assistant's
// actions (assistant.ask, confirm, cancel, history) and the voice route; every write is the same action the button
// calls, run by the server only after Confirm. Esc and × close it; Ctrl+J (or /) opens it (ui/App.tsx).
// AS-2: a question shows its choices as chips (a tap answers it; typing works too), a change of several parts shows
// each part's outcome with its own Undo, and moved to-dos have one Undo for all of them (assistant.undo).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AssistantContext, Card, Choice, ConfirmResult, HandleResult, Link, PartResult, Proposal, Turn, UndoResult } from "../assistant/types.ts";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "../assistant/types.ts";
import { call, csrfToken } from "./api.ts";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";

type Gate = { assistant: "ok" | "off" | "not_set_up"; voice: { on: boolean; message: string | null } };
type Entry = { id: string; role: "me" | "assistant"; text: string; cards: Card[]; proposals: Proposal[]; links: Link[] };
type Outcome = { tone: "ok" | "warn"; text: string; undo?: { clientKey: string; writeId: number }; /** AS-2: one Undo for this proposal's moved to-dos. */ moves?: number; parts?: PartResult[] };

const fromTurn = (t: Turn): Entry => ({ id: `t${t.id}`, role: t.role, text: t.text, cards: t.cards, proposals: t.proposals, links: [] });

/** The top bar's assistant mark on the phone: a speech bubble. */
export function AssistantMark(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export const ASSISTANT_VOICE_PATH = "/api/assistant/transcribe";
export const COMMANDS_HREF = "#/commands";

export function AssistantPanel(props: {
  phone: boolean;
  context: AssistantContext;
  initialText?: string;
  onClose: () => void;
  /** An app address from a card or link (#/ahead/item/4417); #/commands opens the command menu. */
  onOpen: (href: string) => void;
  /** The server clock's lead over this browser's (a pinned clock in the demo and tests): expiry is server time. */
  skewMs?: number;
}): ReactNode {
  const { phone, context, onClose, onOpen } = props;
  const skew = props.skewMs ?? 0;
  useReturnFocus();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [text, setText] = useState(props.initialText ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ctxKey = `${context.clientKey ?? ""}|${context.itemId ?? ""}`;

  useEffect(() => {
    let live = true;
    call<{ turns: Turn[]; gate: Gate }>("assistant.history", { limit: 40, context }).then(
      (r) => live && (setEntries(r.turns.map(fromTurn)), setGate(r.gate)),
      (e: Error) => live && (setEntries([]), setGate({ assistant: "not_set_up", voice: { on: false, message: null } }), setProblem(e.message)),
    );
    return () => void (live = false);
    // The gate follows the client in focus; the rest of the context is only sent with a question.
  }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => void inputRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Esc closes the panel from anywhere in it, and from the page while nothing modal is on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[data-overlay="modal"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const send = useCallback(async (choice?: Choice) => {
    const said = choice ? choice.label : text.trim();
    if (!said || busy) return;
    setBusy(true);
    setProblem(null);
    setEntries((xs) => [...(xs ?? []), { id: `me${Date.now()}`, role: "me", text: said, cards: [], proposals: [], links: [] }]);
    if (!choice) setText("");
    try {
      const r = await call<HandleResult>("assistant.ask", { text: said, context, ...(choice ? { answer: choice.value } : {}) });
      setEntries((xs) => [...(xs ?? []), { id: `a${r.turnId}`, role: "assistant", text: r.reply, cards: r.cards, proposals: r.proposals, links: r.links }]);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [text, busy, context]);

  const replaceProposal = (p: Proposal) => setEntries((xs) => (xs ?? []).map((x) => ({ ...x, proposals: x.proposals.map((q) => (q.id === p.id ? p : q)) })));
  const open = (href: string) => (href === COMMANDS_HREF ? onOpen(href) : (onOpen(href), phone && onClose()));

  const off = gate && gate.assistant !== "ok";
  return (
    <aside className={phone ? "assistant-panel assistant-sheet" : "assistant-panel"} data-overlay="details" aria-label="Assistant" data-testid="assistant-panel">
      <header className="as-head">
        <h2>Assistant</h2>
        <span className="as-hint">{phone ? "Ask, or hold to talk" : "Ask about your plan, or ask for a change"}</span>
        <CloseButton onClose={onClose} />
      </header>
      <div className="as-list" ref={listRef} aria-live="polite">
        {entries === null && <p className="as-quiet">Loading…</p>}
        {entries?.length === 0 && !off && (
          <div className="as-empty">
            <p>Try:</p>
            <ul>
              {["What's next?", "What's due today?", "Move everything from today to tomorrow", "Mark #4417 done and comment that the export is ready"].map((s) => (
                <li key={s}><button type="button" className="link-btn" onClick={() => (setText(s), inputRef.current?.focus())}>{s}</button></li>
              ))}
            </ul>
            <p className="as-quiet">Changes always show a preview first. Nothing is written until you Confirm.</p>
          </div>
        )}
        {entries?.map((e) => (
          <div key={e.id} className={`as-turn ${e.role}`}>
            {e.text && <p className="as-text">{e.text}</p>}
            {e.cards.map((c, i) => <CardView key={i} card={c} onOpen={open} onAnswer={e === entries.at(-1) && !busy ? (ch) => void send(ch) : null} skew={skew} />)}
            {e.proposals.map((p) => <ProposalView key={p.id} proposal={p} skew={skew} onChange={replaceProposal} />)}
            {e.links.length > 0 && (
              <p className="as-links">
                {e.links.map((l) => <button key={l.href} type="button" className="link-btn" onClick={() => open(l.href)}>{l.label}</button>)}
              </p>
            )}
          </div>
        ))}
        {busy && <p className="as-quiet" role="status">Thinking…</p>}
      </div>
      {problem && <p className="as-problem" role="alert">{problem}</p>}
      {off ? (
        <div className="as-off" role="status">
          <p>{gate.assistant === "off" ? "The assistant is off: AI is off for FocusTime (your FocusTime admin's switch)." : "The assistant isn't set up here."} Everything it does is also in the command menu.</p>
          <button type="button" className="top-btn primary" onClick={() => onOpen(COMMANDS_HREF)}>Open the command menu <kbd>Ctrl K</kbd></button>
        </div>
      ) : (
        <Composer phone={phone} text={text} setText={setText} onSend={() => void send()} busy={busy} gate={gate} context={context} inputRef={inputRef} />
      )}
    </aside>
  );
}

function Composer(p: { phone: boolean; text: string; setText: (s: string) => void; onSend: () => void; busy: boolean; gate: Gate | null; context: AssistantContext; inputRef: React.RefObject<HTMLTextAreaElement | null> }): ReactNode {
  const voice = useVoice(p.context, (t) => {
    const next = p.text.trim() ? `${p.text.trim()} ${t}` : t;
    p.setText(next);
    // The transcript is mine to edit: it is sent only with Send.
    requestAnimationFrame(() => p.inputRef.current?.focus());
  });
  const micOff = !p.gate?.voice.on;
  const mic = (
    <MicButton
      large={p.phone}
      state={voice.state}
      left={voice.left}
      disabled={micOff || p.busy}
      title={micOff ? (p.gate?.voice.message ?? "Voice is off") : voice.state === "recording" ? "Release, or tap again, to stop" : "Hold to talk, or tap to start and stop"}
      onDown={voice.down}
      onUp={voice.up}
    />
  );
  return (
    <div className="as-compose">
      {voice.state === "recording" && (
        <p className="as-rec" role="status"><span className="as-rec-dot" aria-hidden="true" /> Recording · {voice.left}s left</p>
      )}
      {voice.state === "sending" && <p className="as-quiet" role="status">Turning it into text…</p>}
      {voice.problem && <p className="as-problem" role="alert">{voice.problem}</p>}
      {micOff && p.gate?.voice.message && <p className="as-quiet as-mic-off">{p.gate.voice.message}</p>}
      <div className="as-row">
        <textarea
          ref={p.inputRef}
          rows={p.phone ? 2 : 3}
          value={p.text}
          maxLength={2000}
          placeholder="Ask, or say what to change"
          aria-label="Ask the assistant"
          onChange={(e) => p.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              p.onSend();
            }
          }}
        />
        {!p.phone && mic}
        <button type="button" className="top-btn primary as-send" onClick={p.onSend} disabled={p.busy || !p.text.trim()}>Send</button>
      </div>
      {p.phone && <div className="as-ptt">{mic}</div>}
    </div>
  );
}

function MicButton(p: { large: boolean; state: VoiceState; left: number; disabled: boolean; title: string; onDown: () => void; onUp: () => void }): ReactNode {
  const rec = p.state === "recording";
  return (
    <button
      type="button"
      className={`as-mic${p.large ? " large" : ""}${rec ? " on" : ""}`}
      aria-label={rec ? `Stop recording, ${p.left} seconds left` : p.large ? "Hold to talk" : "Talk"}
      aria-pressed={rec}
      title={p.title}
      disabled={p.disabled || p.state === "sending"}
      onPointerDown={(e) => (e.preventDefault(), p.onDown())}
      onPointerUp={() => p.onUp()}
      onPointerLeave={() => rec && p.onUp()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          p.onDown();
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="11" rx="3" fill={rec ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      {p.large && <span>{rec ? `Release to stop · ${p.left}s` : "Hold to talk"}</span>}
    </button>
  );
}

type VoiceState = "idle" | "recording" | "sending";
/** A held press longer than this stops on release (hold to talk); a shorter one is a tap that starts, and the next tap stops. */
const HOLD_MS = 350;

/** Push-to-talk: the recording lives in memory only until it is posted, and is dropped after (never kept or replayed). */
function useVoice(context: AssistantContext, onText: (t: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [left, setLeft] = useState(VOICE_MAX_SECONDS);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; bytes: number; started: number; downAt: number; timer: number; tick: number; stream: MediaStream } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    const x = rec.current;
    if (!x || x.r.state === "inactive") return;
    window.clearTimeout(x.timer);
    window.clearInterval(x.tick);
    x.r.stop();
  }, []);

  const start = useCallback(async () => {
    setProblem(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return setProblem("This browser can't record here. Type it instead");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setProblem("FocusTime can't use the microphone. Allow it in the browser, or type it");
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      stream.getTracks().forEach((t) => t.stop());
      return setProblem("This browser can't record in a format FocusTime takes. Type it instead");
    }
    const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
    const x = { r, chunks: [] as Blob[], bytes: 0, started: Date.now(), downAt: Date.now(), timer: 0, tick: 0, stream };
    rec.current = x;
    r.ondataavailable = (e) => {
      if (!e.data.size) return;
      x.chunks.push(e.data);
      x.bytes += e.data.size;
      if (x.bytes > VOICE_MAX_BYTES - 64_000) stop();
    };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const seconds = Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.round((Date.now() - x.started) / 1000)));
      const blob = new Blob(x.chunks, { type: mime });
      x.chunks = [];
      rec.current = null;
      void post(blob, seconds);
    };
    r.start(1000);
    setLeft(VOICE_MAX_SECONDS);
    setState("recording");
    // The hard stop at 60 seconds.
    x.timer = window.setTimeout(stop, VOICE_MAX_SECONDS * 1000);
    x.tick = window.setInterval(() => setLeft(Math.max(0, VOICE_MAX_SECONDS - Math.floor((Date.now() - x.started) / 1000))), 250);
  }, [stop]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (blob: Blob, seconds: number) => {
    if (!blob.size) return setState("idle");
    setState("sending");
    const q = new URLSearchParams({ seconds: String(seconds) });
    if (context.clientKey) q.set("client", context.clientKey);
    if (context.itemId) q.set("item", String(context.itemId));
    try {
      const res = await fetch(`${ASSISTANT_VOICE_PATH}?${q}`, { method: "POST", credentials: "same-origin", headers: { "content-type": blob.type, "x-csrf": csrfToken() }, body: blob });
      const r = (await res.json().catch(() => null)) as { ok: true; text: string } | { ok: false; message?: string; error?: string } | null;
      if (r && r.ok) onTextRef.current(r.text);
      else setProblem((r && !r.ok && (r.message ?? r.error)) || (res.status === 413 ? "That recording is too large" : "The recording couldn't be turned into text. Try again, or type it"));
    } catch {
      setProblem("FocusTime can't be reached. Try again, or type it");
    } finally {
      setState("idle");
    }
  };

  useEffect(() => () => {
    const x = rec.current;
    if (!x) return;
    // Closing the panel mid-recording throws the recording away: nothing is sent.
    x.r.onstop = () => x.stream.getTracks().forEach((t) => t.stop());
    window.clearTimeout(x.timer);
    window.clearInterval(x.tick);
    if (x.r.state !== "inactive") x.r.stop();
  }, []);

  return {
    state,
    left,
    problem,
    down: () => {
      if (state === "recording") return stop();
      if (state === "idle") void start();
    },
    up: () => {
      const x = rec.current;
      if (x && Date.now() - x.downAt > HOLD_MS) stop();
    },
  };
}

function CardView({ card, onOpen, onAnswer, skew }: { card: Card; onOpen: (href: string) => void; /** The newest question's chips answer it; older ones are history. */ onAnswer: ((c: Choice) => void) | null; skew: number }): ReactNode {
  const go = (l: Link | undefined) => l && <button type="button" className="link-btn as-go" onClick={() => onOpen(l.href)}>{l.label}</button>;
  switch (card.kind) {
    case "question": {
      const live = !!onAnswer && Date.parse(card.expiresAt) > Date.now() + skew;
      return (
        <div className="as-card question" data-testid="assistant-question">
          <div className="as-chips" role="group" aria-label={card.text}>
            {card.choices.map((c) => (
              <button key={c.value} type="button" className="as-chip" disabled={!live} onClick={() => onAnswer?.(c)}>{c.label}</button>
            ))}
          </div>
          <p className="as-meta">{live ? "Or just type it." : "Ask again to choose."}</p>
        </div>
      );
    }
    case "note":
      return <div className="as-card note"><p>{card.text}</p>{go(card.link)}</div>;
    case "item":
      return (
        <div className="as-card item">
          <p className="as-card-head"><span className="as-client">{card.clientName}</span> <span className="wi-id">#{card.id}</span> <b>{card.title}</b></p>
          <p className="as-meta">{card.type} · {card.state} · {card.owner ?? "Unassigned"}{card.start || card.target ? ` · ${card.start ?? "no start"} to ${card.target ?? "no target"}` : ""}</p>
          {card.children.length > 0 && (
            <ul className="as-children">
              {card.children.map((c) => <li key={c.id}><span className="wi-id">#{c.id}</span> {c.title} <span className="as-meta">{c.state}{c.owner ? ` · ${c.owner}` : ""}</span></li>)}
            </ul>
          )}
          {go(card.link)}
        </div>
      );
    case "block":
      return (
        <div className="as-card block">
          <p className="as-card-head"><span className="as-client">{card.clientName}</span> <b>{card.date} {card.half}</b> <span className="as-meta">{card.time} · {card.status}</span></p>
          {card.picks.length > 0 && <ul className="as-children">{card.picks.map((p) => <li key={p.id} className={p.done ? "done" : undefined}>{p.done ? "✓ " : ""}{p.title} <span className="as-meta">{p.size}</span></li>)}</ul>}
          {go(card.link)}
        </div>
      );
    case "pick":
      return <div className="as-card pick"><p className="as-card-head"><span className="as-client">{card.clientName}</span> {card.done ? "✓ " : ""}<b>{card.title}</b> <span className="as-meta">{card.date} {card.half}{card.time ? ` · ${card.time}` : ""}</span></p>{go(card.link)}</div>;
    case "send":
      return <div className="as-card send"><p className="as-card-head"><span className="as-client">{card.clientName}</span> <b>{card.title}</b></p><p className="as-meta">{card.from} to {card.to} · {card.tier === "must" ? "Must" : "Suggested"} · week of {card.weekStart} · {card.state}</p>{go(card.link)}</div>;
    case "promise":
      return <div className="as-card promise"><p className="as-card-head"><span className="as-client">{card.clientName}</span> <b>{card.what}</b></p><p className="as-meta">{card.who}{card.toWhom ? ` to ${card.toWhom}` : ""}{card.due ? ` · due ${card.due}` : ""}</p>{go(card.link)}</div>;
  }
}

const LONG = 120;
const editLabel: Record<string, string> = { text: "Comment", comment: "Comment", after: "Description after", date: "Day", half: "Half" };

function ProposalView({ proposal: p, skew, onChange }: { proposal: Proposal; skew: number; onChange: (p: Proposal) => void }): ReactNode {
  const writes = useDevOpsWrite();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(() => seedEdits(p));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Outcome | null>(null);
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + skew), 15_000);
    return () => window.clearInterval(t);
  }, [skew]);
  const expired = p.state === "open" && Date.parse(p.expiresAt) <= now;
  const open = p.state === "open" && !expired;

  const confirm = async () => {
    setBusy(true);
    try {
      const sent = editing ? Object.fromEntries(Object.entries(edits).filter(([k, v]) => p.editable.includes(k) && v.trim())) : {};
      const r = await call<ConfirmResult>("assistant.confirm", { proposalId: p.id, ...(Object.keys(sent).length ? { edits: sent } : {}) });
      if (r.ok) {
        onChange({ ...p, state: "confirmed" });
        setOut({ tone: "ok", text: r.message, ...(r.undo?.kind === "devops" && p.clientKey && !r.parts ? { undo: { clientKey: p.clientKey, writeId: r.undo.id } } : {}), ...(r.undo?.kind === "moves" ? { moves: r.undo.id } : {}), ...(r.parts ? { parts: r.parts } : {}) });
        setEditing(false);
      } else if (r.reason === "changed" && r.proposal) {
        onChange(r.proposal);
        setEdits(seedEdits(r.proposal));
        setOut({ tone: "warn", text: `${r.message}. Check the preview again, then Confirm.` });
      } else {
        if (r.reason === "expired" || r.reason === "gone") onChange({ ...p, state: r.reason === "expired" ? "expired" : "failed" });
        setOut({ tone: "warn", text: r.message });
      }
    } catch (e) {
      setOut({ tone: "warn", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const undoMoves = async (id: number) => {
    setBusy(true);
    try {
      const r = await call<UndoResult>("assistant.undo", { proposalId: id });
      setOut({ tone: r.ok && !r.notBack.length ? "ok" : "warn", text: r.message });
    } catch (e) {
      setOut({ tone: "warn", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    await call("assistant.cancel", { proposalId: p.id }).catch(() => null);
    onChange({ ...p, state: "cancelled" });
    setBusy(false);
  };

  const v = p.preview;
  return (
    <div className={`as-card proposal ${p.state}${expired ? " expired" : ""}`} data-testid="assistant-proposal">
      <p className="as-card-head">
        <span className={`as-sys ${v.system === "DevOps" ? "devops" : ""}`}>{v.system}</span>
        <b>{p.title}</b>
        {p.clientName && <span className="as-client">{p.clientName}</span>}
      </p>
      <p className="as-meta">{v.summary}: {v.target}</p>
      {v.identity && <p className="as-meta">Writes as {v.identity}</p>}
      <dl className="as-rows">
        {v.rows.map((r, i) => {
          const long = (r.before?.length ?? 0) > LONG || (r.after?.length ?? 0) > LONG || /\n/.test(`${r.before ?? ""}${r.after ?? ""}`);
          return (
            <div key={i} className={long ? "as-row-long" : "as-row-short"}>
              <dt>{r.label}</dt>
              {long ? (
                <dd>
                  {r.before !== null && <><span className="as-ba">Before</span><pre className="as-before">{r.before || "(empty)"}</pre></>}
                  <span className="as-ba">After</span><pre className="as-after">{r.after ?? "(none)"}</pre>
                </dd>
              ) : (
                <dd>{r.before !== null && <><s className="as-before">{r.before}</s> → </>}<span className="as-after">{r.after ?? "None"}</span></dd>
              )}
            </div>
          );
        })}
      </dl>
      {v.notes.map((n) => <p key={n} className="as-meta">{n}</p>)}
      <p className="as-meta">Who sees it: {p.whoSees}</p>
      {editing && open && (
        <div className="as-edits">
          {p.editable.map((k) => (
            <label key={k}>
              <span>{editLabel[k] ?? k}</span>
              {k === "half" ? (
                <select value={edits[k] ?? ""} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}>
                  <option value="">As proposed</option>
                  <option value="AM">Morning</option>
                  <option value="PM">Afternoon</option>
                </select>
              ) : k === "date" ? (
                <input type="date" value={edits[k] ?? ""} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
              ) : (
                <textarea rows={k === "after" ? 8 : 3} value={edits[k] ?? ""} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
      )}
      {open && (
        <p className="as-actions">
          <button type="button" className="top-btn primary" onClick={() => void confirm()} disabled={busy}>Confirm</button>
          {p.editable.length > 0 && <button type="button" className="top-btn" onClick={() => setEditing((e) => !e)} disabled={busy} aria-expanded={editing}>{editing ? "Done editing" : "Edit"}</button>}
          <button type="button" className="top-btn" onClick={() => void cancel()} disabled={busy}>Cancel</button>
        </p>
      )}
      {expired && <p className="as-meta">This expired. Ask again for a fresh preview.</p>}
      {p.state === "cancelled" && <p className="as-meta">Cancelled. Nothing was changed.</p>}
      {p.state === "expired" && !expired && <p className="as-meta">This expired. Ask again for a fresh preview.</p>}
      {out && (
        <p className={`as-outcome ${out.tone}`} role="status">
          {out.text}
          {out.undo && writes && <> <button type="button" className="link-btn" onClick={() => void writes.begin(out.undo!.clientKey, [{ kind: "undo", writeId: out.undo!.writeId }])}>Undo</button></>}
          {out.moves !== undefined && <> <button type="button" className="link-btn" disabled={busy} onClick={() => { const { moves: id, ...rest } = out; setOut(rest); void undoMoves(id!); }}>Undo</button></>}
        </p>
      )}
      {out?.parts && (
        <ul className="as-parts">
          {out.parts.map((x) => (
            <li key={x.label} className={x.ok ? "ok" : "warn"}>
              <span aria-hidden="true">{x.ok ? "✓" : "✗"}</span> <b>{x.label}</b>: {x.message}
              {x.undo && writes && p.clientKey && <> <button type="button" className="link-btn" onClick={() => void writes.begin(p.clientKey!, [{ kind: "undo", writeId: x.undo!.id }])}>Undo</button></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The editable fields start at what the preview proposes (a comment's text, the description after). */
function seedEdits(p: Proposal): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of p.editable) {
    if (k === "text" || k === "after" || k === "comment") {
      const row = p.preview.rows.find((r) => /comment|description/i.test(r.label)) ?? p.preview.rows.at(-1);
      out[k] = row?.after ?? "";
    } else out[k] = "";
  }
  return out;
}
