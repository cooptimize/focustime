// A1: the Host contract, run over the fake host, the hosted (azure) host with fake parts, and the local host's parts
// that don't need the desktop (its secrets are covered by keyring.test.ts with a fake secret-tool).
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAzureHost, type NoticeInbox } from "./azure/index.ts";
import { createFakeHost, memoryPhotos, memorySecrets, memorySnapshots } from "./fakes.ts";
import { createLocalHost } from "./local/index.ts";
import { localLinks } from "./local/launch.ts";
import { localPaths } from "./local/paths.ts";
import { createSnapshotStore } from "./local/snapshots.ts";
import { HostUnavailable, SecretError, type Host, type Notice, type SnapshotStore } from "./types.ts";

const NOTICE: Notice = { key: "plan_day:2026-11-02", kind: "plan_day", title: "Plan your day", body: "Today isn't planned yet.", route: "today", buttons: [], at: "2026-11-02T14:00:00Z" } as Notice;

function inbox(): NoticeInbox & { items: Map<string, Notice> } {
  const items = new Map<string, Notice>();
  let n = 0;
  return { items, add: (x) => (items.set(String(++n), x), String(n)), remove: (h) => void items.delete(h) };
}
const azure = () => {
  const box = inbox();
  return { host: createAzureHost({ secrets: memorySecrets(), snapshots: memorySnapshots(), photos: memoryPhotos(), inbox: box }), box };
};

function snapshotContract(name: string, make: () => SnapshotStore) {
  it(`${name}: snapshots round trip, stay per source, and clear one source`, async () => {
    const s = make();
    expect(await s.read("outlook", "2026-11-02")).toBeNull();
    await s.write("outlook", "2026-11-02", { fetchedAt: "2026-11-02T14:00:00Z", items: [{ a: 1 }] });
    await s.write("google", "2026-11-02", { fetchedAt: "2026-11-02T14:00:00Z", items: [{ b: 2 }] });
    expect(await s.read("outlook", "2026-11-02")).toEqual({ fetchedAt: "2026-11-02T14:00:00Z", items: [{ a: 1 }] });
    await s.clear("outlook");
    expect(await s.read("outlook", "2026-11-02")).toBeNull();
    expect(await s.read("google", "2026-11-02")).not.toBeNull();
  });
}

function hostContract(name: string, make: () => Host) {
  describe(`${name} host`, () => {
    it("keeps secrets: set, read, state and delete; app secrets are not refresh tokens", async () => {
      const h = make();
      await expect(h.secrets.get("outlook-refresh-token")).rejects.toBeInstanceOf(SecretError);
      expect(await h.secrets.state("outlook-refresh-token")).toBe("missing");
      await h.secrets.set("outlook-refresh-token", "FAKE-REFRESH");
      expect(await h.secrets.get("outlook-refresh-token")).toBe("FAKE-REFRESH");
      expect(await h.secrets.state("outlook-refresh-token")).toBe("set");
      await h.secrets.delete("outlook-refresh-token");
      expect(await h.secrets.state("outlook-refresh-token")).toBe("missing");
      await expect(h.secrets.set("dataverse-client-secret" as never, "x")).rejects.toThrow();
      await h.secrets.setApp("dataverse-client-secret", "FAKE-APP");
      expect(await h.secrets.get("dataverse-client-secret")).toBe("FAKE-APP");
    });
    it("keeps write PATs wrapped, never as a plain string", async () => {
      const h = make();
      await h.secrets.writePat.set("adatum-1", "FAKEPAT");
      const pat = await h.secrets.writePat.get("adatum-1");
      expect(String(pat)).not.toContain("FAKEPAT");
      expect(JSON.stringify(pat)).not.toContain("FAKEPAT");
      await h.secrets.writePat.clear("adatum-1");
      await expect(h.secrets.writePat.get("adatum-1")).rejects.toBeInstanceOf(SecretError);
    });
    snapshotContract(name, () => make().snapshots);
    it("caches photos and clears them", async () => {
      const h = make();
      await h.photos.write("oid-1", { fetchedAt: "2026-11-02T14:00:00Z", photo: null });
      expect(await h.photos.read("oid-1")).toEqual({ fetchedAt: "2026-11-02T14:00:00Z", photo: null });
      await h.photos.clear();
      expect(await h.photos.read("oid-1")).toBeNull();
    });
    it("shows a notice, hands back a handle, and closes it", async () => {
      const h = make();
      let handle: string | null = null;
      await h.notifications.show(NOTICE, (x) => (handle = x));
      expect(handle).toMatch(/^\d+$/);
      expect(() => h.notifications.close(handle!)).not.toThrow();
    });
    it("opens links, has a clock and a neutral zone, and says what it is", async () => {
      const h = make();
      expect(["opened", "client"]).toContain(await h.links.open("https://example.com/x"));
      expect(h.clock.now()).toBeInstanceOf(Temporal.Instant);
      expect(() => Temporal.Now.instant().toZonedDateTimeISO(h.clock.zone())).not.toThrow();
      expect(h.facts().kind).toBe(h.kind);
    });
    it("keeps the demo flag", async () => {
      const h = make();
      expect(h.files.demoFlag.get()).toBe(false);
      await h.files.demoFlag.set(true);
      expect(h.files.demoFlag.get()).toBe(true);
    });
  });
}

hostContract("fake", () => createFakeHost());
hostContract("azure (fake parts)", () => azure().host);

describe("azure host: desktop-only operations", () => {
  it("throw a plain 'not available in the hosted app'", async () => {
    const { host } = azure();
    expect(() => host.paths.config).toThrow(HostUnavailable);
    expect(() => host.paths.planDb).toThrow(/not available in the hosted app/);
    await expect(host.loopback.listen("localhost")).rejects.toThrow(/Desktop sign-in is not available in the hosted app/);
    await expect(host.launch.detached(["x"])).rejects.toBeInstanceOf(HostUnavailable);
    await expect(host.files.exportPlan("{}")).rejects.toBeInstanceOf(HostUnavailable);
    await expect(host.media.open("https://example.com/p")).rejects.toBeInstanceOf(HostUnavailable);
    expect(() => host.files.store.prepare("/x")).toThrow(HostUnavailable);
  });
  it("puts notices in the in-app inbox, links open in the page, nothing to reopen", async () => {
    const { host, box } = azure();
    let handle = "";
    expect(await host.notifications.show(NOTICE, (h) => (handle = h))).toBeNull();
    expect([...box.items.values()]).toEqual([NOTICE]);
    host.notifications.close(handle);
    expect(box.items.size).toBe(0);
    expect(await host.links.open("https://example.com")).toBe("client");
    expect(await host.launch.reopen()).toBe(false);
    expect(await host.media.status()).toEqual({ playerctl: false, spotify: false });
    expect(host.facts()).toEqual({ kind: "azure", service: false, configPath: null });
  });
});

describe("local host", () => {
  snapshotContract("local", () => createSnapshotStore(mkdtempSync(join(tmpdir(), "focustime-host-"))));
  it("uses the XDG folders", () => {
    const p = localPaths({ XDG_CONFIG_HOME: "/c", XDG_DATA_HOME: "/d", XDG_CACHE_HOME: "/k", XDG_RUNTIME_DIR: "/r" }, "/home/someone");
    expect(p).toEqual({ config: "/c/focustime/config.toml", data: "/d/focustime", cache: "/k/focustime", runtime: "/r/focustime", planDb: "/d/focustime/plan.db" });
    expect(localPaths({}, "/home/someone").config).toBe("/home/someone/.config/focustime/config.toml");
  });
  it("opens only https links, with xdg-open and no shell", async () => {
    const ran: string[][] = [];
    const links = localLinks(async (argv) => void ran.push(argv));
    expect(await links.open("https://dev.azure.com/x")).toBe("opened");
    await expect(links.open("--help")).rejects.toThrow();
    await expect(links.open("file:///etc/passwd")).rejects.toThrow();
    expect(ran).toEqual([["xdg-open", "https://dev.azure.com/x"]]);
  });
  it("keeps the demo flag and the plan store private", async () => {
    const root = mkdtempSync(join(tmpdir(), "focustime-host-"));
    const h = createLocalHost({ port: 5999, token: "t", headless: true, open: false, noReopen: true, now: () => Temporal.Now.instant(), env: { XDG_DATA_HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_RUNTIME_DIR: root } });
    expect(h.kind).toBe("local");
    expect(h.files.demoFlag.get()).toBe(false);
    await h.files.demoFlag.set(true);
    expect(statSync(join(root, "focustime", "demo-mode")).mode & 0o777).toBe(0o600);
    await h.files.demoFlag.set(false);
    expect(existsSync(join(root, "focustime", "demo-mode"))).toBe(false);
    const out = await h.files.exportPlan("{}");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(h.facts()).toEqual({ kind: "local", service: false, configPath: join(root, "focustime", "config.toml") });
    // Headless: no desktop notifications.
    expect(await h.notifications.show(NOTICE)).toBeNull();
  });
});
