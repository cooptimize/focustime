#!/usr/bin/env bash
# FocusTime: switch to a Google OAuth client of type "Web application" from the JSON the Google Cloud console downloads
# (client_secret_<id>.json). The client id is config, not a secret; the client secret goes only through pipes, never
# into a variable, an argument, a file, the terminal or a log.
#
#   client id      -> config: [google] client_id in ~/.config/focustime/app.toml (the developer loop) and
#                     googleClientId in infra/dev.bicepparam and infra/prod.bicepparam (commit and push to deploy)
#   client secret  -> Key Vault <vault>/ft-google-client-secret (a new version; the earlier one stays as an older version)
#                  -> the local keyring, service focustime, account google-client-secret; the value it replaces is kept
#                     first under account google-client-secret-desktop, so the switch can be undone
#
# Checks first: the file is a web client ("web", not "installed"), and its redirect URIs include the dev callback and
# http://localhost:5317/auth/google/callback. Nothing is written when a check fails.
#
# Usage: infra/scripts/google-client.sh --file <client_secret_....json> --vault <key vault name> --dev-url https://<dev fqdn> [--dry-run]
set -euo pipefail
FILE="" VAULT="" DEV_URL="" DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE=$2; shift 2 ;;
    --vault) VAULT=$2; shift 2 ;;
    --dev-url) DEV_URL=${2%/}; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -f $FILE && -n $VAULT && $DEV_URL =~ ^https://[a-z0-9.-]+$ ]] || { echo "usage: $0 --file JSON --vault NAME --dev-url https://FQDN [--dry-run]" >&2; exit 2; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)
APP_TOML="${XDG_CONFIG_HOME:-$HOME/.config}/focustime/app.toml"
LOCAL_CB="http://localhost:5317/auth/google/callback"
DEV_CB="$DEV_URL/auth/google/callback"

# Reads one field of the file to stdout. "secret" goes only into a pipe.
field() { node -e '
const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const w = j.web;
if (!w) { console.error(j.installed ? "This is a Desktop client (\"installed\"); download the Web application client" : "Not a Google OAuth client file"); process.exit(1); }
const f = process.argv[2];
if (f === "id") process.stdout.write(String(w.client_id ?? ""));
else if (f === "secret") process.stdout.write(String(w.client_secret ?? ""));
else if (f === "redirects") process.stdout.write((w.redirect_uris ?? []).join("\n"));
else if (f === "has-secret") process.stdout.write(w.client_secret ? "yes" : "no");
' "$FILE" "$1"; }

ID=$(field id)
[[ $ID =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] || { echo "The client id in the file doesn't look like a Google client id" >&2; exit 1; }
[[ $(field has-secret) == yes ]] || { echo "The file has no client secret" >&2; exit 1; }
redirects=$(field redirects)
for cb in "$DEV_CB" "$LOCAL_CB"; do
  grep -qxF "$cb" <<<"$redirects" || { echo "The client's redirect URIs don't include $cb (add it in the Google console, download the JSON again)" >&2; exit 1; }
done
echo "Web client $ID, redirect URIs include the dev and local callbacks"
command -v secret-tool >/dev/null || { echo "secret-tool not found" >&2; exit 1; }
az keyvault secret list --vault-name "$VAULT" -o none || { echo "Can't read Key Vault $VAULT (az login, and FocusTime DB Admins membership)" >&2; exit 1; }
if ((DRY)); then echo "dry-run: would write the client id to $APP_TOML and the bicepparam files, the secret to $VAULT and the keyring"; exit 0; fi

# 1. Key Vault: a new version of ft-google-client-secret.
field secret | az keyvault secret set --vault-name "$VAULT" --name ft-google-client-secret --file /dev/stdin --encoding utf-8 \
  --content-type "Google OAuth client secret for FocusTime (web client $ID)" -o none
echo "Key Vault $VAULT: ft-google-client-secret updated (the earlier value stays as an older version)"

# 2. The keyring: keep the value being replaced (once), then write the new one.
if secret-tool lookup service focustime account google-client-secret >/dev/null 2>&1 \
  && ! secret-tool lookup service focustime account google-client-secret-desktop >/dev/null 2>&1; then
  secret-tool lookup service focustime account google-client-secret | tr -d '\n' \
    | secret-tool store --label "FocusTime: google-client-secret-desktop (before the web client)" service focustime account google-client-secret-desktop
  echo "Keyring: the previous secret kept as focustime/google-client-secret-desktop"
fi
field secret | secret-tool store --label "FocusTime: google-client-secret" service focustime account google-client-secret
echo "Keyring: focustime/google-client-secret updated"

# 3. The client id as config.
node -e '
const fs = require("node:fs");
const [toml, id, ...params] = process.argv.slice(1);
const t = fs.readFileSync(toml, "utf8");
const lines = t.split("\n");
let inGoogle = false, done = false;
for (let i = 0; i < lines.length; i++) {
  const sec = lines[i].match(/^\s*\[([^\]]+)\]/);
  if (sec) inGoogle = sec[1].trim() === "google";
  else if (inGoogle && /^\s*client_id\s*=/.test(lines[i])) { lines[i] = `client_id = "${id}"`; done = true; }
}
if (!done) { const k = lines.findIndex((l) => /^\s*\[google\]/.test(l)); if (k >= 0) lines.splice(k + 1, 0, `client_id = "${id}"`); else lines.push("", "[google]", `client_id = "${id}"`); }
fs.writeFileSync(toml, lines.join("\n"));
for (const p of params) {
  const s = fs.readFileSync(p, "utf8");
  if (!/^param googleClientId = .*$/m.test(s)) { console.error(`${p}: no googleClientId line`); process.exit(1); }
  fs.writeFileSync(p, s.replace(/^param googleClientId = .*$/m, `param googleClientId = \x27${id}\x27 // the "FocusTime Web" client`));
}
' "$APP_TOML" "$ID" "$REPO/infra/dev.bicepparam" "$REPO/infra/prod.bicepparam"
echo "Config: [google] client_id in $APP_TOML; googleClientId in infra/dev.bicepparam and infra/prod.bicepparam"
echo
echo "Next: restart the local service (systemctl --user restart focustime); commit and push the bicepparam change to deploy dev."
