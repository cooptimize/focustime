// CV-1: Inbox › My promises. What I said I'd do in my clients' registered chats, one per group of my consecutive
// messages: what, to whom (the person I answered or mentioned, never me), the due (overdue in amber, never red), the
// client and chat. CV-5: Create DevOps item is the primary action while it has no item (Add to Today or Make it a
// follow-up next to it), then Add to Today or Make it a follow-up; Link to item, Done and Not needed under ⋯; Why behind
// the info icon. A linked promise stays actionable and shows its item's live state; when the item closes it shows "Item
// closed" with Mark done (never done automatically). One that implies an item waits amber after one of my working days.
// Nothing is posted in Teams.
import { TypeIcon } from "./TypeIcon.tsx";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ModeArea } from "./ModeSwitch.tsx";
import type { WeekLoadData } from "../actions/types.ts";
import type { MyPromisesData, PromiseCard } from "../plan/conversation-views.ts";
import { userZone } from "../week/zone.ts";
import { call } from "./api.ts";
import { AlsoComment, DraftItem, LinkedItem } from "./Conversations.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { Fading } from "./FollowUps.tsx";
import { clientColor, whenText } from "./labels.ts";
import { PersonPicker, type PersonValue } from "./PersonPicker.tsx";
import type { PersonRef } from "../plan/person-ref.ts";
import { wasDueText } from "../plan/due.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** "Today 7:30 PM", "Thu, Nov 5" or "Thu, Nov 5 9:00 AM", in my zone. */
export function dueText(p: Pick<PromiseCard, "dueAt" | "dueDate">, today: string, tz: string): string | null {
  if (p.dueAt) {
    const z = Temporal.Instant.from(p.dueAt).toZonedDateTimeISO(tz);
    const time = z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
    const day = z.toPlainDate().toString();
    return `${day === today ? "Today" : z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${time}`;
  }
  if (p.dueDate) return p.dueDate === today ? "Today" : Temporal.PlainDate.from(p.dueDate).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return null;
}

export function MyPromises({ data, version, onCount, onChanged, select = null, switcher = null }: { switcher?: ReactNode; data: WeekLoadData; version: number; onCount: (n: number) => void; onChanged: () => void; openSettings: (section: string) => void; select?: number | null }) {
  const [state, setState] = useState<MyPromisesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [form, setForm] = useState<{ id: number; kind: "followup" | "link" | "draft" } | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const writes = useDevOpsWrite();
  const tz = userZone(data);
  const clearNotice = useCallback(() => setNotice(null), []);
  const show = useCallback((d: MyPromisesData) => (setState(d), onCount(d.open)), [onCount]);
  const load = useCallback(async () => {
    try {
      show(await call<MyPromisesData>("my_promises.list", {}));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [show]);
  useEffect(() => void load(), [load, version, writes?.version]);
  useEffect(() => head.current?.focus(), []);
  // CV-2: a deep link (#/inbox/promise/<id>, the urgent strip): that promise outlined and scrolled to, or a plain note.
  const scrolledTo = useRef<number | null>(null);
  const missing = select !== null && !!state && !state.promises.some((p) => p.id === select);
  useEffect(() => {
    if (select === null || !state || scrolledTo.current === select) return;
    const el = document.querySelector<HTMLElement>(`.my-promises [data-promise="${select}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
    scrolledTo.current = select;
  }, [select, state]);
  const run = async (action: string, input: Record<string, unknown>, done: ReactNode) => {
    try {
      show(await call<MyPromisesData>(action, input));
      setError(null);
      setForm(null);
      setNotice(done);
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };
  const undo = (p: PromiseCard) => (
    <button type="button" className="mini quiet" onClick={() => void run("my_promises.reopen", { id: p.id }, "Open again")}>
      Undo
    </button>
  );
  const today = state?.today ?? "";
  return (
    <main className="inbox my-promises" aria-label="Promises">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Promises {state && state.open > 0 && <span className="muted">{state.open} open</span>}
        </h2>
        {switcher && <ModeArea>{switcher}</ModeArea>}
      </div>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <Fading text={notice} onGone={clearNotice} ms={8000} />
      {missing && <p className="conv-link-note" role="status">That promise isn't here any more: it was done or closed more than a day ago, or its chat is no longer registered.</p>}
      {state && state.promises.length === 0 && (
        <div className="asks-empty">
          <p>No promises</p>
          <p className="muted">When you say you'll do something in a client's registered chat ("I'll send it tonight"), it shows here.</p>
        </div>
      )}
      <ul className="conv-list">
        {state?.promises.map((p) => (
          <Promise
            key={p.id}
            p={p}
            selected={p.id === select}
            tz={tz}
            today={today}
            color={clientColor(p.clientKey, data.clients)}
            form={form?.id === p.id ? form.kind : null}
            onForm={(kind) => setForm(kind ? { id: p.id, kind } : null)}
            canCreate={!!writes && !!state?.writeClients.includes(p.clientKey)}
            onRun={run}
            undo={undo(p)}
            onCreate={(change) => (setForm(null), void writes?.begin(p.clientKey, [change]))}
            onLink={async (itemId, comment) => {
              await run("my_promises.link", { id: p.id, itemId }, (
                <>
                  Linked to #{itemId}. The promise stays open.{" "}
                  <button type="button" className="mini quiet" onClick={() => void run("my_promises.unlink", { id: p.id }, "Unlinked")}>
                    Undo
                  </button>
                </>
              ));
              if (comment && writes) void writes.begin(p.clientKey, [{ kind: "conversation_comment", commitmentId: p.id, itemId }]);
            }}
            onSuggestion={(s, inc) => void writes?.begin(p.clientKey, [s.kind === "comment" ? { kind: "conversation_comment", suggestionId: s.id, ...(inc ? { includeInternal: true } : {}) } : { kind: "description_update", suggestionId: s.id }])}
          />
        ))}
      </ul>
    </main>
  );
}

function Promise(x: {
  p: PromiseCard; selected?: boolean; tz: string; today: string; color: string; form: "followup" | "link" | "draft" | null; onForm: (k: "followup" | "link" | "draft" | null) => void;
  canCreate: boolean; onRun: (action: string, input: Record<string, unknown>, done: ReactNode) => Promise<void>; undo: ReactNode;
  onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void; onSuggestion: (s: PromiseCard["suggestions"][number], includeInternal: boolean) => void;
  onLink: (itemId: number, comment: boolean) => Promise<void>;
}) {
  const { p } = x;
  const [menu, setMenu] = useState(false);
  const [why, setWhy] = useState(false);
  const open = p.state === "open";
  // CV-2: a promise found by the rules has no conversation yet: one is made from its messages first, then the draft.
  const [draftConv, setDraftConv] = useState<number | null>(p.conversationId);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => setDraftConv(p.conversationId), [p.conversationId]);
  const startDraft = async () => {
    if (draftConv !== null) return x.onForm("draft");
    setStarting(true);
    setStartError(null);
    try {
      const r = await call<{ conversationId: number }>("my_promises.start_draft", { id: p.id });
      setDraftConv(r.conversationId);
      x.onForm("draft");
    } catch (e) {
      setStartError(errText(e));
    } finally {
      setStarting(false);
    }
  };
  const due = dueText(p, x.today, x.tz);
  const onToday = !!p.onToday && p.onToday === x.today;
  const planned = !p.dueDate && !onToday ? { label: "Add to Today", run: () => void x.onRun("my_promises.today", { id: p.id, on: true }, "On Today") } : { label: "Make it a follow-up", run: () => x.onForm(x.form === "followup" ? null : "followup") };
  // CV-5: Create DevOps item first while there's no item; Mark done once its item closed; else the plan action.
  const create = { label: starting ? "Getting the form ready…" : "Create DevOps item", run: () => void startDraft() };
  const markDone = { label: "Mark done", run: () => void x.onRun("my_promises.done", { id: p.id }, <>Done. {x.undo}</>) };
  const primary = p.item?.closed ? markDone : !p.item ? create : planned;
  const second = primary === planned ? null : planned;
  return (
    <li className={`conv-card promise${open ? "" : " resolved"}${x.selected ? " selected" : ""}`} style={{ "--c": x.color } as CSSProperties} aria-label={`Promise: ${p.what}`} data-promise={p.id} tabIndex={x.selected ? 0 : -1}>
      <div className="conv-head">
        <span className="swatch" aria-hidden="true" />
        <strong className="conv-title">{p.what}</strong>
        {p.overdue ? <span className="conv-due overdue">{wasDueText({ dueAt: p.dueAt, dueDate: p.dueDate ?? p.onToday }, x.today, x.tz)}</span> : due && <span className="conv-due">Due {due}</span>}
        {p.waitingDays && <span className="conv-status waiting">Waiting on you · {p.waitingDays} {p.waitingDays === 1 ? "day" : "days"}</span>}
        <button type="button" className="mini quiet conv-why" aria-label="Why this is a promise" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          ⓘ
        </button>
      </div>
      <p className="conv-sub muted">
        {p.toName ? <>To {p.toName} · </> : null}
        {p.clientName} · {p.chatName}
        {p.conversationTitle ? <> · {p.conversationTitle}</> : null}
      </p>
      {why && (
        <div className="conv-why-box muted">
          {p.reason && <p>Why: {p.reason}</p>}
          {p.messages.map((m, i) => (
            <p key={i}>
              You, {whenText(m.at, x.tz)}: {m.text}
            </p>
          ))}
          <a href={p.link} target="_blank" rel="noopener noreferrer">
            Open in Teams
          </a>
        </div>
      )}
      {p.needsItem && open && p.likely && (
        <p className="ask-likely">
          Looks like{" "}
          <a href={p.likely.url ?? undefined} target="_blank" rel="noopener noreferrer">
            #{p.likely.id} {p.likely.title ?? ""}
          </a>{" "}
          <button type="button" className="mini" onClick={() => void x.onLink(p.likely!.id, false)}>
            Link it
          </button>
        </p>
      )}
      {open && p.item && <LinkedItem item={p.item} tz={x.tz} lead="Linked to" />}
      {p.suggestions.map((s) => (
        <div key={s.id} className="conv-suggest">
          <p className="conv-suggest-head">{s.kind === "comment" ? `Suggested update for #${s.itemId}` : `Description change for #${s.itemId}`}</p>
          <p>{s.body || "Discussed in an internal chat."}</p>
          <div className="ask-actions">
            <button type="button" className="mini primary" onClick={() => x.onSuggestion(s, false)}>
              {s.kind === "comment" ? "Post comment" : "Review the change"}
            </button>
            <button type="button" className="mini quiet" onClick={() => void x.onRun("suggestions.skip", { id: s.id }, "Skipped")}>
              Skip
            </button>
          </div>
        </div>
      ))}
      {open && (
        <div className="ask-actions">
          <button type="button" className="mini primary" disabled={primary === create && starting} onClick={primary.run}>
            {primary.label}
          </button>
          {second && (
            <button type="button" className="mini" onClick={second.run}>
              {second.label}
            </button>
          )}
          <span className="fu-more">
            <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for: ${p.what}`} onClick={() => setMenu((v) => !v)}>
              ⋯
            </button>
            {menu && (
              <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
                {planned.label === "Add to Today" && (
                  <button type="button" role="menuitem" autoFocus onClick={() => (setMenu(false), x.onForm("followup"))}>
                    Make it a follow-up
                  </button>
                )}
                {onToday && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), void x.onRun("my_promises.today", { id: p.id, on: false }, "Off Today"))}>
                    Take off Today
                  </button>
                )}
                {!p.item && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), x.onForm("link"))}>
                    Link to item…
                  </button>
                )}
                {p.item && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), void x.onRun("my_promises.unlink", { id: p.id }, "Unlinked"))}>
                    Unlink #{p.item.id}
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => (setMenu(false), void x.onRun("my_promises.done", { id: p.id }, <>Done. {x.undo}</>))}>
                  Done
                </button>
                <button type="button" role="menuitem" onClick={() => (setMenu(false), void x.onRun("my_promises.not_needed", { id: p.id }, <>Not needed. {x.undo}</>))}>
                  Not needed
                </button>
              </span>
            )}
          </span>
        </div>
      )}
      {!open && (
        <p className="ask-done">
          {p.state === "followup" ? "A follow-up now. It closes when the follow-up is done" : p.state === "linked" || p.state === "created" ? <>Kept by <a href={p.item?.url ?? undefined} target="_blank" rel="noopener noreferrer">#{p.item?.id} {p.item?.title ?? ""}</a></> : p.state === "done" ? "Done" : "Not needed"}{" "}
          {(p.state === "done" || p.state === "not_needed" || p.state === "linked") && x.undo}
        </p>
      )}
      {startError && <p className="set-problem">{startError}</p>}
      {x.form === "followup" && <FollowUpForm p={p} onSave={(v) => void x.onRun("my_promises.followup", { id: p.id, ...v }, "Follow-up added. The promise closes when it's done")} onCancel={() => x.onForm(null)} />}
      {x.form === "link" && <PromiseLink p={p} canComment={x.canCreate} onPick={(id, comment) => void x.onLink(id, comment)} onCancel={() => x.onForm(null)} />}
      {x.form === "draft" && draftConv !== null && <DraftItem c={{ id: draftConv, clientName: p.clientName, clientKey: p.clientKey }} commitmentId={p.id} onCreate={x.onCreate} onCancel={() => x.onForm(null)} />}
    </li>
  );
}

function FollowUpForm({ p, onSave, onCancel }: { p: PromiseCard; onSave: (v: { who: string; whoRef: PersonRef | null; what: string; due: string }) => void; onCancel: () => void }) {
  // CV-2: Who starts as the one the promise was made to, as a person when they're known.
  const [who, setWho] = useState<PersonValue>({ who: p.toName ?? "", whoRef: p.toName ? p.toRef : null });
  const [what, setWhat] = useState(p.what);
  const [due, setDue] = useState(p.dueDate ?? p.onToday ?? "");
  return (
    <form className="ask-form" onSubmit={(e) => (e.preventDefault(), onSave({ who: who.who.trim(), whoRef: who.who.trim() ? who.whoRef : null, what: what.trim(), due }))} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Who <PersonPicker value={who} onChange={setWho} clientKey={p.clientKey} conversationId={p.conversationId} commitmentId={p.id} />
      </label>
      <label>
        What
        <input autoFocus value={what} maxLength={200} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label>
        Due
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <button type="submit" className="mini primary">Add follow-up</button>
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}

type Hit = { id: number; title: string; type: string; state: string; url: string; reason: string };
/** CV-3: Link existing… with or without a conversation: likely items first (with why), then whatever is typed. */
function PromiseLink({ p, canComment, onPick: pickIt, onCancel }: { p: PromiseCard; canComment: boolean; onPick: (id: number, comment: boolean) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [comment, setComment] = useState(false);
  const onPick = (id: number) => pickIt(id, comment && canComment);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void call<{ available: boolean; items: Hit[] }>("my_promises.search", { id: p.id, query: q }).then(
          (r) => live && (setHits(r.items), setAvailable(r.available)),
          () => live && setHits([]),
        ),
      q ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, p.id]);
  return (
    <div className="ask-form ask-link" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Link to one of {p.clientName}'s open items
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), onPick(hits[0].id))} />
      </label>
      {hits && (
        <ul className="ask-hits" aria-label={q ? "Open items" : "Likely items"}>
          {!available && <li className="muted">DevOps couldn't be read for {p.clientName} just now</li>}
          {available && hits.length === 0 && <li className="muted">{q ? "No open items match" : "No likely items. Search by title or #id"}</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="mini quiet" onClick={() => onPick(h.id)}>
                <TypeIcon clientKey={p.clientKey} type={h.type} /> #{h.id} {h.title} <span className="muted">· {h.state}</span>
              </button>
              <span className="ask-hit-why muted">{h.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <AlsoComment on={comment} set={setComment} disabled={!canComment} />
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}
