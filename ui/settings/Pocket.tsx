// PK-2: Settings › Connections › Pocket recorder. Not connected: one sentence on what connecting does, the
// numbered steps, the key field and Check and save. Connected: when it was last checked and how many recordings Pocket
// had from the last 7 days, with Check again, Use a new key and Disconnect (which asks first). The key is sent once,
// to be checked and kept; it never comes back. Loading the section reads only what FocusTime kept (pocket.status):
// Pocket is asked only when a button here is pressed. PK-4: the last list Calls asked for, in numbers only (held in
// memory with that list, 5 minutes), and my Pocket addresses, each with Remove.
import { useEffect, useId, useRef, useState } from "react";
import type { PocketView } from "../../actions/pocket-types.ts";
import { checkedAgo, POCKET_CALL_WORDS as PW, POCKET_COUNT_WORDS as CW, POCKET_KEYS_DOC, POCKET_WORDS as W, recordingsLine } from "../../plan/pocket-words.ts";
import { call } from "../api.ts";

const err = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

export function PocketRecorder({ timeZone }: { timeZone: string }) {
  const [v, setV] = useState<PocketView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "check" | "disconnect">(null);
  const [mode, setMode] = useState<null | "replace" | "ask">(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    call("pocket.status", {})
      .then((r) => setV(r as PocketView))
      .catch((e) => setProblem(err(e)));
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const run = async (kind: "save" | "check" | "disconnect", action: string, input: Record<string, unknown>, done: string | null) => {
    setBusy(kind);
    setProblem(null);
    setSaid(null);
    try {
      const r = (await call(action, input)) as PocketView;
      setV(r);
      setClock(Date.now());
      setMode(null);
      setSaid(done);
      return true;
    } catch (e) {
      setProblem(err(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** PK-4: one of my Pocket addresses forgotten; Pocket isn't asked. */
  const removeAddress = async (address: string) => {
    setBusy("check");
    setProblem(null);
    setSaid(null);
    try {
      await call("meeting.pocket_address_remove", { address });
      setV((await call("pocket.status", {})) as PocketView);
      setSaid(PW.addressGone);
    } catch (e) {
      setProblem(err(e));
    } finally {
      setBusy(null);
    }
  };

  if (!v) return problem ? <p className="field-problem" role="status">{problem}</p> : <p className="muted">Loading…</p>;
  return (
    <div className="pocket">
      {!v.connected ? (
        <>
          <p className="muted set-intro">{W.intro}</p>
          <Guide />
          <KeyForm busy={busy} label={W.checkAndSave} onSubmit={(key) => run("save", "pocket.connect", { key }, null)} />
        </>
      ) : (
        <>
          <p className="pocket-state">
            <span className="state live">{W.connected}</span>
            <span className="muted">{[v.checkedAt ? checkedAgo(v.checkedAt, clock, timeZone) : W.notChecked, v.recordings === null ? null : recordingsLine(v.recordings)].filter(Boolean).join(" · ")}</span>
          </p>
          <p className="muted set-intro">{W.kept}</p>
          <LastList v={v} timeZone={timeZone} />
          <Addresses
            list={v.addresses ?? []}
            busy={busy !== null}
            onRemove={(address) => void removeAddress(address)}
          />
          {mode !== "ask" && <div className="pocket-actions">
            <button type="button" className="mini primary" disabled={busy !== null} onClick={() => void run("check", "pocket.check", {}, W.checkedNow)}>
              {busy === "check" ? W.checking : W.checkAgain}
            </button>
            <button type="button" className="mini" aria-expanded={mode === "replace"} disabled={busy !== null} onClick={() => setMode(mode === "replace" ? null : "replace")}>
              {W.replace}
            </button>
            <button type="button" className="mini quiet" aria-expanded={false} disabled={busy !== null} onClick={() => (setSaid(null), setProblem(null), setMode("ask"))}>
              {W.disconnect}
            </button>
          </div>}
          {mode === "replace" && (
            <div className="pocket-replace">
              <p className="muted">{W.replaceHint}</p>
              <Guide />
              <KeyForm busy={busy} label={W.checkAndSave} onSubmit={(key) => run("save", "pocket.connect", { key }, W.replaced)} onCancel={() => setMode(null)} />
            </div>
          )}
          {mode === "ask" && <DisconnectAsk busy={busy !== null} onYes={() => void run("disconnect", "pocket.disconnect", {}, W.gone)} onNo={() => setMode(null)} />}
        </>
      )}
      {problem && (
        <p className="field-problem" role="alert">
          {problem}
        </p>
      )}
      {said && !problem && (
        <p className="muted" role="status">
          {said}
        </p>
      )}
    </div>
  );
}

/** PK-4: the last list Calls asked for: when, and what was found, in numbers only. */
function LastList({ v, timeZone }: { v: PocketView; timeZone: string }) {
  const id = useId();
  const l = v.last;
  if (!l) return <p className="muted pocket-last" data-pocket-last="none">{CW.none}</p>;
  const c = l.counts;
  const time = Temporal.Instant.from(l.at).toZonedDateTimeISO(timeZone).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const rows: [string, number][] = [
    [CW.listed, c.listed],
    [CW.recordings, c.listed - c.notRecordings],
    [CW.kept, c.kept],
    [CW.address, c.address],
    [CW.noRecorder, c.noRecorder],
    [CW.outside, c.outside],
    [CW.notRecordings, c.notRecordings],
  ];
  return (
    <section className="pocket-last" aria-labelledby={id} data-pocket-last="">
      <h4 id={id} className="pocket-steps-label">{CW.head}</h4>
      <p className="muted">{CW.at(time)}</p>
      <dl className="pocket-counts">
        {rows.map(([k, n]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{CW.note}</p>
    </section>
  );
}

/** PK-4: my Pocket addresses (only mine, on my own page), each with Remove. Set from Calls. */
function Addresses({ list, busy, onRemove }: { list: readonly string[]; busy: boolean; onRemove: (a: string) => void }) {
  const id = useId();
  return (
    <section className="pocket-addresses" aria-labelledby={id} data-pocket-addresses="">
      <h4 id={id} className="pocket-steps-label">{CW.addressesHead}</h4>
      {list.length ? (
        <ul>
          {list.map((a) => (
            <li key={a}>
              <span>{a}</span>
              <button type="button" className="mini quiet" disabled={busy} aria-label={CW.removeLabel(a)} onClick={() => onRemove(a)}>{CW.remove}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{CW.addressesNone}</p>
      )}
    </section>
  );
}

function Guide() {
  const id = useId();
  return (
    <div className="pocket-guide">
      <p className="pocket-steps-label" id={id}>
        {W.stepsLabel}
      </p>
      <ol className="pocket-steps" aria-labelledby={id}>
        {W.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="muted">{W.trust}</p>
      <p className="muted">
        <a href={POCKET_KEYS_DOC} target="_blank" rel="noopener noreferrer">
          {W.docsLink}
        </a>
      </p>
    </div>
  );
}

function KeyForm({ busy, label, onSubmit, onCancel }: { busy: string | null; label: string; onSubmit: (key: string) => Promise<boolean>; onCancel?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <form
      className="pocket-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = ref.current?.value ?? "";
        // The key leaves the page once, in this request's body; it is cleared from the field once it is kept.
        if (await onSubmit(value)) {
          if (ref.current) ref.current.value = "";
        }
      }}
    >
      <label htmlFor={id}>{W.field}</label>
      <div className="pocket-input">
        <input id={id} ref={ref} type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={W.fieldHint} disabled={busy !== null} />
        <button type="submit" className="mini primary" disabled={busy !== null}>
          {busy === "save" ? W.checking : label}
        </button>
        {onCancel && (
          <button type="button" className="mini quiet" disabled={busy !== null} onClick={onCancel}>
            {W.cancel}
          </button>
        )}
      </div>
    </form>
  );
}

function DisconnectAsk({ busy, onYes, onNo }: { busy: boolean; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="pocket-ask" role="group" aria-label={W.disconnect}>
      <span>{W.disconnectAsk}</span>
      <button ref={ref} type="button" className="mini danger" disabled={busy} onClick={onYes}>
        {W.disconnect}
      </button>
      <button type="button" className="mini quiet" disabled={busy} onClick={onNo}>
        {W.keep}
      </button>
    </div>
  );
}
