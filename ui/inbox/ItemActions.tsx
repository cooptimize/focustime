// IB-1 slice 2, IB-4: one set of actions per open row in Promises and Captures (the row open in place, the phone's
// sheet, the keys). `actsFor` decides them from the item's state; the primary follows that state: Close the loop for a
// late promise, Create DevOps item for one with no item, Mark done once its item finished, Sort for a capture. From
// chats has its own actions (ui/inbox/Suggestion.tsx). The keys run the same Act as its button.
import { useState, type ReactNode } from "react";
import type { Entry } from "./data.ts";
import { Icon } from "../icons.tsx";

export type FormId = "close" | "due" | "who" | "link" | "draft" | "sort" | "edit";
export type ActId = "create" | "close" | "due" | "who" | "week" | "not_needed" | "done" | "link" | "unlink" | "reopen" | "teams" | "sort" | "dismiss" | "edit" | "delete" | "prepare";

/** One action: its words, its key (shown on the button, run by the same key), and whether it's the one primary. */
export type Act = { id: ActId; label: string; key?: string; primary?: boolean; more?: boolean; href?: string; run: () => void };

/** What an action needs to do its work: run a server action (with a notice and an optional undo), open a form, go somewhere. */
export type ActEnv = {
  run: (action: string, input: Record<string, unknown>, notice: string, undo?: { action: string; input: Record<string, unknown> }) => Promise<void>;
  form: (f: FormId) => void;
  createDraft: (draftId: number) => void;
  editDraft: (draftId: number) => void;
  planWeek: () => void;
  today: string;
};

/** IB-4: the keys, in the order the key help lists them. C, L and X answer on From chats; D on Promises. */
export const ITEM_KEYS: readonly { key: string; does: string }[] = [
  { key: "J", does: "Next row" },
  { key: "K", does: "Previous row" },
  { key: "Enter", does: "Open or close the row" },
  { key: "C", does: "From chats: Create item" },
  { key: "L", does: "From chats: Already covered (link it)" },
  { key: "X", does: "From chats: Dismiss" },
  { key: "D", does: "Promises: Done" },
];
const act = (id: ActId, label: string, run: () => void, o: Partial<Act> = {}): Act => ({ id, label, run, ...(id === "done" ? { key: "D" } : {}), ...o });

/** The actions for one item, primary first. Empty while its source is still loading. */
export function actsFor(e: Entry, env: ActEnv): Act[] {
  const out: Act[] = [];
  switch (e.kind) {
    case "chatPromise": {
      const p = e.promise;
      if (!p) return [];
      const closed = p.state === "done" || p.state === "not_needed";
      const undo = { action: "my_promises.reopen", input: { id: p.id } };
      if (closed) return [act("reopen", "Open again", () => void env.run("my_promises.reopen", { id: p.id }, "Open again"), { primary: true })];
      const late = e.row.late;
      const create = act("create", "Create DevOps item", () => env.form("draft"));
      const close = act("close", "Close the loop", () => env.form("close"));
      const markDone = act("done", "Mark done", () => void env.run("my_promises.done", { id: p.id }, "Done", undo));
      // The primary follows state: late → Close the loop; no item → Create DevOps item; its item closed → Mark done.
      const first = late ? close : !p.item ? create : p.item.closed ? markDone : close;
      out.push({ ...first, primary: true });
      for (const a of [close, create].filter((a) => a !== first && (a !== create || !p.item))) out.push(a);
      out.push(act("due", "Due", () => env.form("due")));
      out.push(act("who", "Who", () => env.form("who")));
      const onToday = !!p.onToday && p.onToday === env.today;
      out.push(onToday
        ? act("week", "Take off my day", () => void env.run("my_promises.today", { id: p.id, on: false }, "Off your day"))
        : act("week", "Add to my week", () => void env.run("my_promises.today", { id: p.id, on: true }, "On today", { action: "my_promises.today", input: { id: p.id, on: false } })));
      if (first !== markDone) out.push(act("done", "Done", () => void env.run("my_promises.done", { id: p.id }, "Done", undo)));
      out.push(act("not_needed", "Not needed", () => void env.run("my_promises.not_needed", { id: p.id }, "Not needed", undo)));
      if (!p.item) out.push(act("link", "Link to item", () => env.form("link"), { more: true }));
      else out.push(act("unlink", `Unlink #${p.item.id}`, () => void env.run("my_promises.unlink", { id: p.id }, "Unlinked"), { more: true }));
      if (p.link) out.push(act("teams", "Open in Teams", () => {}, { href: p.link, more: true }));
      return out;
    }
    case "followUp": {
      const f = e.followUp;
      if (!f) return [];
      if (f.closedAt) return [];
      out.push(act("close", "Close the loop", () => env.form("close"), { primary: true }));
      out.push(act("due", "Due", () => env.form("due")));
      out.push(act("who", "Who", () => env.form("who")));
      out.push(act("week", "Add to my week", env.planWeek));
      out.push(act("done", "Done", () => void env.run("followup.close", { id: f.id, note: null }, "Done")));
      out.push(act("not_needed", "Not needed", () => void env.run("followup.not_needed", { id: f.id }, "Closed as not needed")));
      out.push(act("edit", "Edit…", () => env.form("edit"), { more: true }));
      if (f.byHand) out.push(act("delete", "Delete", () => void env.run("followup.delete", { id: f.id }, "Deleted"), { more: true }));
      return out;
    }
    case "send":
      // Accept, Accept and schedule, Pass to… and Can't this week are the send's own row (SW-1's).
      return [];
    case "capture": {
      const c = e.capture;
      if (!c) return [];
      return [act("sort", "Sort", () => env.form("sort"), { primary: true }), act("delete", "Delete", () => void env.run("capture.route", { id: c.id, as: "dismissed" }, "Deleted"))];
    }
    case "draft": {
      const d = e.draft;
      if (!d) return [];
      return [
        act("create", "Create in DevOps", () => env.createDraft(d.id), { primary: true }),
        act("edit", "Edit draft", () => env.editDraft(d.id)),
        // CP-1, UI-7: one more AI request for its DevOps version, once a prepare ran (the server says when it can't now).
        ...(d.ai && d.ai.state !== "writing" ? [act("prepare", "Prepare again", () => void env.run("draft.prepare", { id: d.id, again: true }, "Prepared again"), { more: true })] : []),
        act("delete", "Delete draft", () => void env.run("draft.remove", { id: d.id }, "Draft deleted"), { more: true }),
      ];
    }
  }
}

/** The action bar: the primary (big on the phone), the rest as buttons, the quieter ones under ⋯. */
export function ItemActions({ acts, phone = false, label }: { acts: readonly Act[]; phone?: boolean; label: string }): ReactNode {
  const [menu, setMenu] = useState(false);
  if (!acts.length) return null;
  const shown = acts.filter((a) => !a.more);
  const more = acts.filter((a) => a.more);
  const button = (a: Act) =>
    a.href ? (
      <a key={a.id} className="ib-act" href={a.href} target="_blank" rel="noopener noreferrer">
        {a.label}
      </a>
    ) : (
      <button key={a.id} type="button" className={`ib-act${a.primary ? " primary" : ""}`} data-act={a.id} onClick={a.run} aria-keyshortcuts={a.key}>
        {a.label}
        {a.key && !phone && <kbd>{a.key}</kbd>}
      </button>
    );
  return (
    <div className={`ib-acts${phone ? " phone" : ""}`} role="group" aria-label={`Actions for ${label}`}>
      {shown.map(button)}
      {more.length > 0 && (
        <span className="fu-more">
          <button type="button" className="ib-act quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for ${label}`} onClick={() => setMenu((v) => !v)}>
            <Icon name="more" />
          </button>
          {menu && (
            <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
              {more.map((a, i) =>
                a.href ? (
                  <a key={a.id} role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>
                    {a.label}
                  </a>
                ) : (
                  <button key={a.id} type="button" role="menuitem" autoFocus={i === 0} data-act={a.id} onClick={() => (setMenu(false), a.run())}>
                    {a.label}
                    {a.key && <kbd>{a.key}</kbd>}
                  </button>
                ),
              )}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
