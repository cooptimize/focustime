// BD-1: Break down (was Draft stories, DS-1) on every Needs stories row. The button says "Break down <type>" with the
// parent's TypeIcon and opens one wide side panel (full screen on the phone): the parent item stays on the left (link,
// state, priority, parent, description, existing children, and what's sent to the AI behind a fold); the right holds
// the three steps. Prepare: the child type (only when there is a choice), a note, Run. Review: editable proposals
// (Keep or Drop with Undo, title, description, acceptance checklist, size, order by drag or keys, "after <title>",
// Regenerate one or all with a note) and the running total. Publish: the exact batch, then Create all; what was
// created and what wasn't, with Retry for the rest. Run never creates anything; nothing reaches DevOps before Create
// all. With AI off for the client the panel says so; with no write PAT nothing is sent, not even the AI request.
// Opened by focustime:break-down, DS-1's focustime:draft-stories, and PV-1's focustime:breakdown ({ clientKey, itemId }).
import { StandardsNote } from "./StandardsNote.tsx";
import type { StandardsUsed } from "../plan/standards.ts";
import { MentionFlag } from "./DevOpsWrite.tsx";
import { TextBox } from "./TextBox.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { useOpenNew } from "./NewItem.tsx";
import { openSend } from "./send-event.ts";
import { useCallback, useContext, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { breakdownLabel, moveCard, reviewTotal } from "../plan/breakdown.ts";
import { sizeChipText } from "../plan/estimate.ts";
import { PlanCtx } from "./planview.ts";
import { call } from "./api.ts";
import { BREAK_DOWN_EVENT, COOP_BRIEF_EVENT, DRAFT_STORIES_EVENT, openBreakDown, PV_BREAKDOWN_EVENT, type BreakDownTarget, type PanelAction } from "./menu.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { DevOpsWork } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import { Icon } from "./icons.tsx";

type Size = "XS" | "S" | "M" | "L" | null;
type CardStatus = { state: "not_sent" } | { state: "created"; itemId: number; url: string | null } | { state: "pending" | "unconfirmed" | "failed" | "refused" | "undone"; message: string; writeId: number };
type Card = { id: string; title: string; description: string; acceptance: string[]; dependsOn: string[]; size: Size; evidence: string[]; questions: string[]; keep: boolean; status: CardStatus; after: string[]; sizeText: string };
type Draft = { id: string; clientKey: string; featureId: number; featureTitle: string; storyType: string; note: string; /** GD-2: the AI's answer named another client and the check replaced it. */ namesRemoved?: boolean; /** KB-1. */ standards?: StandardsUsed | null; cards: Card[]; rationale: string; setAside: { title: string; why: "out_of_scope" | "already_covered"; existing_item_id: number | null; reason: string }[]; published: number; left: number };
type Prepared = {
  clientKey: string; clientName: string; featureId: number; featureTitle: string; featureType: string; storyType: string; childTypes: string[]; url: string;
  item: { state: string; priority: number | null; description: string };
  parent: { id: number; title: string; type: string; url: string } | null;
  children: { id: number; title: string; type: string; state: string }[];
  sent: string[];
  ai: "on" | "off" | "client_off" | "not_set_up"; aiMessage: string | null; write: boolean; writeMessage: string | null; latest: Draft | null;
};
type Preview = { previewId: string; item: string; fields: { label: string; after: string | null }[]; links: string[]; notes: string[]; visibility: string; org: string; project: string; identity: string; /** GD-2: other clients my edited card names. */ mentions?: string[] };

// ---------- the button ----------

/** The parent's type: given by the row, else from the client's last DevOps read (exact client key only). */
function useItemType(clientKey: string, item: BreakDownTarget): string | null {
  const work = useContext(DevOpsWork).get(clientKey);
  if (item.type) return item.type;
  const all = [...(work?.items ?? []), ...(work?.children ?? []), ...(work?.committed ?? [])];
  return all.find((i) => i.id === item.id)?.type ?? null;
}

type StoryStatus = { offered: boolean };
let statusCache: { at: number; p: Promise<StoryStatus | null> } | null = null;
/** Whether Break down is offered to this person (ADM-1: their level's default or their own), asked once per 30 seconds for all rows. */
function useOffered(): boolean {
  const [offered, setOffered] = useState(true);
  useEffect(() => {
    if (!statusCache || Date.now() - statusCache.at > 30_000) statusCache = { at: Date.now(), p: call<StoryStatus>("stories.status", {}).catch(() => null) };
    let live = true;
    void statusCache.p.then((v) => live && v && setOffered(v.offered !== false));
    return () => void (live = false);
  }, []);
  return offered;
}

/**
 * "Break down Feature" on a Needs stories row, with the type's icon. Opens the panel, which says when AI is off; hidden
 * when the person has the offer turned off (ADM-1). The Coop brief beside it stays either way.
 */
export function BreakDownButton({ clientKey, item, short = false }: { clientKey: string; item: BreakDownTarget; /** WD-1: Week's rows say just "Break down" (the row already names the item); the type stays in the tooltip. */ short?: boolean }) {
  const type = useItemType(clientKey, item);
  const offered = useOffered();
  if (!offered) return null;
  return (
    <button type="button" className="link-btn tw-draft bd-trigger" data-breakdown={`${clientKey}:${item.id}`} title={short ? breakdownLabel(type) : undefined} onClick={() => openBreakDown(clientKey, { ...item, ...(type ? { type } : {}) })}>
      {type && !short && <TypeIcon clientKey={clientKey} type={type} decorative />}
      {short ? "Break down" : breakdownLabel(type)}
    </button>
  );
}

/** Mounted once (App): opens the panel when a row or the command menu asks (the old Draft stories event too). */
export function BreakDownHost({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState<{ clientKey: string; item: BreakDownTarget; n: number } | null>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen({ ...(e as CustomEvent<{ clientKey: string; item: BreakDownTarget }>).detail, n: ++n });
    };
    // PV-1's Week block panel sends { clientKey, itemId }; the panel reads the title and type itself.
    const onPv = (e: Event) => {
      const d = (e as CustomEvent<{ clientKey?: unknown; itemId?: unknown }>).detail;
      if (typeof d?.clientKey !== "string" || typeof d.itemId !== "number" || !Number.isSafeInteger(d.itemId) || d.itemId <= 0) return;
      back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen({ clientKey: d.clientKey, item: { id: d.itemId, title: "" }, n: ++n });
    };
    window.addEventListener(BREAK_DOWN_EVENT, on);
    window.addEventListener(DRAFT_STORIES_EVENT, on);
    window.addEventListener(PV_BREAKDOWN_EVENT, onPv);
    return () => {
      window.removeEventListener(BREAK_DOWN_EVENT, on);
      window.removeEventListener(DRAFT_STORIES_EVENT, on);
      window.removeEventListener(PV_BREAKDOWN_EVENT, onPv);
    };
  }, []);
  if (!open) return null;
  return (
    <BreakDownPanel
      key={open.n}
      clientKey={open.clientKey}
      item={open.item}
      onClose={(changed) => {
        setOpen(null);
        statusCache = null;
        if (changed) onDone();
        // Focus goes back to the row that opened it: the same button, or the row's new one after a refresh.
        const el = back.current;
        const key = `${open.clientKey}:${open.item.id}`;
        requestAnimationFrame(() => {
          const target = el?.isConnected ? el : [...document.querySelectorAll<HTMLElement>("[data-breakdown]")].find((b) => b.dataset.breakdown === key);
          target?.focus();
        });
      }}
    />
  );
}

// ---------- the panel ----------

type Step = "prepare" | "review" | "publish";
const STEPS: [Step, string][] = [["prepare", "Prepare"], ["review", "Review"], ["publish", "Publish"]];
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BreakDownPanel({ clientKey, item, onClose }: { clientKey: string; item: BreakDownTarget; onClose: (changed: boolean) => void }) {
  const [step, setStep] = useState<Step>("prepare");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>("Reading the item from DevOps…");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [childType, setChildType] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [allNote, setAllNote] = useState<string | null>(null);
  const changed = useRef(false);
  const first = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    first.current?.focus();
    call<Prepared>("stories.prepare", { clientKey, featureId: item.id }).then(
      (p) => {
        setPrep(p);
        setChildType(p.storyType);
        setBusy(null);
      },
      (e) => {
        setError(errText(e));
        setBusy(null);
      },
    );
  }, [clientKey, item.id]);

  const act = useCallback(async <T,>(label: string, f: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(errText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const canRun = !!prep && prep.ai === "on" && prep.write;
  const run = async () => {
    if (!canRun || busy) return;
    const d = await act("Breaking it down…", () => call<Draft>("stories.run", { clientKey, featureId: item.id, note, ...(childType ? { storyType: childType } : {}) }));
    if (d) {
      setDraft(d);
      setStep("review");
    }
  };

  // Edits are kept on the server as you go (a short pause after typing), so closing the panel loses nothing.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (cards: Card[], d: Draft) => {
    const r = await call<Draft>("stories.save", { draftId: d.id, cards: cards.map((c) => ({ id: c.id, keep: c.keep, title: c.title, description: c.description, acceptance: c.acceptance.filter((a) => a.trim()), size: c.size })) });
    setDraft((cur) => (cur && cur.id === r.id ? { ...r, cards: cur.cards.map((c) => ({ ...c, after: r.cards.find((x) => x.id === c.id)?.after ?? c.after, sizeText: r.cards.find((x) => x.id === c.id)?.sizeText ?? c.sizeText })) } : cur));
    return r;
  }, []);
  const edit = (cards: Card[], now = false) => {
    if (!draft) return;
    const d = { ...draft, cards };
    setDraft(d);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const go = () => void save(cards, d).catch((e) => setError(errText(e)));
    if (now) go();
    else saveTimer.current = setTimeout(go, 600);
  };
  const flush = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draft) await save(draft.cards, draft);
  };

  const regenerate = async (withNote: string, proposalId?: string) => {
    if (!draft) return false;
    const d = await act(proposalId ? "Proposing this one again…" : "Proposing the set again…", async () => {
      await flush();
      return call<Draft>("stories.regenerate", { draftId: draft.id, note: withNote, ...(proposalId ? { proposalId } : {}) });
    });
    if (d) setDraft(d);
    return !!d;
  };

  const preview = async (replace = false) => {
    if (!draft) return;
    const r = await act(replace ? "Replacing and previewing again…" : "Preparing the preview…", async () => {
      await flush();
      return call<{ previews: Preview[]; nothing?: string[] }>("stories.publish_preview", { draftId: draft.id, ...(replace ? { replace: true } : {}) });
    });
    if (r) {
      setPreviews(r.previews);
      setFailed(r.previews.length ? [] : (r.nothing ?? []));
      setStep("publish");
    }
  };

  const createAll = async () => {
    if (!draft || !previews?.length) return;
    const r = await act("Creating in DevOps and checking…", () => call<{ draft: Draft; created: number; failed: string[] }>("stories.publish", { draftId: draft.id, previewIds: previews.map((p) => p.previewId), ...(previews.some((p) => p.mentions?.length) ? { mentionsOk: true } : {}) }));
    if (r) {
      changed.current = changed.current || r.created > 0;
      setDraft(r.draft);
      setFailed(r.failed);
      setPreviews([]);
    }
  };

  const retry = async () => {
    if (!draft) return;
    const r = await act("Checking DevOps and retrying…", () => call<{ draft: Draft; messages: string[]; toPreview: string[] }>("stories.retry", { draftId: draft.id }));
    if (!r) return;
    changed.current = changed.current || r.draft.published > (draft.published ?? 0);
    setDraft(r.draft);
    setFailed(r.messages);
    if (r.toPreview.length) {
      const p = await act("Preparing the preview…", () => call<{ previews: Preview[] }>("stories.publish_preview", { draftId: draft.id }));
      if (p) setPreviews(p.previews);
    }
  };

  const close = () => !busy && onClose(changed.current);
  // Esc closes wherever focus is (it is modal), unless an inner field already used it (a card's note).
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const kept = draft?.cards.filter((c) => c.keep && c.status.state !== "created").length ?? 0;
  const title = prep?.featureTitle ?? item.title;
  const openNew = useOpenNew();
  const type = prep?.featureType ?? item.type ?? null;
  const childWord = draft?.storyType ?? childType ?? prep?.storyType ?? "";
  const label = breakdownLabel(type);

  return (
    <div className="bd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="bd-panel"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${label}: ${title}`}
        onKeyDown={(e) => {
          // Esc inside the panel closes it here and goes no further (the window listener covers focus outside).
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (e.isDefaultPrevented()) return;
          e.preventDefault();
          close();
        }}
      >
        <header className="bd-head">
          <h2 ref={first} tabIndex={-1}>
            {type && <TypeIcon clientKey={clientKey} type={type} decorative />}
            {label}
          </h2>
          <ol className="bd-steps" aria-label="Steps">
            {STEPS.map(([s, name], i) => (
              <li key={s} className={s === step ? "on" : STEPS.findIndex(([x]) => x === step) > i ? "done" : ""} aria-current={s === step ? "step" : undefined}>
                <span className="bd-step-n">{i + 1}</span> {name}
              </li>
            ))}
          </ol>
          <CloseButton onClose={close} disabled={!!busy} />
        </header>

        <ItemPane clientKey={clientKey} id={item.id} title={title} type={type} prep={prep} actions={item.actions ?? []} />

        <section className="bd-main" aria-label={STEPS.find(([s]) => s === step)![1]}>
          <div className="bd-body">
            {step === "prepare" && <PrepareStep prep={prep} childType={childType} setChildType={setChildType} onOpenLatest={prep?.latest ? () => (setDraft(prep.latest), setNote(prep.latest!.note), setStep("review")) : null} />}
            {step === "review" && draft && <ReviewStep clientKey={clientKey} draft={draft} busy={!!busy} onEdit={edit} onRegenerate={regenerate} />}
            {step === "publish" && draft && <PublishStep clientKey={clientKey} draft={draft} previews={previews ?? []} failed={failed} parentUrl={prep?.url ?? null} busy={!!busy} onReplace={() => void preview(true)} />}
            {busy && <p className="bd-busy" role="status">{busy}</p>}
            {error && <p className="set-problem" role="alert">{error}</p>}
          </div>

          <footer className="bd-foot">
            {step === "prepare" && canRun && prep && (
              <>
                <label className="bd-note">
                  <span>Note for the AI (optional)</span>
                  <TextBox
                    minRows={2}
                    maxRows={6}
                    maxLength={600}
                    value={note}
                    placeholder="split by report, skip the data model"
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void run();
                      }
                    }}
                  />
                </label>
                <p className="bd-run-line">
                  Creates <TypeIcon clientKey={clientKey} type={childWord} decorative /> <strong className="type-word">{childWord}</strong> items under #{prep.featureId} after you review and confirm.
                </p>
              </>
            )}
            {step === "review" && draft && allNote !== null && (
              <label className="bd-note">
                <span>Note for proposing the whole set again (optional)</span>
                <TextBox minRows={2} maxRows={6} maxLength={600} autoFocus value={allNote} onChange={(e) => setAllNote(e.target.value)} />
              </label>
            )}
            <div className="bd-buttons">
              {step === "prepare" && openNew && (
                // QC-1: one child by hand, no AI needed: the New form, under this item, one level down.
                <button type="button" className="mini bd-by-hand" disabled={!!busy} onClick={() => (close(), openNew({ from: "breakdown", clientKey, parent: { id: item.id, type: type ?? "", title } }))}>
                  Add one by hand…
                </button>
              )}
              {step === "prepare" && canRun && (
                <button type="button" className="commit" disabled={!!busy} onClick={() => void run()}>
                  Run
                </button>
              )}
              {step === "review" && draft && (
                <>
                  {allNote === null ? (
                    <button type="button" className="mini" disabled={!!busy || draft.published > 0} title={draft.published > 0 ? "Some are in DevOps already: regenerate one instead" : "Propose the whole set again, with a note"} onClick={() => setAllNote(note)}>
                      Regenerate all…
                    </button>
                  ) : (
                    <>
                      <button type="button" className="mini" disabled={!!busy} onClick={() => setAllNote(null)}>
                        Cancel
                      </button>
                      <button type="button" className="mini" disabled={!!busy} onClick={() => void regenerate(allNote).then((ok) => ok && (setNote(allNote), setAllNote(null)))}>
                        Regenerate all
                      </button>
                    </>
                  )}
                  <button type="button" className="commit" disabled={!!busy || kept === 0} onClick={() => void preview()}>
                    {kept === 0 ? "Nothing to create" : `Preview ${plural(kept, "item", "items")}…`}
                  </button>
                </>
              )}
              {step === "publish" && draft && (
                <>
                  <button type="button" className="mini" disabled={!!busy} onClick={() => setStep("review")}>
                    Back to review
                  </button>
                  {previews && previews.length > 0 ? (
                    <button type="button" className="commit" disabled={!!busy} onClick={() => void createAll()}>
                      {previews.some((p) => p.mentions?.length) ? "Create all as written" : "Create all"}
                    </button>
                  ) : draft.left > 0 ? (
                    <button type="button" className="commit" disabled={!!busy} onClick={() => void retry()}>
                      Retry the rest
                    </button>
                  ) : null}
                </>
              )}
              <button type="button" className="mini" disabled={!!busy} onClick={close}>
                {step === "publish" && draft && draft.published > 0 && draft.left === 0 ? "Done" : "Close"}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

// ---------- the parent item (left) ----------

function ItemPane({ clientKey, id, title, type, prep, actions }: { clientKey: string; id: number; title: string; type: string | null; prep: Prepared | null; actions: PanelAction[] }) {
  const [more, setMore] = useState(false);
  const [clamped, setClamped] = useState(false);
  const desc = useRef<HTMLParagraphElement>(null);
  const text = prep?.item.description.trim() ?? "";
  useEffect(() => {
    const el = desc.current;
    if (el && !more) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, more]);
  return (
    <aside className="bd-item" aria-label="The item">
      <p className="bd-item-link">
        {type && <TypeIcon clientKey={clientKey} type={type} />}
        <WorkLink clientKey={clientKey} url={prep?.url}>
          #{id} {title}
        </WorkLink>
      </p>
      {actions.length > 0 && (
        <ul className="bd-item-acts" aria-label="Actions">
          {actions.map((a) => (
            <li key={a.id}>
              <button type="button" className="link-btn" data-act={a.id} onClick={a.run}>
                {a.label}
              </button>
              {a.hint && <span className="muted"> {a.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      {prep && (
        <ul className="bd-chips" aria-label="About the item">
          {prep.item.state && <li className="bd-chip">{prep.item.state}</li>}
          {prep.item.priority !== null && <li className="bd-chip">Priority {prep.item.priority}</li>}
          {prep.parent && (
            <li className="bd-chip">
              <TypeIcon clientKey={clientKey} type={prep.parent.type} />
              <WorkLink clientKey={clientKey} url={prep.parent.url} title={prep.parent.title}>
                #{prep.parent.id}
              </WorkLink>
            </li>
          )}
        </ul>
      )}
      {prep && (
        <div className="bd-desc">
          {text ? (
            <>
              <p ref={desc} className={`bd-desc-text${more ? "" : " clamped"}`}>
                {text}
              </p>
              {(clamped || more) && (
                <button type="button" className="link-btn" aria-expanded={more} onClick={() => setMore(!more)}>
                  {more ? "Show less" : "Show more"}
                </button>
              )}
            </>
          ) : (
            <p className="muted bd-desc-text">No description</p>
          )}
        </div>
      )}
      {prep && prep.children.length > 0 && (
        <section className="bd-children" aria-label="Existing children">
          <h3>Existing children ({prep.children.length})</h3>
          <ul>
            {prep.children.map((k) => (
              <li key={k.id}>
                <TypeIcon clientKey={clientKey} type={k.type} />
                <span className="bd-child-title">{k.title}</span>
                <span className="muted">{k.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {prep && prep.ai === "on" && prep.write && (
        <details className="bd-sent">
          <summary>What's sent to the AI</summary>
          <ul>
            {prep.sent.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

// ---------- 1. Prepare ----------

function PrepareStep({ prep, childType, setChildType, onOpenLatest }: { prep: Prepared | null; childType: string | null; setChildType: (t: string) => void; onOpenLatest: (() => void) | null }) {
  if (!prep) return null;
  if (prep.ai !== "on") return <p className="bd-off" role="status">AI is off for {prep.clientName}. Ask your FocusTime admin.</p>;
  if (!prep.write)
    return (
      <p className="bd-off" role="status">
        Add DevOps write access for {prep.clientName} in{" "}
        <button type="button" className="link-btn" onClick={() => void (location.hash = "#/settings/connections")}>
          Settings
        </button>
        . Nothing is sent until then.
      </p>
    );
  const current = childType ?? prep.storyType;
  return (
    <>
      {onOpenLatest && prep.latest && (
        <p className="muted bd-latest">
          You broke this down before ({plural(prep.latest.cards.length, "proposal", "proposals")}, {prep.latest.published} created).{" "}
          <button type="button" className="link-btn" onClick={onOpenLatest}>
            Open that draft
          </button>
        </p>
      )}
      {prep.childTypes.length > 1 && (
        <div className="bd-types" role="radiogroup" aria-label="Type to create">
          {prep.childTypes.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={t === current} className={`bd-type${t === current ? " on" : ""}`} onClick={() => setChildType(t)}>
              <TypeIcon clientKey={prep.clientKey} type={t} decorative />
              {t}
            </button>
          ))}
        </div>
      )}
      <p className="muted bd-empty">Run proposes several {current} items. They show here to review; nothing is created until you confirm.</p>
    </>
  );
}

// ---------- 2. Review ----------

const SIZES: Size[] = ["XS", "S", "M", "L", null];

function ReviewStep({ clientKey, draft, busy, onEdit, onRegenerate }: { clientKey: string; draft: Draft; busy: boolean; onEdit: (cards: Card[], now?: boolean) => void; onRegenerate: (note: string, id?: string) => Promise<boolean> }) {
  const { sizes } = useContext(PlanCtx);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [regen, setRegen] = useState<{ id: string; note: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const set = (id: string, patch: Partial<Card>, now = false) => onEdit(draft.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)), now);
  const move = (from: number, to: number) => {
    const next = moveCard(draft.cards, from, to);
    if (next.every((c, i) => c === draft.cards[i])) return;
    onEdit(next, true);
  };
  useEffect(() => {
    if (!focusId) return;
    list.current?.querySelector<HTMLElement>(`[data-handle="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, draft.cards]);
  const onHandleKey = (e: KeyboardEvent, i: number, id: string) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    move(i, e.key === "ArrowUp" ? i - 1 : i + 1);
    setFocusId(id);
  };
  const dropOn = (e: DragEvent, i: number) => {
    e.preventDefault();
    if (dragFrom !== null) move(dragFrom, i);
    setDragFrom(null);
  };
  const titleOf = (id: string) => draft.cards.find((c) => c.id === id)?.title ?? id;
  const whyCount = draft.setAside.length;
  const regenOne = (id: string, n: string) => void onRegenerate(n, id).then((ok) => ok && setRegen(null));
  return (
    <>
      {draft.namesRemoved && <p className="names-removed">Another client's name was removed: the AI's text had one, and "another client" is written instead. Edit freely.</p>}
      <StandardsNote s={draft.standards} />
      {(draft.rationale || whyCount > 0) && (
        <details className="bd-why">
          <summary>Why these{whyCount ? `, and ${whyCount} left out` : ""}</summary>
          {draft.rationale && <p>{draft.rationale}</p>}
          {whyCount > 0 && (
            <ul>
              {draft.setAside.map((s) => (
                <li key={s.title}>
                  {s.title} <span className="muted">· {s.why === "already_covered" ? `already covered${s.existing_item_id ? ` by #${s.existing_item_id}` : ""}` : "out of scope"}: {s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {draft.cards.length === 0 && <p className="muted">The AI found nothing new to add under this item.</p>}
      <ol className="bd-cards" ref={list}>
        {draft.cards.map((c, i) => {
          const sent = c.status.state !== "not_sent";
          if (!c.keep && !sent)
            return (
              <li key={c.id} className="bd-card dropped" aria-label={`Dropped ${c.title || c.id}`}>
                <span className="muted">Dropped:</span> <span className="bd-dropped-title">{c.title}</span>
                <button type="button" className="link-btn" onClick={() => set(c.id, { keep: true }, true)}>
                  Undo
                </button>
              </li>
            );
          const lostDeps = c.dependsOn.filter((d) => !draft.cards.find((x) => x.id === d)?.keep);
          return (
            <li
              key={c.id}
              className={`bd-card${sent ? " sent" : ""}${dragFrom === i ? " dragging" : ""}`}
              aria-label={`Card ${c.title || c.id}`}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={(e) => dropOn(e, i)}
            >
              <div className="bd-card-head">
                <button
                  type="button"
                  className="bd-handle"
                  data-handle={c.id}
                  draggable={!busy}
                  aria-label={`Move ${c.title || c.id} (up or down arrow)`}
                  title="Drag, or use the up and down arrows"
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.setData("text/plain", c.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  onKeyDown={(e) => onHandleKey(e, i, c.id)}
                >
                  ⠿
                </button>
                <TypeIcon clientKey={clientKey} type={draft.storyType} />
                <input className="bd-title" aria-label="Title" value={c.title} maxLength={120} disabled={sent} onChange={(e) => set(c.id, { title: e.target.value })} />
                <span className="bd-move">
                  <button type="button" className="mini" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="arrow-up" /></button>
                  <button type="button" className="mini" aria-label="Move down" disabled={i === draft.cards.length - 1} onClick={() => move(i, i + 1)}><Icon name="arrow-down" /></button>
                </span>
                {!sent && (
                  <button type="button" className="mini" onClick={() => set(c.id, { keep: false }, true)}>
                    Drop
                  </button>
                )}
              </div>
              {c.after.length > 0 && <p className="bd-after">{c.after.map((t) => `after ${t}`).join(" · ")}</p>}
              <label className="bd-field">
                <span>Description</span>
                <TextBox minRows={2} maxRows={10} value={c.description} disabled={sent} onChange={(e) => set(c.id, { description: e.target.value })} />
              </label>
              <Acceptance items={c.acceptance} disabled={sent} onChange={(acceptance) => set(c.id, { acceptance })} />
              <div className="bd-card-foot">
                <span className="bd-sizes" role="group" aria-label="Size">
                  {SIZES.map((s) => (
                    <button key={String(s)} type="button" className={`size-chip${c.size === s ? " on" : ""}`} aria-pressed={c.size === s} disabled={sent} onClick={() => set(c.id, { size: s }, true)}>
                      {sizeChipText(s, sizes)}
                    </button>
                  ))}
                </span>
                {!sent && regen?.id !== c.id && (
                  <button type="button" className="link-btn" disabled={busy} onClick={() => setRegen({ id: c.id, note: "" })}>
                    Regenerate…
                  </button>
                )}
              </div>
              {regen?.id === c.id && (
                <div className="bd-regen">
                  <input
                    aria-label="Note for this one (optional)"
                    placeholder="Note for this one (optional)"
                    maxLength={600}
                    autoFocus
                    value={regen.note}
                    onChange={(e) => setRegen({ id: c.id, note: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") regenOne(c.id, regen.note);
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setRegen(null);
                      }
                    }}
                  />
                  <button type="button" className="mini" disabled={busy} onClick={() => regenOne(c.id, regen.note)}>
                    Regenerate
                  </button>
                  <button type="button" className="link-btn" onClick={() => setRegen(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {(c.evidence.length > 0 || c.questions.length > 0) && (
                <details className="bd-card-why">
                  <summary>Why and open questions</summary>
                  {c.evidence.length > 0 && <p className="muted">From: {c.evidence.join("; ")}</p>}
                  {c.questions.map((q) => (
                    <p key={q} className="muted">Check: {q}</p>
                  ))}
                </details>
              )}
              {lostDeps.length > 0 && <p className="muted bd-after">Depends on a dropped one ({lostDeps.map(titleOf).join(", ")}); created without that link.</p>}
              <CardState status={c.status} />
            </li>
          );
        })}
      </ol>
      <p className="bd-total" aria-live="polite">{reviewTotal(draft.cards, sizes)}</p>
    </>
  );
}

/** Acceptance criteria as a short checklist: one line each, Enter adds the next, an empty line goes away on save. */
function Acceptance({ items, disabled, onChange }: { items: string[]; disabled: boolean; onChange: (a: string[]) => void }) {
  const box = useRef<HTMLUListElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  useEffect(() => {
    if (focusAt === null) return;
    box.current?.querySelectorAll<HTMLInputElement>("input")[focusAt]?.focus();
    setFocusAt(null);
  }, [focusAt, items.length]);
  const at = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="bd-field">
      <span>Acceptance criteria</span>
      {items.length > 0 && (
        <ul className="bd-ac" ref={box}>
          {items.map((a, i) => (
            <li key={i}>
              <span className="bd-ac-box" aria-hidden="true" />
              <input
                aria-label={`Acceptance criterion ${i + 1}`}
                value={a}
                disabled={disabled}
                onChange={(e) => at(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onChange([...items.slice(0, i + 1), "", ...items.slice(i + 1)]);
                    setFocusAt(i + 1);
                  } else if (e.key === "Backspace" && !a) {
                    e.preventDefault();
                    onChange(items.filter((_, j) => j !== i));
                    setFocusAt(Math.max(0, i - 1));
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <button type="button" className="link-btn bd-ac-add" onClick={() => (onChange([...items, ""]), setFocusAt(items.length))}>
          <Icon name="add" /> Add a criterion
        </button>
      )}
    </div>
  );
}

function CardState({ status: s }: { status: CardStatus }) {
  if (s.state === "not_sent") return null;
  if (s.state === "created") return <p className="dw-ok bd-state">In DevOps as {s.url ? <a href={s.url} target="_blank" rel="noreferrer">#{s.itemId}</a> : `#${s.itemId}`}</p>;
  return <p className="set-problem bd-state">{s.message}</p>;
}

// ---------- 3. Publish ----------

const field = (p: Preview, label: string) => p.fields.find((f) => f.label === label)?.after ?? null;

function PublishStep({ clientKey, draft, previews, failed, parentUrl, busy, onReplace }: { clientKey: string; draft: Draft; previews: Preview[]; failed: string[]; parentUrl: string | null; busy: boolean; onReplace: () => void }) {
  const p0 = previews[0];
  const created = draft.cards.filter((c) => c.status.state === "created");
  const notYet = draft.cards.filter((c) => c.keep && c.status.state !== "created");
  const parent = (
    <WorkLink clientKey={clientKey} url={parentUrl}>
      #{draft.featureId}
    </WorkLink>
  );
  return (
    <>
      {p0 && (
        <>
          <p className="bd-where">
            DevOps · {p0.org} · {p0.project} · as {p0.identity}
          </p>
          <ol className="bd-batch">
            {previews.map((p) => {
              const t = field(p, "Type") ?? draft.storyType;
              const size = (field(p, "Size in FocusTime") ?? "").replace(/\s*\(not written to DevOps\)$/, "");
              return (
                <li key={p.previewId} className="bd-batch-row" aria-label={p.item}>
                  <TypeIcon clientKey={clientKey} type={t} />
                  <span className="bd-batch-title">{field(p, "Title") ?? p.item}</span>
                  {size && <span className="size-chip on">{size}</span>}
                  <span className="muted bd-batch-under">under {parent}</span>
                  {p.mentions?.length ? <MentionFlag names={p.mentions} where={`${clientKey}'s DevOps`} disabled={busy} onReplace={onReplace} /> : null}
                </li>
              );
            })}
          </ol>
          <p className="muted bd-hint">Each is assigned to you, with the parent's area and iteration, its description and acceptance criteria. Sizes stay in FocusTime. {p0.visibility}</p>
        </>
      )}
      {!p0 && created.length > 0 && (
        <div className="dw-ok bd-created" role="status">
          <p>
            Created {plural(created.length, "item", "items")} under {parent}:
          </p>
          <ul>
            {created.map((c) =>
              c.status.state === "created" ? (
                <li key={c.id}>
                  <TypeIcon clientKey={clientKey} type={draft.storyType} decorative /> {c.status.url ? <a href={c.status.url} target="_blank" rel="noreferrer">#{c.status.itemId}</a> : `#${c.status.itemId}`} {c.title}{" "}
                  {/* SW-1: hand one to a teammate's week (it's assigned to you in DevOps until they take it). */}
                  <button type="button" className="link-btn bd-send" onClick={() => c.status.state === "created" && openSend({ clientKey, itemId: c.status.itemId, level: "story", title: c.title, itemType: draft.storyType, url: c.status.url, parentId: draft.featureId })}>
                    Send to…
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}
      {!p0 && notYet.length > 0 && (
        <div className="bd-notyet" role="alert">
          <p className="set-problem">Not created yet ({notYet.length}):</p>
          <ul>
            {notYet.map((c) => (
              <li key={c.id}>
                {c.title} <span className="muted">· {c.status.state === "not_sent" ? "not sent" : "message" in c.status ? c.status.message : ""}</span>
              </li>
            ))}
          </ul>
          <p className="muted bd-hint">Retry checks DevOps first and never makes a second item.</p>
        </div>
      )}
      {failed.length > 0 && !p0 && notYet.length === 0 && failed.map((f) => <p key={f} className="muted">{f}</p>)}
    </>
  );
}

// ---------- NV-1: the Coop brief, on the same side panel ----------

type Brief = {
  markdown: string;
  descriptionRead: boolean;
  item: { id: number; title: string; type: string; state: string; url: string; targetDate: string | null; description: string; parent: { id: number; title: string; type: string; url: string } | null; children: { id: number; title: string; type: string; state: string }[] };
  contains: string[];
};

/** Mounted once (App): opens the Coop brief panel when any entry point asks (Today, Week, Plan the week, Ahead, the detail panel). */
export function CoopBriefHost() {
  const [open, setOpen] = useState<{ clientKey: string; item: BreakDownTarget; weekStart: string | null; n: number } | null>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ clientKey?: unknown; item?: BreakDownTarget; weekStart?: string | null }>).detail;
      if (typeof d?.clientKey !== "string" || !d.item || !Number.isSafeInteger(d.item.id) || d.item.id <= 0) return;
      back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen({ clientKey: d.clientKey, item: d.item, weekStart: d.weekStart ?? null, n: ++n });
    };
    window.addEventListener(COOP_BRIEF_EVENT, on);
    return () => window.removeEventListener(COOP_BRIEF_EVENT, on);
  }, []);
  if (!open) return null;
  return (
    <CoopBriefPanel
      key={open.n}
      clientKey={open.clientKey}
      item={open.item}
      weekStart={open.weekStart}
      onClose={() => {
        setOpen(null);
        const el = back.current;
        requestAnimationFrame(() => el?.isConnected && el.focus());
      }}
    />
  );
}

/**
 * The Coop brief on Break down's side panel: the item on the left (TypeIcon, link, chips, description, children, and
 * "What's in the brief" folded), the brief on the right. It copies as soon as it is built and says Copied; Copy again
 * and Close at the foot. When the browser refuses to copy, the text is selected with "Press Ctrl+C to copy". Nothing is
 * sent to an AI: the brief is DevOps fields only, for you to paste to Coop.
 */
export function CoopBriefPanel({ clientKey, item, weekStart, onClose }: { clientKey: string; item: BreakDownTarget; weekStart: string | null; onClose: () => void }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const first = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const copyNow = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
      area.current?.focus();
      area.current?.select();
    }
  }, []);
  useEffect(() => {
    first.current?.focus();
    let live = true;
    call<Brief>("feature.brief", { clientKey, itemId: item.id, ...(weekStart ? { weekStart } : {}) }).then(
      (b) => {
        if (!live) return;
        setBrief(b);
        // The text box renders first, so a refused copy can select it.
        setTimeout(() => void copyNow(b.markdown), 0);
      },
      (e) => live && setError(errText(e)),
    );
    return () => void (live = false);
  }, [clientKey, item.id, weekStart, copyNow]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const type = brief?.item.type ?? item.type ?? null;
  const title = brief?.item.title || item.title;
  return (
    <div className="bd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-panel brief-panel" data-overlay="modal" role="dialog" aria-modal="true" aria-label={`Coop brief: ${title || `#${item.id}`}`}>
        <header className="bd-head">
          <h2 ref={first} tabIndex={-1}>
            {type && <TypeIcon clientKey={clientKey} type={type} decorative />}
            Coop brief
          </h2>
          <CloseButton onClose={onClose} />
        </header>

        <aside className="bd-item" aria-label="The item">
          <p className="bd-item-link">
            {type && <TypeIcon clientKey={clientKey} type={type} />}
            <WorkLink clientKey={clientKey} url={brief?.item.url}>
              #{item.id} {title}
            </WorkLink>
          </p>
          {brief && (
            <ul className="bd-chips" aria-label="About the item">
              {brief.item.state && <li className="bd-chip">{brief.item.state}</li>}
              <li className="bd-chip">{brief.item.targetDate ? `Target ${brief.item.targetDate}` : "No target date"}</li>
              {brief.item.parent && (
                <li className="bd-chip">
                  <TypeIcon clientKey={clientKey} type={brief.item.parent.type} />
                  <WorkLink clientKey={clientKey} url={brief.item.parent.url} title={brief.item.parent.title}>
                    #{brief.item.parent.id}
                  </WorkLink>
                </li>
              )}
            </ul>
          )}
          {brief && (
            <div className="bd-desc">
              <p className={`bd-desc-text clamped${brief.item.description.trim() ? "" : " muted"}`}>{brief.item.description.trim() || (brief.descriptionRead ? "No description" : "The description couldn't be read")}</p>
            </div>
          )}
          {brief && brief.item.children.length > 0 && (
            <section className="bd-children" aria-label="Existing children">
              <h3>Existing children ({brief.item.children.length})</h3>
              <ul>
                {brief.item.children.map((k) => (
                  <li key={k.id}>
                    <TypeIcon clientKey={clientKey} type={k.type} />
                    <span className="bd-child-title">{k.title}</span>
                    <span className="muted">{k.state}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {brief && (
            <details className="bd-sent">
              <summary>What's in the brief</summary>
              <ul>
                {brief.contains.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section className="bd-main" aria-label="The brief">
          <div className="bd-body">
            {!brief && !error && <p className="bd-busy" role="status">Building the brief from DevOps…</p>}
            {error && <p className="set-problem" role="alert">Couldn't build the brief: {error}</p>}
            {brief && (
              <>
                <p className={`brief-status${copied === "no" ? " warn" : ""}`} role="status">
                  {copied === "yes" ? "Copied. Paste it to Coop." : copied === "no" ? "Press Ctrl+C to copy" : "Copying…"}
                </p>
                <textarea ref={area} className="brief-text" readOnly value={brief.markdown} aria-label={`Coop brief for #${item.id}`} />
              </>
            )}
          </div>
          <footer className="bd-foot">
            <div className="bd-buttons">
              {brief && (
                <button type="button" className="commit" onClick={() => void copyNow(brief.markdown)}>
                  Copy again
                </button>
              )}
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
