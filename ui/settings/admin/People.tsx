// SA-4: Admin › People, five tabs: People (the table, Not Cooptimizers folded under it), Who's set up (with Invite),
// Client logins (client DevOps identities), Levels (positions to levels) and Admins. Moved from ui/settings/Admin.tsx
// with every action and check as it was; Remove asks for the name at the person's row.
import { Fragment, useState } from "react";
import { call } from "../../api.ts";
import { SaveMark, useSaveContext } from "../autosave.tsx";
import { shortDate } from "../../labels.ts";
import { Icon } from "../../icons.tsx";
import { WhoSetUp } from "../WhoSetUp.tsx";
import { AdminConfirm, Kind, useAdminSave, useSection, type Saver } from "./shared.tsx";
import { Tabs } from "./Tabs.tsx";
import { adminHref, PART_TABS } from "./places.ts";

// ---------- People ----------

type Person = {
  id: string;
  name: string;
  email: string | null;
  me: boolean;
  signedIn: boolean;
  level: string | null;
  levelName: string | null;
  levelSource: "dataverse" | "override" | null;
  dataverseLevel: string | null;
  leads: { clientKey: string; primary: boolean; why: string[]; whyText: string[] }[];
  removedLeads: string[];
  lastSignInAt: string | null;
  setup: "done" | "skipped" | "started" | "not_started" | null;
  dataverseMatch: boolean;
  /** ADM-2: which key matched ("Matched by email"), or why not. */
  dataverseText: string;
  cooptimizer: boolean;
  notCooptimizerText: string | null;
  automation: boolean;
  positionName: string | null;
  clients: string[];
  sources: { microsoft: boolean; google: boolean; devopsWrites: number } | null;
};
type Position = { name: string; people: number; mapped: boolean; level: string | null };
type IdentityRowView = import("../../../plan/identities.ts").IdentityRowView;
type ClientIdentitiesView = import("../../../plan/identities.ts").ClientIdentitiesView;
type PeopleData = { identities?: ClientIdentitiesView[]; people: Person[]; others: Person[]; positions: Position[]; unmappedPositions: number; noDomains: boolean; leadsShown: number; admins: { id: string; name: string | null; via: string | null; checkedAt: string | null }[]; groupLink: string | null; groupSet: boolean; refreshedAt: string | null; levels: { id: string; name: string }[] };

const SETUP_WORDS = { done: "Done", skipped: "Skipped", started: "Started", not_started: "Not started" } as const;

export function PeoplePart({ tab, onTab }: { tab: string; onTab: (t: string) => void }) {
  const { data, error, load } = useSection<PeopleData>("people");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const ctx = useSaveContext();
  const saver = useAdminSave(load);
  const [othersOpen, setOthersOpen] = useState(false);
  const override = async (input: Record<string, unknown>, what: string, undo?: Record<string, unknown>) => {
    setMsg(null);
    try {
      await call("admin.override", input);
      await load();
      setMsg(`${what}. Logged in Admin › Audit.`);
      if (undo)
        ctx?.offerUndo(`${what}.`, async () => {
          await call("admin.override", undo);
          await load();
        });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved");
    }
  };
  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ people: number }>("admin.refresh_people", {});
      await load();
      setMsg(`Read ${r.people} people from Dataverse.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Dataverse couldn't be read");
    } finally {
      setBusy(false);
    }
  };
  const tabs = PART_TABS.people.map(([id, label]) => ({ id, label: id === "people" && data ? `${label} (${data.people.length})` : label, href: adminHref({ part: "people", tab: id }) }));
  const removed = async (m: string) => (setRemoving(null), setMsg(m), await load());
  const body = () => {
    if (error) return <p className="field-problem">{error}</p>;
    if (!data && tab !== "setup") return <p className="muted">Loading…</p>;
    switch (tab) {
      case "setup":
        return <WhoSetUp />;
      case "logins":
        return <ClientIdentities clients={data!.identities ?? []} people={data!.people} reload={load} />;
      case "levels":
        return <PositionMap positions={data!.positions} unmapped={data!.unmappedPositions} levels={data!.levels} saver={saver} />;
      case "admins":
        return <Admins data={data!} />;
      default:
        return (
          <>
            <div className="set-row-actions">
              <button type="button" className="mini" disabled={busy} onClick={() => void refresh()}>
                {busy ? "Reading…" : "Refresh from Dataverse"}
              </button>
              <span className="set-hint">{data!.refreshedAt ? `Levels and leads read ${shortDate(data!.refreshedAt.slice(0, 10))}; again each day.` : "Not read from Dataverse yet."}</span>
              {msg && <span className="set-hint" role="status">{msg}</span>}
            </div>
            <p className="muted">Cooptimizers only. Levels change suggestions and emphasis only, never what anyone can see or do.</p>
            {data!.noDomains && <p className="set-problem">Set Cooptimize email domains in Admin › Team defaults › Planning and new people (Help invites go only to). Until then only guest accounts are left out of People.</p>}
            <PeopleTable people={data!.people} levels={data!.levels} leadsShown={data!.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} removing={removing} onRemoved={removed} label="People" />
            {data!.others.length > 0 && (
              <div className="adm-fold">
                <button type="button" className="fold-line" aria-expanded={othersOpen} onClick={() => setOthersOpen((o) => !o)}>
                  <Icon name={othersOpen ? "open" : "closed"} /> Not Cooptimizers ({data!.others.length})
                </button>
                {othersOpen && (
                  <>
                    <p className="muted">Guests, people outside the Cooptimize email domains and automation accounts. They have no level, lead no client and never show in pickers. Nothing about them is deleted.</p>
                    <PeopleTable people={data!.others} levels={data!.levels} leadsShown={data!.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} removing={removing} onRemoved={removed} label="Not Cooptimizers" others />
                  </>
                )}
              </div>
            )}
          </>
        );
    }
  };
  return (
    <div className="set-form adm-people">
      <Tabs label="People tabs" tabs={tabs} current={tab} onPick={onTab}>
        {body()}
      </Tabs>
    </div>
  );
}

/** Admins: the signed-in admin and everyone seen; "Nobody seen yet." only when that is true. */
function Admins({ data }: { data: PeopleData }) {
  return (
    <section aria-label="Admins">
      <p className="muted">
        Admins are the members of the Entra group "FocusTime Admins". FocusTime never makes anyone an admin; add or remove members in Entra.{" "}
        {data.groupLink ? (
          <a href={data.groupLink} target="_blank" rel="noreferrer">
            Open the group in Entra
          </a>
        ) : (
          "The group isn't set up for this FocusTime yet (runbook: Creating the admin group)."
        )}
      </p>
      <ul className="set-list adm-admins">
        {data.admins.length === 0 && <li className="muted">Nobody seen yet.</li>}
        {data.admins.map((a) => (
          <li key={a.id}>
            <span>{a.name ?? "Someone who hasn't signed in"}</span> <span className="muted">{a.via === "break_glass" ? "break-glass list" : a.via === "demo" ? "the demo" : "FocusTime Admins"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * AH-3: client DevOps identities. A Cooptimizer often signs in to a client's DevOps with a client login ("Ext-…"). Linked
 * ones (from their Account Worker row in Dataverse, or confirmed here) count as them everywhere; a suggestion (the same
 * name once a prefix or suffix is off) waits for Confirm; unmatched ones show as DevOps has them, with Link to a person.
 * Emails never reach this page: rows carry a display name and an opaque ref. Every change is in Admin › Audit.
 */
export function ClientIdentities({ clients, people, reload }: { clients: ClientIdentitiesView[]; people: Person[]; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (r: IdentityRowView, op: "link" | "remove", personId: string, what: string) => {
    setBusy(r.ref);
    setMsg(null);
    try {
      await call("admin.identity", { clientKey: r.clientKey, ref: r.ref, personId, op });
      await reload();
      setMsg(`${what}. Logged in Admin › Audit.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(null);
    }
  };
  const coops = people.filter((p) => p.cooptimizer);
  return (
    <section className="adm-identities" aria-label="Client DevOps identities">
      <h3>Client DevOps identities</h3>
      <p className="muted">When someone signs in to a client's DevOps with a client login, FocusTime counts that login as them: their items, the names shown, leads, Team and notes. Suggestions are only applied when you confirm them.</p>
      {msg && (
        <p className="set-hint" role="status">
          {msg}
        </p>
      )}
      {clients.length === 0 && <p className="muted">No client logins seen in the clients' DevOps.</p>}
      {clients.map((c) => (
        <div key={c.clientKey} className="adm-id-client">
          <h4>{c.clientKey}</h4>
          <p className="muted adm-id-line">{c.line}</p>
          <ul className="set-list adm-id-list" aria-label={`${c.clientKey} identities`}>
            {c.rows.map((r) => (
              <li key={r.ref} className={`adm-id-row ${r.state}`}>
                <span className="adm-id-name">{r.name}</span>
                {r.state === "linked" && (
                  <>
                    <span className="muted">
                      {r.personName ?? "Someone"} · {r.source === "dataverse" ? "from Dataverse" : "confirmed"}
                    </span>
                    <button type="button" className="mini quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} is no longer ${r.personName ?? "linked"}`)} aria-label={`Remove ${r.name} from ${r.personName ?? "this person"}`}>
                      Remove
                    </button>
                  </>
                )}
                {r.state === "suggested" && (
                  <>
                    <span className="muted">Looks like {r.personName}</span>
                    <button type="button" className="mini" disabled={busy === r.ref} onClick={() => void act(r, "link", r.personId!, `${r.name} is ${r.personName} on ${r.clientKey}`)} aria-label={`Confirm ${r.name} is ${r.personName}`}>
                      Confirm
                    </button>
                    <button type="button" className="mini quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} won't be suggested for ${r.personName} again`)} aria-label={`${r.name} isn't ${r.personName}`}>
                      Not them
                    </button>
                  </>
                )}
                {r.state === "unmatched" && (
                  <label className="adm-id-link">
                    <span className="muted">Not linked</span>
                    <select aria-label={`Link ${r.name} to a person`} value="" disabled={busy === r.ref} onChange={(e) => { const p = coops.find((x) => x.id === e.target.value); if (p) void act(r, "link", p.id, `${r.name} is ${p.name} on ${r.clientKey}`); }}>
                      <option value="">Link to a person…</option>
                      {coops.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** ADM-2 (D605): Dataverse position names to levels. Applies at once (the next read of levels), audited as one Rule. */
export function PositionMap({ positions, unmapped, levels, saver }: { positions: Position[]; unmapped: number; levels: PeopleData["levels"]; saver: Saver }) {
  const map = Object.fromEntries(positions.filter((p) => p.mapped).map((p) => [p.name, p.level]));
  const shown = saver.shown("org", "org.position_levels", map) as Record<string, string | null>;
  const set = (name: string, level: string | null) => void saver.save("org", "org.position_levels", { ...shown, [name]: level }, `${name} mapped`);
  return (
    <section className="adm-positions" aria-label="Positions to levels">
      <h3>Positions to levels {unmapped > 0 && <span className="adm-kind">{unmapped} not mapped</span>}</h3>
      <p className="muted">Each Cooptimizer's level comes from their Dataverse position. A position that isn't mapped gives no level: those people show Level not set and use the Consultant defaults.</p>
      <SaveMark s={saver.status("org", "org.position_levels")} retry={() => void saver.save("org", "org.position_levels", shown, "Positions")} />
      <div className="adm-scroll">
        <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Position in Dataverse</th>
            <th scope="col">Level</th>
            <th scope="col">People</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const v = p.name in shown ? shown[p.name] : null;
            return (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>
                  <select aria-label={`Level for ${p.name}`} value={v ?? ""} onChange={(e) => set(p.name, e.target.value || null)}>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                    <option value="">Not mapped</option>
                  </select>
                </td>
                <td>{p.people}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </section>
  );
}

type OnOverride = (input: Record<string, unknown>, what: string, undo?: Record<string, unknown>) => Promise<void>;

function PeopleTable({ people, levels, leadsShown, saver, onOverride, onRemove, removing, onRemoved, label, others = false }: { people: Person[]; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: (p: Person | null) => void; removing: Person | null; onRemoved: (m: string) => Promise<void>; label: string; others?: boolean }) {
  return (
    <div className="adm-scroll">
      <table className="adm-table adm-people-table adm-rows-phone" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{others ? "Why not" : "Level"}</th>
            {!others && <th scope="col">Client lead</th>}
            <th scope="col">Last sign-in</th>
            <th scope="col">Setup</th>
            <th scope="col">Dataverse</th>
            {!others && <th scope="col">Clients</th>}
            <th scope="col">Sources</th>
            <th scope="col">Automation <Kind kind="Rule" /></th>
            <th scope="col"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <Fragment key={p.id}>
              <PersonRow p={p} levels={levels} leadsShown={leadsShown} saver={saver} onOverride={onOverride} onRemove={() => onRemove(p)} others={others} />
              {removing?.id === p.id && (
                // SA-4: the confirm opens at the person's row, not at the foot of the page.
                <tr className="adm-remove-row">
                  <td colSpan={others ? 8 : 10}>
                    <RemovePerson p={p} onClose={() => onRemove(null)} onDone={onRemoved} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonRow({ p, levels, leadsShown, saver, onOverride, onRemove, others }: { p: Person; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: () => void; others: boolean }) {
  const [adding, setAdding] = useState("");
  const [allLeads, setAllLeads] = useState(false);
  const leadClients = p.leads.map((l) => l.clientKey);
  const addable = p.clients.filter((k) => !leadClients.includes(k));
  const shownLeads = allLeads ? p.leads : p.leads.slice(0, leadsShown);
  const scope = `person:${p.id}`;
  const automation = (
    <td>
      <label className="adm-switch">
        <input type="checkbox" role="switch" checked={saver.shown(scope, "automation", p.automation)} aria-label={`${p.name}: automation account`} onChange={(e) => void saver.save(scope, "automation", e.target.checked ? true : undefined, `${p.name}: automation account`)} /> {p.automation ? "Yes" : "No"}
      </label>
      <SaveMark s={saver.status(scope, "automation")} retry={() => void saver.save(scope, "automation", p.automation ? true : undefined, `${p.name}: automation account`)} />
    </td>
  );
  // The word, then the how on its own line (matched by which key, or why there's no sign-in to match yet).
  const dvWord = !p.dataverseMatch ? "Not matched" : p.signedIn ? "Matched" : "In Dataverse";
  const dvHint = p.dataverseText.replace(/^In Dataverse, |^Matched /, "").replace(/^./, (c) => c.toUpperCase());
  const dataverse = (
    <td title={p.dataverseText}>
      <span className={p.dataverseMatch ? undefined : "field-problem"}>{dvWord}</span>
      <span className="set-hint adm-block">{dvHint}</span>
    </td>
  );
  const name = (
    <th scope="row">
      {p.name}
      {p.me && <span className="muted"> (you)</span>}
      {p.email && <span className="muted adm-email">{p.email}</span>}
    </th>
  );
  const sources = <td>{p.sources ? [p.sources.microsoft ? "Microsoft" : null, p.sources.google ? "Google" : null, p.sources.devopsWrites ? `DevOps writes for ${p.sources.devopsWrites}` : null].filter(Boolean).join(", ") || <span className="muted">None</span> : <span className="muted">Not signed in</span>}</td>;
  const remove = (
    <td>
      {p.signedIn && !p.me && (
        <button type="button" className="mini quiet danger" onClick={onRemove}>
          Remove
        </button>
      )}
    </td>
  );
  if (others)
    return (
      <tr>
        {name}
        <td>{p.notCooptimizerText}</td>
        <td>{p.lastSignInAt ? shortDate(p.lastSignInAt.slice(0, 10)) : <span className="muted">Never</span>}</td>
        <td>{p.setup ? SETUP_WORDS[p.setup] : <span className="muted">n/a</span>}</td>
        {dataverse}
        {sources}
        {automation}
        {remove}
      </tr>
    );
  return (
    <tr>
      {name}
      <td>
        <select
          aria-label={`${p.name}: level`}
          value={p.levelSource === "override" ? (p.level ?? "") : ""}
          onChange={(e) => {
            const v = e.target.value;
            void (v
              ? onOverride({ personId: p.id, kind: "level", value: v }, `${p.name}'s level set`, p.levelSource === "override" && p.level ? { personId: p.id, kind: "level", value: p.level } : { personId: p.id, kind: "level", clear: true })
              : onOverride({ personId: p.id, kind: "level", clear: true }, `${p.name}'s level back to Dataverse's`, p.level ? { personId: p.id, kind: "level", value: p.level } : undefined));
          }}
        >
          <option value="">{p.dataverseLevel ? `${p.dataverseLevel} (Dataverse)` : "Level not set"}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} (override)
            </option>
          ))}
        </select>
        {p.levelSource === "override" && <span className="adm-mark">Override</span>}
        {!p.level && <span className="set-hint adm-block">Uses Consultant defaults{p.positionName ? ` (position ${p.positionName} isn't mapped)` : ""}</span>}
      </td>
      <td>
        <ul className="adm-leads">
          {shownLeads.map((l) => (
            <li key={l.clientKey}>
              <span>{l.clientKey}</span> <span className="muted">{l.whyText.join(", ")}{l.primary ? " · primary" : ""}</span>{" "}
              {l.why.includes("override") && <span className="adm-mark">Override</span>}
              <button type="button" className="mini quiet" aria-label={`Remove ${p.name} as lead of ${l.clientKey}`} onClick={() => void onOverride(l.why.length === 1 && l.why[0] === "override" ? { personId: p.id, kind: "lead_add", clientKey: l.clientKey, clear: true } : { personId: p.id, kind: "lead_remove", clientKey: l.clientKey }, `${p.name} no longer a lead of ${l.clientKey}`)}>
                Remove
              </button>
            </li>
          ))}
          {p.leads.length > leadsShown && (
            <li>
              <button type="button" className="mini quiet" onClick={() => setAllLeads((a) => !a)}>
                {allLeads ? "Show fewer" : `and ${p.leads.length - leadsShown} more`}
              </button>
            </li>
          )}
          {p.removedLeads.map((k) => (
            <li key={`removed-${k}`} className="muted">
              {k}: removed by an admin <span className="adm-mark">Override</span>{" "}
              <button type="button" className="mini quiet" onClick={() => void onOverride({ personId: p.id, kind: "lead_remove", clientKey: k, clear: true }, `${p.name} back as a lead of ${k}`)}>
                Undo
              </button>
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <span className="set-inline">
            <select aria-label={`${p.name}: add as lead of`} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add as lead of…</option>
              {addable.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button type="button" className="mini" disabled={!adding} onClick={() => (void onOverride({ personId: p.id, kind: "lead_add", clientKey: adding }, `${p.name} added as a lead of ${adding}`, { personId: p.id, kind: "lead_add", clientKey: adding, clear: true }), setAdding(""))}>
              Add
            </button>
          </span>
        )}
      </td>
      <td>{p.lastSignInAt ? shortDate(p.lastSignInAt.slice(0, 10)) : <span className="muted">Never</span>}</td>
      <td>{p.setup ? SETUP_WORDS[p.setup] : <span className="muted">n/a</span>}</td>
      {dataverse}
      <td>{p.clients.length ? p.clients.join(", ") : <span className="muted">None</span>}</td>
      {sources}
      {automation}
      {remove}
    </tr>
  );
}

function RemovePerson({ p, onClose, onDone }: { p: Person; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call("admin.remove_person", { personId: p.id, confirmName: typed });
      await onDone(`${p.name} was removed: their FocusTime data and personal secrets are deleted. Logged in Admin › Audit.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Not removed");
    } finally {
      setBusy(false);
    }
  };
  // HK-3: focus goes back to the person's Remove when this closes (AdminConfirm).
  return (
    <AdminConfirm
      label={`Remove ${p.name}`}
      text={`Remove ${p.name} from FocusTime? This deletes their plan, settings and personal secrets (sign-ins, write PATs) now and ends their sessions. It can't be undone. Their Dataverse, DevOps and Outlook data stay as they are.`}
      confirm={`Remove ${p.name}`}
      disabled={busy || typed.trim().toLowerCase() !== p.name.trim().toLowerCase()}
      onConfirm={() => void run()}
      onCancel={onClose}
    >
      <label className="set-field">
        <span className="set-label">Type their name to confirm</span>
        <input value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} placeholder={p.name} aria-label="Type their name to confirm" />
      </label>
      {err && <p className="field-problem" role="alert">{err}</p>}
    </AdminConfirm>
  );
}
