// CV-2: the one way to choose a person (Who on a follow-up, and wherever a person is picked from now on). A combobox:
// type to search, Up and Down to move, Enter to choose, Esc to close. Groups: "In this conversation" (externals
// marked), "On <client>" (its Account Workers, with photos) and "Everyone at Cooptimize" (cooptimizers() only). Free
// text is fine and saves as a plain name, "not linked to a person"; a plain name that matches exactly one person
// offers to link it. Photos only for the Cooptimizers on screen.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PeoplePickerData, PickerPerson } from "../actions/people-picker.ts";
import { sameRef, type PersonRef } from "../plan/person-ref.ts";
import { call } from "./api.ts";
import { Avatar, usePhotos } from "./Presence.tsx";

export type PersonValue = { who: string; whoRef: PersonRef | null };

/** Rows shown from "Everyone at Cooptimize" before anything is typed (typing searches all of them). */
const EVERYONE_UNTYPED = 30;

export function usePickerPeople(q: { clientKey: string | null; conversationId?: number | null; commitmentId?: number | null }): PeoplePickerData | null {
  const [d, setD] = useState<PeoplePickerData | null>(null);
  const key = `${q.clientKey ?? ""}|${q.conversationId ?? ""}|${q.commitmentId ?? ""}`;
  useEffect(() => {
    let live = true;
    setD(null);
    call<PeoplePickerData>("people.picker", { ...(q.clientKey ? { clientKey: q.clientKey } : {}), ...(q.conversationId ? { conversationId: q.conversationId } : {}), ...(q.commitmentId ? { commitmentId: q.commitmentId } : {}) }).then(
      (r) => live && setD(r),
      () => live && setD({ groups: [], problems: ["People couldn't be read just now; type a name instead"] }),
    );
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return d;
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The groups narrowed to what's typed (every word must start a word of the name), and "Everyone" capped untyped. */
export function filterGroups(d: PeoplePickerData | null, text: string): PeoplePickerData["groups"] {
  if (!d) return [];
  const words = norm(text).split(/\s+/).filter(Boolean);
  const hit = (p: PickerPerson) => {
    const parts = norm(p.name).split(/[\s.'-]+/);
    return words.every((w) => parts.some((x) => x.startsWith(w)));
  };
  return d.groups
    .map((g) => ({ ...g, people: words.length ? g.people.filter(hit) : g.key === "everyone" ? g.people.slice(0, EVERYONE_UNTYPED) : g.people }))
    .filter((g) => g.people.length);
}

/** The one person whose name is exactly this text, when there is exactly one. */
export function exactMatch(d: PeoplePickerData | null, text: string): PickerPerson | null {
  const t = norm(text);
  if (!d || !t) return null;
  const seen = new Map<string, PickerPerson>();
  for (const g of d.groups) for (const p of g.people) if (norm(p.name) === t) seen.set(p.ref.kind === "cooptimizer" ? `c:${p.ref.id}` : `x:${p.ref.memberId}`, p);
  return seen.size === 1 ? [...seen.values()][0]! : null;
}

export function PersonPicker({ value, onChange, clientKey, conversationId = null, commitmentId = null, label = "Who", placeholder = "Name (optional)" }: {
  value: PersonValue;
  onChange: (v: PersonValue) => void;
  clientKey: string | null;
  conversationId?: number | null;
  commitmentId?: number | null;
  label?: string;
  placeholder?: string;
}) {
  const data = usePickerPeople({ clientKey, conversationId, commitmentId });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => filterGroups(data, value.whoRef ? "" : value.who), [data, value.who, value.whoRef]);
  const flat = useMemo(() => groups.flatMap((g) => g.people), [groups]);
  const photos = usePhotos({ emails: open ? flat.flatMap((p) => (p.email && !p.external ? [p.email] : [])).slice(0, 40) : [] });
  const chosen = value.whoRef ? (data?.groups.flatMap((g) => g.people).find((p) => sameRef(p.ref, value.whoRef)) ?? null) : null;
  const chosenPhoto = usePhotos({ emails: chosen?.email && !chosen.external ? [chosen.email] : [] });
  const linkable = !value.whoRef && !open ? exactMatch(data, value.who) : null;
  useEffect(() => setActive(0), [value.who, open]);

  const pick = (p: PickerPerson) => {
    onChange({ who: p.name, whoRef: p.ref });
    setOpen(false);
  };
  const optionId = (i: number) => `${listId}-o${i}`;
  let i = -1;
  return (
    <span className="person-picker">
      {chosen && <Avatar name={chosen.name} photo={chosen.external ? null : chosenPhoto.photoFor(chosen.email)} size={22} />}
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open && flat.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(open && flat[active] ? { "aria-activedescendant": optionId(active) } : {})}
        value={value.who}
        maxLength={100}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => (onChange({ who: e.target.value, whoRef: null }), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setOpen(true), setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0))));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && open && value.who.trim() && flat[active] && !value.whoRef) (e.preventDefault(), pick(flat[active]!));
          else if (e.key === "Escape" && open) (e.preventDefault(), e.stopPropagation(), setOpen(false));
        }}
      />
      {value.who.trim() && !value.whoRef && !open && <span className="person-picker-note muted">Not linked to a person</span>}
      {value.whoRef?.kind === "external" && <span className="ask-ext">External</span>}
      {linkable && (
        <button type="button" className="mini quiet" onClick={() => pick(linkable)}>
          Link to {linkable.name}
        </button>
      )}
      {open && (flat.length > 0 || (data?.problems.length ?? 0) > 0) && (
        <div className="person-picker-pop" role="presentation" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={`Choose ${label.toLowerCase()}`}>
            {groups.map((g) => (
              <li key={g.key} role="presentation">
                <p className="person-picker-group" aria-hidden="true">{g.label}</p>
                <ul role="group" aria-label={g.label}>
                  {g.people.map((p) => {
                    i++;
                    const n = i;
                    return (
                      <li key={`${g.key}:${p.ref.kind === "cooptimizer" ? p.ref.id : p.ref.memberId}`} id={optionId(n)} role="option" aria-selected={n === active} className={`person-picker-option${n === active ? " active" : ""}`} onMouseEnter={() => setActive(n)} onClick={() => pick(p)}>
                        <Avatar name={p.name} photo={p.external ? null : photos.photoFor(p.email)} size={22} />
                        <span className="person-picker-name">{p.name}</span>
                        {p.external && <span className="ask-ext">External</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {value.who.trim() && <p className="person-picker-free muted">Enter keeps the highlighted person; Tab keeps “{value.who.trim()}” as a plain name.</p>}
          {!value.who.trim() && data?.groups.some((g) => g.key === "everyone" && g.people.length > EVERYONE_UNTYPED) && <p className="person-picker-free muted">Type to find anyone at Cooptimize.</p>}
          {data?.problems.map((p) => (
            <p key={p} className="person-picker-free muted">
              {p}
            </p>
          ))}
        </div>
      )}
    </span>
  );
}
