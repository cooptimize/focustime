// ADM-2 (D575): every personal screen and picker lists clients only. One wrapper on the action context: the Dataverse
// source's myClients() (Settings › Clients, the week's clients, Capture, follow-ups, Plan the week, Roadmap, the help
// finder) keeps only the accounts clientAccounts() says are clients, and isClient() answers for the lists built from
// other keys (standing blocks, Keep following). Without the team runtime (no org) everything counts, as before.
import type { ClientAccounts } from "../plan/client-accounts.ts";
import type { OrgRuntime } from "./org.ts";

type Ctx<S> = { org?: OrgRuntime | undefined; makeDataverse: (cfg: never, timeZone: string) => S };

/** The clients answer for this context, or null (no team runtime: everything counts). */
export async function clientsOf(org: OrgRuntime | undefined | null): Promise<ClientAccounts | null> {
  return org ? org.clientAccounts().catch(() => null) : null;
}

export async function isClientKey(org: OrgRuntime | undefined | null, key: string): Promise<boolean> {
  const ca = await clientsOf(org);
  return ca ? ca.isClient(key) : true;
}

/** The context with myClients() filtered to clients. */
export function onlyClients<C extends Ctx<S>, S extends { myClients?: () => Promise<{ clientKey: string }[] | null> }>(ctx: C): C {
  const org = ctx.org;
  if (!org) return ctx;
  const make = ctx.makeDataverse;
  return {
    ...ctx,
    makeDataverse: ((cfg: never, tz: string) => {
      const src = make(cfg, tz);
      const mine = src.myClients;
      if (!mine) return src;
      return {
        ...src,
        myClients: async () => {
          const list = await mine.call(src);
          if (!list) return list;
          const ca = await clientsOf(org);
          return ca ? list.filter((c) => ca.isClient(c.clientKey)) : list;
        },
      };
    }) as C["makeDataverse"],
  };
}
