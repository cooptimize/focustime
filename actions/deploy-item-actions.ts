// DP-2: a client's data platform and its list of deployment items. `deploy.items` is read by whoever plans a
// deployment; `deploy.config_save` only by a FocusTime admin or that client's leads (admins aren't leads by being
// admins, so both are checked). Team values in org_settings, each change in admin_audit, like Admin › Clients. Only
// new deployments follow: a planned one keeps its own snapshot (picks.deploy_items).
import { clientScope, OrgInputError, specFor } from "../config/org.ts";
import { DATA_PLATFORMS, PLATFORM_LABEL, type DataPlatform } from "../config/deploy-catalog.ts";
import { fullList, groupsFor, type ClientDeploy, type ItemGroup, type ListItem } from "../plan/deploy-items.ts";
import type { OrgRuntime } from "./org.ts";
import { isClientLead } from "./client-lead.ts";

export const DEPLOY_ITEM_ACTIONS = ["deploy.items", "deploy.config_save"] as const;
export type DeployItemAction = (typeof DEPLOY_ITEM_ACTIONS)[number];

export type DeployItemContext = {
  org: OrgRuntime | undefined;
  me: () => Promise<{ id: string; name: string } | null>;
  isAdmin: () => Promise<boolean>;
};

export type DeployItemsView = {
  clientKey: string;
  platform: DataPlatform | null;
  groups: ItemGroup[];
  /** May change this client's platform and list (an admin or its lead). */
  canEdit: boolean;
  /** Where that's done: Admin › Clients for an admin, else the client's page in Settings. */
  editHref: string | null;
  /** Each platform's whole list, hidden items too, for the editor; only for someone who may edit. */
  lists: { platform: DataPlatform; label: string; items: ListItem[] }[] | null;
};

type Result = { ok: true; data: unknown } | { ok: false; status: number; error: string; code?: string };
const bad = (error: string, status = 400): Result => ({ ok: false, status, error });

const clientKeyOf = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.length <= 100 ? v : null);

async function viewOf(c: DeployItemContext, clientKey: string): Promise<DeployItemsView> {
  const rule = (await c.org?.rules())?.clients[clientKey];
  const deploy: ClientDeploy = { dataPlatform: rule?.dataPlatform ?? null, deployItems: rule?.deployItems ?? null };
  const me = await c.me();
  const admin = await c.isAdmin().catch(() => false);
  const lead = admin ? false : await isClientLead(c.org, me?.id ?? null, clientKey);
  const canEdit = !!c.org && (admin || lead);
  return {
    clientKey,
    platform: deploy.dataPlatform ?? null,
    groups: groupsFor(deploy),
    canEdit,
    editHref: !canEdit ? null : admin ? `#/settings/admin-clients/deploy-${encodeURIComponent(clientKey)}` : `#/settings/client/${encodeURIComponent(clientKey)}`,
    lists: canEdit ? DATA_PLATFORMS.map((p) => ({ platform: p, label: PLATFORM_LABEL[p], items: fullList(p, deploy.deployItems) })) : null,
  };
}

export async function deployItemAction(c: DeployItemContext, action: DeployItemAction, input: unknown): Promise<Result> {
  const i = (input ?? {}) as Record<string, unknown>;
  const clientKey = clientKeyOf(i.clientKey);
  if (!clientKey) return bad("clientKey names the client");
  if (action === "deploy.items") return { ok: true, data: await viewOf(c, clientKey) };

  const unknown = Object.keys(i).find((k) => !["clientKey", "platform", "items"].includes(k));
  if (unknown) return bad(`unknown input field ${unknown}`);
  const me = await c.me();
  const org = c.org;
  if (!org || !me) return bad("Sign in first", 403);
  if (!(await c.isAdmin().catch(() => false)) && !(await isClientLead(org, me.id, clientKey))) return bad("Only a FocusTime admin or this client's leads change this", 403);
  const scope = clientScope(clientKey);
  const actor = { id: me.id, name: me.name };
  try {
    // A null platform clears it (back to "not set"); the list is saved whole for the platforms sent.
    if ("platform" in i) {
      const value = i.platform === null ? undefined : specFor(scope, "data_platform")!.parse(i.platform);
      await org.store.setOrg({ scope, key: "data_platform", value, actor, area: "clients", target: clientKey });
    }
    if ("items" in i) {
      const parsed = specFor(scope, "deploy_items")!.parse(i.items) as Record<string, unknown>;
      const saved = (await org.rules()).clients[clientKey]?.deployItems ?? {};
      await org.store.setOrg({ scope, key: "deploy_items", value: { ...saved, ...parsed }, actor, area: "clients", target: clientKey });
    }
  } catch (e) {
    if (e instanceof OrgInputError) return bad(e.message, 422);
    throw e;
  }
  org.invalidate();
  return { ok: true, data: await viewOf(c, clientKey) };
}
