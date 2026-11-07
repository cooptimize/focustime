// DOC-1: the Technical docs (#/docs/<page>/<heading>), on ST-1's panel shell like UI-5's Guide: the rail of pages with
// search at its top, the title, ×, Esc, focus on the title and back to the opener; on a phone or a narrow window the
// rail is its own list page (#/docs/contents). The pages are docs/technical/*.md rendered and sanitized at build time
// (scripts/tech-docs.ts), so they are always this build's. Loaded only when opened (ui/App.tsx), with its diagrams'
// styles. Opens for signed-in Cooptimizers; an automation account gets "not available" (docs.access).
import { useEffect, useMemo, useRef, useState } from "react";
import docs from "virtual:tech-docs";
import "virtual:tech-docs.css";
import type { DocsAccess } from "../../actions/docs-actions.ts";
import { REPO } from "../About.tsx";
import { useGuideList } from "../guide/GuideFrame.tsx";
import { SearchBox, searchEntries, SearchResults } from "../guide/Search.tsx";
import { PanelShell, type RailGroup } from "../PanelShell.tsx";
import { DOC_CONTENTS, DOC_PAGES, DOCS_TEXT, docPageFor, docPageLabel } from "./pages.ts";
import "./docs.css";

type Entry = { page: string; anchor: string | null; title: string; text: string };

/** Every section of every page, to search: the page's title, then each heading with the text under it. */
export function docsIndex(): Entry[] {
  return docs.pages.flatMap((p) => p.search.map((s) => ({ page: p.id, anchor: s.anchor, title: s.anchor ? s.title : p.title, text: s.text })));
}

function useBuildSha(): string | null {
  const [sha, setSha] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/version", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sha?: unknown }>) : null))
      .then((b) => live && typeof b?.sha === "string" && setSha(b.sha.slice(0, 12)))
      .catch(() => undefined);
    return () => void (live = false);
  }, []);
  return sha;
}

export default function TechDocs({
  page,
  heading,
  onGo,
  onClose,
  access,
}: {
  page: string | null;
  heading: string | null;
  /** Opens a page, at a heading (null: the top); `contents` is the phone's list. */
  onGo: (page: string, heading: string | null) => void;
  onClose: () => void;
  access: () => Promise<DocsAccess>;
}) {
  const list = useGuideList();
  const current = docPageFor(page) ?? (list ? null : "overview");
  const doc = current ? docs.pages.find((p) => p.id === current) ?? null : null;
  const [allowed, setAllowed] = useState<DocsAccess | null>(null);
  const [q, setQ] = useState("");
  const index = useMemo(docsIndex, []);
  const hits = useMemo(() => searchEntries(q, index), [q, index]);
  const sha = useBuildSha();
  const body = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    access().then(
      (a) => live && setAllowed(a),
      () => live && setAllowed({ allowed: false, why: "unknown" }),
    );
    return () => void (live = false);
  }, [access]);

  // A heading in the address: bring it into view and focus it, after the shell's own focus on the title.
  useEffect(() => {
    if (!heading || !doc || !allowed?.allowed) return;
    const t = setTimeout(() => {
      const el = body.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(heading)}"]`);
      if (!el) return;
      el.tabIndex = -1;
      el.scrollIntoView?.({ block: "start" });
      // On a phone the page itself scrolls under the sticky top bar: keep the heading below it.
      const bar = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 0;
      const top = el.getBoundingClientRect().top;
      if (top < bar + 8) window.scrollBy(0, top - bar - 12);
      el.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(t);
  }, [heading, doc, allowed]);

  const go = (e: Entry) => {
    setQ("");
    onGo(e.page, e.anchor);
  };
  const ok = allowed?.allowed === true;
  const groups: RailGroup[] = ok ? [{ id: "docs", label: DOCS_TEXT.name, items: DOC_PAGES.map((p) => ({ id: p.id, label: p.label, href: `#/docs/${p.id}` })) }] : [];
  return (
    <PanelShell
      name={DOCS_TEXT.name}
      className="tech-docs"
      groups={groups}
      current={ok ? current : "overview"}
      onPick={(id) => (setQ(""), onGo(id, null))}
      onClose={onClose}
      onBack={list && ok && current !== null ? () => onGo(DOC_CONTENTS, null) : null}
      backLabel={DOCS_TEXT.name}
      title={ok && doc ? doc.title : DOCS_TEXT.name}
      railTop={ok ? <SearchBox q={q} setQ={setQ} first={() => hits[0] && go(hits[0])} label={DOCS_TEXT.search} placeholder={DOCS_TEXT.search} /> : undefined}
      railOverride={
        ok && q.trim() ? (
          <SearchResults
            rows={hits.map((h, i) => ({ key: `${h.page}${h.anchor ?? ""}${i}`, title: h.title, where: DOCS_TEXT.in(docPageLabel(h.page)) }))}
            label={DOCS_TEXT.results(hits.length)}
            count={hits.length ? DOCS_TEXT.results(hits.length) : DOCS_TEXT.none(q)}
            onGo={(i) => go(hits[i]!)}
          />
        ) : undefined
      }
      phone={list}
      pageKey={`${current ?? DOC_CONTENTS}`}
    >
      {allowed === null ? (
        <p className="td-note" role="status">
          {DOCS_TEXT.checking}
        </p>
      ) : !ok ? (
        <p className="td-note" role="status" data-docs-refused={allowed.allowed ? undefined : allowed.why}>
          {allowed.allowed ? null : allowed.why === "automation" ? DOCS_TEXT.automation : DOCS_TEXT.unknown}
        </p>
      ) : doc ? (
        <>
          <article ref={body} className="td-body" data-doc-page={doc.id} dangerouslySetInnerHTML={{ __html: doc.html }} />
          <footer className="td-footer">
            <span data-build>{sha ? DOCS_TEXT.build(sha) : null}</span>
            <a href={`${REPO}/edit/main/docs/technical/${doc.file}`} target="_blank" rel="noreferrer noopener">
              {DOCS_TEXT.edit}
            </a>
          </footer>
        </>
      ) : null}
    </PanelShell>
  );
}
