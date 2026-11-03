#!/usr/bin/env bash
# FocusTime: dev and prod parity (D472), run by deploy-prod.yml before anything changes, and by hand any time.
# Fails when dev has an app setting, an app secret reference or a Key Vault secret whose name prod lacks, unless
# infra/parity-allow.txt allows it. Names only: it never reads a value (Reader can't list the app's secret values, and
# Key Vault Reader sees secret metadata only), and it prints nothing but names.
#
# Prod's names are what runs now plus what this deploy will add (--what-if: the JSON of
# `az deployment group what-if --no-pretty-print` for prod), so a setting that dev already got from this commit's
# Bicep doesn't fail the deploy that brings it to prod.
#
# Reads: ft-prod-deploy has Reader on ft-dev-app and Key Vault Reader on both vaults (bootstrap.sh --env prod, step 7).
# Usage: infra/scripts/parity.sh [--what-if <file>]
set -euo pipefail
shopt -s inherit_errexit # a failed read inside $( ) fails the check, never passes it

DEV_RG="FocusTime-dev" DEV_APP="ft-dev-app" PROD_RG="FocusTime" PROD_APP="ft-prod-app"
ALLOW="$(cd "$(dirname "$0")/.." && pwd)/parity-allow.txt"
WHATIF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --what-if) WHATIF=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "::error::$*" >&2; exit 1; }
# One name per line, "<kind> <name>": settings and app secret references of a container app.
app_names() {
  local out
  out=$(az containerapp show -g "$1" -n "$2" --query "{s: properties.template.containers[0].env[].name, r: properties.configuration.secrets[].name}" -o json) \
    || fail "Can't read $2's setting names (ft-prod-deploy needs Reader on it: infra/scripts/bootstrap.sh --env prod)"
  jq -r '((.s // [])[] | "setting \(.)"), ((.r // [])[] | "app-secret \(.)")' <<<"$out"
}
vault_names() {
  local vault out
  vault=$(az keyvault list -g "$1" --query '[0].name' -o tsv) || fail "Can't list the vaults in $1"
  [[ -n $vault ]] || fail "No Key Vault in $1"
  out=$(az keyvault secret list --vault-name "$vault" --query "[].name" -o tsv) \
    || fail "Can't list $vault's secret names (ft-prod-deploy needs Key Vault Reader on it: infra/scripts/bootstrap.sh --env prod)"
  sed 's/^/vault-secret /' <<<"$out" | grep -v '^vault-secret $' || true
}
planned_names() {
  [[ -n $WHATIF ]] || return 0
  jq -r --arg app "$PROD_APP" '
    .changes[]? | select(.resourceId | test("/containerApps/" + $app + "$"; "i")) | (.after // {}) .properties
    | ((.template.containers[0].env // [])[] | "setting \(.name)"), ((.configuration.secrets // [])[] | "app-secret \(.name)")' "$WHATIF"
}

dev=$( { app_names "$DEV_RG" "$DEV_APP"; vault_names "$DEV_RG"; } | sort -u)
prod=$( { app_names "$PROD_RG" "$PROD_APP"; vault_names "$PROD_RG"; planned_names; } | sort -u)
allowed=$(sed 's/#.*//; s/[[:space:]]*$//' "$ALLOW" | grep . | sort -u || true)

missing=$(comm -23 <(echo "$dev") <(echo "$prod") | comm -23 - <(echo "$allowed") | grep . || true)
echo "Compared $(grep -c . <<<"$dev") names in dev with prod ($([[ -n $WHATIF ]] && echo "now and after this deploy" || echo "now"))."
if [[ -n $missing ]]; then
  while read -r kind name; do echo "::error::Prod is missing the $kind $name that dev has. Add it through infra/ (or infra/scripts/copy-secrets.sh for a secret), or allow it in infra/parity-allow.txt with a reason." >&2; done <<<"$missing"
  exit 1
fi
echo "Prod has every name dev has."
