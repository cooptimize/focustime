import { describe, expect, it } from "vitest";
import type { SourceSummary } from "../actions/types.ts";
import type { ClientWork } from "../week/types.ts";
import { causeLines, sourceActions, stateOf } from "./status.ts";
import { workStatusLabel } from "./work.ts";

const AT = "2026-10-31T15:49:00-04:00";
const src = (source: SourceSummary["source"], over: Partial<SourceSummary> = {}): SourceSummary => ({ source, status: "ok", fetchedAt: AT, fromCache: false, itemCount: 3, ...over });
const locked = (source: SourceSummary["source"]) => src(source, { status: "error", fromCache: true, cause: "keyring", message: "Secret storage unavailable (Secret Service). Unlock the keyring and retry. Showing data from 3:49 PM" });
const client = (clientKey: string, over: Partial<ClientWork> = {}): ClientWork => ({ clientKey, clientName: clientKey, status: "ok", fetchedAt: AT, fromCache: false, items: [], children: [], ...over });
const lockedClient = (k: string) => client(k, { status: "error", fromCache: true, cause: "keyring", message: "DevOps settings unavailable (keyring locked). Showing items from 3:49 PM" });

describe("status lines, one per root cause", () => {
  it("a locked keyring shows once and names every source it affects, DevOps included", () => {
    const lines = causeLines([locked("dataverse"), locked("pto"), locked("outlook"), locked("google")], ["A", "B", "C", "D"].map(lockedClient));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ cause: "keyring", affected: ["Dataverse", "PTO", "Outlook", "Google", "DevOps (4 clients)"], step: "Unlock the keyring", since: AT, missing: false, fixes: [{ kind: "retry" }] });
    expect(lines[0]!.text).toBe("Keyring locked or unavailable, so Dataverse, PTO, Outlook, Google and DevOps (4 clients) can't sign in");
  });

  it("offline sources collapse into one line too, and the oldest saved data is named", () => {
    const older = "2026-10-30T09:00:00-04:00";
    const net = (s: SourceSummary["source"], at = AT) => src(s, { status: "unreachable", fromCache: true, fetchedAt: at, cause: "network", message: "Offline, showing data from 3:49 PM" });
    const [line, ...rest] = causeLines([net("dataverse"), net("pto", older), net("outlook")], [client("A", { status: "unreachable", cause: "network", fromCache: false, fetchedAt: null })]);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ cause: "network", affected: ["Dataverse", "PTO", "Outlook", "DevOps (1 client)"], since: older, missing: true });
  });

  it("a failure of its own keeps its own line, after the shared cause; identical messages show once", () => {
    const own = src("google", { status: "misconfigured", fromCache: true, message: "Google refused access: check the calendar permission for FocusTime. Showing data from 3:49 PM" });
    const lines = causeLines([locked("dataverse"), locked("pto"), own], null);
    expect(lines.map((l) => l.key)).toEqual(["keyring", expect.stringMatching(/^msg:/)]);
    expect(lines[1]).toMatchObject({ cause: null, affected: ["Google"], text: "Google refused access: check the calendar permission for FocusTime", since: AT });
  });

  it("live, sample and never-connected sources are not failures; DevOps failures of its own stay in its popover", () => {
    const fresh = src("outlook", { status: "auth_required", fromCache: false, fetchedAt: null, fixAction: "connect_microsoft", message: "Outlook is not connected yet" });
    const devops = [client("A", { status: "auth_failed", fromCache: true, message: "DevOps PAT expired or invalid for A" })];
    expect(causeLines([src("dataverse"), src("google", { sample: true }), fresh], devops)).toEqual([]);
  });

  it("an expired calendar offers Reconnect on its line, not Retry", () => {
    const expired = src("outlook", { status: "auth_required", fromCache: true, fixAction: "connect_microsoft", message: "Outlook needs reconnecting. Showing data from Oct 31 3:49 PM" });
    expect(causeLines([expired], null)[0]).toMatchObject({ text: "Outlook needs reconnecting", fixes: [{ kind: "reconnect", calendar: "outlook" }] });
  });
});

describe("actions a source offers", () => {
  it("Disconnect only on a live calendar", () => {
    expect(sourceActions(src("outlook"))).toEqual(["disconnect"]);
    expect(sourceActions(src("dataverse"))).toEqual([]);
  });

  it("no Disconnect while a calendar shows cached data because of a shared failure", () => {
    expect(sourceActions(locked("outlook"))).toEqual([]);
    expect(sourceActions(src("google", { status: "unreachable", fromCache: true, cause: "network" }))).toEqual([]);
  });

  it("Connect when never connected, Reconnect when expired, nothing for sample data", () => {
    expect(sourceActions(src("outlook", { status: "auth_required", fixAction: "connect_microsoft", message: "Outlook is not connected yet", fetchedAt: null }))).toEqual(["connect"]);
    expect(sourceActions(src("google", { status: "auth_required", fromCache: true, fixAction: "connect_google", message: "Google needs reconnecting" }))).toEqual(["reconnect"]);
    expect(sourceActions(src("google", { sample: true }))).toEqual([]);
  });

  it("the chip says cached when saved data shows, failed when nothing does", () => {
    expect(stateOf(locked("dataverse")).label).toBe("cached");
    expect(stateOf(src("dataverse", { status: "error", cause: "keyring", fromCache: false })).label).toBe("failed");
  });
});

describe("DevOps names the true cause", () => {
  it("a locked keyring reads as keyring locked, not unreachable", () => {
    expect(workStatusLabel(lockedClient("Proseware"))).toBe("cached (keyring locked)");
    expect(workStatusLabel(client("A", { status: "unreachable", cause: "network", fromCache: true }))).toBe("cached (offline)");
    expect(workStatusLabel(client("A", { status: "auth_failed", fromCache: true }))).toBe("cached (PAT expired or invalid)");
  });
});

describe("calendar links in the status (CAL-1)", () => {
  const link = (id: string, name: string, broken: boolean) => ({ id, name, color: "#0d9488", kind: "personal" as const, mode: "busy" as const, broken });
  it("a link that stopped working: its own line by name, Replace link, and the chip says so", () => {
    const stopped = src("ics", { status: "error", fromCache: true, message: "The link stopped working. Replace it?", fixAction: "open_settings", link: link("a1", "Family", true) });
    const [line] = causeLines([src("outlook"), stopped], []);
    expect(line).toMatchObject({ affected: ["Family"], text: "Family: The link stopped working", fixes: [{ kind: "replace_link", id: "a1" }], since: AT });
    expect(stateOf(stopped)).toEqual({ cls: "error", label: "stopped working" });
    expect(sourceActions(stopped)).toEqual([]);
  });

  it("two links failing alike keep a line each; a passing problem is a Retry", () => {
    const slow = (id: string, name: string) => src("ics", { status: "unreachable", fromCache: true, message: "The calendar's server took too long to answer", link: link(id, name, false) });
    const lines = causeLines([slow("a1", "Family"), slow("b2", "School")], []);
    expect(lines.map((l) => [l.text, l.fixes])).toEqual([
      ["Family: The calendar's server took too long to answer", [{ kind: "retry" }]],
      ["School: The calendar's server took too long to answer", [{ kind: "retry" }]],
    ]);
  });
});

describe("RF-1: the status bar is the one place a computer reconnects a source", () => {
  it("every line Day's strip used to show has a fix the bar draws: Reconnect for a calendar that needs sign-in, else Retry or Replace link", () => {
    const google = src("google", { status: "auth_required", fixAction: "connect_google", fetchedAt: null, itemCount: 0, message: "Google needs you to sign in again" });
    const outlook = src("outlook", { status: "auth_required", fixAction: "connect_microsoft", fromCache: true, message: "Sign in again" });
    const dv = src("dataverse", { status: "unreachable", fromCache: true, message: "Dataverse didn't answer" });
    const lines = causeLines([google, outlook, dv, locked("pto")], [lockedClient("A")]);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.fixes.length, l.text).toBeGreaterThan(0);
    const fixes = lines.flatMap((l) => l.fixes);
    expect(fixes).toEqual(expect.arrayContaining([{ kind: "reconnect", calendar: "google" }, { kind: "reconnect", calendar: "outlook" }, { kind: "retry" }]));
  });
});

describe("a part a source couldn't read (PS-1)", () => {
  it('Dataverse live but its holidays unread: one line saying so, with Retry, and no "saved data" tail', () => {
    const lines = causeLines([src("dataverse", { note: "Holidays weren't read" }), src("pto")], []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ text: "Dataverse: holidays weren't read", since: null, missing: false, fixes: [{ kind: "retry" }] });
  });
  it("no note, no line", () => {
    expect(causeLines([src("dataverse"), src("pto")], [])).toEqual([]);
  });
});
