// The shared work item lookup (step 15.2): one control wherever a DevOps item is named (flex session, follow-up,
// Needs help from…). It searches the chosen client's loaded items by title or #id, this week's priorities and my
// assigned items first. Enter on a highlighted result links it; Enter otherwise keeps the plain text. A linked item
// shows its title and link. Changing the client clears the link; with no client it is disabled, with a hint.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { lookupItems, parseItemRef } from "../plan/lookup.ts";
import type { WorkItem } from "../week/types.ts";
import { DevOpsWork, typeTag } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";

/** This week's plan items (client and id), so the lookup can rank them first. App provides it. */
export const WeekItems = createContext<readonly { clientKey: string; itemId: number }[]>([]);

export type ItemValue = { itemId: number | null; title: string | null; url: string | null; text: string };
export const NO_ITEM: ItemValue = { itemId: null, title: null, url: null, text: "" };

export function ItemLookup({ clientKey, value, onChange, label = "Work item", name }: { clientKey: string | null; value: ItemValue; onChange: (v: ItemValue) => void; label?: string; name?: string }) {
  const work = useContext(DevOpsWork);
  const week = useContext(WeekItems);
  const cw = clientKey ? work.get(clientKey) : undefined;
  const priorities = useMemo(() => {
    const ids = new Set(week.filter((w) => w.clientKey === clientKey).map((w) => w.itemId));
    for (const c of cw?.children ?? []) if (c.parentId !== null && ids.has(c.parentId)) ids.add(c.id);
    return ids;
  }, [week, clientKey, cw]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = useMemo(() => (open ? lookupItems(value.text, cw, priorities) : []), [open, value.text, cw, priorities]);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Changing the client clears the link (an item belongs to one client).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (value.itemId !== null) onChange({ ...NO_ITEM });
  }, [clientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = (i: WorkItem) => {
    onChange({ itemId: i.id, title: i.title, url: i.url, text: "" });
    setOpen(false);
    setActive(-1);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % results.length : (a - 1 + results.length) % results.length));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const hit = results[active] ?? (parseItemRef(value.text) !== null ? results.find((r) => r.id === parseItemRef(value.text)) : undefined);
      if (hit) link(hit);
      else setOpen(false); // Enter keeps the plain text.
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  if (value.itemId !== null)
    return (
      <span className="item-lookup linked">
        {name && <input type="hidden" name={name} value={value.itemId} />}
        <span className="pr-type">#{value.itemId}</span>
        {clientKey && value.url ? <WorkLink clientKey={clientKey} url={value.url}>{value.title ?? `Item ${value.itemId}`}</WorkLink> : <span>{value.title ?? `Item ${value.itemId}`}</span>}
        <button type="button" className="mini quiet" onClick={() => (onChange({ ...NO_ITEM }), setTimeout(() => input.current?.focus(), 0))} aria-label={`Unlink #${value.itemId}`} title="Unlink, or choose another">
          ×
        </button>
      </span>
    );
  const disabled = !clientKey;
  return (
    <span className="item-lookup">
      {name && <input type="hidden" name={name} value="" />}
      <input
        ref={input}
        value={value.text}
        disabled={disabled}
        onChange={(e) => (onChange({ ...NO_ITEM, text: e.target.value }), setOpen(true), setActive(-1))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        placeholder={disabled ? "Choose a client first" : cw ? "Search by title or #id" : "Type it (DevOps isn't loaded for this client)"}
        aria-label={label}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        maxLength={200}
        title={disabled ? "Choose a client first, then search its DevOps items" : undefined}
      />
      {open && results.length > 0 && (
        <ul className="item-lookup-list" id={listId} role="listbox" aria-label={`${label} results`}>
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => link(r)}>
                <span className="pr-type">{typeTag(r.type)}</span> {r.title} <span className="muted">#{r.id}</span>
                {priorities.has(r.id) && <span className="item-lookup-tag">this week</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
