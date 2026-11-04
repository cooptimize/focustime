#!/usr/bin/env bash
# FocusTime (P1): the Web Push VAPID key for one environment. Makes a P-256 key pair (a JWK with the private part) with
# node and pipes it straight into the environment's Key Vault as the secret ft-vapid-key: never into a variable, an
# argument, a file, the terminal or a log. The app reads it at run time with its managed identity (host/azure/vapid.ts);
# until it exists, Settings › Notifications says push isn't set up and everything else works.
#
# An existing ft-vapid-key is left alone unless --force. Replacing it ends push on every device (each subscribed with
# the old public key): people turn "Notify this device" on again.
#
# Usage: infra/scripts/vapid-key.sh --vault <key vault name> [--force] [--dry-run]
set -euo pipefail
VAULT="" FORCE=0 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT=$2; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n $VAULT ]] || { echo "usage: $0 --vault NAME [--force] [--dry-run]" >&2; exit 2; }
command -v node >/dev/null || { echo "node not found" >&2; exit 1; }
command -v az >/dev/null || { echo "az not found" >&2; exit 1; }

NAME=ft-vapid-key
have=$(az keyvault secret list --vault-name "$VAULT" --query "[?name=='$NAME'].name | [0]" -o tsv)
if [[ -n $have && $FORCE -eq 0 ]]; then echo "$NAME: already in $VAULT, left as it is (--force to replace; every device then turns push on again)"; exit 0; fi
if ((DRY)); then echo "dry-run: a new P-256 key pair -> $VAULT/$NAME"; exit 0; fi
node -e 'const { generateKeyPairSync } = require("node:crypto"); const { kty, crv, d, x, y } = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }); process.stdout.write(JSON.stringify({ kty, crv, d, x, y }));' \
  | az keyvault secret set --vault-name "$VAULT" --name "$NAME" --file /dev/stdin --encoding utf-8 --content-type "FocusTime Web Push VAPID key (P-256 JWK)" -o none
echo "$NAME: written to $VAULT"
