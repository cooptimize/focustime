// SW-1: sending work to someone's week and client priorities, in the page.
//   Send to…          one dialog from any feature or story's ⋯ (openSend), on any screen (SendHost in App)
//   From your team    Commit's group beside From last week: what was sent to me (Accept, Accept and schedule, Pass
//                     to…, Can't this week), client priorities (Add to my week), and what I sent with its state
//   Today's line      one line in the urgent strip when something waits for me ("Priya sent you Loyalty points (Must)")
// Plain words; nothing here reads as anyone checking on anyone.
import { TextBox } from "./TextBox.tsx";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { PeoplePickerData, PickerPerson } from "../actions/people-picker.ts";
import type { CommitData, PickerPersonView, PriorityView, SendView } from "../plan/team-types.ts";
import type { IsoDate } from "../week/types.ts";

type Half = "AM" | "PM";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { PersonPicker, type PersonValue } from "./PersonPicker.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { WorkLink } from "./WorkLink.tsx";

export { openSend, SEND_EVENT, type SendTarget } from "./send-event.ts";
import { SEND_EVENT, type SendTarget } from "./send-event.ts";
import { Icon } from "./icons.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const weekWords = (w: IsoDate, thisWeek: IsoDate) => (w === thisWeek ? "this week" : Temporal.PlainDate.from(w) > Temporal.PlainDate.from(thisWeek) ? "next week" : `week of ${Temporal.PlainDate.from(w).toLocaleString("en-US", { month: "short", day: "numeric" })}`);

/** The picker's one group from send.people: the Cooptimizers on the client. */
function pickerOf(people: readonly PickerPersonView[], label: string): PeoplePickerData {
  return { groups: people.length ? [{ key: "client", label, people: people.map((p) => ({ name: p.name, ref: { kind: "cooptimizer", id: p.id, name: p.name }, email: p.email, external: false })) }] : [], problems: [] };
}
const idOf = (p: PickerPerson) => (p.ref.kind === "cooptimizer" ? p.ref.id : "");

/** App's one Send to… dialog, opened by openSend from anywhere. */
export function SendHost({ thisWeek, onSent }: { thisWeek: IsoDate; onSent: () => void }) {
  const [target, setTarget] = useState<SendTarget | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<SendTarget>).detail);
    window.addEventListener(SEND_EVENT, on);
    return () => window.removeEventListener(SEND_EVENT, on);
  }, []);
  if (!target) return null;
  return <SendDialog target={target} thisWeek={thisWeek} onClose={() => setTarget(null)} onSent={onSent} />;
}

type People = { people: PickerPersonView[]; canSend: boolean; canMust: boolean; why: string | null };

export function SendDialog({ target, thisWeek, onClose, onSent }: { target: SendTarget; thisWeek: IsoDate; onClose: () => void; onSent: () => void }) {
  useReturnFocus();
  const next = Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString();
  const [people, setPeople] = useState<People | null>(null);
  const [who, setWho] = useState<PersonValue>({ who: "", whoRef: null });
  const [week, setWeek] = useState<IsoDate>(thisWeek);
  const [kind, setKind] = useState<"suggested" | "must">("suggested");
  const [note, setNote] = useState("");
  const [askTake, setAskTake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [priority, setPriority] = useState<{ note: string } | null>(null);
  const client = target.clientName ?? target.clientKey;
  useEffect(() => {
    let live = true;
    call<People>("send.people", { clientKey: target.clientKey }).then(
      (p) => live && setPeople(p),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => void (live = false);
  }, [target.clientKey]);
  const byId = new Map((people?.people ?? []).map((p) => [p.id, p] as const));
  const toId = who.whoRef?.kind === "cooptimizer" ? who.whoRef.id : null;
  const send = async () => {
    if (!toId) return setError("Choose who to send it to");
    setBusy(true);
    try {
      await call("send.create", { clientKey: target.clientKey, itemId: target.itemId, level: target.level, title: target.title, itemType: target.itemType, url: target.url, ...(target.parentId ? { parentId: target.parentId } : {}), weekStart: week, kind, ...(note.trim() ? { note: note.trim() } : {}), askTake, toId });
      setDone(`Sent to ${byId.get(toId)?.name ?? who.who} for ${weekWords(week, thisWeek)}. You'll see their answer in Plan.`);
      onSent();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const flag = async () => {
    setBusy(true);
    try {
      await call("priority.flag", { clientKey: target.clientKey, itemId: target.itemId, title: target.title, itemType: target.itemType, url: target.url, ...(priority?.note.trim() ? { note: priority.note.trim() } : {}) });
      setDone(`${target.title} is a ${client} priority. Everyone on ${client} sees it in To place, in a block's panel on Week.`);
      onSent();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog send-dialog"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Send to… ${target.title}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.stopPropagation(), e.preventDefault(), onClose());
        }}
      >
        <div className="cap-dialog-head">
          <h2>Send to…</h2>
          <span className="send-subject">
            {target.itemType && <TypeIcon clientKey={target.clientKey} type={target.itemType} decorative />}
            <span className="muted">{client}:</span> {target.title}
          </span>
          <CloseButton onClose={onClose} disabled={busy} />
        </div>
        {done ? (
          <>
            <p className="send-done">{done}</p>
            <div className="wd-actions send-acts">
              <button type="button" className="primary" autoFocus onClick={onClose}>Done</button>
            </div>
          </>
        ) : !people ? (
          <p className="muted">{error ?? "Reading who is on this client…"}</p>
        ) : !people.canSend ? (
          <>
            <p className="muted">{people.why}</p>
            <div className="wd-actions send-acts"><button type="button" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <div className="help-row">
              <span className="help-label">To</span>
              <PersonPicker label="Send to" placeholder={`Someone on ${client}`} clientKey={target.clientKey} value={who} onChange={(v) => (setWho(v), setError(null))} people={pickerOf(people.people, `On ${client}`)} disabledWhy={(p) => (byId.get(idOf(p))?.onFocusTime === false ? "Not on FocusTime yet" : null)} strict />
            </div>
            <div className="help-row">
              <span className="help-label">For</span>
              <div className="chips" role="radiogroup" aria-label="Which week">
                {([thisWeek, next] as const).map((w) => (
                  <button key={w} type="button" className="chip-btn" role="radio" aria-checked={week === w} onClick={() => setWeek(w)}>
                    {w === thisWeek ? "This week" : "Next week"}
                  </button>
                ))}
              </div>
            </div>
            <div className="help-row">
              <span className="help-label">As</span>
              <div className="chips" role="radiogroup" aria-label="Suggested or Must">
                <button type="button" className="chip-btn" role="radio" aria-checked={kind === "suggested"} onClick={() => setKind("suggested")}>Suggested</button>
                <button type="button" className="chip-btn" role="radio" aria-checked={kind === "must"} disabled={!people.canMust} title={people.canMust ? "A Must from a lead: it goes on their week once they accept" : `Only ${client}'s leads send a Must`} onClick={() => setKind("must")}>Must</button>
              </div>
              {!people.canMust && <span className="muted send-hint">Only {client}'s leads send a Must</span>}
            </div>
            <div className="help-row">
              <span className="help-label">Note</span>
              <TextBox className="send-note" minRows={2} maxRows={6} maxLength={300} placeholder="Optional: why it matters, or where to start" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <label className="send-check">
              <input type="checkbox" checked={askTake} onChange={(e) => setAskTake(e.target.checked)} /> Ask them to take it in DevOps
              <span className="muted"> · their Accept offers to assign it to them</span>
            </label>
            {error && <p className="error-line" role="alert">{error}</p>}
            <div className="wd-actions send-acts">
              {people.canMust && !priority && (
                <button type="button" className="link-btn send-priority" onClick={() => setPriority({ note: "" })} title="No person named; everyone on the client sees it in To place, in a block's panel on Week">
                  Make it a {client} priority instead
                </button>
              )}
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void send()} disabled={busy || !toId}>Send</button>
            </div>
            {priority && (
              <div className="send-priority-form">
                <span className="help-label">Client priority</span>
                <input type="text" maxLength={300} placeholder="Optional note for the team" value={priority.note} onChange={(e) => setPriority({ note: e.target.value })} aria-label="Client priority note" />
                <button type="button" className="mini primary" onClick={() => void flag()} disabled={busy}>Flag it</button>
                <button type="button" className="link-btn" onClick={() => setPriority(null)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Commit's team data for a week, read again whenever `version` changes. */
export function useTeamCommit(weekStart: IsoDate, version: unknown) {
  const [data, setData] = useState<CommitData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call<CommitData>("team.commit", { weekStart }));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [weekStart]);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { data, error, reload: load, setError };
}

const kindChip = (kind: SendView["kind"]) => <span className={`send-kind kind-${kind}`}>{kind === "must" ? "Must" : "Suggested"}</span>;
const fromWords = (s: SendView) => `from ${first(s.from.name)}${s.by && s.by.id !== s.from.id ? `, passed on by ${first(s.by.name)}` : ""}`;

/** One thing sent to me: Accept (with Also assign to me in DevOps), Accept and schedule, Pass to…, Can't this week. */
export function IncomingRow({ s, clientName, past, act, onSchedule }: { s: SendView; clientName: string; past: boolean; act: (a: string, i: Record<string, unknown>) => Promise<unknown>; onSchedule?: ((date: IsoDate, half: Half) => void) | undefined }) {
  const env = useDevOpsWrite();
  const [assign, setAssign] = useState(s.askTake);
  const [form, setForm] = useState<null | "pass" | "cant">(null);
  const [reason, setReason] = useState("");
  const [to, setTo] = useState<PersonValue>({ who: "", whoRef: null });
  const [people, setPeople] = useState<PickerPersonView[] | null>(null);
  useEffect(() => {
    if (form !== "pass" || people) return;
    void call<People>("send.people", { clientKey: s.clientKey }).then((p) => setPeople(p.people), () => setPeople([]));
  }, [form, people, s.clientKey]);
  const accept = async (schedule: boolean) => {
    const r = (await act("send.accept", { id: s.id, ...(schedule ? { schedule: true } : {}) })) as { open: { date: IsoDate; half: Half } | null } | null;
    if (r && assign && env) await env.begin(s.clientKey, [{ kind: "assign", itemId: s.itemId }]);
    if (r && schedule && r.open && onSchedule) onSchedule(r.open.date, r.open.half);
  };
  const toId = to.whoRef?.kind === "cooptimizer" ? to.whoRef.id : null;
  return (
    <li className={`carry-row send-row${s.conflict ? " conflict" : ""}`} data-send={s.id}>
      <span className="carry-main">
        {s.itemType && <TypeIcon clientKey={s.clientKey} type={s.itemType} decorative />}
        <WorkLink clientKey={s.clientKey} url={s.url} className="carry-title" title={s.title}>
          {s.title}
        </WorkLink>
        {kindChip(s.kind)}
      </span>
      <span className="carry-kind">
        {s.conflict ? (
          <span className="send-conflict">You can't this week: {s.reason} · {first(s.from.name)} knows</span>
        ) : (
          <>
            {fromWords(s)}
            {s.note && <span className="send-note-text"> · “{s.note}”</span>}
          </>
        )}
      </span>
      <span className="carry-acts">
        {!past && (
          <>
            <label className="send-assign" title="Through the DevOps write preview; undo puts it back">
              <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} /> Also assign to me in DevOps
            </label>
            <button type="button" className="mini primary" onClick={() => void accept(false)}>{s.conflict ? "Accept after all" : "Accept"}</button>
            {!s.conflict && (
              <>
                <button type="button" className="link-btn" onClick={() => void accept(true)} title={`Accept, then plan it into your first ${clientName} block`}>Accept and schedule</button>
                <button type="button" className="link-btn" onClick={() => setForm(form === "pass" ? null : "pass")}>Pass to…</button>
                <button type="button" className="link-btn" onClick={() => setForm(form === "cant" ? null : "cant")}>Can't this week</button>
              </>
            )}
          </>
        )}
      </span>
      {form === "cant" && (
        <span className="send-form">
          <input type="text" maxLength={300} autoFocus placeholder="Why, in a few words (they'll see it)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why you can't this week" />
          <button type="button" className="mini" disabled={!reason.trim()} onClick={() => void act("send.cant", { id: s.id, reason }).then(() => setForm(null))}>Tell {first(s.from.name)}</button>
          <button type="button" className="link-btn" onClick={() => setForm(null)}>Cancel</button>
        </span>
      )}
      {form === "pass" && (
        <span className="send-form">
          <PersonPicker label="Pass to" placeholder={`Someone on ${clientName}`} clientKey={s.clientKey} value={to} onChange={setTo} people={people ? pickerOf(people, `On ${clientName}`) : null} disabledWhy={(p) => (people?.find((x) => x.id === idOf(p))?.onFocusTime === false ? "Not on FocusTime yet" : null)} strict />
          <button type="button" className="mini" disabled={!toId} onClick={() => void act("send.pass", { id: s.id, toId }).then(() => setForm(null))}>Pass it on</button>
          <span className="muted">{first(s.from.name)} stays the sender</span>
          <button type="button" className="link-btn" onClick={() => setForm(null)}>Cancel</button>
        </span>
      )}
    </li>
  );
}

/** What I sent, with its state: Cancel while Waiting; on a Must that couldn't be taken, Pass to… or Withdraw. */
function SentRow({ s, clientName, act }: { s: SendView; clientName: string; act: (a: string, i: Record<string, unknown>) => Promise<unknown> }) {
  const [pass, setPass] = useState(false);
  const [to, setTo] = useState<PersonValue>({ who: "", whoRef: null });
  const [people, setPeople] = useState<PickerPersonView[] | null>(null);
  useEffect(() => {
    if (!pass || people) return;
    void call<People>("send.people", { clientKey: s.clientKey }).then((p) => setPeople(p.people), () => setPeople([]));
  }, [pass, people, s.clientKey]);
  const toId = to.whoRef?.kind === "cooptimizer" ? to.whoRef.id : null;
  return (
    <li className={`carry-row sent-row state-${s.shown}${s.conflict ? " conflict" : ""}`} data-send={s.id}>
      <span className="carry-main">
        {s.itemType && <TypeIcon clientKey={s.clientKey} type={s.itemType} decorative />}
        <WorkLink clientKey={s.clientKey} url={s.url} className="carry-title" title={s.title}>
          {s.title}
        </WorkLink>
        {kindChip(s.kind)}
      </span>
      <span className="carry-kind">
        to {s.shown === "passed" ? first(s.by?.name ?? "") : first(s.to.name)} · <span className={`sent-state state-${s.shown}`}>{s.words}</span>
      </span>
      <span className="carry-acts">
        {s.canCancel && <button type="button" className="link-btn" onClick={() => void act("send.cancel", { id: s.id })}>Cancel</button>}
        {s.canWithdraw && (
          <>
            <button type="button" className="link-btn" onClick={() => setPass(!pass)}>Pass to…</button>
            <button type="button" className="link-btn" onClick={() => void act("send.withdraw", { id: s.id })}>Withdraw</button>
          </>
        )}
      </span>
      {pass && (
        <span className="send-form">
          <PersonPicker label="Pass to" placeholder={`Someone on ${clientName}`} clientKey={s.clientKey} value={to} onChange={setTo} people={people ? pickerOf(people.filter((p) => p.id !== s.to.id), `On ${clientName}`) : null} disabledWhy={(p) => (people?.find((x) => x.id === idOf(p))?.onFocusTime === false ? "Not on FocusTime yet" : null)} strict />
          <button type="button" className="mini" disabled={!toId} onClick={() => void act("send.pass", { id: s.id, toId }).then(() => setPass(false))}>Send it there</button>
          <button type="button" className="link-btn" onClick={() => setPass(false)}>Cancel</button>
        </span>
      )}
    </li>
  );
}

function PriorityRow({ p, weekStart, past, act }: { p: PriorityView; weekStart: IsoDate; past: boolean; act: (a: string, i: Record<string, unknown>) => Promise<unknown> }) {
  return (
    <li className="carry-row priority-row">
      <span className="carry-main">
        <span className="priority-mark"><Icon name="priority" /></span>
        {p.itemType && <TypeIcon clientKey={p.clientKey} type={p.itemType} decorative />}
        <WorkLink clientKey={p.clientKey} url={p.url} className="carry-title" title={p.title}>
          {p.title}
        </WorkLink>
      </span>
      <span className="carry-kind">
        Client priority{p.note && <span className="send-note-text"> · “{p.note}”</span>}
      </span>
      <span className="carry-acts">
        {p.onMyWeek ? <span className="muted">On your week <Icon name="done" /></span> : !past && <button type="button" className="mini" onClick={() => void act("priority.add_to_week", { clientKey: p.clientKey, itemId: p.itemId, weekStart })}>Add to my week</button>}
        {p.canUnflag && <button type="button" className="link-btn" onClick={() => void act("priority.unflag", { clientKey: p.clientKey, itemId: p.itemId })} title="Take it off the client's priorities">Not a priority</button>}
      </span>
    </li>
  );
}

/**
 * The block panel's "From your team": per client, sent to me and client priorities (part "answer"), or what I sent
 * (part "mine"). Hidden for a client with nothing in it; nothing counts until accepted.
 */
export function FromYourTeam({ weekStart, thisWeek, version, colors, onChanged, onSchedule, part }: { weekStart: IsoDate; thisWeek: IsoDate; version: unknown; colors: Record<string, string>; onChanged: () => void; onSchedule?: (date: IsoDate, half: Half) => void; /** WD-1: "answer" (sent to me and priorities: Add work's To place), "mine" (what I sent: its group at the bottom; NM-2: Ask a lead to look only in "all", Team's). */ part: "answer" | "mine" }) {
  const t = useTeamCommit(weekStart, version);
  const past = weekStart < thisWeek;
  const answerPart = part !== "mine";
  const minePart = part !== "answer";
  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        const r = await call(action, input);
        t.setError(null);
        return r;
      } catch (e) {
        t.setError(errText(e));
        return null;
      } finally {
        await t.reload();
        onChanged();
      }
    },
    [t, onChanged],
  );
  const clients = (t.data?.clients ?? []).filter((c) => (answerPart && (c.incoming.length || c.priorities.length)) || (minePart && c.sent.length > 0));
  const waiting = clients.reduce((n, c) => n + c.incoming.filter((s) => !s.conflict).length, 0);
  if (!clients.length) return t.error ? <p className="error-line" role="alert">{t.error}</p> : null;
  return (
    <section className="carry team-group" aria-label={part === "mine" ? "You sent" : "From your team"}>
      {part !== "mine" && <header className="carry-head">
        <h2 className="section-label">From your team</h2>
        {waiting > 0 && answerPart && <span className="muted">{waiting} to answer · nothing counts on your week until you accept</span>}
      </header>}
      {t.error && <p className="error-line" role="alert">{t.error}</p>}
      {clients.map((c) => (
        <div key={c.clientKey} className="carry-client" style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties}>
          <h3 className="carry-client-name">
            <span className="swatch" aria-hidden="true" />
            {c.clientName}
          </h3>
          {answerPart && c.incoming.length > 0 && (
            <ul className="carry-rows" aria-label={`Sent to you for ${c.clientName}`}>
              {c.incoming.map((s) => (
                <IncomingRow key={s.id} s={s} clientName={c.clientName} past={past} act={act} onSchedule={onSchedule} />
              ))}
            </ul>
          )}
          {answerPart && c.priorities.length > 0 && (
            <ul className="carry-rows" aria-label={`${c.clientName} priorities`}>
              {c.priorities.map((p) => (
                <PriorityRow key={p.itemId} p={p} weekStart={weekStart} past={past} act={act} />
              ))}
            </ul>
          )}
          {minePart && c.sent.length > 0 && (
            <>
              <p className="team-sub">You sent</p>
              <ul className="carry-rows" aria-label={`You sent for ${c.clientName}`}>
                {c.sent.map((s) => (
                  <SentRow key={s.id} s={s} clientName={c.clientName} act={act} />
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
