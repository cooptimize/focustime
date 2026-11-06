// AI-0: the guard decides what may go to the AI provider. Another client's name, nickname, DevOps project or work item
// id refuses; so do token, key and secret shapes, the person's VM, and email addresses from outside Cooptimize. The
// task's own client, and ordinary text, pass. Fake values are built here at run time (nothing secret-shaped in the repo).
import { describe, expect, it } from "vitest";
import { aClientEntry } from "../test/builders/index.ts";
import { guard, otherClientMatch, redact, redactValue, type GuardInput } from "./guard.ts";

const directory = [
  aClientEntry({ key: "fabrikam", names: ["Fabrikam Inc"], projects: ["Fabrikam Portal"], itemIds: [4101, 4102] }),
  aClientEntry({ key: "Northwind", names: ["Northwind Traders"], projects: ["NW Ops"], itemIds: [5150, 77] }),
];
const g = (client: string, o: Partial<GuardInput> = {}): GuardInput => ({ client, directory, homeDomains: ["cooptimize.example"], forbidden: ["vm-sam-dev", "/subscriptions/x/vm-sam-dev"], ...o });
const rep = (c: string, n: number) => c.repeat(n);

describe("one client per request", () => {
  it.each([
    ["another client's key", "Ask Northwind about the export", "client_name"],
    ["another client's Dataverse name, any case", "the northwind traders invoice", "client_name"],
    ["another client's project", "In NW Ops the build failed", "devops_project"],
    ["another client's work item id", "Story 5150 is late", "work_item"],
    ["another client's work item with #", "see #5150", "work_item"],
  ])("%s refuses", (_why, text, rule) => {
    expect(guard(text, g("fabrikam"))).toEqual({ kind: "refused_client", rule, entry: "Northwind" });
  });

  it.each([
    ["its own name and nickname", "Fabrikam Inc asked: can fabrikam get the export?"],
    ["its own project and items", "Fabrikam Portal #4101 and 4102 are in progress"],
    ["short numbers, times and dates", "3 stories, 2h left, due 2026-11-06 at 10:30, 15 minutes"],
    ["a number that only looks like a short id of another client", "We have 77 tests"],
    ["a word that contains a client name", "Northwindy weather"],
    ["its own link", "https://dev.azure.com/contoso/Fabrikam%20Portal/_workitems/edit/4101"],
  ])("%s passes", (_why, text) => {
    expect(guard(text, g("fabrikam"))).toBeNull();
  });

  // AP-2: only ids known to be another client's refuse; any other number passes, however it is written.
  it.each([
    ["an unrelated number", "We moved 1500 rows"],
    ["a five-digit number nobody has", "Order 20419 shipped"],
    ["a date", "due 5150-01-02"],
    ["an amount", "it costs $5150 a month, or 5,150 a year"],
    ["a decimal and a version", "release 5150.2 and 1.5150"],
    ["a percentage", "5150% of the target"],
    ["a time", "at 10:30"],
  ])("%s passes", (_why, text) => {
    expect(guard(text, g("fabrikam"))).toBeNull();
  });

  it('client "none": every client is another client', () => {
    expect(guard("Say ok.", g("none"))).toBeNull();
    expect(guard("Fabrikam needs this", g("none"))?.kind).toBe("refused_client");
    expect(guard("item 4101", g("none"))?.kind).toBe("refused_client");
  });

  it("an id both clients have (two DevOps orgs) belongs to the task's own client", () => {
    const both = [aClientEntry({ key: "fabrikam", itemIds: [900] }), aClientEntry({ key: "contoso", names: [], projects: [], itemIds: [900] })];
    expect(guard("item 900", g("fabrikam", { directory: both }))).toBeNull();
  });
});

describe("never sent: tokens, keys, secrets, VM details, outside email addresses", () => {
  const b64 = "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG";
  it.each([
    ["an Authorization header", "Authorization: Basic abc"],
    ["a bearer token", `Bearer ${rep("x", 12)}.${rep("y", 12)}`],
    ["a JWT", `eyJ${rep("a", 20)}.${rep("b", 20)}.${rep("c", 10)}`],
    ["an OpenAI key", `sk-proj-${rep("A1b2", 8)}`],
    ["a DevOps PAT", `pat ${rep("abcdefghijklmnopqrstuvwxyz234567", 2).slice(0, 52)} here`],
    ["a new-format DevOps PAT", `${rep("Ab1", 25)}AZDO${rep("x", 4)}`],
    ["an Entra client secret", `the secret is abc8Q~${rep("Zx9_", 9)}`],
    ["a GitHub token", `ghp_${rep("a1", 18)}`],
    ["a Google API key", `AIza${rep("b", 35)}`],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["a password in a connection string", "Server=x;Password=hunter2hunter2;"],
    ["an api_key assignment", 'api_key = "abcdef123456"'],
    ["a SAS signature", "https://x.blob.core.windows.net/c?sv=1&sig=abcdefghijklmnopqrstuvwxyz123"],
    ["an Azure resource id", "/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg/providers/x"],
    ["a long random key", `value ${b64}`],
  ])("%s refuses", (_why, text) => {
    expect(guard(text, g("fabrikam"))?.kind).toBe("refused_secret");
  });

  it("the person's VM name refuses", () => {
    expect(guard("start vm-sam-dev please", g("fabrikam"))).toEqual({ kind: "refused_secret", rule: "vm" });
  });

  it("an email address outside Cooptimize refuses; Cooptimize's (and its subdomains) pass", () => {
    expect(guard("from dana@fabrikam.example", g("fabrikam"))).toEqual({ kind: "refused_email", rule: "external_email" });
    expect(guard("cc lee@cooptimize.example and ops@mail.cooptimize.example", g("fabrikam"))).toBeNull();
  });

  it.each([
    ["a GUID", "id 0f8fad5b-d9cb-469f-a165-70867728950e"],
    ["a sentence about passwords", "The password reset page fails"],
    ["a work item link", "https://dev.azure.com/contoso/Fabrikam%20Portal/_workitems/edit/4101"],
    ["a long plain word list", "acknowledgement documentation internationalization"],
  ])("%s passes", (_why, text) => {
    expect(guard(text, g("fabrikam"))).toBeNull();
  });
});

// GD-1: Cooptimize Internal's work is about clients, so an Internal request may name them; nothing else changes.
describe("Cooptimize Internal (internal: true)", () => {
  const internal = (o: Partial<GuardInput> = {}) => g("internal-key", { internal: true, ...o });
  it.each([
    ["two clients' names", "Compare the Fabrikam Inc and Northwind Traders exports"],
    ["a client's project", "In NW Ops and Fabrikam Portal the build failed"],
    ["clients' work items", "see #5150 and 4101"],
  ])("%s passes", (_why, text) => {
    expect(guard(text, internal())).toBeNull();
  });

  it.each([
    ["a token", `ghp_${rep("a1", 18)}`],
    ["an Authorization header", "Authorization: Basic abc"],
  ])("%s still refuses", (_why, text) => {
    expect(guard(`Fabrikam: ${text}`, internal())?.kind).toBe("refused_secret");
  });

  it("the VM and outside email addresses still refuse", () => {
    expect(guard("start vm-sam-dev", internal())).toEqual({ kind: "refused_secret", rule: "vm" });
    expect(guard("Northwind's dana@fabrikam.example", internal())).toEqual({ kind: "refused_email", rule: "external_email" });
  });

  it("without the flag the same key is like any client: the others refuse", () => {
    expect(guard("Fabrikam Inc and Northwind", g("internal-key"))?.kind).toBe("refused_client");
  });
});

describe("which client matched (for the log's client ref and the DevOps preview)", () => {
  it("a hit names the matched entry's key, never the text", () => {
    expect(guard("the northwind traders invoice", g("fabrikam"))).toEqual({ kind: "refused_client", rule: "client_name", entry: "Northwind" });
  });
  it("otherClientMatch gives the other client's first name for the preview", () => {
    expect(otherClientMatch("see #5150", "fabrikam", directory)).toEqual({ key: "Northwind", name: "Northwind Traders", rule: "work_item" });
    expect(otherClientMatch("Fabrikam Portal only", "fabrikam", directory)).toBeNull();
  });
  it("the task's own client matches its entry whatever the case of its key (no false match on its own name)", () => {
    expect(guard("Northwind Traders asked about NW Ops #5150", g("northwind"))).toBeNull();
    expect(guard("Fabrikam Inc asked", g("FABRIKAM"))).toBeNull();
  });
});

describe("redact (HK-4)", () => {
  const g = { homeDomains: ["cooptimize.example"], forbidden: ["vm-contoso-dev"] };
  it("replaces only the spans and keeps the rest, with kinds and rules but never the text", () => {
    const pat = "a".repeat(20) + "b2c3d4e5f6g7".repeat(2) + "h".repeat(8);
    const r = redact(`see ${pat}, token: Bearer ${"x".repeat(20)} on vm-contoso-dev, mail jo@else.example or me@cooptimize.example`, g);
    expect(r.text).toBe("see [removed], token: [removed] on [removed], mail [removed] or me@cooptimize.example");
    expect(r.removed.map((x) => x.rule).sort()).toEqual(["bearer_token", "devops_pat", "external_email", "vm"]);
  });
  it("clean text comes back unchanged", () => {
    expect(redact("Export fails on 2026-11-06 at 10:30, item #5150", g)).toEqual({ text: "Export fails on 2026-11-06 at 10:30, item #5150", removed: [] });
  });
  it("redactValue walks arrays and objects; keys are never touched", () => {
    const r = redactValue({ items: [{ note: "ok" }, { note: "jo@else.example" }], n: 3 }, g);
    expect(r.value).toEqual({ items: [{ note: "ok" }, { note: "[removed]" }], n: 3 });
    expect(r.removed).toEqual([{ kind: "email", rule: "external_email" }]);
  });
});
