// UI-5: the Guide's try-it sandboxes. Each is self-contained: its example data is in the page (content.ts TRY and
// SIZING), it keeps its state in React only, and it calls no action and no server. Leaving the section resets it.
// Motion is CSS or the Web Animations API, under 600 ms, and none under reduced motion (the end state shows at once).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StorySize } from "../../plan/estimate.ts";
import { useReducedMotion } from "../brand/motion.ts";
import { SIZING, TRY, type ExampleColor, type TryItId } from "./content.ts";
import { sandbox } from "./sandbox.ts";
import { Rich } from "./Rich.tsx";

const tint = (c: ExampleColor): CSSProperties => ({ ["--c" as string]: `var(--client-${c})` });

function Frame({ id, title, sub, onReset, children }: { id: TryItId; title: string; sub: string; onReset?: () => void; children: ReactNode }) {
  return (
    <section className="try" data-try={id} aria-labelledby={`try-${id}`}>
      <div className="try-head">
        <h4 id={`try-${id}`}>{title}</h4>
        {onReset && (
          <button type="button" className="link-btn" onClick={onReset}>
            {TRY.reset}
          </button>
        )}
      </div>
      <p className="try-sub">{sub}</p>
      {children}
      <p className="try-note">{TRY.example}</p>
    </section>
  );
}

// ---------- Put a to-do on a block (drag, or Move to; the chip slides to its new place) ----------

type Where = Record<string, string | null>;

/** Slides elements from where they were to where they are now (FLIP), under 600 ms; nothing under reduced motion. */
function useSlide(deps: unknown, root: React.RefObject<HTMLElement | null>, reduced: boolean) {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const els = [...(root.current?.querySelectorAll<HTMLElement>("[data-slide]") ?? [])];
    const now = new Map(els.map((e) => [e.dataset.slide!, e.getBoundingClientRect()]));
    if (!reduced)
      for (const e of els) {
        const was = last.current.get(e.dataset.slide!);
        const is = now.get(e.dataset.slide!)!;
        if (!was || (was.x === is.x && was.y === is.y)) continue;
        e.animate?.([{ transform: `translate(${was.x - is.x}px, ${was.y - is.y}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
      }
    last.current = now;
  }, [deps]); // eslint-disable-line react-hooks/exhaustive-deps
}

function DragTry() {
  const t = TRY.drag;
  const start: Where = Object.fromEntries(t.todos.map((x) => [x.id, null]));
  const [where, setWhere] = useState<Where>(start);
  const [said, setSaid] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useSlide(where, root, reduced);
  const move = (id: string, block: string | null) => {
    setWhere((w) => ({ ...w, [id]: block }));
    const todo = t.todos.find((x) => x.id === id)!;
    setSaid(block ? t.moved(todo.title, t.blocks.find((b) => b.id === block)!.label) : "");
  };
  const chip = (x: (typeof t.todos)[number]) => (
    <li key={x.id} className="try-todo" data-slide={x.id} draggable onDragStart={(e) => (e.dataTransfer.setData("text/plain", x.id), (e.dataTransfer.effectAllowed = "move"))}>
      <span className="try-grip" aria-hidden="true">⋮⋮</span>
      <span className="try-todo-title">{x.title}</span>
      <span className="guide-tag">{x.size}</span>
      <span className="try-moves">
        {where[x.id] ? (
          <button type="button" className="link-btn" onClick={() => move(x.id, null)}>
            {t.back}
          </button>
        ) : (
          t.blocks.map((b) => (
            <button key={b.id} type="button" className="link-btn" onClick={() => move(x.id, b.id)}>
              {t.moveTo(b.label)}
            </button>
          ))
        )}
      </span>
    </li>
  );
  return (
    <Frame id="drag" title={t.title} sub={t.sub} onReset={() => (setWhere(start), setSaid(""))}>
      <div ref={root} className="try-drag">
        <div className="try-pool">
          <div className="try-label">{t.unplanned}</div>
          <ul className="try-todos">{t.todos.filter((x) => !where[x.id]).map(chip)}</ul>
        </div>
        <div className="try-blocks">
          {t.blocks.map((b) => {
            const here = t.todos.filter((x) => where[x.id] === b.id);
            const planned = here.reduce((n, x) => n + x.minutes, 0);
            return (
              <div
                key={b.id}
                className={`try-block${over === b.id ? " over" : ""}`}
                style={tint(b.color)}
                onDragOver={(e) => (e.preventDefault(), setOver(b.id))}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id in where) move(id, b.id);
                }}
              >
                <div className="try-block-head">
                  <b>
                    {b.client} · {b.label}
                  </b>
                  <span className={`try-fit${planned > b.freeMinutes ? " amber" : ""}`}>{t.fit(planned, b.freeMinutes)}</span>
                </div>
                <ul className="try-todos">{here.length ? here.map(chip) : <li className="try-empty">{t.empty}</li>}</ul>
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </Frame>
  );
}

// ---------- The Timeline toggle ----------

function TimelineTry() {
  const t = TRY.timeline;
  const [on, setOn] = useState(true);
  const b = t.block;
  const hours = Array.from({ length: b.to - b.from }, (_, i) => b.from + i);
  const span = b.to - b.from;
  return (
    <Frame id="timeline" title={t.title} sub={t.sub}>
      <div className="try-tl-bar">
        <button type="button" className={`try-toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => setOn((x) => !x)}>
          {t.toggle}
        </button>
      </div>
      <div className={`try-tl${on ? " with-rail" : ""}`} style={tint(b.color)}>
        <div className="try-block-head">
          <b>{b.label}</b>
        </div>
        <div className="try-tl-body">
          {on && (
            <div className="try-rail" aria-label={`${b.label}, ${t.hour(b.from)} to ${t.hour(b.to)}`}>
              {hours.map((h) => (
                <span key={h} className="try-hour" style={{ top: `${((h - b.from) / span) * 100}%` }}>
                  {t.hour(h)}
                </span>
              ))}
              {t.meetings.map((m) => (
                <span key={m.title} className="try-meet" style={{ top: `${((m.from - b.from) / span) * 100}%`, height: `${((m.to - m.from) / span) * 100}%` }}>
                  {m.title}
                </span>
              ))}
            </div>
          )}
          <ul className="try-todos plain">
            {!on && t.meetings.map((m) => <li key={m.title} className="try-meet-row">{t.listMeeting(m.title, m.from)}</li>)}
            {t.todos.map((x) => (
              <li key={x} className="try-todo">
                <span className="try-check" aria-hidden="true" />
                <span className="try-todo-title">{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Frame>
  );
}

// ---------- How much fits in a block? (G1's sandbox, now in Week) ----------

function SizingTry() {
  const [stories, setStories] = useState<(StorySize | null)[]>(SIZING.start);
  const sb = useMemo(() => sandbox(stories, SIZING.block), [stories]);
  const sizes: (StorySize | null)[] = ["XS", "S", "M", "L", null];
  const freeHours = Math.round(SIZING.block.freeMinutes / 60);
  return (
    <Frame id="sizing" title={SIZING.title} sub={SIZING.sub}>
      <div className="guide-sandbox">
        <div className="guide-blockviz" style={tint(SIZING.block.color)}>
          <div className="head">
            <b>{SIZING.blockTitle}</b>
            <span className="muted">
              {SIZING.block.label} · <span data-testid="guide-free">{SIZING.block.free}</span>
            </span>
          </div>
          <div className="bar" aria-hidden="true">
            {Array.from({ length: freeHours }, (_, q) => (
              <div key={q} className={`q${q < sb.filled ? " fill" : ""}${q % 2 ? " alt" : ""}`} />
            ))}
          </div>
          <div className="spill" aria-hidden="true">
            {Array.from({ length: sb.spill }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <div className="foot">
            <span className={`fitword ${sb.fit.tone}`} data-testid="guide-fit" role="status">
              {sb.minutes === 0 ? SIZING.empty : sb.fit.text}
            </span>
            <span className="load" data-testid="guide-load">
              {SIZING.load(sb.load.planned, sb.load.free)}
            </span>
          </div>
          <div className="adds">
            {sizes.map((s) => (
              <button key={s ?? "unsized"} type="button" className="quiet" data-add={s ?? "unsized"} onClick={() => sb.minutes < SIZING.maxMinutes && setStories((x) => [...x, s])}>
                + {SIZING.add(s)}
              </button>
            ))}
            <button type="button" className="quiet" data-clear onClick={() => setStories([])}>
              {SIZING.clear}
            </button>
          </div>
          <div className="stack" aria-label={SIZING.stackLabel}>
            {sb.chips.map((chip, i) => (
              <button key={i} type="button" className={stories[i] ? "" : "unsized"} aria-label={SIZING.remove(chip)} onClick={() => setStories((x) => x.filter((_, j) => j !== i))}>
                {chip} ✕
              </button>
            ))}
          </div>
        </div>
        <div className="guide-legend">
          {SIZING.legend.map((l) => (
            <div key={l}>
              <Rich text={l} />
            </div>
          ))}
          <div className="faint">{SIZING.hint}</div>
        </div>
      </div>
    </Frame>
  );
}

// ---------- Open an Inbox item ----------

function InboxTry() {
  const t = TRY.inbox;
  const [open, setOpen] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const item = t.items.find((x) => x.id === open) ?? null;
  return (
    <Frame id="inbox" title={t.title} sub={t.sub}>
      <div className="try-inbox">
        <div className="try-list" role="listbox" aria-label={t.list}>
          <div className="try-label">{t.list}</div>
          {t.items.map((x) => (
            <button key={x.id} type="button" role="option" aria-selected={open === x.id} className="try-row" onClick={() => (setOpen(x.id), setPressed(false))}>
              <span className="try-row-top">
                <b>{x.title}</b>
                <span className="try-kind">{x.kind}</span>
              </span>
              <span className="try-why">
                {x.client} · {x.why}
              </span>
            </button>
          ))}
        </div>
        <div className="try-pane" aria-live="polite">
          {item ? (
            <>
              <div className="try-kind">
                {item.client} · {item.kind}
              </div>
              <b className="try-pane-title">{item.title}</b>
              <p>{item.summary}</p>
              <div className="try-why">{item.why}</div>
              <button type="button" className="primary" onClick={() => setPressed(true)}>
                {item.main}
              </button>
              {pressed && <p className="try-note">{t.note}</p>}
            </>
          ) : (
            <p className="muted">{t.pick}</p>
          )}
        </div>
      </div>
    </Frame>
  );
}

// ---------- Ask the assistant (scripted: no AI, no server) ----------

type Turn = { ask: string; reply: (typeof TRY.assistant.answers)[keyof typeof TRY.assistant.answers]; state: "open" | "done" | "cancelled" };

const scripted = (q: string) => {
  const a = TRY.assistant.answers;
  const s = q.toLowerCase();
  if (/\bnext\b/.test(s)) return a.next;
  if (/\bmove\b/.test(s)) return a.move;
  if (/\b(done|close|#4411)\b/.test(s)) return a.update;
  return a.unknown;
};

function AssistantTry() {
  const t = TRY.assistant;
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const reduced = useReducedMotion();
  const ask = (text: string) => {
    const v = text.trim();
    if (!v) return;
    setTurns((ts) => [...ts.slice(-2), { ask: v, reply: scripted(v), state: "open" }]);
    setQ("");
  };
  const set = (i: number, state: Turn["state"]) => setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, state } : x)));
  return (
    <Frame id="assistant" title={t.title} sub={t.sub} onReset={() => (setTurns([]), setQ(""))}>
      <div className="try-ask">
        <div className="try-suggest">
          {t.suggestions.map((s) => (
            <button key={s} type="button" className="try-chip" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="try-box"
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
        >
          <input aria-label={t.box} placeholder={t.box} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="primary">
            {t.send}
          </button>
        </form>
        <ol className="try-turns" aria-live="polite">
          {turns.map((x, i) => (
            <li key={i}>
              <div className="try-me">{x.ask}</div>
              {x.reply.kind === "answer" ? (
                <div className="try-reply">{x.reply.text}</div>
              ) : (
                <div className={`try-proposal ${x.state}${reduced ? " still" : ""}`}>
                  <b>{x.reply.title}</b>
                  <ul>
                    {x.reply.rows.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <div className="try-who">{x.reply.who}</div>
                  {x.state === "open" ? (
                    <div className="try-actions">
                      <button type="button" className="primary" onClick={() => set(i, "done")}>
                        {t.confirm}
                      </button>
                      <button type="button" className="quiet" onClick={() => set(i, "cancelled")}>
                        {t.cancel}
                      </button>
                    </div>
                  ) : x.state === "done" ? (
                    <div className="try-done">
                      <span className="gs-tick">{t.done}</span>
                      <button type="button" className="link-btn" onClick={() => set(i, "open")}>
                        {t.undo}
                      </button>
                    </div>
                  ) : (
                    <div className="try-who">{t.cancelled}</div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}

export function TryIt({ id }: { id: TryItId }) {
  switch (id) {
    case "drag":
      return <DragTry />;
    case "timeline":
      return <TimelineTry />;
    case "sizing":
      return <SizingTry />;
    case "inbox":
      return <InboxTry />;
    case "assistant":
      return <AssistantTry />;
  }
}

// ---------- Today's urgent strip, collapsing to "N more in Inbox" (an animation, once in view) ----------

export function UrgentStrip() {
  const t = TRY.urgent;
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [played, setPlayed] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setPlayed(true), io.disconnect()), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  const state = reduced ? "done still" : played ? "play" : "";
  const extra = t.rows.length - 3;
  return (
    <div ref={box} className="try-urgent-wrap" role="img" aria-label={`${t.label}: the 3 most urgent, then ${t.more(extra)}`}>
      <div key={run} className={`try-urgent ${state}`} aria-hidden="true">
        {t.rows.map((r, i) => (
          <div key={r.text} className={`try-u-row ${r.tone}${i >= 3 ? " extra" : ""}`}>
            <i />
            <span className="try-u-text">{r.text}</span>
            <span className="try-u-meta">{r.meta}</span>
          </div>
        ))}
        <div className="try-u-more">{t.more(extra)}</div>
      </div>
      <span className="try-note">{t.label}</span>
      {!reduced && (
        <button type="button" className="link-btn" onClick={() => (setPlayed(true), setRun((n) => n + 1))}>
          {t.replay}
        </button>
      )}
    </div>
  );
}
