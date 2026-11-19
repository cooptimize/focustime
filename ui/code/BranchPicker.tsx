// RB-7: the branch picker beside a repo's name, drawn as Code's client picker (its button, list and options, by their own
// class names so a test's or a style's client picker never finds this one): the branch on
// screen on the button; the list asked for only when it first opens (code.branches, branch heads only), the opening
// branch first and marked, then the default when it differs and marked, then the rest by name; over 20 branches a
// box to find one by typing. A long name is cut in the middle with the whole name on hover. Choosing one hands the
// name back; the page puts it in the address. Nothing of it is kept anywhere but this page's memory.
import { useEffect, useMemo, useRef, useState } from "react";
import { call, ActionRefusal } from "../api.ts";
import { Icon } from "../icons.tsx";
import { BRANCH_FIND_AFTER, BRANCH_TEXT, middleCut } from "../../plan/code-branch.ts";

export type BranchList = { names: string[]; opening: string | null; default: string | null; cut: boolean };
type ListState = "loading" | BranchList | { message: string };

/** The branch lists read while Code is open, per client and repo (never stored). */
export const branchLists = new Map<string, BranchList>();

export function BranchPicker({ clientKey, repoId, current, onPick }: { clientKey: string; repoId: string; /** The branch on screen, or null before the first read says. */ current: string | null; onPick: (name: string) => void }) {
  const key = `${clientKey}\u0000${repoId}`;
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState | null>(() => branchLists.get(key) ?? null);
  const [find, setFind] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => (setList(branchLists.get(key) ?? null), setFind("")), [key]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (!open || (list && list !== "loading" && !("message" in list))) return;
    if (list === "loading") return;
    let live = true;
    setList("loading");
    call<BranchList>("code.branches", { clientKey, repoId }).then(
      (r) => {
        branchLists.set(key, r);
        if (live) setList(r);
      },
      (e) => live && setList({ message: e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong. Try again in a moment." }),
    );
    return () => void (live = false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>("[data-code-branch-find], [aria-selected='true'], [data-code-branch-opt]")?.focus());
  }, [open, list]);
  const ok = list && list !== "loading" && !("message" in list) ? list : null;
  const shown = useMemo(() => {
    if (!ok) return [];
    const f = find.trim().toLowerCase();
    return f ? ok.names.filter((n) => n.toLowerCase().includes(f)) : ok.names;
  }, [ok, find]);
  const pick = (n: string) => {
    setOpen(false);
    setFind("");
    wrap.current?.querySelector<HTMLElement>(".cv-branch-btn")?.focus();
    if (n !== current) onPick(n);
  };
  const move = (by: number) => {
    const opts = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-code-branch-opt]") ?? [])];
    const at = opts.indexOf(document.activeElement as HTMLElement);
    opts[Math.max(0, Math.min(opts.length - 1, at < 0 ? 0 : at + by))]?.focus();
  };
  return (
    <div
      className="cv-branch"
      ref={wrap}
      data-menu={open ? "" : undefined}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          wrap.current?.querySelector<HTMLElement>(".cv-branch-btn")?.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          move(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <button type="button" className="cv-branch-btn" data-code-branch-btn={current ?? ""} aria-haspopup="listbox" aria-expanded={open} aria-label={BRANCH_TEXT.label(current ?? "…")} title={current ?? undefined} onClick={() => setOpen((v) => !v)}>
        <Icon name="branch" className="cv-kind" />
        <span>{current ? middleCut(current) : "…"}</span>
        <span className="cv-branch-caret" aria-hidden="true">
          <Icon name="open" />
        </span>
      </button>
      {open && (
        <div className="cv-branch-pop" data-code-branch-pop="">
          {list === "loading" || list === null ? (
            <p className="cv-note" role="status">Loading…</p>
          ) : "message" in list ? (
            <p className="cv-note problem" role="alert">{list.message}</p>
          ) : (
            <>
              {list.names.length > BRANCH_FIND_AFTER && (
                <input
                  type="search"
                  className="cv-find-input cv-branch-find"
                  data-code-branch-find=""
                  aria-label={BRANCH_TEXT.find}
                  placeholder={BRANCH_TEXT.find}
                  autoComplete="off"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && shown[0] && (e.preventDefault(), pick(shown[0]))}
                />
              )}
              <div className="cv-branch-list" role="listbox" aria-label="Branches">
                {shown.map((n) => (
                  <button key={n} type="button" role="option" aria-selected={n === current} className="cv-branch-opt" data-code-branch-opt={n} title={n} onClick={() => pick(n)}>
                    <span className="cv-branch-name">{middleCut(n)}</span>
                    {n === list.opening && <span className="cv-branch-mark">{BRANCH_TEXT.opening}</span>}
                    {n === list.default && n !== list.opening && <span className="cv-branch-mark">{BRANCH_TEXT.default}</span>}
                  </button>
                ))}
              </div>
              {!shown.length && <p className="cv-note">{BRANCH_TEXT.noMatch}</p>}
              {list.cut && <p className="cv-note">{BRANCH_TEXT.cut(list.names.length)}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
