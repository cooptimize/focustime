// The shared work item lookup (step 15.2): one control wherever a DevOps item is named (flex session, follow-up,
// Ask to collaborate). It searches the chosen client's loaded items by title or #id, this week's priorities and my
// assigned items first. Enter on a highlighted result links it; Enter otherwise keeps the plain text. A linked item
// shows its title and link. Changing the client clears the link; with no client it is disabled, with a hint.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { lookupItems, parseItemRef } from "../plan/lookup.ts";
import type { WorkItem } from "../week/types.ts";
import { DevOpsWork } from "./work.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { Icon } from "./icons.tsx";

/** This week's plan items (client and id), so the lookup can rank them first. App provides it. */
export const WeekItems = createContext<readonly { clientKey: string; itemId: number }[]>([]);

export type ItemValue = { itemId: number | null; title: string | null; url: string | null; text: string };
export const NO_ITEM: ItemValue = { itemId: null, title: null, url: null, text: "" };

/** Step 15.3: features or epics (from capture.features) as a lookup pool, for a draft's parent. */
export function parentPool(choices: readonly { id: number; title: string; state: string; type?: string; url?: string }[] | undefined, tier: "feature" | "epic"): { items: WorkItem[]; children: WorkItem[] } | undefined {
  if (!choices) return undefined;
  const items = choices.map((c): WorkItem => ({ id: c.id, title: c.title, type: c.type ?? "", state: c.state, stateCategory: "Unknown", level: "portfolio", tier, order: null, parentId: null, changedAt: "", url: c.url ?? "" }));
  return { items, children: [] };
}

export function ItemLookup({ clientKey, value, onChange, label = "Work item", name, pool, placeholder, autoFocus, onEnterText, only }: { clientKey: string | null; value: ItemValue; onChange: (v: ItemValue) => void; label?: string; name?: string; /** Step 15.3: search these instead of the client's loaded work items (a draft's parent). */ pool?: { items: readonly WorkItem[]; children: readonly WorkItem[] } | undefined; placeholder?: string | undefined; autoFocus?: boolean; /** Step 15.3: Enter on text that links nothing (the intention box adds it as plain text). */ onEnterText?: (text: string, how: { shift: boolean }) => void; /** Only offer these (the intention box: pickable items). */ only?: (i: WorkItem) => boolean }) {
  const work = useContext(DevOpsWork);
  const week = useContext(WeekItems);
  const cw = pool ?? (clientKey ? work.get(clientKey) : undefined);
  const priorities = useMemo(() => {
    const ids = new Set(week.filter((w) => w.clientKey === clientKey).map((w) => w.itemId));
    for (const c of cw?.children ?? []) if (c.parentId !== null && ids.has(c.parentId)) ids.add(c.id);
    return ids;
  }, [week, clientKey, cw]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const searched = useMemo(() => {
    if (!only || !cw) return cw;
    const c = cw as { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[] };
    return { items: c.items.filter(only), children: c.children.filter(only), committed: (c.committed ?? []).filter(only) };
  }, [cw, only]);
  const results = useMemo(() => (open ? lookupItems(value.text, searched, priorities) : []), [open, value.text, searched, priorities]);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Changing the client clears the link (an item belongs to one client).
  // (By the previous client, not a first-render flag: React's dev double effects would clear a starting link.)
  const prevClient = useRef(clientKey);
  useEffect(() => {
    if (prevClient.current === clientKey) return;
    prevClient.current = clientKey;
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
    } else if (e.key === "Enter" && (open || onEnterText)) {
      e.preventDefault();
      const hit = open && !e.shiftKey ? (results[active] ?? (parseItemRef(value.text) !== null ? results.find((r) => r.id === parseItemRef(value.text)) : undefined)) : undefined;
      if (hit) link(hit);
      else {
        setOpen(false); // Enter keeps the plain text.
        if (onEnterText && value.text.trim()) onEnterText(value.text.trim(), { shift: e.shiftKey });
      }
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
        {clientKey && value.url && value.url.startsWith("https://dev.azure.com/") ? <WorkLink clientKey={clientKey} url={value.url}>{value.title ?? `Item ${value.itemId}`}</WorkLink> : <span>{value.title ?? `Item ${value.itemId}`}</span>}
        <button type="button" className="mini quiet icon-btn small" onClick={() => (onChange({ ...NO_ITEM }), setTimeout(() => input.current?.focus(), 0))} aria-label={`Unlink #${value.itemId}`} title="Unlink, or choose another">
          <Icon name="close" />
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
        autoFocus={autoFocus}
        placeholder={disabled ? "Choose a client first" : (placeholder ?? (cw ? "Search by title or #id" : "Type it (DevOps isn't loaded for this client)"))}
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
                <TypeIcon clientKey={clientKey} type={r.type} /> {r.title} <span className="muted">#{r.id}</span>
                {priorities.has(r.id) && <span className="item-lookup-tag">this week</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
