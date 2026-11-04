import { describe, expect, it } from "vitest";
import { permissionRows } from "./permissions.ts";

const state = (rows: ReturnType<typeof permissionRows>, scope: string) => rows.find((r) => r.scope === scope)!.state;

describe("Settings > Connections: each Microsoft permission's state (T-2)", () => {
  it("granted when any Graph token holds it, needs consent when its own token was refused, admin when an admin must", () => {
    const rows = permissionRows(
      [
        { kind: "read", state: "granted", granted: ["Calendars.ReadWrite", "User.Read", "MailboxSettings.Read", "Presence.ReadWrite", "Presence.Read.All"] },
        { kind: "photo", state: "consent", granted: [] },
        { kind: "chats", state: "consent", granted: [] },
        { kind: "arm", state: "granted", granted: ["user_impersonation"] },
      ],
      true,
    );
    expect(state(rows, "Calendars.ReadWrite")).toBe("granted");
    expect(state(rows, "Presence.Read.All")).toBe("granted");
    expect(state(rows, "Chat.ReadBasic")).toBe("needs_consent");
    expect(state(rows, "ProfilePhoto.Read.All")).toBe("needs_admin");
    expect(state(rows, "user_impersonation")).toBe("granted");
  });

  it("an Azure grant never counts for Graph, and the reverse", () => {
    const rows = permissionRows([{ kind: "arm", state: "granted", granted: ["User.Read"] }, { kind: "read", state: "granted", granted: ["user_impersonation"] }], true);
    expect(state(rows, "User.Read")).not.toBe("granted");
    expect(state(rows, "user_impersonation")).not.toBe("granted");
  });

  it("signed out: every row says so; unchecked: unknown", () => {
    expect(new Set(permissionRows([], false).map((r) => r.state))).toEqual(new Set(["signed_out"]));
    expect(state(permissionRows([{ kind: "chats", state: "unavailable", granted: [] }], true), "Chat.ReadBasic")).toBe("unknown");
  });
});

describe("the Connections list matches what the app registration asks for", () => {
  it("every Graph scope in infra/scripts/app-registration.sh is listed, and nothing more", async () => {
    const { readFileSync } = await import("node:fs");
    const { PERMISSIONS } = await import("./permissions.ts");
    const script = readFileSync(new URL("../infra/scripts/app-registration.sh", import.meta.url), "utf8");
    const graph = script.match(/^GRAPH_SCOPES=\(([^)]*)\)/m)![1]!.split(/\s+/).filter((s) => s && !["openid", "profile", "email", "offline_access"].includes(s));
    const listed = PERMISSIONS.filter((p) => p.api === "Microsoft Graph").map((p) => p.scope);
    expect([...listed].sort()).toEqual([...graph].sort());
  });
});
