// DS-1: Draft stories on every Needs stories row. The button opens one sheet in three steps: Prepare (what FocusTime
// found in DevOps, this client's examples, the house style, a note, the story type and the cost; Run), Review (the AI's
// proposals as editable cards: Keep or Drop, title, description, acceptance criteria, order, size, "after <title>",
// Regenerate one or the set) and Publish (the exact batch from the write framework, then Create; what was created and
// what wasn't, with Retry for the rest). Nothing reaches DevOps until Create is pressed. With AI off for the client the
// button says so and opens Settings; the Coop brief next to it still works.
import { TypeIcon } from "./TypeIcon.tsx";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "./api.ts";
import { DRAFT_STORIES_EVENT, openDraftStories } from "./menu.ts";
import { WorkLink } from "./WorkLink.tsx";

type StoryStatus = { setUp: boolean; on: boolean; allowed: string[]; offered: boolean; write: string[] };
type Size = "S" | "M" | "L" | null;
type CardStatus = { state: "not_sent" } | { state: "created"; itemId: number; url: string | null } | { state: "pending" | "unconfirmed" | "failed" | "refused" | "undone"; message: string; writeId: number };
type Card = { id: string; title: string; description: string; acceptance: string[]; dependsOn: string[]; size: Size; evidence: string[]; questions: string[]; keep: boolean; status: CardStatus; after: string[]; sizeText: string };
type Draft = { id: string; clientKey: string; featureId: number; featureTitle: string; storyType: string; note: string; cards: Card[]; rationale: string; setAside: { title: string; why: "out_of_scope" | "already_covered"; existing_item_id: number | null; reason: string }[]; cost: string; published: number; left: number };
type Prepared = {
  clientKey: string; clientName: string; featureId: number; featureTitle: string; featureType: string; storyType: string; /** WT-1: the child types the feature takes, the most common first. */ childTypes: string[]; url: string;
  signals: { fields: [string, string][]; epic: { id: number; title: string } | null; children: { id: number; title: string; type: string; state: string }[]; comments: { total: number; sent: number; left: number; coopBlocks: number } };
  exemplars: { id: number; title: string; summary: string; stories: number; chosen: boolean }[];
  poolRead: boolean; style: { text: string; learned: boolean; edited: boolean }; estimate: string | null; model: string | null;
  ai: "on" | "off" | "client_off" | "not_set_up"; aiMessage: string | null; write: boolean; writeMessage: string | null; latest: Draft | null;
};
type Preview = { previewId: string; item: string; fields: { label: string; after: string | null }[]; links: string[]; notes: string[]; visibility: string; org: string; project: string; identity: string };

// ---------- the button ----------

let statusCache: { at: number; p: Promise<StoryStatus | null> } | null = null;
/** Draft stories' AI and write state for every client, asked once per 30 seconds for all the rows on screen. */
function useStoryStatus(): StoryStatus | null {
  const [s, setS] = useState<StoryStatus | null>(null);
  useEffect(() => {
    if (!statusCache || Date.now() - statusCache.at > 30_000) statusCache = { at: Date.now(), p: call<StoryStatus>("stories.status", {}).catch(() => null) };
    let live = true;
    void statusCache.p.then((v) => live && setS(v));
    return () => void (live = false);
  }, []);
  return s;
}
const forgetStatus = () => void (statusCache = null);

/** The button on a Needs stories row: opens the sheet, or Settings when AI is off for this client. */
export function DraftStoriesButton({ clientKey, clientName, item }: { clientKey: string; clientName?: string; item: { id: number; title: string } }) {
  const st = useStoryStatus();
  const on = !!st && st.setUp && st.on && st.allowed.includes(clientKey);
  const name = clientName ?? clientKey;
  // ADM-1: a person (or their level's default) can turn the offer off in Settings › Planning; the Coop brief stays.
  if (st && !st.offered) return null;
  if (st && !on) {
    return (
      <button type="button" className="link-btn tw-draft ds-off" title={!st.setUp ? "AI isn't set up for this FocusTime" : !st.on ? "AI is off for FocusTime. A FocusTime admin turns it on." : `AI isn't allowed for ${name}. A FocusTime admin decides.`} onClick={() => void (location.hash = "#/settings/ai")}>
        Draft stories (AI is off for {name})
      </button>
    );
  }
  return (
    <button type="button" className="link-btn tw-draft" onClick={() => openDraftStories(clientKey, item)}>
      Draft stories
    </button>
  );
}

/** Mounted once (App): opens the sheet when a row or the command menu asks. */
export function DraftStoriesHost({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState<{ clientKey: string; item: { id: number; title: string }; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => setOpen({ ...(e as CustomEvent<{ clientKey: string; item: { id: number; title: string } }>).detail, n: ++n });
    window.addEventListener(DRAFT_STORIES_EVENT, on);
    return () => window.removeEventListener(DRAFT_STORIES_EVENT, on);
  }, []);
  if (!open) return null;
  return (
    <DraftStoriesSheet
      key={open.n}
      clientKey={open.clientKey}
      item={open.item}
      onClose={(changed) => {
        setOpen(null);
        forgetStatus();
        if (changed) onDone();
      }}
    />
  );
}

// ---------- the sheet ----------

type Step = "prepare" | "review" | "publish";
const STEPS: [Step, string][] = [["prepare", "Prepare"], ["review", "Review"], ["publish", "Publish"]];
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function DraftStoriesSheet({ clientKey, item, onClose }: { clientKey: string; item: { id: number; title: string }; onClose: (changed: boolean) => void }) {
  const [step, setStep] = useState<Step>("prepare");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>("Reading the feature from DevOps…");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [childType, setChildType] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const changed = useRef(false);
  const first = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    first.current?.focus();
    call<Prepared>("stories.prepare", { clientKey, featureId: item.id }).then(
      (p) => {
        setPrep(p);
        setChildType(p.storyType);
        setChosen(p.exemplars.filter((e) => e.chosen).map((e) => e.id));
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

  const runDraft = async () => {
    const d = await act("Drafting stories…", () => call<Draft>("stories.run", { clientKey, featureId: item.id, note, exemplarIds: chosen, ...(childType ? { storyType: childType } : {}) }));
    if (d) {
      setDraft(d);
      setStep("review");
    }
  };

  // Edits are kept on the server as you go (a short pause after typing), so closing the sheet loses nothing.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (cards: Card[], d: Draft) => {
    const r = await call<Draft>("stories.save", { draftId: d.id, cards: cards.map((c) => ({ id: c.id, keep: c.keep, title: c.title, description: c.description, acceptance: c.acceptance, size: c.size })) });
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

  const regenerate = async (proposalId?: string) => {
    if (!draft) return;
    const d = await act(proposalId ? "Drafting this card again…" : "Drafting the set again…", async () => {
      await flush();
      return call<Draft>("stories.regenerate", { draftId: draft.id, note, ...(proposalId ? { proposalId } : {}) });
    });
    if (d) setDraft(d);
  };

  const preview = async () => {
    if (!draft) return;
    const r = await act("Preparing the preview…", async () => {
      await flush();
      return call<{ previews: Preview[]; nothing?: string[] }>("stories.publish_preview", { draftId: draft.id });
    });
    if (r) {
      setPreviews(r.previews);
      setFailed(r.previews.length ? [] : (r.nothing ?? []));
      setStep("publish");
    }
  };

  const publish = async () => {
    if (!draft || !previews?.length) return;
    const r = await act("Creating in DevOps and checking…", () => call<{ draft: Draft; created: number; failed: string[] }>("stories.publish", { draftId: draft.id, previewIds: previews.map((p) => p.previewId) }));
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
  const kept = draft?.cards.filter((c) => c.keep && c.status.state !== "created").length ?? 0;
  const title = prep?.featureTitle ?? item.title;

  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="cap-dialog ds-sheet"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Draft stories: ${title}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="cap-dialog-head ds-head">
          <h2 ref={first} tabIndex={-1}>
            Draft stories <span className="muted">· {prep?.clientName ?? clientKey}</span>
          </h2>
          <p className="ds-feature">
            {prep && <TypeIcon clientKey={clientKey} type={prep.featureType} />} {prep ? <WorkLink clientKey={clientKey} url={prep.url}>#{item.id} {title}</WorkLink> : `#${item.id} ${title}`}
          </p>
          <ol className="ds-steps" aria-label="Steps">
            {STEPS.map(([s, label], i) => (
              <li key={s} className={s === step ? "on" : STEPS.findIndex(([x]) => x === step) > i ? "done" : ""} aria-current={s === step ? "step" : undefined}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>
        <div className="ds-body">
          {step === "prepare" && prep && <PrepareStep prep={prep} childType={childType ?? prep.storyType} setChildType={setChildType} note={note} setNote={setNote} chosen={chosen} setChosen={setChosen} onReview={prep.latest ? () => (setDraft(prep.latest), setNote(prep.latest!.note), setStep("review")) : null} />}
          {step === "review" && draft && <ReviewStep draft={draft} busy={!!busy} onEdit={edit} onRegenerate={(id) => void regenerate(id)} />}
          {step === "publish" && draft && <PublishStep draft={draft} previews={previews ?? []} failed={failed} />}
          {busy && <p className="ds-busy" role="status">{busy}</p>}
          {error && <p className="set-problem" role="alert">{error}</p>}
        </div>
        <div className="wd-actions ds-actions">
          {step === "prepare" && (
            <>
              {prep && (prep.ai !== "on" || !prep.write) && (
                <button type="button" className="mini" onClick={() => (onClose(false), void (location.hash = `#/settings/${prep.ai === "off" || prep.ai === "not_set_up" ? "ai" : "clients"}`))}>
                  Open Settings
                </button>
              )}
              <button type="button" className="commit" disabled={!!busy || !prep || prep.ai !== "on" || !prep.write} onClick={() => void runDraft()}>
                Run
              </button>
            </>
          )}
          {step === "review" && draft && (
            <>
              <button type="button" className="mini" disabled={!!busy || draft.published > 0} title={draft.published > 0 ? "Some are in DevOps already: regenerate one card instead" : "Draft the whole set again, with the note"} onClick={() => void regenerate()}>
                Regenerate all
              </button>
              <button type="button" className="commit" disabled={!!busy || kept === 0} onClick={() => void preview()}>
                {kept === 0 ? "Nothing to publish" : `Publish ${kept} ${kept === 1 ? "story" : "stories"}…`}
              </button>
            </>
          )}
          {step === "publish" && draft && (
            <>
              <button type="button" className="mini" disabled={!!busy} onClick={() => setStep("review")}>
                Back to review
              </button>
              {previews && previews.length > 0 ? (
                <button type="button" className="commit" disabled={!!busy} onClick={() => void publish()}>
                  Create {previews.length} {previews.length === 1 ? "story" : "stories"} in DevOps
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
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ds-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function PrepareStep({ prep, childType, setChildType, note, setNote, chosen, setChosen, onReview }: { prep: Prepared; childType: string; setChildType: (t: string) => void; note: string; setNote: (s: string) => void; chosen: number[]; setChosen: (ids: number[]) => void; onReview: (() => void) | null }) {
  const s = prep.signals;
  const c = s.comments;
  const toggle = (id: number) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.length >= 5 ? chosen : [...chosen, id]);
  return (
    <>
      {prep.aiMessage && <p className="set-problem" role="status">{prep.aiMessage}</p>}
      {prep.writeMessage && <p className="set-problem" role="status">{prep.writeMessage}. Nothing is sent until then.</p>}
      {onReview && prep.latest && (
        <p className="ds-latest">
          You drafted this feature before ({prep.latest.cards.length} {prep.latest.cards.length === 1 ? "card" : "cards"}, {prep.latest.published} in DevOps).{" "}
          <button type="button" className="link-btn" onClick={onReview}>Open that draft</button>
        </p>
      )}
      <Section title="Found in DevOps">
        <dl className="ds-fields">
          {s.fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Epic</dt>
            <dd>{s.epic ? `#${s.epic.id} ${s.epic.title}` : "None"}</dd>
          </div>
          <div>
            <dt>Comments</dt>
            <dd>
              {c.total === 0 ? "None" : `${c.sent} of ${c.total}, newest first${c.left ? ` (${c.left} older left out)` : ""}${c.coopBlocks ? `; ${c.coopBlocks} Coop ${c.coopBlocks === 1 ? "block" : "blocks"} as one line` : ""}`}
            </dd>
          </div>
        </dl>
        <p className="muted ds-hint">Text only: no attachments or links yet. Email addresses are left out. Everything goes as data, never as instructions.</p>
      </Section>
      <Section title={`Existing children (${s.children.length})`}>
        {s.children.length ? (
          <ul className="ds-children">
            {s.children.map((k) => (
              <li key={k.id}>
                <TypeIcon clientKey={prep.clientKey} type={k.type} /> #{k.id} {k.title} <span className="muted">· {k.state}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet.</p>
        )}
        <p className="muted ds-hint">Sent so the AI proposes what's missing, not these again.</p>
      </Section>
      <Section title={`Examples from ${prep.clientName} (${chosen.length})`}>
        {!prep.poolRead ? (
          <p className="muted">Examples couldn't be read from DevOps now; the house style below is used alone.</p>
        ) : prep.exemplars.length ? (
          <ul className="ds-examples">
            {prep.exemplars.map((e) => (
              <li key={e.id}>
                <label className="set-check">
                  <input type="checkbox" checked={chosen.includes(e.id)} disabled={!chosen.includes(e.id) && chosen.length >= 5} onChange={() => toggle(e.id)} />
                  <span>
                    {e.title} <span className="muted">· {e.stories} stories</span>
                    {e.summary && <span className="ds-sub">{e.summary}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Too few features with stories in {prep.clientName}'s project to learn from, so no examples: the default style is used.</p>
        )}
        <p className="muted ds-hint">Only this client's own features. Up to 5; untick one to swap in another.</p>
      </Section>
      <Section title="House style">
        <p className="ds-style">{prep.style.text}</p>
        <p className="muted ds-hint">{prep.style.edited ? "Your words." : prep.style.learned ? "Learned from this client's features, again each week." : "The default."} Edit it in Settings › Clients.</p>
      </Section>
      <label className="ds-note">
        <span>Note for the AI (optional)</span>
        <textarea rows={2} maxLength={600} value={note} placeholder="split by report, skip the data model" onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="ds-run-line">
        Creates{" "}
        {prep.childTypes.length > 1 ? (
          <label className="ds-child-type">
            <TypeIcon clientKey={prep.clientKey} type={childType} decorative />
            <select aria-label="Type to create" value={childType} onChange={(e) => setChildType(e.target.value)}>
              {prep.childTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <TypeIcon clientKey={prep.clientKey} type={childType} decorative />
            <strong className="type-word">{childType}</strong>
          </>
        )}{" "}
        items under #{prep.featureId}, only after you review and confirm.
        {prep.estimate && (
          <>
            {" "}About <strong>{prep.estimate}</strong>{prep.model ? ` at ${prep.model}` : ""}.
          </>
        )}
      </p>
    </>
  );
}

const SIZES: Size[] = ["S", "M", "L", null];
const SIZE_HOURS: Record<string, string> = { S: "1h", M: "2h", L: "4h" };

function ReviewStep({ draft, busy, onEdit, onRegenerate }: { draft: Draft; busy: boolean; onEdit: (cards: Card[], now?: boolean) => void; onRegenerate: (id: string) => void }) {
  const set = (id: string, patch: Partial<Card>, now = false) => onEdit(draft.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)), now);
  const move = (i: number, by: -1 | 1) => {
    const next = [...draft.cards];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onEdit(next, true);
  };
  const titleOf = (id: string) => draft.cards.find((c) => c.id === id)?.title ?? id;
  return (
    <>
      {draft.rationale && <p className="ds-rationale">{draft.rationale}</p>}
      {draft.cards.length === 0 && <p className="muted">The AI found nothing new to add to this feature.</p>}
      <ol className="ds-cards">
        {draft.cards.map((c, i) => {
          const sent = c.status.state !== "not_sent";
          return (
            <li key={c.id} className={`ds-card${c.keep ? "" : " dropped"}${sent ? " sent" : ""}`} aria-label={`Card ${c.title || c.id}`}>
              <div className="ds-card-head">
                <span className="ds-card-id">{c.id}</span>
                <input className="ds-title" aria-label="Title" value={c.title} maxLength={120} disabled={sent || !c.keep} onChange={(e) => set(c.id, { title: e.target.value })} />
                <span className="ds-card-tools">
                  <button type="button" className="mini" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="mini" aria-label="Move down" disabled={i === draft.cards.length - 1} onClick={() => move(i, 1)}>↓</button>
                  {!sent && (
                    <button type="button" className={`mini${c.keep ? "" : " on"}`} onClick={() => set(c.id, { keep: !c.keep }, true)}>
                      {c.keep ? "Drop" : "Keep"}
                    </button>
                  )}
                </span>
              </div>
              {c.after.length > 0 && <p className="ds-after">{c.after.map((t) => `after ${t}`).join(" · ")}</p>}
              {c.keep && (
                <>
                  <label className="ds-field">
                    <span>Description</span>
                    <textarea rows={3} value={c.description} disabled={sent} onChange={(e) => set(c.id, { description: e.target.value })} />
                  </label>
                  <label className="ds-field">
                    <span>Acceptance criteria, one per line</span>
                    <textarea rows={Math.max(2, c.acceptance.length)} value={c.acceptance.join("\n")} disabled={sent} onChange={(e) => set(c.id, { acceptance: e.target.value.split("\n") })} />
                  </label>
                  <div className="ds-card-foot">
                    <span className="ds-sizes" role="group" aria-label="Size">
                      {SIZES.map((s) => (
                        <button key={String(s)} type="button" className={`size-chip${c.size === s ? " on" : ""}`} aria-pressed={c.size === s} disabled={sent} onClick={() => set(c.id, { size: s }, true)}>
                          {s ? `${s} · ${SIZE_HOURS[s]}` : "Size? · 2h"}
                        </button>
                      ))}
                    </span>
                    {!sent && (
                      <button type="button" className="link-btn" disabled={busy} onClick={() => onRegenerate(c.id)}>
                        Regenerate
                      </button>
                    )}
                  </div>
                  {(c.evidence.length > 0 || c.questions.length > 0) && (
                    <details className="ds-why">
                      <summary>Why and open questions</summary>
                      {c.evidence.length > 0 && <p className="muted">From: {c.evidence.join("; ")}</p>}
                      {c.questions.map((q) => (
                        <p key={q} className="muted">Check: {q}</p>
                      ))}
                    </details>
                  )}
                </>
              )}
              {c.dependsOn.some((d) => !draft.cards.find((x) => x.id === d)?.keep) && c.keep && <p className="muted ds-after">Depends on a dropped card ({c.dependsOn.filter((d) => !draft.cards.find((x) => x.id === d)?.keep).map(titleOf).join(", ")}); published without that link.</p>}
              <CardState status={c.status} />
            </li>
          );
        })}
      </ol>
      {draft.setAside.length > 0 && (
        <details className="ds-aside">
          <summary>Set aside ({draft.setAside.length})</summary>
          <ul>
            {draft.setAside.map((s) => (
              <li key={s.title}>
                {s.title} <span className="muted">· {s.why === "already_covered" ? `already covered${s.existing_item_id ? ` by #${s.existing_item_id}` : ""}` : "out of scope"}: {s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted ds-hint">Drafting so far cost {draft.cost}. The note in Prepare goes with Regenerate too.</p>
    </>
  );
}

function CardState({ status: s }: { status: CardStatus }) {
  if (s.state === "not_sent") return null;
  if (s.state === "created") return <p className="dw-ok ds-state">In DevOps as {s.url ? <a href={s.url} target="_blank" rel="noreferrer">#{s.itemId}</a> : `#${s.itemId}`}</p>;
  return <p className="set-problem ds-state">{s.message}</p>;
}

function PublishStep({ draft, previews, failed }: { draft: Draft; previews: Preview[]; failed: string[] }) {
  const p0 = previews[0];
  const created = draft.cards.filter((c) => c.status.state === "created");
  const notYet = draft.cards.filter((c) => c.keep && c.status.state !== "created");
  return (
    <>
      {p0 && (
        <>
          <dl className="wd-where">
            <dt>Where</dt>
            <dd>DevOps · {p0.org} · {p0.project}</dd>
            <dt>Writes as</dt>
            <dd>{p0.identity}</dd>
          </dl>
          <div className="dw-rows">
            {previews.map((p) => (
              <section key={p.previewId} className="dw-row" aria-label={p.item}>
                <h3>{p.item}</h3>
                <table className="wd-fields">
                  <tbody>
                    {p.fields.map((f) => (
                      <tr key={f.label}>
                        <th scope="row">{f.label}</th>
                        <td>{f.after ?? "(none)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.links.map((n) => <p key={n} className="muted dw-note">{n}</p>)}
              </section>
            ))}
          </div>
          <p className="wd-visibility"><strong>Who can see it:</strong> {p0.visibility}</p>
        </>
      )}
      {!p0 && created.length > 0 && (
        <p className="dw-ok" role="status">
          Created {created.length} {created.length === 1 ? "story" : "stories"} under #{draft.featureId}: {created.map((c) => (c.status.state === "created" ? `#${c.status.itemId}` : "")).join(", ")}.
        </p>
      )}
      {!p0 && notYet.length > 0 && (
        <div className="ds-notyet" role="alert">
          <p className="set-problem">Not in DevOps yet ({notYet.length}):</p>
          <ul>
            {notYet.map((c) => (
              <li key={c.id}>
                {c.title} <span className="muted">· {c.status.state === "not_sent" ? "not sent" : "message" in c.status ? c.status.message : ""}</span>
              </li>
            ))}
          </ul>
          <p className="muted ds-hint">Retry checks DevOps first and never makes a second item.</p>
        </div>
      )}
      {failed.length > 0 && !p0 && notYet.length === 0 && failed.map((f) => <p key={f} className="muted">{f}</p>)}
    </>
  );
}
