// Demo mode (step 15.4): a fictional signed-in person and VM. The Azure side is the fake Resource Manager behind a fetch
// that never leaves the process: a start takes about 20 seconds, the auto-shutdown is 7:00 PM (read only). No Azure calls.
import type { MicrosoftAccount } from "../../actions/account.ts";
import { createAzureClient } from "../azure/client.ts";
import { fakeArm } from "../azure/fake-arm.ts";
import type { PresenceClient, RawPresence } from "../graph/presence.ts";
import { DEMO_PEOPLE, DEMO_PRESENCE } from "./data.ts";
import type { PhotoClient } from "../graph/photos.ts";
import { demoAvatar } from "../../plan/photos.ts";
import { demoChats } from "./chats.ts";

/** Step 16.4: generated avatars for the fictional people (one has none, to show initials). No Graph calls. */
export function demoPhotos(): PhotoClient {
  const svg = (name: string) => {
    const b64 = demoAvatar(name).split(",")[1]!;
    return { type: "image/svg+xml", bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) };
  };
  return {
    mine: async () => svg(DEMO_PERSON.name),
    person: async (oid) => {
      const p = DEMO_PEOPLE.find((x) => x.aadId === oid.toLowerCase());
      return p && p.name !== "Taylor Kim" ? svg(p.name) : null;
    },
  };
}

/** Step 16.3: Teams presence in demo mode: fictional teammates, and my status kept in memory. No Graph calls. */
export function demoPresence(): PresenceClient & { mineSet: () => string | null } {
  let mine: string | null = null;
  return {
    setMine: async (_oid, status) => void (mine = status),
    clearMine: async () => void (mine = null),
    mine: async (): Promise<RawPresence> => ({ availability: mine ?? "Available", activity: mine ?? "Available" }),
    people: async (ids) => new Map(ids.map((id) => id.toLowerCase()).filter((id) => DEMO_PRESENCE[id]).map((id) => [id, DEMO_PRESENCE[id]!] as const)),
    mineSet: () => mine,
  };
}

export const DEMO_PERSON = { oid: "00000000-0000-4000-8000-0000000000e1", tid: "00000000-0000-4000-8000-0000000000d1", name: "Alex Rivera", username: "you@example.com", email: "you@example.com" };
export const DEMO_VM_ID = "/subscriptions/00000000-0000-4000-8000-0000000000f1/resourceGroups/rg-demo-dev/providers/Microsoft.Compute/virtualMachines/vm-demo-alex";

export function createDemoAzure() {
  const arm = fakeArm({ now: () => Date.now(), transitionMs: 20_000 });
  arm.addVm({ id: DEMO_VM_ID, name: "vm-demo-alex", resourceGroup: "rg-demo-dev", subscriptionId: "00000000-0000-4000-8000-0000000000f1", location: "eastus", tags: { Owner: DEMO_PERSON.name }, power: "deallocated" }, { time: "1900", timeZoneId: "Eastern Standard Time" });
  const account: MicrosoftAccount = {
    signIn: async () => ({ status: "connected", identity: DEMO_PERSON }),
    identity: async () => DEMO_PERSON,
    armToken: async () => "demo",
    writeAccess: async () => ({ status: "read_only", message: "Demo data" }),
    presence: demoPresence(),
    photos: demoPhotos(),
    chats: demoChats(),
    probe: async (kind) => ({ kind, state: "granted", granted: kind === "arm" ? ["user_impersonation"] : ["User.Read", "Calendars.ReadWrite", "MailboxSettings.Read", "Presence.ReadWrite", "Presence.Read.All", "ProfilePhoto.Read.All", "Chat.ReadBasic"] }),
    signOut: async () => {},
  };
  return { account, azure: (token: () => Promise<string>) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }), arm };
}
