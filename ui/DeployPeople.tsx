// DP-3: other people on a deployment, on the screens. Who is on it (a count on a row, the names where a deployment is
// opened), the People field on every form that makes or edits one (the shared picker, Cooptimizers only, chosen from
// the list), my own Outlook hold's line and its one offer, and holds left on my Outlook for deployments I'm no longer
// on. Only ever my own Outlook state; another person's is never shown.
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { addedByText, HOLD_WORDS, LEFT_HOLD, namesText, othersOn } from "../plan/shared-deploy.ts";
import type { Pick } from "../plan/types.ts";
import { call } from "./api.ts";
import { Icon } from "./icons.tsx";
import { PersonPicker, usePickerPeople, type PersonValue } from "./PersonPicker.tsx";
import { useTimeboxes, type TimeboxEnv } from "./Timeboxes.tsx";
import type { PeoplePickerData } from "../actions/people-picker.ts";

/** "+2" on a row: the others on it, their names on hover. Nothing when only I am on it. */
export function PeopleChip({ pick }: { pick: Pick }) {
  const sh = pick.shared;
  if (!sh || sh.people.length < 2) return null;
  const n = sh.people.length;
  const names = namesText(sh.people.map((p) => p.name));
  return (
    <span className="deploy-people" title={`On it: ${names}`} aria-label={`${n} people on it: ${names}`}>
      <Icon name="people" /> {n}
    </span>
  );
}

/** Where a deployment is opened: everyone on it by name (me as "You"), and who added me. */
export function PeopleLine({ pick, me }: { pick: Pick; me: string | null }) {
  const sh = pick.shared;
  if (!sh) return null;
  const mine = me?.toLowerCase() ?? "";
  const names = sh.people.map((p) => (p.id === mine ? "You" : p.name));
  const by = addedByText(sh);
  return (
    <p className="deploy-people-line">
      <Icon name="people" /> <span>{sh.people.length === 1 ? "Only you are on it" : `On it: ${namesText(names)}`}</span>
      {by && <span className="muted"> · {by}</span>}
    </p>
  );
}

type Chosen = { id: string; name: string };

/** The picker's people, Cooptimizers only (never "In this conversation" or anyone external), without those chosen. */
function cooptimizersOnly(d: PeoplePickerData | null, chosen: readonly Chosen[]): PeoplePickerData | null {
  if (!d) return null;
  const taken = new Set(chosen.map((c) => c.id.toLowerCase()));
  return { problems: d.problems, groups: d.groups.filter((g) => g.key !== "conversation").map((g) => ({ ...g, people: g.people.filter((p) => p.ref.kind === "cooptimizer" && !p.external && !taken.has(p.ref.id.toLowerCase())) })).filter((g) => g.people.length) };
}

/**
 * The People field: who else is on it, as chips with Remove, and the shared picker to add someone (the client's
 * people first, then everyone at Cooptimize; chosen from the list, never a typed name). Saved as a JSON list of ids in
 * a hidden input named `name`. I am on it always and am not listed here.
 */
export function DeployPeopleField({ name, clientKey, initial, onChange }: { name: string; clientKey: string | null; initial: readonly Chosen[]; onChange?: (people: Chosen[]) => void }) {
  const [chosen, setChosen] = useState<Chosen[]>([...initial]);
  const [who, setWho] = useState<PersonValue>({ who: "", whoRef: null });
  const fetched = usePickerPeople({ clientKey });
  const people = useMemo(() => cooptimizersOnly(fetched, chosen), [fetched, chosen]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    onChange?.(chosen);
  }, [chosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (v: PersonValue) => {
    if (v.whoRef?.kind === "cooptimizer") {
      const ref = v.whoRef;
      setChosen((c) => (c.some((x) => x.id.toLowerCase() === ref.id.toLowerCase()) ? c : [...c, { id: ref.id, name: v.who }]));
      setWho({ who: "", whoRef: null });
    } else setWho(v);
  };
  return (
    <span className="deploy-people-field">
      <input type="hidden" name={name} value={JSON.stringify(chosen.map((c) => c.id))} />
      <span className="deploy-people-chips">
        <span className="dp-chip me">You</span>
        {chosen.map((c) => (
          <span key={c.id} className="dp-chip">
            {c.name}
            <button type="button" className="dp-remove" aria-label={`Take ${c.name} off it`} title={`Take ${c.name} off it`} onClick={() => setChosen((x) => x.filter((y) => y.id !== c.id))}>
              <Icon name="close" />
            </button>
          </span>
        ))}
      </span>
      <PersonPicker label="Add someone" placeholder="Add someone at Cooptimize" clientKey={clientKey} value={who} onChange={add} people={people} strict />
    </span>
  );
}

/** Put my hold on, update it, or take it off: my own timebox for the deployment, then my own preview (or my confirm_own rule). */
export async function holdAction(env: TimeboxEnv, pick: Pick, on: boolean): Promise<string | null> {
  try {
    const r = await call<{ uid: string | null; sync: boolean }>("deploy.hold", { id: pick.id, on });
    env.changed();
    if (r.uid && r.sync) await env.sync(r.uid);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "That didn't work";
  }
}

/** My own Outlook for this deployment: one line and its one offer. Never anyone else's. */
export function HoldLine({ pick, onLeave }: { pick: Pick; onLeave?: () => void }) {
  const env = useTimeboxes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = pick.shared?.hold;
  if (!hold || !env || pick.status !== "planned") return null;
  const words = HOLD_WORDS[hold.state];
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setError(await f().catch((e: unknown) => (e instanceof Error ? e.message : "That didn't work")));
    setBusy(false);
  };
  const direct = async (action: string) => {
    const r = await call<{ uid?: string; sync?: boolean }>(action, { id: pick.id });
    env.changed();
    if (r.uid && r.sync) await env.sync(r.uid);
    return null;
  };
  return (
    <div className={`deploy-hold ${hold.state}`} data-hold={hold.state}>
      <span className="deploy-hold-line"><Icon name="calendar" /> {words.line}</span>
      <span className="deploy-hold-acts">
        {hold.state === "moved_in_outlook" ? (
          <>
            {(pick.shared?.people.length ?? 1) > 1 && (
              <button type="button" className="mini" disabled={busy} onClick={() => void run(() => direct("deploy.hold_follow"))}>Move the deployment for everyone</button>
            )}
            <button type="button" className="mini" disabled={busy} onClick={() => void run(() => direct("deploy.hold_back"))}>Put my hold back</button>
          </>
        ) : hold.state === "deleted_in_outlook" ? (
          <>
            <button type="button" className="mini" disabled={busy} onClick={() => void run(() => holdAction(env, pick, true))}>Put it back</button>
            {onLeave && (pick.shared?.people.length ?? 1) > 1 && <button type="button" className="mini quiet" disabled={busy} onClick={onLeave}>Take me off</button>}
          </>
        ) : hold.state === "behind" && hold.uid ? (
          <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => (await env.sync(hold.uid!), null))}>{words.offer}</button>
        ) : words.offer && hold.state !== "pending" ? (
          <button type="button" className="mini" disabled={busy} onClick={() => void run(() => holdAction(env, pick, hold.state === "off"))}>{words.offer}</button>
        ) : null}
      </span>
      {error && <span className="deploy-hold-error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * Week's line when holds are left on my Outlook for deployments I'm no longer on: Remove them (my own preview), never
 * by itself.
 */
export function LeftHolds({ holds }: { holds: WeekLoadData["leftHolds"] }) {
  const env = useTimeboxes();
  if (!holds?.length || !env) return null;
  return (
    <span className="status-chip left-holds" role="status">
      {holds.length === 1 ? `${LEFT_HOLD}: ${holds[0]!.title}` : `${holds.length} holds for deployments you're no longer on are still on your Outlook`}
      <button type="button" className="mini" onClick={() => void env.syncMany(holds.map((h) => h.uid))}>{holds.length === 1 ? "Remove it" : "Remove them"}</button>
    </span>
  );
}

/**
 * On a visit: my holds that fell behind after someone else's change are brought in step by my own rule (my confirm_own:
 * a preview, or straight through when I turned previews off for my own events). Once per hold and change.
 */
export function useHoldsInStep(data: { plan: WeekLoadData["plan"] } | null, env: TimeboxEnv | null) {
  const asked = useRef(new Set<string>());
  const behind = useMemo(() => {
    const out: { uid: string; key: string }[] = [];
    for (const day of Object.values(data?.plan ?? {})) for (const p of day.picks) if (p.shared?.hold.state === "behind" && p.shared.hold.uid && p.status === "planned") out.push({ uid: p.shared.hold.uid, key: `${p.shared.hold.uid}:${p.shared.version}` });
    return out;
  }, [data?.plan]);
  useEffect(() => {
    if (!env) return;
    const fresh = behind.filter((b) => !asked.current.has(b.key));
    if (!fresh.length) return;
    for (const b of fresh) asked.current.add(b.key);
    void env.syncMany(fresh.map((b) => b.uid));
  }, [behind, env]);
}

export { othersOn };
