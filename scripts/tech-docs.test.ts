// DOC-1: the technical docs stay honest. Every page has its "Checked against" line; every relative link and heading
// it points to exists; every Graph permission the code or the setup script asks for is listed in integrations.md;
// every diagram is drawn and none is left over; nothing in the pages looks like a secret; and the rendering keeps
// raw HTML, script URLs and event handlers inert.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../plan/permissions.ts";
import { wantedDiagrams } from "./docs-diagrams.ts";
import { anchorsOf, checkSvg, CHECKED_RE, DOCS_DIR, DocsError, linkTarget, renderAll, renderPage, TECH_PAGES, unstyleSvg } from "./tech-docs.ts";

const root = resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const pageText = (file: string) => read(`${DOCS_DIR}/${file}`);
/** Markdown links outside code: [text](href). */
const linksOf = (md: string) => [...md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "").matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
/** A Markdown file's heading anchors, the way GitHub and the panel make them. */
const anchorsIn = (md: string) => anchorsOf([...md.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1]!.replace(/[`*_]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim()));

describe("the technical docs (DOC-1)", () => {
  it("has every page, each with who it's for and its Checked against line", () => {
    for (const p of TECH_PAGES) {
      const md = pageText(p.file);
      expect(md, p.file).toMatch(/^# /);
      expect(CHECKED_RE.test(md), `${p.file} needs "Checked against <sha> on <Mon D, YYYY>"`).toBe(true);
      expect(md.split("\n").slice(0, 4).join(" "), `${p.file}: who it's for, at the top`).toMatch(/\bFor\b/);
    }
  });

  it("links only to files and headings that exist", () => {
    const bad: string[] = [];
    for (const p of TECH_PAGES) {
      for (const href of linksOf(pageText(p.file))) {
        const to = linkTarget(href, p.file, p.id);
        if (to.kind === "web" || to.kind === "drop") continue;
        const file = to.kind === "doc" ? `${DOCS_DIR}/${TECH_PAGES.find((x) => x.id === to.page)!.file}` : to.path;
        if (!existsSync(join(root, file))) {
          bad.push(`${p.file}: ${href} (no file ${file})`);
          continue;
        }
        if (to.anchor && file.endsWith(".md") && !anchorsIn(read(file)).includes(to.anchor)) bad.push(`${p.file}: ${href} (no heading #${to.anchor} in ${file})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("lists every Graph permission the code and the setup script ask for", () => {
    const integrations = pageText("integrations.md");
    const fromRegistry = PERMISSIONS.map((p) => p.scope);
    const fromScript = (/GRAPH_SCOPES=\(([^)]*)\)/.exec(read("infra/scripts/app-registration.sh"))?.[1] ?? "").split(/\s+/).filter(Boolean);
    const oauth = read("sources/oauth/oauth.ts");
    const fromOauth = [...oauth.matchAll(/graph\.microsoft\.com\/([A-Za-z]+\.[A-Za-z.]+)/g), ...oauth.matchAll(/"(Calendars\.Read[A-Za-z]*)"/g)].map((m) => m[1]!);
    expect(fromScript.length).toBeGreaterThan(5);
    expect(fromOauth.length).toBeGreaterThan(5);
    const all = [...new Set([...fromRegistry, ...fromScript, ...fromOauth])];
    expect(all.filter((s) => !integrations.includes(`\`${s}\``))).toEqual([]);
  });

  it("has every diagram drawn, and no drawing no page uses", () => {
    const dir = join(root, DOCS_DIR, "diagrams");
    const have = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)) : [];
    const wanted = [...wantedDiagrams(root).keys()];
    expect(wanted.filter((k) => !have.includes(k)), "run npm run docs:diagrams").toEqual([]);
    expect(have.filter((k) => !wanted.includes(k)), "run npm run docs:diagrams").toEqual([]);
  });

  it("holds nothing that looks like a secret", () => {
    const shapes: [string, RegExp][] = [
      ["a GUID (tenant, subscription or client id)", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
      ["a long hex string", /\b[0-9a-f]{32,}\b/i],
      ["a long base64 string", /[A-Za-z0-9+/]{40,}={0,2}/],
      ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\./],
      ["an OpenAI key", /\bsk-[A-Za-z0-9_-]{16,}/],
      ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
      ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["a connection string secret", /(Password|Pwd|AccountKey|SharedAccessKey|client_secret)\s*=/i],
      ["an Authorization header value", /Authorization:\s*(Basic|Bearer)\s+\S/i],
      ["a company email address", /[A-Za-z0-9._%+-]+@cooptimize\.org/i],
    ];
    // Resource and app names are fine: ft-<env>-app, ft-dev-kv-<suffix>, ft-data-key and the like.
    const hits: string[] = [];
    for (const p of TECH_PAGES) {
      const md = pageText(p.file);
      md.split("\n").forEach((line, i) => {
        for (const [what, re] of shapes) if (re.test(line)) hits.push(`${p.file}:${i + 1}: ${what}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("renders every page, with headings as anchors", () => {
    const docs = renderAll(root);
    expect(docs.pages.map((p) => p.id)).toEqual(TECH_PAGES.map((p) => p.id));
    for (const p of docs.pages) {
      expect(p.title, p.file).not.toBe("");
      expect(p.headings.length, p.file).toBeGreaterThan(1);
      for (const h of p.headings) expect(p.html).toContain(`data-anchor="${h.anchor}"`);
      expect(p.checked, p.file).not.toBeNull();
    }
    const security = docs.pages.find((p) => p.id === "security")!;
    expect(security.html).toContain('<figure class="td-diagram"');
    expect(security.html).not.toMatch(/\sstyle\s*=|<style/);
  });
});

describe("rendering a page", () => {
  const ctx = { file: "README.md", pageId: "overview", diagram: () => null };

  it("shows raw HTML as text: a script tag is inert", () => {
    const r = renderPage("# T\n\n<script>alert(1)</script>\n\nHello <img src=x onerror=alert(1)> there\n", ctx);
    expect(r.html).not.toMatch(/<script|<img/i);
    expect(r.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("drops script URLs and keeps safe links", () => {
    const r = renderPage("# T\n\n[bad](javascript:alert(1)) [web](https://example.com) [page](security.md#secrets) [file](../../server/app.ts) [here](#t)\n", ctx);
    expect(r.html).not.toMatch(/javascript:/i);
    expect(r.html).toContain('href="https://example.com" target="_blank" rel="noreferrer noopener"');
    expect(r.html).toContain('href="#/docs/security/secrets" data-doc="security"');
    expect(r.html).toContain('href="https://github.com/cooptimize/focustime/blob/main/server/app.ts"');
  });

  it("refuses a diagram that holds a script or an event handler", () => {
    expect(() => checkSvg('<svg><script>alert(1)</script></svg>', "t")).toThrow(DocsError);
    expect(() => checkSvg('<svg><rect onclick="x()"/></svg>', "t")).toThrow(DocsError);
    expect(() => checkSvg('<svg><a href="https://example.com"><text>x</text></a></svg>', "t")).toThrow(DocsError);
    expect(() => checkSvg('<svg><path marker-end="url(#arrow)"/></svg>', "t")).not.toThrow();
  });

  it("moves a diagram's styles into a stylesheet (the app's CSP allows no inline styles)", () => {
    const u = unstyleSvg('<svg id="d1" style="max-width: 300px;"><style>#d1 .a{fill:red}</style><rect class="a" style="fill:blue"/><rect style="fill:blue"/></svg>');
    expect(u.svg).not.toMatch(/style/);
    expect(u.svg.match(/tds-[0-9a-f]{10}/g)?.length).toBe(3);
    expect(u.css).toContain("#d1 .a{fill:red}");
    expect(u.css).toMatch(/\.tds-[0-9a-f]{10}\{fill:blue\}/);
    expect(u.svg).toContain('class="a tds-');
  });

  it("fails on a diagram that isn't drawn", () => {
    expect(() => renderPage("# T\n\n```mermaid\nflowchart LR\n  a --> b\n```\n", ctx)).toThrow(/npm run docs:diagrams/);
  });
});
