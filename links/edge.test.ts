import { describe, expect, it } from "vitest";
import type { EdgeConfig } from "../config/schema.ts";
import { checkDevOpsUrl, detectEdge, installFromDesktop, launchPlan, profilesFromLocalState } from "./edge.ts";

const HOME = "/home/me";

describe("Edge install detection", () => {
  it("a native package: the binary itself, profiles under ~/.config/microsoft-edge", () => {
    expect(installFromDesktop("/usr/bin/microsoft-edge-stable %U", HOME, "x")).toMatchObject({ install: "native", command: ["/usr/bin/microsoft-edge-stable"], profilesDir: `${HOME}/.config/microsoft-edge` });
    expect(installFromDesktop("/usr/bin/microsoft-edge-beta %U", HOME, "x")?.profilesDir).toBe(`${HOME}/.config/microsoft-edge-beta`);
  });

  it("a Flatpak: flatpak run with the app id, profiles under ~/.var/app", () => {
    const f = installFromDesktop("/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=/app/bin/edge --file-forwarding com.microsoft.Edge @@u %U @@", HOME, "x");
    expect(f).toMatchObject({ install: "flatpak", command: ["/usr/bin/flatpak", "run", "--branch=stable", "--arch=x86_64", "com.microsoft.Edge"], profilesDir: `${HOME}/.var/app/com.microsoft.Edge/config/microsoft-edge` });
  });

  it("other browsers are not Edge", () => {
    expect(installFromDesktop("/usr/bin/chromium %U", HOME, "x")).toBeNull();
  });

  it("reads the .desktop entry, preferring user entries over system ones", () => {
    const files: Record<string, string> = {
      "/usr/share/applications/microsoft-edge.desktop": "[Desktop Entry]\nExec=/usr/bin/microsoft-edge-stable %U\n",
      [`${HOME}/.local/share/flatpak/exports/share/applications/com.microsoft.Edge.desktop`]: "[Desktop Entry]\nExec=/usr/bin/flatpak run com.microsoft.Edge %U\n",
    };
    expect(detectEdge((p) => files[p] ?? null, HOME)?.install).toBe("flatpak");
    delete files[`${HOME}/.local/share/flatpak/exports/share/applications/com.microsoft.Edge.desktop`];
    expect(detectEdge((p) => files[p] ?? null, HOME)?.install).toBe("native");
    expect(detectEdge(() => null, HOME)).toBeNull();
  });
});

describe("Edge profiles from Local State", () => {
  it("keeps only directory and display name, and drops anything that could be a flag", () => {
    const state = JSON.stringify({
      profile: { info_cache: { Default: { name: "Cooptimize", user_name: "me@x.com", gaia_id: "1" }, "Profile 3": { name: "CSC" }, "--evil": { name: "x" } }, last_used: "Default" },
      os_crypt: { encrypted_key: "SECRET" },
    });
    const out = profilesFromLocalState(state);
    expect(out).toEqual([
      { directory: "Default", name: "Cooptimize" },
      { directory: "Profile 3", name: "CSC" },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/SECRET|me@x\.com|gaia/);
    expect(profilesFromLocalState("not json")).toEqual([]);
  });
});

describe("work item link validation", () => {
  const ok = (url: string, org: string | null) => checkDevOpsUrl(url, org);
  it("accepts a link in the client's own organization, any case", () => {
    expect(ok("https://dev.azure.com/cscsteelusa/Project%20Ada/_workitems/edit/101", "cscsteelusa")).toEqual({ ok: true, url: "https://dev.azure.com/cscsteelusa/Project%20Ada/_workitems/edit/101" });
    expect(ok("https://dev.azure.com/WC-ERP/x/_workitems/edit/1", "wc-erp").ok).toBe(true);
  });
  it("refuses another client's organization", () => {
    expect(ok("https://dev.azure.com/cooptimize/Internal/_workitems/edit/5", "cscsteelusa")).toMatchObject({ ok: false, error: "That link is not in this client's DevOps organization" });
    expect(ok("https://dev.azure.com/cscsteelusa-other/x", "cscsteelusa").ok).toBe(false);
  });
  it("refuses anything that is not dev.azure.com over https", () => {
    for (const url of [
      "http://dev.azure.com/cscsteelusa/x",
      "https://dev.azure.com.evil.example/cscsteelusa/x",
      "https://evil.example/https://dev.azure.com/cscsteelusa/x",
      "https://user:pw@dev.azure.com/cscsteelusa/x",
      "https://dev.azure.com:8443/cscsteelusa/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "--profile-directory=Default",
      "not a url",
    ])
      expect(ok(url, "cscsteelusa").ok, url).toBe(false);
    expect(checkDevOpsUrl(42, "cscsteelusa").ok).toBe(false);
  });
  it("refuses when the client's organization is not known", () => {
    expect(ok("https://dev.azure.com/cscsteelusa/x", null)).toMatchObject({ ok: false, error: expect.stringMatching(/not known yet/) });
  });
});

describe("launch arguments", () => {
  const native: EdgeConfig = { command: ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"], profiles: { CSC: "Profile 3", Cooptimize: "Default" }, fallbackCommand: ["omarchy-launch-browser"] };
  const url = "https://dev.azure.com/cscsteelusa/P/_workitems/edit/1";
  it("a mapped client: the Edge command, its profile directory as one argument, then the link", () => {
    expect(launchPlan(native, "CSC", "CSC", url)).toEqual({ argv: ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable", "--profile-directory=Profile 3", url], profile: "Profile 3", notice: null });
  });
  it("a Flatpak install puts the profile after the app id", () => {
    const flat = { ...native, command: ["flatpak", "run", "com.microsoft.Edge"] };
    expect(launchPlan(flat, "Cooptimize", "Cooptimize", url).argv).toEqual(["flatpak", "run", "com.microsoft.Edge", "--profile-directory=Default", url]);
  });
  it("an unmapped client opens in the default browser with a notice", () => {
    expect(launchPlan(native, "W&C", "W&C", url)).toEqual({ argv: ["omarchy-launch-browser", url], profile: null, notice: "No Edge profile set for W&C" });
    expect(launchPlan(native, "toString", "toString", url).profile).toBeNull();
  });
  it("no Edge command at all also falls back", () => {
    expect(launchPlan({ ...native, command: [] }, "CSC", "CSC", url).notice).toBe("No Edge profile set for CSC");
  });
});
