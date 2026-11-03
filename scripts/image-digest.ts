// A5 (D466): the digest of the image deploy-dev built and tested for one commit, read from dev's registry with only
// pull rights (AcrPull: the registry's own token exchange, no management read). Prints `sha256:...`; fails plainly
// when there is no image for that commit. Tokens stay in this process: never printed, never an argument.
//
//   node scripts/image-digest.ts <registry name> <full commit sha>
import { execFileSync } from "node:child_process";

const [registry = "", sha = ""] = process.argv.slice(2);
if (!/^[a-z0-9]{5,50}$/.test(registry) || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error("usage: node scripts/image-digest.ts <registry name> <full 40-character commit sha>");
  process.exit(2);
}
const host = `${registry}.azurecr.io`;
const form = (body: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
const fail = (why: string): never => {
  console.error(why);
  process.exit(1);
};

const aad = execFileSync("az", ["account", "get-access-token", "--resource", "https://containerregistry.azure.net", "--query", "accessToken", "-o", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const exchange = await fetch(`https://${host}/oauth2/exchange`, form({ grant_type: "access_token", service: host, access_token: aad }));
if (!exchange.ok) fail(`${registry}: signing in to the registry failed (${exchange.status}); the identity needs AcrPull on it`);
const { refresh_token: refresh } = (await exchange.json()) as { refresh_token: string };
const token = await fetch(`https://${host}/oauth2/token`, form({ grant_type: "refresh_token", service: host, scope: "repository:focustime:pull", refresh_token: refresh }));
if (!token.ok) fail(`${registry}: no pull access to focustime (${token.status})`);
const { access_token: access } = (await token.json()) as { access_token: string };
const accept = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"].join(", ");
const r = await fetch(`https://${host}/v2/focustime/manifests/${sha}`, { method: "HEAD", headers: { Authorization: `Bearer ${access}`, Accept: accept } });
if (r.status === 404) fail(`No image for ${sha.slice(0, 7)} in ${registry}: dev builds one for every commit it deploys from main. Deploy that commit to dev first, or pick a SHA from dev's ⋯ › About.`);
if (!r.ok) fail(`${registry}: reading the image for ${sha.slice(0, 7)} failed (${r.status})`);
const digest = r.headers.get("docker-content-digest") ?? "";
if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`${registry}: the registry gave no digest for ${sha.slice(0, 7)}`);
console.log(digest);
