// Demo mode (step 15.4): a fictional signed-in person and VM. The Azure side is the fake Resource Manager behind a fetch
// that never leaves the process: start and stop take about 20 seconds, the auto-shutdown is 7:00 PM. No Azure calls.
import type { MicrosoftAccount } from "../../actions/account.ts";
import { createAzureClient } from "../azure/client.ts";
import { fakeArm } from "../azure/fake-arm.ts";

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
    signOut: async () => {},
  };
  return { account, azure: (token: () => Promise<string>) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }), arm };
}
