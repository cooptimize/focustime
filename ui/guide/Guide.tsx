// G1: the in-app Guide (#/guide), rebuilt from the approved prototype (docs/ux/guide/prototype.html) in the app's
// tokens, type scale and components. Every word is in ./content.ts; keys come from ui/keys.ts and the sizing sandbox
// from the app's own math (./sandbox.ts). Example data only, labeled as such: never the person's own.
// UI-5: one section at a time in GuideFrame; Start here is ./StartHere.tsx, the tours ./tour/. Lumen: the footer, Start here's unroll and a tour's end (docs/design/brand.md).
import { TypeIcon } from "../TypeIcon.tsx";
import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Lumen } from "../brand/Brand.tsx";
import { KEYS } from "../keys.ts";
import type { StorySize } from "../../plan/estimate.ts";
import { ASKS, BASICS, TEAM, TEAMS_BOT, DEVOPS, FOOTER, GUIDE_TITLE, PHONE, QUESTIONS, RHYTHM, SECTION_GROUPS, SECTIONS, SHORTCUTS, SIZING, TOUR, type ExampleColor, type Mini, type SectionId, type Tone } from "./content.ts";
import { GuideFrame } from "./GuideFrame.tsx";
import { StartHere } from "./StartHere.tsx";
import "./guide.css";
import { caps, keysFor, richParts } from "./shortcuts.ts";
import { sandbox } from "./sandbox.ts";

const TONE: Record<Tone, string> = {
  "client-blue": "var(--client-blue)",
  "client-teal": "var(--client-teal)",
  accent: "var(--accent)",
  action: "var(--action)",
  watch: "var(--watch)",
  risk: "var(--risk)",
  brand: "var(--ok)",
  faint: "var(--text-faint)",
};
const color = (c: ExampleColor) => `var(--client-${c})`;
/** The client color a piece of the Guide draws with (--c, as the week's blocks use it). */
const tint = (c: string): CSSProperties => ({ ["--c" as string]: c });

export function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="guide-keys">
      {keys.map((k, i) => (
        <span key={`${k}${i}`} className="guide-combo">
          {caps(k).map((c, j) => (
            <kbd key={j}>{c}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** Copy from content.ts with its {key:…}, {size:…} and {b:…} marks drawn. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) =>
        p.kind === "text" ? <Fragment key={i}>{p.text}</Fragment> : p.kind === "keys" ? <Keys key={i} keys={p.keys} /> : p.kind === "size" ? <span key={i} className="guide-tag">{p.text}</span> : <b key={i}>{p.text}</b>,
      )}
    </>
  );
}

function Chapter({ id, eyebrow, title, sub, children }: { id: SectionId; eyebrow: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="guide-ch" id={`guide-${id}`} data-chapter={id} aria-labelledby={`g-${id}`}>
      <div className="guide-eyebrow">{eyebrow}</div>
      <h2 id={`g-${id}`} tabIndex={-1}>{title}</h2>
      {sub && (
        <p className="guide-sub">
          <Rich text={sub} />
        </p>
      )}
      {children}
    </section>
  );
}

function Basics() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <Chapter id="basics" eyebrow={BASICS.eyebrow} title={BASICS.title} sub={BASICS.sub}>
      <div className="guide-concepts">
        {BASICS.cards.map((c, i) => {
          const on = open.has(i);
          return (
            <button key={c.name} type="button" className="guide-concept" aria-expanded={on} style={tint(TONE[c.tone])} onClick={() => setOpen((s) => { const n = new Set(s); if (!n.delete(i)) n.add(i); return n; })}>
              <span className="k">
                <i aria-hidden="true" />
                {c.name}
              </span>
              <span className="s">
                <Rich text={c.short} />
              </span>
              {on && (
                <span className="more">
                  <Rich text={c.more} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Chapter>
  );
}

function MiniScreen({ m }: { m: Mini }) {
  const head = (meta: ReactNode) => (
    <div className="hd">
      <span>{m.title}</span>
      {meta}
    </div>
  );
  let body: ReactNode;
  switch (m.kind) {
    case "week":
      body = (
        <>
          {head(<span className="muted">{m.meta}</span>)}
          <div className="chips" aria-hidden="true">
            {m.chips.map((c, i) => (
              <i key={i} className={c ? "on" : ""} style={c ? tint(color(c)) : undefined} />
            ))}
          </div>
          <div className="card" style={tint(color(m.client.color))}>
            <div className="row">
              <b>{m.client.name}</b>
              <span className="muted end">{m.client.meta}</span>
            </div>
            {m.client.rows.map((r) => (
              <div key={r.title} className="row">
                <span>{r.title}</span>
                {r.flag ? <span className="pill watch end">{r.meta}</span> : <span className="muted end">{r.meta}</span>}
              </div>
            ))}
          </div>
          <div className="row muted">
            <span>{m.next}</span>
          </div>
        </>
      );
      break;
    case "plan":
      body = (
        <>
          {head(<span className="muted">{m.meta}</span>)}
          <div className="card" style={tint(color(m.color))}>
            <div className="row">
              <b>{m.client}</b>
              <span className="muted end">{m.fit}</span>
            </div>
            {m.stories.map((s) => (
              <div key={s.title} className="row">
                <span>{s.title}</span>
                <span className="guide-tag end">{s.size}</span>
              </div>
            ))}
            <div className="row meet">
              <span>{m.meeting}</span>
            </div>
            <div className="row free">
              <span>{m.free}</span>
            </div>
          </div>
        </>
      );
      break;
    case "now":
      body = (
        <>
          {head(<span className="pill risk">{m.risk}</span>)}
          <div className="card" style={tint(color(m.color))}>
            {m.rows.map((r) =>
              r.kind === "meeting" ? (
                <div key={r.text} className="row meet">
                  <span>{r.text}</span>
                </div>
              ) : (
                <div key={r.text} className="row">
                  <i className={`chk${r.kind === "done" ? " on" : ""}`} aria-hidden="true" />
                  {r.kind === "next" ? <b>{r.text}</b> : <span className={r.kind === "done" ? "done" : ""}>{r.text}</span>}
                  {r.kind === "next" && <span className="go end">{r.action}</span>}
                </div>
              ),
            )}
          </div>
        </>
      );
      break;
    case "check":
      body = (
        <>
          {head(<span className="muted">{m.meta}</span>)}
          <div className="card" style={tint(color(m.color))}>
            <div className="row">
              <b>{m.client}</b>
              <span className="muted end">{m.done}</span>
            </div>
            <div className="row">
              <span>{m.story}</span>
              <span className="guide-tag end">{m.size}</span>
              <span className="pill watch">{m.move}</span>
            </div>
            <div className="warn">{m.warn}</div>
          </div>
        </>
      );
      break;
    case "close":
      body = (
        <>
          {head(<span className="muted">{m.meta}</span>)}
          <div className="card" style={tint("var(--border-strong)")}>
            <div className="row muted">
              <span>{m.noteLabel}</span>
            </div>
            <div className="row">
              <span>{m.note}</span>
            </div>
          </div>
          <div className="card" style={tint("var(--watch)")}>
            <div className="row">
              <span>{m.devops}</span>
              <span className="go end">{m.devopsAction}</span>
            </div>
          </div>
          <div className="card" style={tint("var(--risk)")}>
            <div className="row">
              <span className="pill risk">{m.overdue}</span>
              <span>{m.overdueText}</span>
            </div>
          </div>
        </>
      );
      break;
  }
  return (
    <div className="guide-mini" aria-label={`${RHYTHM.example}: ${m.title}`}>
      {body}
      <div className="guide-example">{RHYTHM.example}</div>
    </div>
  );
}

function Rhythm({ cur, setCur }: { cur: number; setCur: (i: number) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const steps = RHYTHM.steps;
  const s = steps[cur]!;
  const pick = (i: number, focus: boolean) => {
    setCur(i);
    if (focus) tabs.current[i]?.focus({ preventScroll: true });
  };
  return (
    <Chapter id="rhythm" eyebrow={RHYTHM.eyebrow} title={RHYTHM.title} sub={RHYTHM.sub}>
      <div className="guide-rhythm">
        <div className="guide-steps" role="tablist" aria-label={RHYTHM.stepsLabel} aria-orientation="vertical">
          {steps.map((st, i) => (
            <button
              key={st.name}
              ref={(el) => void (tabs.current[i] = el)}
              type="button"
              role="tab"
              id={`guide-step-${i}`}
              aria-selected={i === cur}
              aria-controls="guide-step-panel"
              tabIndex={i === cur ? 0 : -1}
              className="guide-step"
              onClick={() => pick(i, false)}
              onKeyDown={(e) => {
                const n = steps.length;
                if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), e.stopPropagation(), pick((i + 1) % n, true));
                else if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), e.stopPropagation(), pick((i - 1 + n) % n, true));
              }}
            >
              <span className="guide-dot">{i + 1}</span>
              <span>
                <b>{st.name}</b>
                <small>{st.when.split(" · ")[0]}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="guide-panel" role="tabpanel" id="guide-step-panel" aria-labelledby={`guide-step-${cur}`} aria-live="polite">
          <div>
            <h3>{s.name}</h3>
            <div className="when">{s.when}</div>
            <ul>
              {s.what.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <div className="keys">
              {RHYTHM.shortcut} <Keys keys={keysFor(s.keys)} />
            </div>
            <div className="nav">
              <button type="button" className="quiet" disabled={cur === 0} onClick={() => pick(Math.max(0, cur - 1), true)}>
                {RHYTHM.back}
              </button>
              <button type="button" className="primary" onClick={() => pick(cur === steps.length - 1 ? 0 : cur + 1, true)}>
                {cur === steps.length - 1 ? RHYTHM.again : `${RHYTHM.next} ${steps[cur + 1]!.name}`}
              </button>
            </div>
          </div>
          <MiniScreen m={s.mini} />
        </div>
      </div>
    </Chapter>
  );
}

function Sizing() {
  const [stories, setStories] = useState<(StorySize | null)[]>(SIZING.start);
  const sb = useMemo(() => sandbox(stories, SIZING.block), [stories]);
  const sizes: (StorySize | null)[] = ["S", "M", "L", null];
  const freeHours = Math.round(SIZING.block.freeMinutes / 60);
  return (
    <Chapter id="sizing" eyebrow={SIZING.eyebrow} title={SIZING.title} sub={SIZING.sub}>
      <div className="guide-sandbox">
        <div className="guide-blockviz" style={tint(color(SIZING.block.color))}>
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
    </Chapter>
  );
}

function Devops() {
  return (
    <Chapter id="devops" eyebrow={DEVOPS.eyebrow} title={DEVOPS.title}>
      <div className="guide-principle">
        <div>
          <div className="guide-quote">
            {DEVOPS.quote[0]}
            <span>{DEVOPS.quote[1]}</span>
          </div>
          <p className="guide-sub">{DEVOPS.body}</p>
        </div>
        <div className="guide-ladder">
          {DEVOPS.ladder.map((r) => (
            <div key={r.level} className={`rung${r.flag ? " flag" : ""}`}>
              <span className="lvl">{r.icon && <TypeIcon type={r.level} look={{ icon: r.icon, color: null }} decorative />} {r.level}</span>
              <span>
                <Rich text={r.text} />
              </span>
            </div>
          ))}
        </div>
        <p className="guide-icons-intro">{DEVOPS.icons.intro}</p>
        <ul className="guide-icons" aria-label="Work item type icons">
          {DEVOPS.icons.legend.map((l) => (
            <li key={l.name}>
              <TypeIcon type={l.name} look={{ icon: l.icon, color: l.color }} decorative /> <span>{l.name}</span>
            </li>
          ))}
        </ul>
      </div>
      {DEVOPS.breakdown.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

function Shortcuts() {
  return (
    <Chapter id="keys" eyebrow={SHORTCUTS.eyebrow} title={SHORTCUTS.title} sub={SHORTCUTS.sub}>
      <div className="guide-keygrid">
        {SHORTCUTS.cards.map((c) => (
          <div key={c.label} className="guide-key" data-shortcut={c.label}>
            <span>{c.label}</span>
            <Keys keys={keysFor(c.keys, c.all)} />
          </div>
        ))}
      </div>
      <details className="guide-q guide-every">
        <summary>{SHORTCUTS.every}</summary>
        <dl className="key-list">
          {KEYS.map((k) => (
            <Fragment key={k.does}>
              <dt>
                <Keys keys={k.keys} />
              </dt>
              <dd>{k.does}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </Chapter>
  );
}

function Phone() {
  return (
    <Chapter id="phone" eyebrow={PHONE.eyebrow} title={PHONE.title} sub={PHONE.sub}>
      {PHONE.items.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

function AsksChapter() {
  return (
    <Chapter id="asks" eyebrow={ASKS.eyebrow} title={ASKS.title} sub={ASKS.sub}>
      {ASKS.items.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

function TeamChapter() {
  return (
    <Chapter id="team" eyebrow={TEAM.eyebrow} title={TEAM.title} sub={TEAM.sub}>
      {TEAM.items.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

function TeamsBotChapter() {
  return (
    <Chapter id="teams" eyebrow={TEAMS_BOT.eyebrow} title={TEAMS_BOT.title} sub={TEAMS_BOT.sub}>
      {TEAMS_BOT.items.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

function Questions() {
  return (
    <Chapter id="questions" eyebrow={QUESTIONS.eyebrow} title={QUESTIONS.title}>
      {QUESTIONS.items.map((x) => (
        <details key={x.q} className="guide-q">
          <summary>{x.q}</summary>
          <p>
            <Rich text={x.a} />
          </p>
        </details>
      ))}
    </Chapter>
  );
}

/** The sections a legacy chapter draws (UI-5 keeps G1's chapters, facts fixed, until the next build replaces them). */
function Section({ id, step, setStep, onTour }: { id: SectionId; step: number; setStep: (n: number) => void; onTour: ((id: string) => void) | null }) {
  switch (id) {
    case "start":
      return <StartHere onTour={onTour} />;
    case "basics":
      return <Basics />;
    case "rhythm":
      return <Rhythm cur={step} setCur={setStep} />;
    case "sizing":
      return <Sizing />;
    case "devops":
      return <Devops />;
    case "keys":
      return <Shortcuts />;
    case "phone":
      return <Phone />;
    case "asks":
      return <AsksChapter />;
    case "team":
      return <TeamChapter />;
    case "teams":
      return <TeamsBotChapter />;
    case "questions":
      return <Questions />;
  }
}

/**
 * The Guide (UI-5): one section at a time beside a rail, like Settings. In the app it sits over the current place
 * (Esc or Close goes back); signed out it is a page of its own from the sign-in screen. `chapter` is the section in
 * the address (#/guide/<section>; none or unknown: Start here). `onTour` starts a Show me tour (null signed out).
 */
export function Guide({ chapter, onClose, onSection, onTour = null, closeLabel = TOUR.close, standalone = false }: { chapter: string | null; onClose: () => void; onSection: (id: string) => void; onTour?: ((id: string) => void) | null; closeLabel?: string; standalone?: boolean }) {
  const [step, setStep] = useState(0);
  const current: SectionId = SECTIONS.find((s) => s.id === chapter)?.id ?? "start";
  return (
    <GuideFrame title={GUIDE_TITLE} rail={SECTIONS.map((s) => ({ id: s.id, label: s.name, group: s.group }))} groups={SECTION_GROUPS} current={current} onPick={onSection} onClose={onClose} closeLabel={closeLabel} standalone={standalone}>
      <div className="guide-wrap guide-body" data-section={current}>
        <Section id={current} step={step} setStep={setStep} onTour={onTour} />
        <footer className="guide-footer">
          <Lumen pose="still" size={22} />
          <span>
            <Rich text={FOOTER} />
          </span>
        </footer>
      </div>
    </GuideFrame>
  );
}

export default Guide;
