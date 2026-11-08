// CV-1's conversation pieces, shared by the Inbox's detail pane (IB-1, ui/inbox/): the messages like Teams (CV-2,
// ui/MessageThread.tsx: grouped by person with avatars, mine on the other side, quotes, reactions, the latest 20 with
// Show earlier), Link to item, Create DevOps item (the draft), Not a request, Merge into…, a suggested update, and the
// linked item with its live state. Nothing is posted in Teams. Chat text shows only on its own client's item.
import { TypeIcon } from "./TypeIcon.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConversationCard, ConversationMessage, ConversationMessages } from "../plan/conversation-views.ts";
import { ImageViewer } from "./ImageViewer.tsx";
import { MessageThread } from "./MessageThread.tsx";
import { usePhotos } from "./Presence.tsx";
import type { ItemDraft } from "../plan/conversations.ts";
import { acceptanceText, pathOfAction } from "../plan/conversation-draft.ts";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { whenText } from "./labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
type Suggest = ConversationCard["suggestions"][number];
export const PRIMARY_WORD = { create: "Create DevOps item", link: "Link", resolve: "Resolve", take_over: "Take it over", reopen: "Open again", mark_done: "Mark done" } as const;

/** CV-2: Merge into…: the same chat's other conversations; the one picked keeps its place, this one moves into it. */
export function SuggestionBox({ s, onPost, onSkip }: { s: Suggest; onPost: (includeInternal: boolean) => void; onSkip: () => void }) {
  const [include, setInclude] = useState(false);
  const lines = [...(s.body ? s.body.split("\n") : []), ...(include ? s.internal : [])];
  return (
    <div className="conv-suggest" onClick={(e) => e.stopPropagation()}>
      <p className="conv-suggest-head">{s.kind === "comment" ? <>Suggested update for #{s.itemId}</> : <>Description change for #{s.itemId}</>}</p>
      {s.namesRemoved && <p className="names-removed">Another client's name was removed: "another client" is written instead.</p>}
      {s.kind === "comment" ? (
        <>
          <ul className="conv-suggest-lines">
            {lines.length ? lines.map((l, i) => <li key={i}>{l}</li>) : <li className="muted">Discussed in an internal chat.</li>}
          </ul>
          {s.internal.length > 0 && (
            <label className="conv-internal-toggle">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include {s.internal.length === 1 ? "the line" : `the ${s.internal.length} lines`} from the internal chat
            </label>
          )}
        </>
      ) : (
        <p>Adds below the current description: "{s.body}". You see the whole before and after first.</p>
      )}
      <div className="ask-actions">
        <button type="button" className="mini primary" onClick={() => onPost(include)}>
          {s.kind === "comment" ? "Post comment" : "Review the change"}
        </button>
        <button type="button" className="mini quiet" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

export function NotRequest({ onSave, onCancel }: { onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <form className="ask-form" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), onSave(reason.trim()))} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Why isn't it a request? <span className="muted">(optional, everyone on the chat sees it)</span>
        <input autoFocus maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Answered on a call" />
      </label>
      <button type="submit" className="mini primary">Not a request</button>
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}

type Hit = { id: number; title: string; type: string; state: string; url: string };

/**
 * CV-5: a linked item with its live state from the central store: "#id title · Active · Dana · changed Tue"; when it
 * closed in DevOps, "Item closed" (Mark done is the card's primary, never done automatically).
 */
export function LinkedItem({ item, tz, lead }: { item: NonNullable<ConversationCard["item"]>; tz: string; lead: string }) {
  return (
    <p className={`conv-item${item.closed ? " closed" : ""}`}>
      {item.closed ? <strong className="conv-item-closed">Item closed</strong> : lead}{" "}
      <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer">
        #{item.id} {item.title ?? ""}
      </a>
      {item.state && (
        <span className="muted">
          {" "}
          · {item.state} · {item.assignee ?? "Unassigned"}
          {item.changedAt ? <> · changed {whenText(item.changedAt, tz)}</> : null}
        </span>
      )}
    </p>
  );
}

/** CV-5: "Also add a comment on the item", off by default; the comment goes through its own preview and confirm. */
export function AlsoComment({ on, set, disabled }: { on: boolean; set: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="conv-internal-toggle">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} /> Also add a comment on the item, with a link back to Teams
      {disabled && <span className="muted"> (needs DevOps writes)</span>}
    </label>
  );
}

export function ConvLink({ c, onPick, onCancel }: { c: ConversationCard; onPick: (id: number, comment: boolean) => void; onCancel: () => void }) {
  const [q, setQ] = useState(c.likely ? `#${c.likely.id}` : "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [comment, setComment] = useState(false);
  const pick = (id: number) => onPick(id, comment && c.canCreate);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void call<{ available: boolean; items: Hit[] }>("conversations.search_items", { id: c.id, query: q }).then(
        (r) => live && (setAvailable(r.available), setHits(r.items)),
        () => live && (setAvailable(false), setHits([])),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, c.id]);
  return (
    <div className="ask-form ask-link" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Link to one of {c.clientName}'s open items
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), pick(hits[0].id))} />
      </label>
      {!available && <p className="set-problem">DevOps couldn't be read for {c.clientName}. Try again in a moment.</p>}
      {hits && available && (
        <ul className="ask-hits" aria-label="Open items">
          {hits.length === 0 && <li className="muted">No open items match</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="mini quiet" onClick={() => pick(h.id)}>
                <TypeIcon clientKey={c.clientKey} type={h.type} /> #{h.id} {h.title} <span className="muted">· {h.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AlsoComment on={comment} set={setComment} disabled={!c.canCreate} />
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}

type TypeChoices = { choices: { type: string; bug: boolean }[]; type: string | null };
type DraftData = { draft: ItemDraft; notSorted: string | null; features: { id: number; title: string; type: string }[]; types?: Record<string, TypeChoices>; internalChat: boolean; canCreate: boolean };
/**
 * Create DevOps item (CV-1, CV-5): one form for any conversation or promise. The AI's draft from that conversation only
 * (title, path of action, acceptance criteria, type, parent) when AI may run for the client; otherwise empty for me to
 * fill in. Me or nobody as the assignee. Without my write access it says how to turn writes on, and sends nothing.
 */
export function DraftItem({ c, commitmentId, onCreate, onCancel }: { c: Pick<ConversationCard, "id" | "clientName" | "clientKey">; commitmentId: number | null; onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void; onCancel: () => void }) {
  const writes = useDevOpsWrite();
  const [d, setD] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<ItemDraft["level"]>("story");
  const [type, setType] = useState<string>("");
  const [parent, setParent] = useState<string>("");
  const [path, setPath] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [assignMe, setAssignMe] = useState(true);
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const fill = useCallback(async (regenerate: boolean) => {
    setBusy(true);
    try {
      const r = await call<DraftData>("conversations.draft", { id: c.id, ...(commitmentId ? { commitmentId } : {}), ...(regenerate ? { regenerate: true } : {}) });
      setD(r);
      setTitle(r.draft.title);
      setLevel(r.draft.level);
      const p = r.draft.parentId ? String(r.draft.parentId) : "";
      setParent(p);
      setType(r.types?.[p || "none"]?.type ?? "");
      setPath(pathOfAction(r.draft));
      setAcceptance(acceptanceText(r.draft));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [c.id, commitmentId]);
  useEffect(() => void fill(false), [fill]);
  // WT-1: only the valid child types under the chosen parent, the most common first.
  const options = d?.types?.[parent || "none"];
  const chosen = options?.choices.find((x) => x.type === type) ?? null;
  const pickParent = (p: string) => {
    setParent(p);
    const next = d?.types?.[p || "none"];
    if (next && !next.choices.some((x) => x.type === type)) setType(next.type ?? "");
  };
  const canSend = !!d?.canCreate && !!writes;
  return (
    <form
      className="ask-form conv-draft"
      aria-label="Create DevOps item"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !canSend) return;
        onCreate({
          kind: "conversation_create", conversationId: c.id, ...(commitmentId ? { commitmentId } : {}), title: title.trim(), description: path, level: chosen?.bug ? "bug" : level === "bug" ? "story" : level,
          ...(type ? { type } : {}), ...(parent ? { parentId: Number(parent) } : {}), ...(include ? { includeInternal: true } : {}), ...(acceptance.trim() ? { acceptance: acceptance.trim() } : {}), ...(assignMe ? {} : { assign: "none" }),
        });
      }}
    >
      <p className="conv-suggest-head">Create DevOps item</p>
      {error && <p className="set-problem">{error}</p>}
      {!d && !error && <p className="muted">Getting the form ready…</p>}
      {d && (
        <>
          {d.notSorted && <p className="muted">{d.draft.byAi ? null : <>Not drafted by AI ({d.notSorted}). Fill it in below.</>}</p>}
          {d.draft.namesRemoved && <p className="names-removed">Another client's name was removed: the AI's draft had one, and "another client" is written instead. Edit freely.</p>}
          {!canSend && (
            <p className="conv-turn-on" role="status">
              Turn on DevOps writes for {c.clientName} to create it. Nothing is sent until you do.{" "}
              {writes && (
                <button type="button" className="linkish" onClick={() => writes.enable(c.clientKey)}>
                  Settings › Clients
                </button>
              )}
            </p>
          )}
          <label>
            Title
            <input autoFocus maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Parent
            <select value={parent} onChange={(e) => pickParent(e.target.value)}>
              <option value="">None (the project's default area and iteration)</option>
              {d.features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.type} #{f.id} {f.title}
                </option>
              ))}
            </select>
          </label>
          {options && options.choices.length > 0 ? (
            <fieldset className="conv-types">
              <legend>Type</legend>
              {options.choices.map((x) => (
                <label key={x.type} className={`conv-type${x.type === type ? " on" : ""}`}>
                  <input type="radio" name={`conv-type-${c.id}`} value={x.type} checked={x.type === type} onChange={() => setType(x.type)} />
                  <TypeIcon clientKey={c.clientKey} type={x.type} decorative /> {x.type}
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Type
              <select value={level} onChange={(e) => (setLevel(e.target.value as ItemDraft["level"]), setType(""))}>
                <option value="bug">Bug</option>
                <option value="story">Story</option>
                <option value="feature">Feature</option>
              </select>
            </label>
          )}
          <label>
            Description <span className="muted">(the conversation's messages, who and when, and the Teams link are added below it)</span>
            <textarea rows={8} maxLength={8000} value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <label>
            Acceptance criteria <span className="muted">(one per line; only where the type has them)</span>
            <textarea rows={4} maxLength={8000} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
          </label>
          <label className="conv-internal-toggle">
            <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} /> Assign it to me (otherwise unassigned)
          </label>
          {d.internalChat && (
            <label className="conv-internal-toggle">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include the messages from this internal chat (left out by default)
            </label>
          )}
          <div className="ask-actions">
            <button type="submit" className="mini primary" disabled={!canSend || !title.trim()}>
              Preview in DevOps
            </button>
            <button type="button" className="mini quiet" disabled={busy} onClick={() => void fill(true)}>
              {busy ? "Drafting…" : "Draft again"}
            </button>
            <button type="button" className="mini quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** CV-2: Show messages: the latest page, rendered like Teams (ui/MessageThread.tsx), with Show earlier. */
export function Messages({ c, tz }: { c: Pick<ConversationCard, "id">; tz: string }) {
  const [ms, setMs] = useState<ConversationMessage[] | string | null>(null);
  const [earlier, setEarlier] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    void call<ConversationMessages>("conversations.messages", { id: c.id }).then((r) => live && (setMs(r.messages), setEarlier(r.earlier)), (e) => live && setMs(errText(e)));
    return () => void (live = false);
  }, [c.id]);
  const emails = useMemo(() => (Array.isArray(ms) ? [...new Set(ms.map((m) => m.email).filter((e): e is string => !!e))] : []), [ms]);
  const photos = usePhotos({ emails });
  // CV-2: every image loaded so far, in thread order, for the viewer's Previous and Next.
  const viewable = useMemo(() => (Array.isArray(ms) ? ms.flatMap((m) => (m.images ?? []).flatMap((i) => (i.src ? [{ id: i.id, src: i.src }] : []))) : []), [ms]);
  const [viewing, setViewing] = useState<number | null>(null);
  if (ms === null) return <p className="muted">Loading…</p>;
  if (typeof ms === "string") return <p className="set-problem">{ms}</p>;
  const more = async () => {
    if (!earlier) return;
    setLoading(true);
    try {
      const r = await call<ConversationMessages>("conversations.messages", { id: c.id, before: earlier });
      setMs((cur) => [...r.messages, ...(Array.isArray(cur) ? cur : [])]);
      setEarlier(r.earlier);
    } catch (e) {
      setMs(errText(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="conv-messages" onClick={(e) => e.stopPropagation()}>
      <MessageThread messages={ms} tz={tz} photoFor={(e) => photos.photoFor(e)} earlier={!!earlier} loadingEarlier={loading} onEarlier={() => void more()} onImage={(id) => setViewing(Math.max(0, viewable.findIndex((i) => i.id === id)))} />
      {viewing !== null && viewable.length > 0 && <ImageViewer images={viewable} at={viewing} onAt={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
