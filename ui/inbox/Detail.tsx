// IB-1 slice 2, IB-4: one open row of Promises or Captures, in place (and a send, reached from Day's strip): what I
// said, every action (ItemActions, the same set the keys run), the form an action opened, then the item's own body: a
// promise's item and where it came from; a send's answer row; a capture to sort; a draft to create. Nothing here posts
// in Teams or sends mail without Close the loop's own preview (ui/SendLoop.tsx).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { SendView, CommitData } from "../../plan/team-types.ts";
import type { PersonRef } from "../../plan/person-ref.ts";
import { call } from "../api.ts";
import { SortCapture, captureClients } from "../Capture.tsx";
import { SendLoop } from "../SendLoop.tsx";
import { DraftItem, LinkedItem, SuggestionBox } from "../Conversations.tsx";
import { ItemTitleLink } from "../WorkLink.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { WRITING_POLL_MS } from "../createdraft-ctx.ts";
import { draftRowState, draftRowText } from "../../plan/capture-prepare.ts";
import { CLOSE_HOW, type CloseHow, type DraftStory } from "../../plan/types.ts";
import { FollowUpForm } from "../FollowUps.tsx";
import { clientColor } from "../labels.ts";
import { Stamp } from "../Stamp.tsx";
import { stampText } from "../stamp.ts";
import { PromiseLink } from "../MyPromises.tsx";
import { PersonPicker, type PersonValue } from "../PersonPicker.tsx";
import { IncomingRow } from "../Team.tsx";
import type { Entry } from "./data.ts";
import { ItemActions, type Act, type FormId } from "./ItemActions.tsx";
import { lateText, dueWords } from "./model.ts";

/** "Mon 9:00 AM", "today 3:30 PM": when a snooze ends, in my zone. */
export function wakeWords(at: string, tz: string, today: string): string {
  const z = Temporal.Instant.from(at).toZonedDateTimeISO(tz);
  const time = z.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const d = z.toPlainDate();
  const days = Temporal.PlainDate.from(today).until(d).days;
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? d.toLocaleString("en-US", { weekday: "short" }) : d.toLocaleString("en-US", { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

export type DetailProps = {
  entry: Entry;
  acts: Act[];
  form: FormId | null;
  setForm: (f: FormId | null) => void;
  data: WeekLoadData;
  tz: string;
  today: string;
  clientName: (k: string | null) => string;
  /** Runs an action and reloads (the same path ItemActions uses). */
  run: (action: string, input: Record<string, unknown>, notice: string, undo?: { action: string; input: Record<string, unknown> }) => Promise<void>;
  /** A form's own call: returns the error to show, or null when it worked (then the form closes and the Inbox reloads). */
  submit: (action: string, input: Record<string, unknown>, notice: string) => Promise<string | null>;
  /** Reads the Inbox again quietly (a draft's AI version still being written). */
  reload?: () => void;
  phone?: boolean;
  /** LP-1: a send closed the loop (or saved a draft): close the form, say so, read the Inbox again. */
  finished?: (notice: string) => void;
};

/** The status pill: late or due. */
function Pill({ entry, today }: { entry: Entry; today: string }) {
  const r = entry.row;
  if (r.done) return <span className="ib-pill done">Done</span>;
  if (r.late && r.due) return <span className="ib-pill late">{`${dueWords(r.due, today)} · ${lateText(r.due, today)}`}</span>;
  if (r.due && r.kind === "promise") return <span className={`ib-pill${r.due <= today ? " soon" : ""}`}>{dueWords(r.due, today)}</span>;
  return null;
}

/** IB-4: an open row's content, in place under its row (`inline`), or on its own (a send from Day's strip). */
export function Detail(p: DetailProps & { inline?: boolean }): ReactNode {
  const { entry: e } = p;
  const r = e.row;
  const color = clientColor(r.clientKey ?? undefined, p.data.clients);
  return (
    <article className={`ib-detail ib4-open${p.phone ? " phone" : ""}`} aria-label={r.title} style={{ "--c": color } as CSSProperties}>
      {!p.inline && (
        <header className="ib-detail-head">
          <h2 className="ib-detail-title" tabIndex={-1}>
            {r.title || "(no title)"}
          </h2>
          <Pill entry={e} today={p.today} />
        </header>
      )}
      <Lead {...p} />
      <ItemActions acts={p.acts} label={r.title} phone={!!p.phone} />
      <FormArea {...p} />
      <Body {...p} />
    </article>
  );
}

/** Under the title: my own words for a chat promise. */
function Lead({ entry: e, tz, today }: DetailProps): ReactNode {
  if (e.kind === "chatPromise" && e.promise?.messages.length)
    return (
      <blockquote className="ib-said">
        <span className="muted">You said, <Stamp at={e.promise.messages[0]!.at} tz={tz} today={today} /></span> “{e.promise.messages.map((m) => m.text).join(" ")}”
      </blockquote>
    );
  return null;
}

/** The form an action opened, under the actions (one at a time). */
function FormArea(p: DetailProps): ReactNode {
  const { entry: e, form, setForm } = p;
  const writes = useDevOpsWrite();
  if (!form) return null;
  const cancel = () => setForm(null);
  const who = e.row.who;
  if (form === "close") {
    const submit = (v: { how: string | null; note: string | null }) =>
      e.kind === "chatPromise" && e.promise
        ? p.submit("my_promises.close", { id: e.promise.id, ...(v.how ? { how: v.how } : {}), ...(v.note ? { note: v.note } : {}) }, "Loop closed")
        : e.kind === "followUp" && e.followUp
          ? p.submit("followup.close", { id: e.followUp.id, note: v.note, ...(v.how ? { how: v.how } : {}) }, "Loop closed")
          : Promise.resolve("Nothing to close");
    // A promise I added starts on its own channel (as its row did before IB-1), in Close without sending.
    const ch = e.kind === "followUp" ? e.followUp?.channel ?? null : null;
    const initialHow = (CLOSE_HOW as readonly string[]).includes(ch ?? "") ? (ch as CloseHow) : null;
    // LP-1: Draft › Preview › Sent; IB-1's form stays as "Close without sending".
    const key = e.kind === "chatPromise" && e.promise ? `c${e.promise.id}` : e.kind === "followUp" && e.followUp ? `f${e.followUp.id}` : null;
    if (!key) return null;
    return <SendLoop key={key} promiseKey={key} who={who} demo={!!p.data.demo} compact={!!p.phone} onClosed={(m) => (p.finished ? p.finished(m) : (setForm(null), p.reload?.()))} onCancel={cancel} closeWithout={submit} initialHow={initialHow} />;
  }
  if (form === "due") return <DueForm {...p} />;
  if (form === "who") return <WhoForm {...p} />;
  if (form === "link") {
    if (e.kind === "chatPromise" && e.promise) {
      const pr = e.promise;
      return (
        <div className="ib-form">
          <PromiseLink p={pr} canComment={!!writes?.can(pr.clientKey)} onCancel={cancel} onPick={(itemId, comment) => void p.submit("my_promises.link", { id: pr.id, itemId }, `Linked to #${itemId}. The promise stays open.`).then((err) => void (!err && comment && writes && writes.begin(pr.clientKey, [{ kind: "conversation_comment", commitmentId: pr.id, itemId }])))} />
        </div>
      );
    }
  }
  if (form === "draft") return <DraftForm {...p} />;
  if (form === "sort" && e.kind === "capture" && e.capture)
    return (
      <div className="ib-form">
        <SortCapture capture={e.capture} clients={captureClients(p.data)} today={p.today} onDone={(m) => void p.run("inbox.list", {}, m)} onCancel={cancel} />
      </div>
    );
  if (form === "edit" && e.kind === "followUp" && e.followUp)
    return (
      <div className="ib-form">
        <FollowUpForm clients={captureClients(p.data)} initial={e.followUp} onCancel={cancel} onSaved={() => void p.run("inbox.list", {}, "Saved")} />
      </div>
    );
  return null;
}

function DueForm(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const [day, setDay] = useState(e.row.due ?? "");
  const [err, setErr] = useState<string | null>(null);
  const t = Temporal.PlainDate.from(p.today);
  const presets = [
    { label: "Today", day: p.today },
    { label: "Tomorrow", day: t.add({ days: 1 }).toString() },
    { label: "Next Monday", day: t.add({ days: 8 - t.dayOfWeek }).toString() },
  ];
  const save = async (d: string | null) => {
    const r =
      e.kind === "chatPromise" && e.promise ? await p.submit("my_promises.due", { id: e.promise.id, due: d }, d ? `Due ${dueWords(d, p.today).replace(/^Due /, "")}` : "No due day")
      : e.kind === "followUp" && e.followUp ? await p.submit("followup.edit", { id: e.followUp.id, due: d }, d ? `Due ${dueWords(d, p.today).replace(/^Due /, "")}` : "No due day")
      : "Nothing to change";
    setErr(r);
  };
  return (
    <form className="ib-form ib-due" aria-label="Due" onSubmit={(ev) => (ev.preventDefault(), void save(day || null))} onKeyDown={(ev) => ev.key === "Escape" && (ev.stopPropagation(), p.setForm(null))}>
      <span className="ib-form-label">Due</span>
      {presets.map((x) => (
        <button key={x.label} type="button" className="mini" aria-pressed={day === x.day} onClick={() => void save(x.day)}>
          {x.label}
        </button>
      ))}
      <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} aria-label="Due day" autoFocus />
      <button type="submit" className="mini primary" disabled={!day}>Save</button>
      {e.row.due && (
        <button type="button" className="mini quiet" onClick={() => void save(null)}>
          No due day
        </button>
      )}
      <button type="button" className="mini quiet" onClick={() => p.setForm(null)}>Cancel</button>
      {err && <span className="set-problem" role="alert">{err}</span>}
    </form>
  );
}

/** Who it's to: a person from the picker, a name, or nobody (never me). */
function WhoForm(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const initial: PersonValue =
    e.kind === "chatPromise" && e.promise ? { who: e.promise.toName ?? "", whoRef: e.promise.toRef }
    : e.kind === "followUp" && e.followUp ? { who: e.followUp.hasWho ? e.followUp.who : "", whoRef: e.followUp.whoRef }
    : { who: "", whoRef: null };
  const [v, setV] = useState<PersonValue>(initial);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const who = v.who.trim();
    const whoRef: PersonRef | null = who ? v.whoRef : null;
    const r =
      e.kind === "chatPromise" && e.promise ? await p.submit("my_promises.who", { id: e.promise.id, who: who || null, whoRef }, who ? `For ${who}` : "For no one named")
      : e.kind === "followUp" && e.followUp ? await p.submit("followup.edit", { id: e.followUp.id, who, whoRef }, who ? `For ${who}` : "For no one named")
      : "Nothing to change";
    setErr(r);
  };
  const clientKey = e.row.clientKey;
  return (
    <form className="ib-form ib-who" aria-label="Who" onSubmit={(ev) => (ev.preventDefault(), void save())} onKeyDown={(ev) => ev.key === "Escape" && (ev.stopPropagation(), p.setForm(null))}>
      <PersonPicker value={v} onChange={setV} clientKey={clientKey} {...(e.kind === "chatPromise" && e.promise ? { conversationId: e.promise.conversationId, commitmentId: e.promise.id } : {})} />
      <button type="submit" className="mini primary">Save</button>
      <button type="button" className="mini quiet" onClick={() => p.setForm(null)}>Cancel</button>
      {err && <span className="set-problem" role="alert">{err}</span>}
    </form>
  );
}

/** Create DevOps item for a chat promise: its conversation's draft (one made from its messages first, CV-2). */
function DraftForm(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const writes = useDevOpsWrite();
  const [conv, setConv] = useState<number | null>(e.kind === "chatPromise" ? (e.promise?.conversationId ?? null) : null);
  const [err, setErr] = useState<string | null>(null);
  const promiseId = e.kind === "chatPromise" ? (e.promise?.id ?? null) : null;
  useEffect(() => {
    if (conv !== null || promiseId === null) return;
    let live = true;
    void call<{ conversationId: number }>("my_promises.start_draft", { id: promiseId }).then((r) => live && setConv(r.conversationId), (x) => live && setErr(errText(x)));
    return () => void (live = false);
  }, [conv, promiseId]);
  if (err) return <p className="set-problem" role="alert">{err}</p>;
  if (conv === null) return <p className="muted">Getting the form ready…</p>;
  const client = e.kind === "chatPromise" ? e.promise : null;
  if (!client) return null;
  const commitmentId = promiseId;
  return (
    <div className="ib-form">
      <DraftItem c={{ id: conv, clientName: client.clientName, clientKey: client.clientKey }} commitmentId={commitmentId} onCancel={() => p.setForm(null)} onCreate={(change) => (p.setForm(null), void writes?.begin(client.clientKey, [change]))} />
    </div>
  );
}

/** The item's own body, beside or under the actions. */
function Body(p: DetailProps): ReactNode {
  const { entry: e, tz } = p;
  const writes = useDevOpsWrite();
  if (e.kind === "chatPromise") {
    const pr = e.promise;
    if (!pr) return <p className="muted ib-missing">This promise couldn't be read just now. Try again in a moment.</p>;
    return (
      <div className="ib-body">
        <section className="ib-card" aria-label="Linked DevOps item">
          <h3 className="ib-section">Linked DevOps item</h3>
          {pr.item ? <LinkedItem item={pr.item} tz={tz} lead="Linked to" clientKey={pr.clientKey} /> : <p>None yet.</p>}
          {!pr.item && pr.likely && (
            <p className="muted">
              Looks like{" "}
              <ItemTitleLink clientKey={pr.clientKey} id={pr.likely.id} url={pr.likely.url}>
                #{pr.likely.id} {pr.likely.title ?? ""}
              </ItemTitleLink>
            </p>
          )}
        </section>
        <section className="ib-card" aria-label="Where it came from">
          <h3 className="ib-section">Where it came from</h3>
          <p>
            {pr.chatName}
            {pr.conversationTitle ? ` · ${pr.conversationTitle}` : ""} · <Stamp at={pr.createdAt} tz={tz} today={p.today} />
          </p>
          {pr.conversationClosed && <p className="muted">The conversation is closed. This promise is still yours.</p>}
          {pr.reason && <p className="muted">Why it's a promise: {pr.reason}</p>}
          <a href={pr.link} target="_blank" rel="noopener noreferrer">
            Open in Teams
          </a>
        </section>
        {pr.suggestions.map((s) => (
          <SuggestionBox key={s.id} s={s} onPost={(inc) => void writes?.begin(pr.clientKey, [s.kind === "comment" ? { kind: "conversation_comment", suggestionId: s.id, ...(inc ? { includeInternal: true } : {}) } : { kind: "description_update", suggestionId: s.id }])} onSkip={() => void p.run("suggestions.skip", { id: s.id }, "Skipped")} />
        ))}
        {(pr.state === "done" || pr.state === "not_needed") && <p className="muted">{pr.state === "done" ? "Done" : "Not needed"} · <Stamp at={pr.createdAt} tz={tz} today={p.today} /></p>}
      </div>
    );
  }
  if (e.kind === "followUp") {
    const f = e.followUp;
    if (!f) return <p className="muted ib-missing">This promise couldn't be read just now. Try again in a moment.</p>;
    return (
      <div className="ib-body">
        <section className="ib-card" aria-label="Linked DevOps item">
          <h3 className="ib-section">Linked DevOps item</h3>
          {f.itemId ? (
            <p>
              <ItemTitleLink clientKey={f.clientKey} id={f.itemId} url={f.itemUrl}>
                #{f.itemId}
              </ItemTitleLink>
            </p>
          ) : (
            <p>None yet.</p>
          )}
        </section>
        <section className="ib-card" aria-label="Where it came from">
          <h3 className="ib-section">Where it came from</h3>
          <p>{f.byHand ? "You added it, " : "Opened "}<Stamp at={f.openedAt} tz={tz} today={p.today} /></p>
          {f.origin && (
            <p className="muted">
              Why: {f.origin.trigger}
              {f.origin.items.length ? ` (${f.origin.items.map((i) => (i.itemId ? `#${i.itemId} ${i.title}` : i.title)).join(", ")})` : ""}
            </p>
          )}
          {f.draft && <pre className="ib-draft">{f.draft}</pre>}
        </section>
        {f.closedAt && <p className="muted">{f.outcome === "not_needed" ? "Not needed" : "Loop closed"} · <Stamp at={f.closedAt} tz={tz} today={p.today} />{f.closeNote ? `: ${f.closeNote}` : ""}</p>}
      </div>
    );
  }
  if (e.kind === "send") return <SendBody {...p} />;
  if (e.kind === "capture") {
    if (!e.capture) return <p className="muted ib-missing">This capture couldn't be read just now.</p>;
    return (
      <div className="ib-body">
        <p className="ib-summary">{e.capture.text}</p>
        <p className="muted">Captured {stampText(e.capture.createdAt, tz, p.today)}. Sort it into a story or feature, a to-do for today, or a promise.</p>
      </div>
    );
  }
  const d = e.draft;
  if (!d) return <p className="muted ib-missing">This draft couldn't be read just now.</p>;
  return (
    <div className="ib-body">
      <p className="ib-summary">{d.description || "No description yet."}</p>
      <p className="muted">
        {d.level === "feature" ? "Draft feature" : "Draft story"}
        {d.parentItemId !== null ? ` under #${d.parentItemId}` : ""} · {p.clientName(d.clientKey)}
      </p>
      <DraftState d={d} clientName={p.clientName(d.clientKey)} reload={p.reload} />
    </div>
  );
}

/** CP-1's line for a draft: what it needs (Ready to create, Needs a parent, AI still writing…); looks again while AI writes. */
function DraftState({ d, clientName, reload }: { d: DraftStory; clientName: string; reload?: (() => void) | undefined }): ReactNode {
  const env = useDevOpsWrite();
  const state = draftRowState(d, { canWrite: !!env?.can(d.clientKey), now: new Date().toISOString() });
  useEffect(() => {
    if (state !== "writing" || !reload) return;
    const t = setTimeout(reload, WRITING_POLL_MS * 2);
    return () => clearTimeout(t);
  }, [state, reload, d]);
  return (
    <p className={`dw-draft-state ${state}`} data-state={state} title={d.ai?.note ?? undefined}>
      {draftRowText(state, d, clientName)}
    </p>
  );
}

/** A send to me: SW-1's own answer row (Accept, Accept and schedule, Pass to…, Can't this week), read from its week. */
function SendBody(p: DetailProps): ReactNode {
  const r = p.entry.row;
  const [s, setS] = useState<SendView | null | "missing">(null);
  const id = Number(r.key.slice(1));
  useEffect(() => {
    let live = true;
    if (!r.weekStart) return void setS("missing");
    void call<CommitData>("team.commit", { weekStart: r.weekStart }).then(
      (d) => live && setS(d.clients.flatMap((c) => c.incoming).find((x) => x.id === id) ?? "missing"),
      () => live && setS("missing"),
    );
    return () => void (live = false);
  }, [id, r.weekStart]);
  if (s === null) return <p className="muted">Loading…</p>;
  if (s === "missing") return <p className="muted ib-missing">This send isn't waiting any more.</p>;
  const act = async (a: string, i: Record<string, unknown>) => {
    const err = await p.submit(a, i, a === "send.accept" ? "On your week" : a === "send.pass" ? "Passed on" : a === "send.cant" ? "They know you can't this week" : "Done");
    return err ? null : {};
  };
  return (
    <div className="ib-body">
      {s.note && <blockquote className="ib-said">“{s.note}”</blockquote>}
      <ul className="ib-send">
        <IncomingRow s={s} clientName={p.clientName(s.clientKey)} past={false} act={act} />
      </ul>
    </div>
  );
}
