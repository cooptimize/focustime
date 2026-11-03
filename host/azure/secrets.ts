// A4: the hosted app's app secrets. Container Apps resolves Key Vault references (ft-entra-client-secret,
// ft-google-client-secret, ft-dataverse-client-secret) with the app's managed identity and hands them in as
// environment variables; they are read once at start, kept only here, and removed from the environment so nothing the
// process starts inherits them. A person's secrets (refresh tokens, write PATs) are never host secrets in the hosted
// app: they are sealed in user_secrets (A2).
import { HostUnavailable, SecretError, type AppSecretAccount, type HostSecrets, type SecretAccount } from "../types.ts";

/** The environment variable each app secret arrives in (infra/modules/app.bicep sets them from Key Vault). */
export const SECRET_ENV: Readonly<Record<AppSecretAccount, string>> = {
  "entra-client-secret": "FOCUSTIME_SECRET_ENTRA_CLIENT",
  "google-client-secret": "FOCUSTIME_SECRET_GOOGLE_CLIENT",
  "dataverse-client-secret": "FOCUSTIME_SECRET_DATAVERSE_CLIENT",
  // Only for running the image against a local SQL Server (the hosted app signs in with its identity).
  "sql-password": "FOCUSTIME_SECRET_SQL_PASSWORD",
};

const isApp = (a: SecretAccount): a is AppSecretAccount => a in SECRET_ENV;

export function envSecrets(env: Record<string, string | undefined> = process.env): HostSecrets {
  const held = new Map<AppSecretAccount, string>();
  for (const [account, name] of Object.entries(SECRET_ENV) as [AppSecretAccount, string][]) {
    const v = env[name];
    if (v) held.set(account, v);
    delete env[name];
  }
  const perPerson = (what: string) => () => {
    throw new HostUnavailable(what);
  };
  return {
    get: async (a) => {
      const v = isApp(a) ? held.get(a) : undefined;
      if (v === undefined) throw new SecretError("not_found");
      return v;
    },
    state: async (a) => (isApp(a) && held.has(a) ? "set" : "missing"),
    set: async () => perPerson("A refresh token in the host's secret store (they are each person's, sealed in the database)")(),
    delete: async () => perPerson("A refresh token in the host's secret store")(),
    setApp: async () => perPerson("Setting an app secret from FocusTime (it lives in Key Vault)")(),
    writePat: {
      get: async () => {
        throw new SecretError("not_found");
      },
      set: async () => perPerson("A write PAT in the host's secret store (it is each person's, sealed in the database)")(),
      clear: async () => perPerson("A write PAT in the host's secret store")(),
    },
  };
}
