#!/usr/bin/env bash
# FocusTime (AI-0): the OpenAI API key for one environment. Asks for the key without showing it (paste it, then Enter)
# and pipes it straight into the environment's Key Vault as the secret ft-openai-key: never into an argument, a file,
# the terminal, the shell history or a log. The app reads it at run time with its managed identity (server/main.ts);
# until it exists, Settings › AI says "AI isn't set up" and everything else works. A new key is used within a minute,
# no restart. One key per environment: make a separate project key for dev and for prod (docs/azure/runbook.md).
#
# --local puts it in this machine's keyring instead (service focustime, account openai-api-key), for the developer loop
# with [ai] provider = "openai" in ~/.config/focustime/app.toml.
#
# An existing ft-openai-key is left alone unless --force (replace it to rotate the key, then revoke the old one).
#
# Usage: infra/scripts/openai-key.sh --vault <key vault name> [--force] [--dry-run]
#        infra/scripts/openai-key.sh --local [--force]
set -euo pipefail
VAULT="" LOCAL=0 FORCE=0 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT=$2; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z $VAULT && $LOCAL -eq 0 ]] || [[ -n $VAULT && $LOCAL -eq 1 ]]; then
  echo "usage: $0 --vault NAME [--force] [--dry-run]   or   $0 --local [--force]" >&2; exit 2
fi
[[ -t 0 ]] || { echo "Run this in a terminal: it asks for the key." >&2; exit 2; }

NAME=ft-openai-key ACCOUNT=openai-api-key
if ((LOCAL)); then
  command -v secret-tool >/dev/null || { echo "secret-tool not found" >&2; exit 1; }
  if secret-tool lookup service focustime account "$ACCOUNT" >/dev/null 2>&1 && ((FORCE == 0)); then
    echo "$ACCOUNT: already in the keyring, left as it is (--force to replace)"; exit 0
  fi
else
  command -v az >/dev/null || { echo "az not found" >&2; exit 1; }
  have=$(az keyvault secret list --vault-name "$VAULT" --query "[?name=='$NAME'].name | [0]" -o tsv)
  if [[ -n $have && $FORCE -eq 0 ]]; then echo "$NAME: already in $VAULT, left as it is (--force to replace)"; exit 0; fi
  if ((DRY)); then echo "dry-run: would ask for the key and write it to $VAULT/$NAME"; exit 0; fi
fi

# The key stays in this shell's memory only: read without echo, checked for its shape, handed to the next command on
# its standard input by a shell builtin (printf), then cleared.
IFS= read -rs -p "Paste the OpenAI API key (it won't show), then Enter: " KEY; echo
trap 'KEY=""' EXIT
[[ $KEY =~ ^sk-[A-Za-z0-9_-]{20,}$ ]] || { echo "That doesn't look like an OpenAI API key (sk-...). Nothing was written." >&2; exit 1; }

if ((LOCAL)); then
  printf '%s' "$KEY" | secret-tool store --label="FocusTime $ACCOUNT" service focustime account "$ACCOUNT"
  echo "$ACCOUNT: written to the keyring"
else
  printf '%s' "$KEY" | az keyvault secret set --vault-name "$VAULT" --name "$NAME" --file /dev/stdin --encoding utf-8 --content-type "FocusTime OpenAI API key" -o none
  echo "$NAME: written to $VAULT"
fi
KEY=""
