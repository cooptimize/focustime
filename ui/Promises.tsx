// AP-2: Inbox › Promises. My own messages in client chats read for asks that commit to something ("I'll send it
// tomorrow"), by client, newest first. Each card: what, to whom, due, the message, the ask it answers, Open in Teams,
// and Make it a follow-up (who, what, Teams and the due date filled in; the existing follow-up model), Link to a
// DevOps item, Done and Dismiss (both with Undo). A promise made a follow-up or linked closes when the follow-up is
// done or the item is done in DevOps. Nothing is posted in Teams. Chat text shows only on its own client's card.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { PromiseView, PromisesData } from "../plan/asks.ts";
import { dueState } from "../plan/due.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";
import { call } from "./api.ts";
import { LinkPicker } from "./Asks.tsx";
import { DueBadge, Fading } from "./FollowUps.tsx";
import { clientColor, whenText } from "./labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const keyOf = (p: { chatId: string; messageId: string }) => `${p.chatId}|${p.messageId}`;
const shortDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function Promises({ data, version, onCount, onAskCount, onChanged, openSettings }: { data: WeekLoadData; version: number; onCount: (n: number) => void; onAskCount?: (n: number) => void; onChanged: () => void; openSettings: (section: string) => void }) {
  const [state, setState] = useState<PromisesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [form, setForm] = useState<{ key: string; kind: "followup" | "link" } | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const tz = userZone(data);
  const today = state?.today ?? localToday(new Date().toISOString(), tz);
  const clearNotice = useCallback(() => setNotice(null), []);
  const show = useCallback(
    (d: PromisesData) => {
      setState(d);
      onCount(d.open);
      onAskCount?.(d.asksOpen);
    },
    [onCount, onAskCount],
  );
  const load = useCallback(async () => {
    try {
      show(await call<PromisesData>("promises.list", {}));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [show]);
  useEffect(() => void load(), [load, version]);
  useEffect(() => head.current?.focus(), []);

  const groups = useMemo(() => {
    const m = new Map<string, { clientKey: string; clientName: string; items: PromiseView[] }>();
    const sorted = [...(state?.promises ?? [])].sort((a, b) => (a.status === "open") !== (b.status === "open") ? (a.status === "open" ? -1 : 1) : Date.parse(b.at) - Date.parse(a.at));
    for (const p of sorted) (m.get(p.clientKey) ?? m.set(p.clientKey, { clientKey: p.clientKey, clientName: p.clientName, items: [] }).get(p.clientKey)!).items.push(p);
    return [...m.values()];
  }, [state]);

  const run = async (action: string, input: Record<string, unknown>, done: ReactNode) => {
    try {
      show(await call<PromisesData>(action, input));
      setError(null);
      setForm(null);
      setNotice(done);
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };
  const resolve = (p: PromiseView, status: "done" | "dismissed") =>
    void run("promises.resolve", { chatId: p.chatId, messageId: p.messageId, status }, (
      <>
        {status === "done" ? "Marked done" : "Dismissed"}.{" "}
        <button type="button" className="mini quiet" onClick={() => void run("promises.reopen", { chatId: p.chatId, messageId: p.messageId }, "Open again")}>
          Undo
        </button>
      </>
    ));

  const open = state?.open ?? 0;
  return (
    <main className="inbox asks promises" aria-label="Promises">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Promises {state && open > 0 && <span className="muted">{open} open</span>}
        </h2>
      </div>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <Fading text={notice} onGone={clearNotice} ms={8000} />
      {state && state.promises.length === 0 && (
        <div className="asks-empty">
          <p>No open promises</p>
          <p className="muted">
            When you write "I'll", "let me", "by Friday" or similar in a client chat you read for asks, it shows up here, so you can make it a follow-up. Phrases are in{" "}
            <button type="button" className="linkish" onClick={() => openSettings("clients")}>
              Settings › Clients
            </button>
            .
          </p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.clientKey} className="ask-group" aria-label={`Promises to ${g.clientName}`} style={{ "--c": clientColor(g.clientKey, data.clients) } as CSSProperties}>
          <h3>
            <span className="swatch" aria-hidden="true" />
            {g.clientName} <span className="muted">{g.items.filter((p) => p.status === "open").length || ""}</span>
          </h3>
          <ul className="ask-list">
            {g.items.map((p) => (
              <PromiseCard
                key={keyOf(p)}
                p={p}
                tz={tz}
                today={today}
                form={form?.key === keyOf(p) ? form.kind : null}
                onForm={(kind) => setForm(kind ? { key: keyOf(p), kind } : null)}
                onFollowUp={(v) => void run("promises.followup", { chatId: p.chatId, messageId: p.messageId, ...v }, "Follow-up added. The promise closes when it's done")}
                onLink={(id) => void run("promises.link", { chatId: p.chatId, messageId: p.messageId, itemId: id }, `Linked to #${id}. The promise closes when it's done in DevOps`)}
                onDone={() => resolve(p, "done")}
                onDismiss={() => resolve(p, "dismissed")}
                onUndo={() => void run("promises.reopen", { chatId: p.chatId, messageId: p.messageId }, "Open again")}
              />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

function PromiseCard(p: {
  p: PromiseView; tz: string; today: string;
  form: "followup" | "link" | null; onForm: (k: "followup" | "link" | null) => void;
  onFollowUp: (v: { who: string; what: string; due: string }) => void; onLink: (id: number) => void;
  onDone: () => void; onDismiss: () => void; onUndo: () => void;
}) {
  const x = p.p;
  const open = x.status === "open";
  const due = x.due ? dueState(x.due, p.today) : null;
  return (
    <li className={`ask-card promise-card${open ? "" : " resolved"}`} data-promise={keyOf(x)} aria-label={`Promise: ${x.what}`}>
      <div className="ask-head">
        <strong>{x.what}</strong>
        {due && <DueBadge l={{ dueState: due }} />}
      </div>
      <p className="promise-meta muted">
        {x.toWhom ? <>To {x.toWhom} · </> : null}
        You said <time dateTime={x.at}>{whenText(x.at, p.tz)}</time> · {x.chatName}
        {x.due && !due ? <> · due {shortDay(x.due)}</> : null}
      </p>
      <p className="ask-text clamp">{x.text}</p>
      <p className="ask-meta muted">
        {x.answers && <span>Answers: {x.answers.title}</span>}
        {x.notSorted && <span className="ask-not-sorted">Not read by AI: {x.notSorted}</span>}
        {x.reason && <span title={x.reason}>Why: {x.reason}</span>}
        <a href={x.link} target="_blank" rel="noopener noreferrer">
          Open in Teams
        </a>
      </p>
      {open ? (
        <div className="ask-actions">
          <button type="button" className="mini primary" aria-expanded={p.form === "followup"} onClick={() => p.onForm(p.form === "followup" ? null : "followup")}>
            Make it a follow-up
          </button>
          <button type="button" className="mini" aria-expanded={p.form === "link"} onClick={() => p.onForm(p.form === "link" ? null : "link")}>
            Link to an item…
          </button>
          <button type="button" className="mini" onClick={p.onDone}>
            Done
          </button>
          <button type="button" className="mini quiet" onClick={p.onDismiss}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className="ask-done">
          {x.status === "followup" ? (
            <>Follow-up added. It closes when the follow-up is done</>
          ) : x.status === "linked" && x.item ? (
            <>
              Linked to{" "}
              <a href={x.item.url ?? undefined} target="_blank" rel="noopener noreferrer">
                #{x.item.id} {x.item.title}
              </a>
              . It closes when the item is done
            </>
          ) : x.status === "done" ? (
            <>Done</>
          ) : (
            <>Dismissed</>
          )}
          {(x.status === "done" || x.status === "dismissed") && (
            <button type="button" className="mini quiet" onClick={p.onUndo}>
              Undo
            </button>
          )}
        </p>
      )}
      {open && p.form === "followup" && <FollowUpForm p={x} onSave={p.onFollowUp} onCancel={() => p.onForm(null)} />}
      {open && p.form === "link" && <LinkPicker a={x} onPick={p.onLink} onCancel={() => p.onForm(null)} />}
    </li>
  );
}

/** Make it a follow-up: who, what and the due date filled in from the promise (the channel is the chat, in Teams). */
function FollowUpForm({ p, onSave, onCancel }: { p: PromiseView; onSave: (v: { who: string; what: string; due: string }) => void; onCancel: () => void }) {
  const [who, setWho] = useState(p.toWhom ?? "");
  const [what, setWhat] = useState(p.what);
  const [due, setDue] = useState(p.due ?? "");
  return (
    <form
      className="ask-form promise-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ who: who.trim(), what: what.trim(), due });
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
    >
      <label>
        What
        <input autoFocus required maxLength={200} value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label>
        Who <span className="muted">(optional)</span>
        <input maxLength={200} value={who} onChange={(e) => setWho(e.target.value)} placeholder={p.clientName} />
      </label>
      <label>
        Due <span className="muted">(optional)</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <span className="muted promise-channel">Channel: Teams, {p.chatName}</span>
      <button type="submit" className="mini primary">Add follow-up</button>
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}
