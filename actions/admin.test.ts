// ADM-1: who is a FocusTime admin. The "FocusTime Admins" group (the ID token's groups claim, Graph on overage), the
// break-glass list, at most 10 minutes of caching, and "not admin" when Graph can't say.
import { describe, expect, it } from "vitest";
import { ADMIN_TTL_MS, createAdminCheck, demoAdminCheck, groupsOf, inList, type AdminCheckDeps } from "./admin.ts";

const GROUP = "00000000-0000-4000-8000-00000000a0a0";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const GLASS = "00000000-0000-4000-8000-0000000000c3";

function setup(o: { graph?: (id: string) => boolean | null; groupId?: string | null } = {}) {
  let t = 1_000_000;
  const asked: string[] = [];
  const seen: [string, boolean, string | null][] = [];
  const deps: AdminCheckDeps = {
    groupId: o.groupId === undefined ? GROUP : o.groupId,
    breakGlass: [GLASS],
    graph: async (id) => {
      asked.push(id);
      return o.graph ? o.graph(id) : null;
    },
    now: () => t,
    seen: async (id, admin, via) => void seen.push([id, admin, via]),
  };
  return { check: createAdminCheck(deps), asked, seen, later: (ms: number) => void (t += ms) };
}

describe("groupsOf: the ID token's groups claim", () => {
  it("a list, the overage markers, or nothing", () => {
    expect(groupsOf({ groups: [GROUP, 7] })).toEqual({ kind: "list", ids: [GROUP] });
    expect(groupsOf({ _claim_names: { groups: "src1" } })).toEqual({ kind: "overage" });
    expect(groupsOf({ hasgroups: true })).toEqual({ kind: "overage" });
    expect(groupsOf({})).toEqual({ kind: "none" });
    expect(groupsOf(null)).toEqual({ kind: "none" });
  });
});

describe("isAdmin", () => {
  it("a member of the group (from the claim): yes, without asking Graph", async () => {
    const s = setup();
    await s.check.signedIn(A, { kind: "list", ids: ["other", GROUP.toUpperCase()] });
    expect(await s.check.isAdmin(A)).toBe(true);
    expect(await s.check.via(A)).toBe("group");
    expect(s.asked).toEqual([]);
    expect(s.seen).toEqual([[A, true, "group"]]);
  });
  it("not a member: no", async () => {
    const s = setup();
    await s.check.signedIn(B, { kind: "list", ids: ["other"] });
    expect(await s.check.isAdmin(B)).toBe(false);
    expect(s.asked).toEqual([]);
  });
  it("overage: Graph answers (checkMemberGroups), and the answer is kept", async () => {
    const s = setup({ graph: (id) => id === A });
    await s.check.signedIn(A, { kind: "overage" });
    expect(await s.check.isAdmin(A)).toBe(true);
    expect(await s.check.isAdmin(A)).toBe(true);
    expect(s.asked).toEqual([A]);
  });
  it("Graph can't say: not admin, and asked again next time (never cached)", async () => {
    const s = setup({ graph: () => null });
    expect(await s.check.isAdmin(A)).toBe(false);
    expect(await s.check.isAdmin(A)).toBe(false);
    expect(s.asked).toEqual([A, A]);
  });
  it("the answer expires after 10 minutes: removed from the group, no longer an admin", async () => {
    let member = true;
    const s = setup({ graph: () => member });
    await s.check.signedIn(A, { kind: "list", ids: [GROUP] });
    member = false;
    s.later(ADMIN_TTL_MS - 1);
    expect(await s.check.isAdmin(A)).toBe(true);
    s.later(2);
    expect(await s.check.isAdmin(A)).toBe(false);
    expect(s.asked).toEqual([A]);
  });
  it("the break-glass list counts, in any case, with no group set up and without asking Graph", async () => {
    const s = setup({ groupId: null });
    expect(await s.check.isAdmin(GLASS.toUpperCase())).toBe(true);
    expect(await s.check.via(GLASS)).toBe("break_glass");
    expect(await s.check.isAdmin(A)).toBe(false);
    expect(s.asked).toEqual([]);
  });
  it("nobody signed in: no", async () => {
    expect(await setup().check.isAdmin(null)).toBe(false);
  });
  it("inList ignores case and empty lists", () => {
    expect(inList(A.toUpperCase(), [A])).toBe(true);
    expect(inList(A, [])).toBe(false);
    expect(inList(null, [A])).toBe(false);
  });
});

describe("the demo", () => {
  it("only the demo's person, and only in that demo's check", async () => {
    const c = demoAdminCheck(A);
    expect(await c.isAdmin(A)).toBe(true);
    expect(await c.via(A)).toBe("demo");
    expect(await c.isAdmin(B)).toBe(false);
  });
});
