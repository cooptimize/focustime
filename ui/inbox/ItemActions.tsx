// IB-1 slice 2: one set of actions per Inbox item, wherever it shows (the detail pane, the phone's item sheet, the
// keys). `actsFor` decides them from the item's state; the primary follows that state: Create DevOps item for a work
// request or a promise with no item, Close the loop for a late promise, nothing pushy for chatter. The keys run the
// same Act as its button (J and K move and Enter opens in InboxPage; C, L, F, W, H, N and E here).
import { useState, type ReactNode } from "react";
import { PRIMARY_WORD } from "../Conversations.tsx";
import type { Entry } from "./data.ts";

export type FormId = "close" | "due" | "who" | "link" | "draft" | "not_request" | "sort" | "edit" | "merge";
export type ActId =
  | "create" | "close" | "due" | "who" | "week" | "hide" | "not_needed" | "done" | "link" | "unlink" | "resolve" | "take_over" | "reopen"
  | "teams" | "not_request" | "sort" | "dismiss" | "edit" | "delete" | "merge" | "prepare";

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
  /** Whether the open conversation has another open one in its chat to merge into. */
  canMerge?: boolean;
};

/** The keys, in the order the key help lists them. */
export const ITEM_KEYS: readonly { key: string; act: ActId | "next" | "prev" | "open"; does: string }[] = [
  { key: "J", act: "next", does: "Next item" },
  { key: "K", act: "prev", does: "Previous item" },
  { key: "Enter", act: "open", does: "Open the item" },
  { key: "C", act: "create", does: "Create DevOps item" },
  { key: "L", act: "close", does: "Close the loop" },
  { key: "F", act: "due", does: "Change the due day" },
  { key: "W", act: "week", does: "Put it on my week" },
  { key: "H", act: "hide", does: "Hide it for me" },
  { key: "N", act: "not_needed", does: "Not needed" },
  { key: "E", act: "done", does: "Done" },
];
const KEY_OF: Partial<Record<ActId, string>> = Object.fromEntries(ITEM_KEYS.filter((k) => k.key.length === 1).map((k) => [k.act, k.key]));
const act = (id: ActId, label: string, run: () => void, o: Partial<Act> = {}): Act => ({ id, label, run, ...(KEY_OF[id] ? { key: KEY_OF[id] } : {}), ...o });

/** The actions for one item, primary first. Empty while its source is still loading. */
export function actsFor(e: Entry, env: ActEnv): Act[] {
  const out: Act[] = [];
  const hide = (id: string) => act("hide", "Hide for me", () => void env.run("inbox.hide", { key: id, hidden: true }, "Hidden for you", { action: "inbox.hide", input: { key: id, hidden: false } }), { more: true });
  switch (e.kind) {
    case "conversation": {
      const c = e.card;
      if (!c) return [];
      const open = !c.closed;
      const resolve = () => void env.run("conversations.resolve", { id: c.id }, "Resolved for everyone on the chat", { action: "conversations.reopen", input: { id: c.id } });
      const primary: Act | null =
        c.primary === "create" ? act("create", PRIMARY_WORD.create, () => env.form("draft"), { primary: true })
        : c.primary === "link" ? act("link", PRIMARY_WORD.link, () => env.form("link"), { primary: true })
        : c.primary === "resolve" || c.primary === "mark_done" ? act("done", PRIMARY_WORD[c.primary], resolve, { primary: true })
        : c.primary === "reopen" ? act("reopen", PRIMARY_WORD.reopen, () => void env.run("conversations.reopen", { id: c.id }, "Open again"), { primary: true })
        : c.primary === "take_over" ? (() => {
            const k = c.commitments.find((x) => x.state === "open" && x.impliesItem && !x.mine);
            return k ? act("take_over", PRIMARY_WORD.take_over, () => void env.run("conversations.take_over", { commitmentId: k.id }, `It's yours now. ${k.whoName.split(" ")[0]} is told quietly.`), { primary: true }) : null;
          })()
        : null;
      if (primary) out.push(primary);
      if (open && !c.item && c.primary !== "create") out.push(act("create", "Create DevOps item", () => env.form("draft")));
      if (open && !c.item && c.primary !== "link") out.push(act("link", "Link to item", () => env.form("link")));
      out.push(act("teams", "Open in Teams", () => {}, { href: c.link }));
      if (open && c.primary !== "resolve" && c.primary !== "mark_done") out.push(act("done", "Resolve", resolve, { more: true }));
      if (open) out.push(act("not_needed", "Not a request", () => env.form("not_request"), { more: true }));
      if (open && (env.canMerge ?? false)) out.push(act("merge", "Merge into…", () => env.form("merge"), { more: true }));
      if (c.item) out.push(act("unlink", `Unlink #${c.item.id}`, () => void env.run("conversations.unlink", { id: c.id }, "Unlinked"), { more: true }));
      if (!open && c.primary !== "reopen") out.push(act("reopen", "Open again", () => void env.run("conversations.reopen", { id: c.id }, "Open again"), { more: true }));
      out.push(act("hide", c.hidden ? "Show for me" : "Hide for me", () => void env.run("conversations.hide", { id: c.id, hidden: !c.hidden }, c.hidden ? "Shown again" : "Hidden for you. Nobody else's view changes", { action: "conversations.hide", input: { id: c.id, hidden: c.hidden } }), { more: true }));
      return out;
    }
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
        ? act("week", "Take off Today", () => void env.run("my_promises.today", { id: p.id, on: false }, "Off Today"))
        : act("week", "Add to Today", () => void env.run("my_promises.today", { id: p.id, on: true }, "On Today", { action: "my_promises.today", input: { id: p.id, on: false } })));
      if (first !== markDone) out.push(act("done", "Done", () => void env.run("my_promises.done", { id: p.id }, "Done", undo)));
      if (!p.item) out.push(act("link", "Link to item", () => env.form("link"), { more: true }));
      else out.push(act("unlink", `Unlink #${p.item.id}`, () => void env.run("my_promises.unlink", { id: p.id }, "Unlinked"), { more: true }));
      out.push(act("not_needed", "Not needed", () => void env.run("my_promises.not_needed", { id: p.id }, "Not needed", undo), { more: true }));
      out.push(act("teams", "Open in Teams", () => {}, { href: p.link, more: true }));
      out.push(hide(e.row.key));
      return out;
    }
    case "followUp": {
      const f = e.followUp;
      if (!f) return [];
      if (f.closedAt) return [];
      out.push(act("close", "Close the loop", () => env.form("close"), { primary: true }));
      out.push(act("due", "Due", () => env.form("due")));
      out.push(act("who", "Who", () => env.form("who")));
      out.push(act("week", "Plan it on my week", env.planWeek));
      out.push(act("done", "Done", () => void env.run("followup.close", { id: f.id, note: null }, "Done")));
      out.push(act("edit", "Edit…", () => env.form("edit"), { more: true }));
      out.push(act("not_needed", "Not needed", () => void env.run("followup.not_needed", { id: f.id }, "Closed as not needed"), { more: true }));
      if (f.byHand) out.push(act("delete", "Delete", () => void env.run("followup.delete", { id: f.id }, "Deleted"), { more: true }));
      out.push(hide(e.row.key));
      return out;
    }
    case "send":
      // Accept, Accept and schedule, Pass to… and Can't this week are the send's own row in the pane (SW-1's).
      return [hide(e.row.key)];
    case "capture": {
      const c = e.capture;
      if (!c) return [];
      return [
        act("sort", "Sort", () => env.form("sort"), { primary: true }),
        act("dismiss", "Dismiss", () => void env.run("capture.route", { id: c.id, as: "dismissed" }, "Dismissed")),
        hide(e.row.key),
      ];
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
        hide(e.row.key),
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
            ⋯
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
