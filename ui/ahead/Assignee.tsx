// AH-1: choosing an assignee in Ahead: the PersonPicker's people (people.picker), limited to the Cooptimizers on that
// client (its Account Workers, cooptimizers() only), plus Me and Nobody. No free text: DevOps needs a real person.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PickerPerson } from "../../actions/people-picker.ts";
import type { Assignee } from "../../plan/ahead-edit.ts";
import { filterGroups, usePickerPeople } from "../PersonPicker.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";

type Choice = { key: string; label: string; value: Assignee; email: string | null };

export function AssigneePicker({ clientKey, me, current, onPick, onCancel }: { clientKey: string; me: string | null; current: Assignee; onPick: (a: Assignee) => void; onCancel: () => void }) {
  const data = usePickerPeople({ clientKey });
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const people: PickerPerson[] = useMemo(() => filterGroups(data ? { ...data, groups: data.groups.filter((g) => g.key === "client") } : null, text).flatMap((g) => g.people), [data, text]);
  const choices: Choice[] = useMemo(() => {
    const mine = me ? people.find((p) => p.email?.toLowerCase() === me.toLowerCase()) : undefined;
    const q = text.trim().toLowerCase();
    const extra: Choice[] = [];
    if (me && !mine && (!q || "me".startsWith(q))) extra.push({ key: "me", label: "Me", value: { email: me.toLowerCase(), name: "Me" }, email: me });
    if (!q || "nobody".startsWith(q)) extra.push({ key: "nobody", label: "Nobody", value: null, email: null });
    return [...extra, ...people.filter((p) => p.email).map((p) => ({ key: p.email!, label: p.email!.toLowerCase() === me?.toLowerCase() ? `${p.name} (me)` : p.name, value: { email: p.email!.toLowerCase(), name: p.name }, email: p.email }))];
  }, [people, me, text]);
  const photos = usePhotos({ emails: choices.flatMap((c) => (c.email ? [c.email] : [])).slice(0, 40) });
  useEffect(() => setActive(0), [text]);
  const pick = (c: Choice | undefined) => c && onPick(c.value);
  return (
    <span className="person-picker ah-assignee">
      <input
        ref={input}
        role="combobox"
        aria-label="Assigned to"
        aria-expanded={choices.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(choices[active] ? { "aria-activedescendant": `${listId}-${active}` } : {})}
        value={text}
        placeholder={current ? current.name : "Nobody"}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, Math.max(choices.length - 1, 0))));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter") (e.preventDefault(), pick(choices[active]));
          else if (e.key === "Escape") (e.preventDefault(), onCancel());
        }}
      />
      <div className="person-picker-pop" role="presentation" onMouseDown={(e) => e.preventDefault()}>
        <ul id={listId} role="listbox" aria-label="Choose who it's assigned to">
          {choices.map((c, i) => (
            <li key={c.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={`person-picker-option${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
              {c.key !== "nobody" && <Avatar name={c.label} photo={photos.photoFor(c.email)} size={22} />}
              <span className="person-picker-name">{c.label}</span>
            </li>
          ))}
        </ul>
        {!data && <p className="person-picker-free muted">Reading people…</p>}
        {data && !people.length && !text && <p className="person-picker-free muted">No Cooptimizers are listed on this client yet.</p>}
        {data?.problems.map((p) => (
          <p key={p} className="person-picker-free muted">
            {p}
          </p>
        ))}
      </div>
    </span>
  );
}
