// The command menu (Ctrl+K) and the "⋯" / right-click popup menus (step 6). Both render menu steps from
// ui/menu.ts: arrow keys move, Enter chooses, Backspace on an empty search or Left goes back, Esc closes.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { filterCommands, type MenuEnv, type MenuItem, type MenuStep } from "./menu.ts";
import { ITEM_ATTRS } from "./keys.ts";
import { useScopedTab } from "./scope.ts";

type Opener = (at: { x: number; y: number }, step: MenuStep) => void;
export type MenuApi = { env: MenuEnv | null; open: Opener };
export const MenuCtx = createContext<MenuApi>({ env: null, open: () => {} });

/** Props for anything with a menu: the "⋯" button opens it, and so does a right-click on the element. */
export function useMenu(build: (env: MenuEnv) => MenuStep) {
  const { env, open } = useContext(MenuCtx);
  const show = (e: ReactMouseEvent) => {
    if (!env) return;
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = e.type === "click";
    open(fromButton ? { x: r.right, y: r.bottom + 4 } : { x: e.clientX, y: e.clientY }, build(env));
  };
  return { onContextMenu: show, button: (label: string) => <MoreButton label={label} onClick={show} /> };
}

export function MoreButton({ label, onClick }: { label: string; onClick: (e: ReactMouseEvent) => void }) {
  const tabIndex = useScopedTab();
  return (
    <button
      type="button"
      className="more-btn"
      tabIndex={tabIndex}
      aria-label={label}
      aria-haspopup="menu"
      title={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      ⋯
    </button>
  );
}

/** Runs an item; true when the menu should close. */
async function choose(item: MenuItem, push: (s: MenuStep) => void): Promise<boolean> {
  if (item.disabled) return false;
  if (item.next) {
    push(item.next());
    return false;
  }
  await item.run?.();
  return true;
}

function StepView({ step, query, onDone, push, back, canBack, autoFocusList }: { step: MenuStep; query: string; onDone: () => void; push: (s: MenuStep) => void; back: () => void; canBack: boolean; autoFocusList: boolean }) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = "items" in step ? filterCommands(step.items, query) : [];
  useEffect(() => {
    setActive(Math.max(0, shown.findIndex((i) => !i.disabled)));
  }, [step, query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if ("prompt" in step) inputRef.current?.focus();
    else if (autoFocusList) listRef.current?.focus();
  }, [step, autoFocusList]);
  // Block bodies: an effect must return nothing or a cleanup (scrollIntoView returns a Promise in current Chromium).
  useEffect(() => {
    void listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if ("prompt" in step) {
    return (
      <form
        className="menu-prompt"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = inputRef.current?.value.trim();
          if (!v) return;
          await step.submit(v);
          onDone();
        }}
      >
        <label>
          <span>{step.prompt}</span>
          <input
            ref={inputRef}
            {...(step.input === "date" ? { type: "date", defaultValue: step.value ?? "", required: true } : { placeholder: step.placeholder ?? "", maxLength: 200 })}
            onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), canBack ? back() : onDone())}
          />
        </label>
        <button type="submit" className="mini primary">{step.button ?? "Add"}</button>
      </form>
    );
  }

  const keys = (e: KeyboardEvent) => {
    const move = (d: number) => {
      e.preventDefault();
      if (!shown.length) return;
      let i = active;
      for (let n = 0; n < shown.length; n++) {
        i = (i + d + shown.length) % shown.length;
        if (!shown[i]!.disabled) break;
      }
      setActive(i);
    };
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" || (e.key === "ArrowRight" && shown[active]?.next)) {
      e.preventDefault();
      const it = shown[active];
      if (it) void choose(it, push).then((close) => close && onDone());
    } else if (e.key === "ArrowLeft" && canBack) {
      e.preventDefault();
      back();
    }
  };

  let lastGroup: string | undefined;
  return (
    <ul ref={listRef} className="menu-list" role="menu" tabIndex={-1} onKeyDown={keys} data-keys>
      {shown.length === 0 && <li className="menu-empty">Nothing matches</li>}
      {shown.map((it, i) => {
        const heading = it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <li key={it.id} role="none">
            {heading && <div className="menu-group">{heading}</div>}
            <button
              type="button"
              role="menuitem"
              data-i={i}
              className={`menu-item${i === active ? " active" : ""}${it.danger ? " danger" : ""}${it.checked ? " checked" : ""}`}
              aria-disabled={!!it.disabled}
              title={it.disabled ?? ""}
              tabIndex={-1}
              onMouseEnter={() => !it.disabled && setActive(i)}
              onClick={() => void choose(it, push).then((close) => close && onDone())}
            >
              <span className="menu-label">
                {it.checked && <span aria-hidden="true">✓ </span>}
                {it.label}
                {it.disabled && <span className="menu-why"> · {it.disabled}</span>}
              </span>
              {it.hint && <span className="menu-hint">{it.hint.length <= 5 ? <kbd>{it.hint}</kbd> : it.hint}</span>}
              {it.next && <span className="menu-arrow" aria-hidden="true">›</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function useSteps(first: MenuStep) {
  const [stack, setStack] = useState<MenuStep[]>([first]);
  useEffect(() => {
    setStack([first]);
  }, [first]);
  return { step: stack[stack.length - 1]!, push: (s: MenuStep) => setStack((st) => [...st, s]), back: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), canBack: stack.length > 1 };
}

/** A popup menu at a point (the "⋯" button or a right-click). */
export function PopupMenu({ at, step: first, onClose }: { at: { x: number; y: number }; step: MenuStep; onClose: () => void }) {
  const { step, push, back, canBack } = useSteps(first);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A popover sits in the top layer, so it shows above the details dialog too.
    if (!el.matches(":popover-open")) el.showPopover?.();
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x - (at.x + r.width > innerWidth ? r.width : 0), innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) });
  }, [at, step]);
  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", away);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="popup-menu"
      popover="manual"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="menu-title">
        {canBack && (
          <button type="button" className="menu-back" onClick={back} aria-label="Back">
            ‹
          </button>
        )}
        <span>{step.title}</span>
      </div>
      <StepView step={step} query="" onDone={onClose} push={push} back={back} canBack={canBack} autoFocusList />
    </div>
  );
}

/** The command menu: search every command; commands that need a target ask for it in a next step. */
export function CommandMenu({ commands, onClose }: { commands: MenuItem[]; onClose: () => void }) {
  // Taken once when the menu opens, so a quiet reload behind it doesn't reset where you are.
  const [first] = useState<MenuStep>(() => ({ title: "Commands", items: commands }));
  const { step, push, back, canBack } = useSteps(first);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQuery("");
    if ("items" in step) input.current?.focus();
  }, [step]);
  const list = () => document.querySelector<HTMLElement>(".command-menu .menu-list");
  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="command-menu"
        role="dialog"
        aria-label="Command menu"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            if (canBack) back();
            else onClose();
          }
        }}
      >
        <div className="command-head">
          {canBack && (
            <button type="button" className="menu-back" onClick={back} aria-label="Back">
              ‹
            </button>
          )}
          {"items" in step ? (
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={canBack ? step.title : "Type a command or search…"}
              aria-label="Search commands"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                  // Hand the key to the list, which owns the active row.
                  e.preventDefault();
                  list()?.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true }));
                } else if (e.key === "Backspace" && !query && canBack) {
                  e.preventDefault();
                  back();
                }
              }}
            />
          ) : (
            <span className="command-step-title">{step.title}</span>
          )}
          <kbd className="command-esc">Esc</kbd>
        </div>
        <StepView step={step} query={query} onDone={onClose} push={push} back={back} canBack={canBack} autoFocusList={false} />
        <div className="command-foot muted">↑↓ move · Enter choose · Esc {canBack ? "back" : "close"}</div>
      </div>
    </div>
  );
}

export function MenuHost({ env, children }: { env: MenuEnv | null; children: ReactNode }) {
  const [popup, setPopup] = useState<{ at: { x: number; y: number }; step: MenuStep } | null>(null);
  const api = useMemo<MenuApi>(() => ({ env, open: (at, step) => setPopup({ at, step }) }), [env]);
  return (
    <MenuCtx.Provider value={api}>
      {children}
      {popup && <PopupMenu at={popup.at} step={popup.step} onClose={() => setPopup(null)} />}
    </MenuCtx.Provider>
  );
}

/** A list row with a menu: right-click anywhere on it, or the "⋯" button at its end. */
export function MenuRow({ build, label, className, title, item, children }: { build: (env: MenuEnv) => MenuStep; label: string; className?: string; title?: string; item?: { clientKey: string; url: string | null }; children: ReactNode }) {
  const m = useMenu(build);
  return (
    <li className={className} title={title} onContextMenu={m.onContextMenu} {...(item ? ITEM_ATTRS(item.clientKey, item.url) : {})}>
      {children}
      {m.button(label)}
    </li>
  );
}
