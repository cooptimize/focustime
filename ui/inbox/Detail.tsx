// IB-1 slice 2: the detail pane (desktop) and the item sheet (phone) for one Inbox item: what it is, where it came
// from and when, the summary or what I said, every action (ItemActions, the same set the keys run), the form an action
// opened, then the item's own body: a conversation's messages like Teams with its linked item and commitments; a
// promise's words, its item and where it came from; a send's answer row; a capture to sort; a draft to create.
// Nothing here posts in Teams or sends mail; Close the loop records how I told them (ui/CloseLoop.tsx).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { SendView, CommitData } from "../../plan/team-types.ts";
import type { PersonRef } from "../../plan/person-ref.ts";
import type { ConversationCard } from "../../plan/conversation-views.ts";
import { call } from "../api.ts";
import { SortCapture, captureClients } from "../Capture.tsx";
import { CloseLoop } from "../CloseLoop.tsx";
import { ConvLink, DraftItem, LinkedItem, Messages, NotRequest, SuggestionBox } from "../Conversations.tsx";
import { MergePane } from "./MergePane.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { WRITING_POLL_MS } from "../createdraft-ctx.ts";
import { draftRowState, draftRowText } from "../../plan/capture-prepare.ts";
import { CLOSE_HOW, type CloseHow, type DraftStory } from "../../plan/types.ts";
import { FollowUpForm } from "../FollowUps.tsx";
import { clientColor, whenText } from "../labels.ts";
import { PromiseLink } from "../MyPromises.tsx";
import { PersonPicker, type PersonValue } from "../PersonPicker.tsx";
import { IncomingRow } from "../Team.tsx";
import type { ChatterRow, Entry } from "./data.ts";
import { ItemActions, type Act, type FormId } from "./ItemActions.tsx";
import { KIND_WORD, lateText, dueWords } from "./model.ts";
import type { SnoozeChoice } from "../../plan/inbox-items.ts";

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
  run: (action: string, input: Record<string, unknown>, notice: string) => Promise<void>;
  /** A form's own call: returns the error to show, or null when it worked (then the form closes and the Inbox reloads). */
  submit: (action: string, input: Record<string, unknown>, notice: string) => Promise<string | null>;
  /** A conversation's merge candidates (open ones of the same chat) and the merge itself. */
  mergeOthers?: ConversationCard[];
  merge?: (id: number, into: ConversationCard) => Promise<void>;
  /** Reads the Inbox again quietly (a draft's AI version still being written). */
  reload?: () => void;
  /** Slice 3: the Snooze choices to offer now (the list's; Later today only with an hour or more left). */
  snoozeChoices?: readonly SnoozeChoice[] | undefined;
  phone?: boolean;
};

/** The status pill at the top right: late, due, needs you, in progress. */
function Pill({ entry, today }: { entry: Entry; today: string }) {
  const r = entry.row;
  if (r.done) return <span className="ib-pill done">Done</span>;
  if (r.late && r.due) return <span className="ib-pill late">{`${dueWords(r.due, today).replace(/^Due today$/, "Due today")} · ${lateText(r.due, today)}`}</span>;
  if (r.due && r.kind === "promise") return <span className={`ib-pill${r.due <= today ? " soon" : ""}`}>{dueWords(r.due, today)}</span>;
  if (r.views.includes("needs_you")) return <span className="ib-pill ask">Needs you</span>;
  if (r.views.includes("in_progress")) return <span className="ib-pill">In progress</span>;
  return null;
}

export function Detail(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const r = e.row;
  const color = clientColor(r.clientKey ?? undefined, p.data.clients);
  const meta = [r.clientKey ? p.clientName(r.clientKey) : null, r.kind === "promise" ? (r.who ? `For ${r.who}` : null) : r.who, r.where].filter(Boolean);
  return (
    <article className={`ib-detail${p.phone ? " phone" : ""}`} aria-label={r.title} style={{ "--c": color } as CSSProperties}>
      <header className="ib-detail-head">
        <p className="ib-detail-meta">
          <span className={`ib-kind kind-${r.kind}`}>{KIND_WORD[r.kind]}</span>
          {meta.map((m, i) => (
            <span key={i} className={i === 0 && r.clientKey ? "ib-client" : undefined}>
              {i === 0 && r.clientKey && <span className="dot" aria-hidden="true" />}
              {m}
            </span>
          ))}
          <time dateTime={r.at}>{whenText(r.at, p.tz)}</time>
        </p>
        <Pill entry={e} today={p.today} />
      </header>
      <h2 className="ib-detail-title" tabIndex={-1}>
        {r.title || "(no title)"}
      </h2>
      {r.reason && <p className="ib-reason">{r.reason}</p>}
      {r.snoozedUntil && <p className="ib-snoozed muted">Snoozed until {wakeWords(r.snoozedUntil, p.tz, p.today)}. It's out of your counts until then.</p>}
      <Lead {...p} />
      {!p.phone && <ItemActions acts={p.acts} label={r.title} />}
      <FormArea {...p} />
      <Body {...p} />
    </article>
  );
}

/** Under the title: a conversation's summary, my own words for a chat promise, a capture's text. */
function Lead({ entry: e, tz }: DetailProps): ReactNode {
  if (e.kind === "conversation" && e.card) {
    const c = e.card;
    return (
      <>
        {c.summary.trim() ? <p className="ib-summary">{c.summary}</p> : <p className="ib-summary muted">Grouped without AI, so there's no summary. The messages are below.</p>}
        {c.images ? <p className="conv-images muted">{c.images === 1 ? "1\u00a0image" : `${c.images}\u00a0images`}{c.imageNote ? `: ${c.imageNote}` : ""}</p> : null}
      </>
    );
  }
  if (e.kind === "chatPromise" && e.promise?.messages.length)
    return (
      <blockquote className="ib-said">
        <span className="muted">You said, {whenText(e.promise.messages[0]!.at, tz)}</span> “{e.promise.messages.map((m) => m.text).join(" ")}”
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
    // A promise I added starts on its own channel (as its row did before IB-1).
    const ch = e.kind === "followUp" ? e.followUp?.channel ?? null : null;
    const initialHow = (CLOSE_HOW as readonly string[]).includes(ch ?? "") ? (ch as CloseHow) : null;
    return <CloseLoop who={who} compact={false} initialHow={initialHow} onSubmit={submit} onCancel={cancel} />;
  }
  if (form === "due") return <DueForm {...p} />;
  if (form === "snooze") return <SnoozeForm {...p} />;
  if (form === "who") return <WhoForm {...p} />;
  if (form === "link") {
    if (e.kind === "conversation" && e.card) {
      const c = e.card;
      return (
        <div className="ib-form">
          <ConvLink c={c} onCancel={cancel} onPick={(itemId, comment) => void p.submit("conversations.link", { id: c.id, itemId }, `Linked to #${itemId} for everyone on the chat`).then((err) => void (!err && comment && writes && writes.begin(c.clientKey, [{ kind: "conversation_comment", conversationId: c.id, itemId }])))} />
        </div>
      );
    }
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
  if (form === "not_request" && e.kind === "conversation" && e.card) {
    const c = e.card;
    return (
      <div className="ib-form">
        <NotRequest onCancel={cancel} onSave={(reason) => void p.submit("conversations.not_request", { id: c.id, ...(reason ? { reason } : {}) }, "Closed for everyone on the chat")} />
      </div>
    );
  }
  if (form === "merge" && e.kind === "conversation" && e.card && p.merge) {
    const c = e.card;
    return <MergePane c={c} others={p.mergeOthers ?? []} tz={p.tz} onMerge={p.merge} onCancel={cancel} />;
  }
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

/** Due: today, tomorrow, next Monday, a date, or none. Snoozing is separate and never changes this. */
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

const SNOOZE_WORD: Record<SnoozeChoice, string> = { later: "Later today", tomorrow: "Tomorrow", next_week: "Next week" };

/** Snooze: out of every view and count until then. The due day never changes. */
function SnoozeForm(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const [day, setDay] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const min = Temporal.PlainDate.from(p.today).add({ days: 1 }).toString();
  const save = async (until: string) => setErr(await p.submit("inbox.snooze", { key: e.row.key, until }, "Snoozed. It's back when the time comes"));
  return (
    <form className="ib-form ib-snooze" aria-label="Snooze" onSubmit={(ev) => (ev.preventDefault(), day && void save(day))} onKeyDown={(ev) => ev.key === "Escape" && (ev.stopPropagation(), p.setForm(null))}>
      <span className="ib-form-label">Snooze until</span>
      {(p.snoozeChoices ?? ["tomorrow", "next_week"]).map((c, i) => (
        <button key={c} type="button" className="mini" autoFocus={i === 0} onClick={() => void save(c)}>
          {SNOOZE_WORD[c]}
        </button>
      ))}
      <input type="date" value={day} min={min} onChange={(ev) => setDay(ev.target.value)} aria-label="Snooze until a day" />
      <button type="submit" className="mini primary" disabled={!day}>Snooze</button>
      <button type="button" className="mini quiet" onClick={() => p.setForm(null)}>Cancel</button>
      <span className="muted ib-form-note">{e.row.due ? "The due day stays as it is." : "It comes back at the start of your day."}</span>
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

/** Create DevOps item: the conversation's draft (CV-1), or a chat promise's (one made from its messages first, CV-2). */
function DraftForm(p: DetailProps): ReactNode {
  const { entry: e } = p;
  const writes = useDevOpsWrite();
  const [conv, setConv] = useState<number | null>(e.kind === "conversation" ? (e.card?.id ?? null) : e.kind === "chatPromise" ? (e.promise?.conversationId ?? null) : null);
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
  const client = e.kind === "conversation" ? e.card : e.kind === "chatPromise" ? e.promise : null;
  if (!client) return null;
  const commitmentId = e.kind === "chatPromise" ? promiseId : (e.kind === "conversation" && e.card?.commitments.find((x) => x.mine && x.state === "open" && x.impliesItem && !x.item)?.id) || null;
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
  if (e.kind === "conversation") {
    const c = e.card;
    if (!c) return <p className="muted ib-missing">This conversation couldn't be read just now. Try again in a moment.</p>;
    return (
      <div className="ib-body two">
        <section className="ib-messages" aria-label="Messages">
          <h3 className="ib-section">Messages</h3>
          <Messages c={c} tz={tz} />
        </section>
        <aside className="ib-side">
          <section className="ib-card" aria-label="Linked DevOps item">
            <h3 className="ib-section">Linked DevOps item</h3>
            {c.item ? <LinkedItem item={c.item} tz={tz} lead="Tracked as" /> : <p>None yet.</p>}
            {!c.item && c.likely && (
              <p className="muted">
                Looks like{" "}
                <a href={c.likely.url ?? undefined} target="_blank" rel="noopener noreferrer">
                  #{c.likely.id} {c.likely.title ?? ""}
                </a>
              </p>
            )}
          </section>
          {c.commitments.length > 0 && (
            <section className="ib-card" aria-label="Commitments">
              <h3 className="ib-section">Commitments</h3>
              <ul className="ib-commits">
                {c.commitments.map((k) => (
                  <li key={k.id}>
                    <span className={`ib-tag${k.mine ? " ask" : ""}`}>{k.mine ? "You" : k.whoName}</span> {k.what}
                    {k.dueDate ? <span className="muted"> · {dueWords(k.dueDate, p.today)}</span> : null}
                    {k.state !== "open" && <span className="muted"> · {k.state === "done" ? "done" : k.state.replace("_", " ")}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {c.suggestions.filter((s) => s.mine).map((s) => (
            <SuggestionBox key={s.id} s={s} onPost={(inc) => void writes?.begin(c.clientKey, [s.kind === "comment" ? { kind: "conversation_comment", suggestionId: s.id, ...(inc ? { includeInternal: true } : {}) } : { kind: "description_update", suggestionId: s.id }])} onSkip={() => void p.run("suggestions.skip", { id: s.id }, "Skipped")} />
          ))}
          <section className="ib-card" aria-label="History">
            <h3 className="ib-section">Status</h3>
            <p>{c.statusLine}</p>
            {c.updated && c.updated !== "Updated" && <p className="muted">Updated: {c.updated}</p>}
            {c.closed && (
              <p className="muted">
                {c.closed.kind === "resolved" ? "Resolved" : "Not a request"} by {c.closed.by} · {whenText(c.closed.at, tz)}
                {c.closed.reason ? `: ${c.closed.reason}` : ""}
              </p>
            )}
          </section>
        </aside>
      </div>
    );
  }
  if (e.kind === "chatPromise") {
    const pr = e.promise;
    if (!pr) return <p className="muted ib-missing">This promise couldn't be read just now. Try again in a moment.</p>;
    return (
      <div className="ib-body">
        <section className="ib-card" aria-label="Linked DevOps item">
          <h3 className="ib-section">Linked DevOps item</h3>
          {pr.item ? <LinkedItem item={pr.item} tz={tz} lead="Linked to" /> : <p>None yet.</p>}
          {!pr.item && pr.likely && (
            <p className="muted">
              Looks like{" "}
              <a href={pr.likely.url ?? undefined} target="_blank" rel="noopener noreferrer">
                #{pr.likely.id} {pr.likely.title ?? ""}
              </a>
            </p>
          )}
        </section>
        <section className="ib-card" aria-label="Where it came from">
          <h3 className="ib-section">Where it came from</h3>
          <p>
            {pr.chatName}
            {pr.conversationTitle ? ` · ${pr.conversationTitle}` : ""} · {whenText(pr.createdAt, tz)}
          </p>
          {pr.reason && <p className="muted">Why it's a promise: {pr.reason}</p>}
          <a href={pr.link} target="_blank" rel="noopener noreferrer">
            Open in Teams
          </a>
        </section>
        {pr.suggestions.map((s) => (
          <SuggestionBox key={s.id} s={s} onPost={(inc) => void writes?.begin(pr.clientKey, [s.kind === "comment" ? { kind: "conversation_comment", suggestionId: s.id, ...(inc ? { includeInternal: true } : {}) } : { kind: "description_update", suggestionId: s.id }])} onSkip={() => void p.run("suggestions.skip", { id: s.id }, "Skipped")} />
        ))}
        {(pr.state === "done" || pr.state === "not_needed") && <p className="muted">{pr.state === "done" ? "Done" : "Not needed"} · {whenText(pr.createdAt, tz)}</p>}
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
              <a href={f.itemUrl ?? undefined} target="_blank" rel="noopener noreferrer">
                #{f.itemId}
              </a>
            </p>
          ) : (
            <p>None yet.</p>
          )}
        </section>
        <section className="ib-card" aria-label="Where it came from">
          <h3 className="ib-section">Where it came from</h3>
          <p>{f.byHand ? `You added it, ${whenText(f.openedAt, tz)}` : `Opened ${whenText(f.openedAt, tz)}`}</p>
          {f.origin && (
            <p className="muted">
              Why: {f.origin.trigger}
              {f.origin.items.length ? ` (${f.origin.items.map((i) => (i.itemId ? `#${i.itemId} ${i.title}` : i.title)).join(", ")})` : ""}
            </p>
          )}
          {f.draft && <pre className="ib-draft">{f.draft}</pre>}
        </section>
        {f.closedAt && <p className="muted">{f.outcome === "not_needed" ? "Not needed" : "Loop closed"} · {whenText(f.closedAt, tz)}{f.closeNote ? `: ${f.closeNote}` : ""}</p>}
      </div>
    );
  }
  if (e.kind === "send") return <SendBody {...p} />;
  if (e.kind === "waiting") return <WaitingBody {...p} />;
  if (e.kind === "capture") {
    if (!e.capture) return <p className="muted ib-missing">This capture couldn't be read just now.</p>;
    return (
      <div className="ib-body">
        <p className="ib-summary">{e.capture.text}</p>
        <p className="muted">Captured {whenText(e.capture.createdAt, tz)}. Sort it into a promise, a draft story or a draft feature.</p>
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

/**
 * Chatter: one chat's chatter. Never Create DevOps item, as the primary or at all: This is work moves a message into its
 * own conversation first. An admin can mark the chat a Social chat (skips AI for everyone); others see who can and where.
 */
export function ChatterDetail({ row, tz, color, onWork, chat, admin, onSocial }: {
  row: ChatterRow; tz: string; color: string; onWork: (m: ChatterRow["messages"][number]) => void;
  chat?: { name: string; link: string; social: boolean } | undefined; admin: boolean; onSocial: (on: boolean) => void;
}): ReactNode {
  const name = chat?.name ?? "this chat";
  return (
    <article className="ib-detail" aria-label={row.title} style={{ "--c": color } as CSSProperties}>
      <header className="ib-detail-head">
        <p className="ib-detail-meta">
          <span className="ib-kind">Chatter</span>
          <span className="ib-client">
            <span className="dot" aria-hidden="true" />
            {row.clientName}
          </span>
          <span>
            {whenText(row.messages[0]!.at, tz)} to {whenText(row.lastAt, tz)}
          </span>
        </p>
      </header>
      <h2 className="ib-detail-title" tabIndex={-1}>{row.title}</h2>
      <p className="ib-summary">
        {row.messages.length} {row.messages.length === 1 ? "message" : "messages"} filtered as chatter. No question for you, no ask, no promise. They never count toward Needs you.
      </p>
      <div className="ib-acts" role="group" aria-label={`Actions for ${row.title}`}>
        {chat?.link && (
          <a className="ib-act" href={chat.link} target="_blank" rel="noopener noreferrer">
            Open in Teams
          </a>
        )}
        {admin && (
          <button type="button" className="ib-act" onClick={() => onSocial(!chat?.social)}>
            {chat?.social ? `${name} isn't a Social chat` : `Mark ${name} as a Social chat`}
          </button>
        )}
      </div>
      <p className="muted ib-form-note">
        {chat?.social
          ? `${name} is a Social chat: its messages skip AI and are filed here.${admin ? "" : " A FocusTime admin can change that in Admin › Clients."}`
          : admin
            ? "A Social chat's messages skip AI entirely and are filed as chatter, for everyone on the chat."
            : `If ${name} is only social, a FocusTime admin can mark it a Social chat in Admin › Clients. Its messages then skip AI.`}
      </p>
      <section className="ib-card" aria-label="Messages">
        <h3 className="ib-section">Latest messages</h3>
        <ul className="ib-chatter">
          {row.messages.slice(-8).map((m) => (
            <li key={m.messageId}>
              <strong>{m.author}</strong> <span className="muted">{whenText(m.at, tz)}</span>
              <p>{m.text}</p>
              <button type="button" className="mini" onClick={() => onWork(m)}>
                This is work
              </button>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** Slice 3: what I wait on, in plain words. Nothing to answer here; it leaves when they do their part. */
function WaitingBody({ entry: e, today }: DetailProps): ReactNode {
  const r = e.row;
  const who = r.who ?? "Someone";
  const text =
    r.kind === "commitment" ? `${who} said they'd do it${r.due ? `, due ${dueWords(r.due, today).replace(/^Due /, "").toLowerCase()}` : ""}${r.late && r.due ? ` (${lateText(r.due, today)})` : ""}.${r.where ? ` In ${r.where}.` : ""}`
    : r.kind === "sent" ? `You sent it to ${who} for ${r.where ?? "their week"}${r.must ? " as a Must" : ""}. They haven't answered yet.`
    : `You asked ${who} to look at your week. No reply yet.`;
  return (
    <div className="ib-body">
      <p className="ib-summary">{text}</p>
      <p className="muted">It leaves Waiting on once they answer or it's done. Snooze it if you don't want to see it for a while.</p>
    </div>
  );
}
