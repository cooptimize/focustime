// IB-4: one suggestion from chats, open in place: the conversation's summary and its messages like Teams, and three
// actions. Create item opens the create-from-conversation form filled from the conversation (preview and confirm
// before anything reaches DevOps); Already covered searches the client's items and links one; Dismiss takes it out of
// From chats for me only, with Undo. Under ⋯: Add as my promise, This isn't work (shared, with Undo), Open in Teams.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { SuggestionRow } from "../../plan/conversation-views.ts";
import { ConvLink, DraftItem, Messages } from "../Conversations.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { Icon } from "../icons.tsx";

export type SuggestionForm = "create" | "link" | null;

/** The actions of a suggestion, primary first, with their keys (C, L, X). */
export function suggestionActs(s: SuggestionRow, env: { form: (f: SuggestionForm) => void; dismiss: () => void; promise: () => void; notWork: () => void }) {
  return [
    { id: "create", label: "Create item", key: "C", primary: true, run: () => env.form("create") },
    { id: "link", label: "Already covered", key: "L", run: () => env.form("link") },
    { id: "dismiss", label: "Dismiss", key: "X", run: env.dismiss },
    { id: "promise", label: "Add as my promise", more: true, run: env.promise },
    { id: "not_work", label: "This isn't work", more: true, run: env.notWork },
    { id: "teams", label: "Open in Teams", more: true, href: s.link, run: () => {} },
  ] as const;
}

export function SuggestionOpen({ s, form, setForm, tz, color, phone, onDismiss, onPromise, onNotWork, onLinked }: {
  s: SuggestionRow;
  form: SuggestionForm;
  setForm: (f: SuggestionForm) => void;
  tz: string;
  color: string;
  phone: boolean;
  onDismiss: () => void;
  onPromise: () => void;
  onNotWork: () => void;
  onLinked: (itemId: number, comment: boolean) => void;
}): ReactNode {
  const writes = useDevOpsWrite();
  const [menu, setMenu] = useState(false);
  const acts = suggestionActs(s, { form: setForm, dismiss: onDismiss, promise: onPromise, notWork: onNotWork });
  const shown = acts.filter((a) => !("more" in a && a.more));
  const more = acts.filter((a) => "more" in a && a.more);
  return (
    <div className="ib4-open" style={{ "--c": color } as CSSProperties}>
      <p className="ib4-why">
        <span className="muted">Why it needs an item:</span> {s.why || "It asks for work no item covers yet."} <span className="muted">· Suggested as a {s.levelWord.toLowerCase()}: “{s.title}”</span>
      </p>
      {s.summary.trim() && <p className="ib-summary">{s.summary}</p>}
      <div className="ib-acts ib4-acts" role="group" aria-label={`Actions for ${s.conversationTitle}`} data-tour="ib-acts">
        {shown.map((a) => (
          <button key={a.id} type="button" className={`ib-act${"primary" in a && a.primary ? " primary" : ""}`} data-act={a.id} onClick={a.run} aria-keyshortcuts={"key" in a ? a.key : undefined}>
            {a.label}
            {"key" in a && !phone && <kbd>{a.key}</kbd>}
          </button>
        ))}
        <span className="fu-more">
          <button type="button" className="ib-act quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for ${s.conversationTitle}`} onClick={() => setMenu((v) => !v)}>
            <Icon name="more" />
          </button>
          {menu && (
            <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
              {more.map((a, i) =>
                "href" in a ? (
                  <a key={a.id} role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>
                    {a.label}
                  </a>
                ) : (
                  <button key={a.id} type="button" role="menuitem" autoFocus={i === 0} data-act={a.id} onClick={() => (setMenu(false), a.run())}>
                    {a.label}
                  </button>
                ),
              )}
            </span>
          )}
        </span>
      </div>
      {form === "create" && (
        <div className="ib-form">
          <DraftItem c={{ id: s.id, clientName: s.clientName, clientKey: s.clientKey }} commitmentId={null} onCancel={() => setForm(null)} onCreate={(change) => (setForm(null), void writes?.begin(s.clientKey, [change]))} />
        </div>
      )}
      {form === "link" && (
        <div className="ib-form">
          <ConvLink c={{ id: s.id, likely: null, canCreate: s.canCreate, clientName: s.clientName, clientKey: s.clientKey }} onCancel={() => setForm(null)} onPick={onLinked} />
        </div>
      )}
      <section className="ib-messages" aria-label="Messages">
        <h3 className="ib-section">
          Messages{" "}
          <a className="ib4-teams" href={s.link} target="_blank" rel="noopener noreferrer">
            Open in Teams
          </a>
        </h3>
        <Messages c={{ id: s.id }} tz={tz} />
      </section>
    </div>
  );
}
