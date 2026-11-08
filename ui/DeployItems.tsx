// DP-2: what a deployment moves. The checkboxes (Quick capture, and Deployment details on any to-do), the summary chip
// on a row, and the data platform and list editor for admins and a client's leads. The lists come from the server
// (`deploy.items`), never from here.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call } from "./api.ts";
import { placePopover } from "./popover-place.ts";
import type { DeployItemsView } from "../actions/deploy-item-actions.ts";
import type { DataPlatform } from "../config/deploy-catalog.ts";
import { defaultKeys, itemsSummary, ownKey, switchTicks, toRows, type DeployItem, type ItemGroup, type ListItem } from "../plan/deploy-items.ts";
import type { Pick } from "../plan/types.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/**
 * The "What's going" checkboxes. New deployment (`existing` undefined): the client's defaults, and a client switch swaps
 * the list (`switchTicks`). A planned one: exactly what it has, and items since taken off the list stay listed so
 * editing never loses a tick. `name` adds a hidden field with the keys as JSON, for a plain form.
 */
export function DeployChecks({ clientKey, clientName, existing, onChange, name, onLeave }: { clientKey: string | null; clientName: string; existing?: readonly DeployItem[] | null; onChange?: (keys: string[] | null) => void; name?: string; /** Following the settings link: close what's open. */ onLeave?: () => void }) {
  const [view, setView] = useState<DeployItemsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<DeployItem[]>([]);
  const prev = useRef<{ groups: ItemGroup[]; manual: Set<string> } | null>(null);
  const manualNow = useRef(manual);
  manualNow.current = manual;
  useEffect(() => {
    setFailed(false);
    if (!clientKey) return setView(null);
    let live = true;
    call<DeployItemsView>("deploy.items", { clientKey }).then(
      (v) => {
        if (!live) return;
        setView(v);
        if (existing !== undefined) {
          const had = existing ?? [];
          const listed = v.groups.flatMap((g) => g.items);
          const key = (d: DeployItem) => listed.find((i) => i.key === d.key)?.key ?? listed.find((i) => i.name.toLowerCase() === d.name.toLowerCase())?.key ?? null;
          setExtra(had.filter((d) => key(d) === null));
          setTicked(new Set(had.map((d) => key(d) ?? d.key)));
        } else {
          const before = prev.current;
          const next = before ? switchTicks(before.groups, manualNow.current, v.groups) : { ticked: defaultKeys(v.groups), manual: [] };
          setTicked(new Set(next.ticked));
          setManual(new Set(next.manual));
        }
        prev.current = { groups: v.groups, manual: manualNow.current };
      },
      () => live && (setFailed(true), setView(null)),
    );
    return () => {
      live = false;
    };
    // `existing` is read once per client: the form it sits in doesn't change it while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);
  const keys = view ? [...ticked] : null;
  const keysKey = keys ? JSON.stringify(keys) : "";
  useEffect(() => onChange?.(keys), [keysKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string, on: boolean) => {
    setTicked((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
    setManual((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  };
  const box = (i: { key: string; name: string }) => (
    <label key={i.key} className="dep-check">
      <input type="checkbox" checked={ticked.has(i.key)} onChange={(e) => toggle(i.key, e.target.checked)} /> {i.name}
    </label>
  );
  const both = (view?.groups.length ?? 0) > 1;
  return (
    <fieldset className="dep-items" aria-label="What's going">
      <legend>What's going</legend>
      {name && <input type="hidden" name={name} value={keysKey} />}
      {!clientKey && <p className="muted">Choose a client to see its list</p>}
      {failed && <p className="muted">The list didn't load. The client's defaults are used when you save.</p>}
      {view?.groups.map((g) => (
        <div key={g.platform} className="dep-group" role="group" aria-label={g.label}>
          {both && <span className="dep-group-label">{g.label}</span>}
          <div className="dep-checks">{g.items.map(box)}</div>
        </div>
      ))}
      {extra.length > 0 && (
        <div className="dep-group" role="group" aria-label="No longer on the list">
          <span className="dep-group-label">No longer on the list</span>
          <div className="dep-checks">{extra.map(box)}</div>
        </div>
      )}
      {view && !view.platform && view.editHref && (
        <a className="link-btn dep-set-platform" href={view.editHref} onClick={() => onLeave?.()}>
          Set {clientName}'s data platform
        </a>
      )}
    </fieldset>
  );
}

/** A Deployment's "4 items" on a row: the full list and its Note on hover, or on a tap. */
export function DeployItemsChip({ pick }: { pick: Pick }) {
  const items = pick.deployItems ?? [];
  const label = itemsSummary(items) ?? (pick.notes?.trim() ? "Note" : null);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el || !btn.current) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    setPos(placePopover(btn.current.getBoundingClientRect(), { width: el.offsetWidth, height: el.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("mousedown", away, true);
    window.addEventListener("touchstart", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("touchstart", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  if (!label) return null;
  const note = pick.notes?.trim() ?? "";
  const words = [items.map((i) => i.name).join(", "), note].filter(Boolean).join(" · ");
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className="deploy-items-wrap" onClick={stop} onDoubleClick={stop} onKeyDown={stop}>
      <button ref={btn} type="button" className="deploy-items-chip" title={words} aria-haspopup="dialog" aria-expanded={open} aria-label={`What's going: ${words}`} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div ref={pop} className="deploy-items-pop" role="dialog" aria-label="What's going" popover="manual" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
          {items.length > 0 && <ul>{items.map((i) => <li key={i.key}>{i.name}</li>)}</ul>}
          {note && <p>{note}</p>}
        </div>
      )}
    </span>
  );
}

type Status = { busy: boolean; note: string | null; error: string | null };

/**
 * A client's data platform and its list, for an admin or that client's lead (nothing shows for anyone else). Every
 * change saves at once. The lists are the client's only: only new deployments follow.
 */
export function DeploySettings({ clientKey, clientName }: { clientKey: string; clientName: string }) {
  const [view, setView] = useState<DeployItemsView | null>(null);
  const [status, setStatus] = useState<Status>({ busy: false, note: null, error: null });
  const [adding, setAdding] = useState<Partial<Record<DataPlatform, string>>>({});
  useEffect(() => {
    let live = true;
    call<DeployItemsView>("deploy.items", { clientKey }).then((v) => live && setView(v), () => live && setView(null));
    return () => {
      live = false;
    };
  }, [clientKey]);
  const anchor = useRef<HTMLDivElement>(null);
  const ready = !!view?.canEdit;
  // "Set <client>'s data platform" lands on this client's section of a long page.
  useEffect(() => {
    if (ready && decodeURIComponent(location.hash).endsWith(`/deploy-${clientKey}`)) anchor.current?.scrollIntoView({ block: "start" });
  }, [ready, clientKey]);
  if (!view?.canEdit || !view.lists) return null;
  const save = async (input: Record<string, unknown>) => {
    setStatus({ busy: true, note: null, error: null });
    try {
      setView(await call<DeployItemsView>("deploy.config_save", { clientKey, ...input }));
      setStatus({ busy: false, note: "Saved. New deployments follow; ones already planned stay as they are.", error: null });
      return true;
    } catch (e) {
      setStatus({ busy: false, note: null, error: message(e) });
      return false;
    }
  };
  // Shown at once; the server's answer replaces it (and a refusal puts the saved list back).
  const saveList = (p: DataPlatform, items: ListItem[]) => {
    setView((v) => (v?.lists ? { ...v, lists: v.lists.map((l) => (l.platform === p ? { ...l, items } : l)) } : v));
    void save({ items: { [p]: toRows(items) } }).then((ok) => {
      if (!ok) void call<DeployItemsView>("deploy.items", { clientKey }).then(setView, () => undefined);
    });
  };
  const lists = view.lists.filter((l) => !view.platform || l.platform === view.platform);
  const swap = (p: DataPlatform, items: ListItem[], i: number, by: number) => {
    const n = [...items];
    [n[i], n[i + by]] = [n[i + by]!, n[i]!];
    saveList(p, n);
  };
  const add = (p: DataPlatform, items: ListItem[]) => {
    const name = (adding[p] ?? "").trim();
    if (!name) return;
    setAdding({ ...adding, [p]: "" });
    saveList(p, [...items, { key: ownKey(name, items.map((i) => i.key)), name, on: false, hidden: false, own: true }]);
  };
  return (
    <div className="set-form dep-settings" ref={anchor} id={`deploy-${clientKey}`}>
      <div className="set-field">
        <span className="set-label">Data platform</span>
        <span className="set-value">
          <span className="seg dep-platform" role="radiogroup" aria-label={`${clientName}: data platform`}>
            {([[null, "Not set"], ["fabric", "Fabric"], ["azure", "Azure"]] as const).map(([p, label]) => (
              <button key={label} type="button" role="radio" className={`seg-btn${view.platform === p ? " on" : ""}`} aria-checked={view.platform === p} disabled={status.busy} onClick={() => void save({ platform: p })}>
                {label}
              </button>
            ))}
          </span>
        </span>
        <span className="set-hint">Which list a deployment for this client offers. Not set shows both, with nothing ticked.</span>
      </div>
      <div className="set-field">
        <span className="set-label">Deployment items</span>
        <span className="set-hint">Add this client's own, hide ones it doesn't use, reorder, and choose what's ticked by default. Only new deployments follow.</span>
      </div>
      {lists.map((l) => (
        <div key={l.platform} className="dep-list" role="group" aria-label={`${clientName}: ${l.label} items`}>
          {lists.length > 1 && <h4>{l.label}</h4>}
          <ul>
            {l.items.map((it, i) => {
              const set = (patch: Partial<ListItem>) => saveList(l.platform, l.items.map((x) => (x.key === it.key ? { ...x, ...patch } : x)));
              return (
                <li key={it.key} className={it.hidden ? "hidden-item" : undefined}>
                  <span className="dep-move">
                    <button type="button" className="mini quiet" aria-label={`Move ${it.name} up`} disabled={i === 0 || status.busy} onClick={() => swap(l.platform, l.items, i, -1)}>↑</button>
                    <button type="button" className="mini quiet" aria-label={`Move ${it.name} down`} disabled={i === l.items.length - 1 || status.busy} onClick={() => swap(l.platform, l.items, i, 1)}>↓</button>
                  </span>
                  <span className="dep-name">
                    {it.name}
                    {it.hidden && <span className="muted"> · hidden</span>}
                  </span>
                  <label className="dep-on">
                    <input type="checkbox" checked={it.on} disabled={status.busy} aria-label={`${it.name}: ticked by default`} onChange={(e) => set({ on: e.target.checked })} /> Default
                  </label>
                  <button type="button" className="mini quiet" disabled={status.busy} onClick={() => (it.own && !it.hidden ? saveList(l.platform, l.items.filter((x) => x.key !== it.key)) : set({ hidden: !it.hidden }))}>
                    {it.own && !it.hidden ? "Remove" : it.hidden ? "Show" : "Hide"}
                  </button>
                </li>
              );
            })}
          </ul>
          <span className="dep-add">
            <input aria-label={`Add a ${l.label} item for ${clientName}`} placeholder="Add an item" maxLength={60} value={adding[l.platform] ?? ""} onChange={(e) => setAdding({ ...adding, [l.platform]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add(l.platform, l.items))} />
            <button type="button" className="mini" disabled={status.busy || !(adding[l.platform] ?? "").trim()} onClick={() => add(l.platform, l.items)}>Add</button>
          </span>
        </div>
      ))}
      {status.note && <p className="muted" role="status">{status.note}</p>}
      {status.error && <p className="set-problem" role="alert">{status.error}</p>}
    </div>
  );
}
