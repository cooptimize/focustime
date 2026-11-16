// AH-5, QC-1: the people an item can be assigned to (this client's DevOps project, never another client's), read once
// per client, and the list as a form field. Its own file (PF-1) so the New form doesn't bring Backlog's grid with it.
import { useEffect, useMemo, useState } from "react";
import type { AssignPerson } from "../../plan/ahead-people.ts";
import { call } from "../api.ts";
import type { ListOption } from "../CellPopover.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import { SelectField } from "../SelectField.tsx";

/** ahead.people, read once per client while Ahead is open. */
const peopleMemo = new Map<string, Promise<{ people: AssignPerson[]; problem: string | null }>>();
export const forgetAheadPeople = () => peopleMemo.clear();
export function usePeople(clientKey: string) {
  const [d, setD] = useState<{ people: AssignPerson[]; problem: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // TP-1: never show one client's people while another's are read.
    setD(null);
    setErr(null);
    const p = peopleMemo.get(clientKey) ?? call<{ people: AssignPerson[]; problem: string | null }>("ahead.people", { clientKey });
    peopleMemo.set(clientKey, p);
    p.then((x) => live && setD(x), (e: unknown) => (peopleMemo.delete(clientKey), live && setErr(e instanceof Error ? e.message : "Couldn't read who can be assigned")));
    return () => void (live = false);
  }, [clientKey]);
  return { data: d, error: err };
}

/**
 * QC-1: Ahead's Assigned to list as a form field (the New form): the same people (this client's DevOps project, never
 * another client's), me first, Unassigned, then everyone by name. The value is an email, "" for nobody.
 */
export function PeopleField({ clientKey, value, onChange, label = "Assigned to" }: { clientKey: string; value: string; onChange: (email: string) => void; label?: string }) {
  const { data, error } = usePeople(clientKey);
  const people = useMemo(() => data?.people ?? [], [data]);
  const photos = usePhotos({ emails: people.filter((p) => !p.external).map((p) => p.email).slice(0, 60) });
  // "me" (the form's default) is my own entry once the list is read.
  const shown = value === "me" ? (people.find((p) => p.me)?.email ?? "me") : value;
  const options: ListOption[] = useMemo(() => {
    const row = (p: AssignPerson): ListOption => ({ key: p.email, label: p.me ? `${p.name} (me)` : p.name, search: `${p.name} ${p.domain}${p.me ? " me" : ""}`, lead: <Avatar name={p.name} photo={p.external ? null : photos.photoFor(p.email)} size={22} />, sub: p.domain, ...(p.external ? { hint: <span className="ah-ext">Outside Cooptimize</span> } : {}) });
    const known = shown && !people.some((p) => p.email === shown) ? [{ key: shown, label: shown === "me" ? "Me" : shown }] : [];
    return [...people.filter((p) => p.me).map(row), { key: "", label: "Unassigned", search: "unassigned nobody none", lead: <span className="ah-pop-nobody" aria-hidden="true">–</span> }, ...known, ...people.filter((p) => !p.me).map(row)];
  }, [people, photos, shown]);
  if (!data && !error) return <span className="muted nf-reading">Reading who can be assigned…</span>;
  return (
    <>
      <SelectField label={label} value={shown} options={options} onChange={onChange} className="nf-select" />
      {(error ?? data?.problem) && <span className="muted nf-why">{error ?? data?.problem}</span>}
    </>
  );
}
