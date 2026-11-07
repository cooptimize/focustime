// DOC-1: the Technical docs' addresses (#/docs, #/docs/<page>, #/docs/<page>/<heading>), the page list matching the
// files the build renders, and who may open them (docs.access).
import { describe, expect, it } from "vitest";
import { docsAccessAction } from "../../actions/docs-actions.ts";
import { TECH_PAGES } from "../../scripts/tech-docs.ts";
import { hashOf, parseHash } from "../nav.ts";
import { DOC_PAGES, docPageFor } from "./pages.ts";

const overlay = (h: string) => parseHash(h)?.overlay ?? "unknown";

describe("Technical docs addresses", () => {
  it("parse a page and a heading, and write the same address back", () => {
    expect(overlay("#/docs")).toEqual({ kind: "docs", page: null, heading: null });
    expect(overlay("#/docs/security")).toEqual({ kind: "docs", page: "security", heading: null });
    expect(overlay("#/docs/security/secrets")).toEqual({ kind: "docs", page: "security", heading: "secrets" });
    expect(overlay("#/docs/contents")).toEqual({ kind: "docs", page: "contents", heading: null });
    for (const h of ["#/docs", "#/docs/security", "#/docs/security/secrets", "#/docs/data/what-is-never-stored"]) expect(hashOf(parseHash(h)!)).toBe(h);
  });

  it("refuse an unknown page, a bad heading, a heading on the contents list and anything longer", () => {
    for (const h of ["#/docs/nope", "#/docs/security/Secrets", "#/docs/security/<script>", "#/docs/contents/x", "#/docs/security/secrets/more"]) expect(parseHash(h), h).toBeNull();
  });

  it("an unknown page id opens the Overview; contents is the phone's list", () => {
    expect(docPageFor(null)).toBe("overview");
    expect(docPageFor("contents")).toBeNull();
    expect(docPageFor("data")).toBe("data");
  });

  it("the rail's pages are the files the build renders, in the same order", () => {
    expect(DOC_PAGES.map((p) => p.id)).toEqual(TECH_PAGES.map((p) => p.id));
  });
});

describe("docs.access", () => {
  it("lets a Cooptimizer in and refuses an automation account", async () => {
    expect(await docsAccessAction({ automation: async () => false }, {})).toEqual({ ok: true, data: { allowed: true } });
    expect(await docsAccessAction({ automation: async () => true }, {})).toEqual({ ok: true, data: { allowed: false, why: "automation" } });
  });

  it("does not guess when the account can't be checked, and takes no input", async () => {
    expect(await docsAccessAction({ automation: async () => Promise.reject(new Error("down")) }, undefined)).toEqual({ ok: true, data: { allowed: false, why: "unknown" } });
    expect((await docsAccessAction({ automation: async () => false }, { as: "someone" })).ok).toBe(false);
    expect((await docsAccessAction({ automation: async () => false }, [])).ok).toBe(false);
  });
});
