#!/usr/bin/env bash
# FocusTime: copy app secrets from this machine's secret store (Secret Service, service "focustime") into an
# environment's Key Vault, once. Each value goes through a pipe from secret-tool into `az keyvault secret set`: never
# into a variable, an argument, a file, the terminal or a log. An existing Key Vault secret is left alone unless --force.
#
#   google-client-secret     -> ft-google-client-secret
#   dataverse-client-secret  -> ft-dataverse-client-secret
#
# (The Entra client secret is made by app-registration.sh straight into Key Vault as ft-entra-client-secret.)
#
# Usage: infra/scripts/copy-secrets.sh --vault <key vault name> [--force] [--dry-run]
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
command -v secret-tool >/dev/null || { echo "secret-tool not found" >&2; exit 1; }

copy() { # keyring account, Key Vault name, description
  if ! secret-tool lookup service focustime account "$1" >/dev/null 2>&1; then echo "$1: not in the local secret store, skipped"; return; fi
  local have
  have=$(az keyvault secret list --vault-name "$VAULT" --query "[?name=='$2'].name | [0]" -o tsv)
  if [[ -n $have && $FORCE -eq 0 ]]; then echo "$2: already in $VAULT, left as it is (--force to replace)"; return; fi
  if ((DRY)); then echo "dry-run: $1 -> $VAULT/$2"; return; fi
  secret-tool lookup service focustime account "$1" | tr -d '\n' \
    | az keyvault secret set --vault-name "$VAULT" --name "$2" --file /dev/stdin --encoding utf-8 --content-type "$3" -o none
  echo "$2: written to $VAULT"
}
copy google-client-secret ft-google-client-secret "Google OAuth client secret for FocusTime"
copy dataverse-client-secret ft-dataverse-client-secret "Dataverse client secret for FocusTime"
