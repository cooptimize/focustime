#!/usr/bin/env bash
# FocusTime: create or update the "FocusTime" Entra web app registration (step A0, run in A4).
#
# Idempotent: finds the registration by display name and brings it to the state below; running it again changes
# nothing. It prints the registration's settings at the end and never prints, logs or stores a secret: the client
# secret goes from `az ad app credential reset` straight into Key Vault through a pipe.
#
#   - single tenant (AzureADMyOrg), platform web, implicit flow off (no access or ID tokens from /authorize)
#   - redirect URIs for dev, prod and local development
#   - delegated Microsoft Graph and Azure Service Management scopes (resolved to their ids from the tenant)
#   - a service principal, then admin consent for the whole tenant
#   - a client secret in Key Vault only when the vault has none yet, or with --rotate-secret
#
# Needs: Azure CLI, `az login` as someone who can create app registrations and grant admin consent in the tenant,
# and secrets set permission on the vault.
#
# Usage:
#   infra/scripts/app-registration.sh --dev-url https://<dev app>.centralus.azurecontainerapps.io \
#     --prod-url https://<prod app>.centralus.azurecontainerapps.io --vault <key vault name> [--rotate-secret] [--dry-run]
set -euo pipefail

NAME="FocusTime"
SECRET_NAME="entra-client-secret"
SECRET_YEARS=1
LOCAL_URL="http://localhost:5317"
CALLBACK="/auth/microsoft/callback"
GRAPH_API="00000003-0000-0000-c000-000000000000"
ARM_API="797f4846-ba00-4fd7-ba43-dac1f8f63013"
# Delegated scopes (docs/azure/A0-inventory.md section 7). Calendars.ReadWrite covers ReadBasic; MailboxSettings.Read
# gives each user's time zone (section 6). Presence.Read.All and ProfilePhoto.Read.All are the tenant-wide reads.
GRAPH_SCOPES=(openid profile email offline_access User.Read Calendars.ReadWrite MailboxSettings.Read Presence.ReadWrite Presence.Read.All ProfilePhoto.Read.All)
ARM_SCOPES=(user_impersonation)

DEV_URL="" PROD_URL="" VAULT="" ROTATE=0 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-url) DEV_URL=${2%/}; shift 2 ;;
    --prod-url) PROD_URL=${2%/}; shift 2 ;;
    --vault) VAULT=$2; shift 2 ;;
    --rotate-secret) ROTATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n $DEV_URL && -n $PROD_URL && -n $VAULT ]] || { echo "usage: $0 --dev-url URL --prod-url URL --vault NAME [--rotate-secret] [--dry-run]" >&2; exit 2; }
for u in "$DEV_URL" "$PROD_URL"; do [[ $u =~ ^https://[a-z0-9.-]+$ ]] || { echo "not an https origin: $u" >&2; exit 2; }; done

command -v az >/dev/null || { echo "Azure CLI not found" >&2; exit 1; }
az account show -o none 2>/dev/null || { echo "Run az login first" >&2; exit 1; }
run() { if ((DRY)); then echo "dry-run: az $*"; else az "$@"; fi; }

REDIRECTS=("$DEV_URL$CALLBACK" "$PROD_URL$CALLBACK" "$LOCAL_URL$CALLBACK")

# 1. The registration, found by display name (exactly one, or none).
ids=$(az ad app list --display-name "$NAME" --query "[?displayName=='$NAME'].appId" -o tsv)
count=$(grep -c . <<<"$ids" || true)
if ((count > 1)); then echo "More than one registration is named $NAME; fix that by hand first" >&2; exit 1; fi
if ((count == 0)); then
  echo "Creating $NAME"
  if ((DRY)); then APP_ID="00000000-0000-0000-0000-000000000000"; else
    APP_ID=$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
  fi
else
  APP_ID=$ids
  echo "Found $NAME ($APP_ID)"
fi

# 2. Platform web, the redirect URIs, implicit flow off. (Replaces the web redirect list with exactly these three.)
run ad app update --id "$APP_ID" --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "${REDIRECTS[@]}" \
  --enable-access-token-issuance false --enable-id-token-issuance false -o none

# 3. Delegated permissions, by id from each API's service principal in this tenant.
scope_ids() { # api, names... -> "id=Scope" pairs
  local api=$1; shift
  local n id
  for n in "$@"; do
    id=$(az ad sp show --id "$api" --query "oauth2PermissionScopes[?value=='$n'].id | [0]" -o tsv)
    [[ -n $id ]] || { echo "No delegated scope $n on $api" >&2; exit 1; }
    printf '%s=Scope ' "$id"
  done
}
have=$(az ad app show --id "$APP_ID" --query "requiredResourceAccess[].resourceAccess[].id" -o tsv 2>/dev/null || true)
for pair in "$GRAPH_API:${GRAPH_SCOPES[*]}" "$ARM_API:${ARM_SCOPES[*]}"; do
  api=${pair%%:*}
  read -r -a names <<<"${pair#*:}"
  want=()
  for p in $(scope_ids "$api" "${names[@]}"); do grep -qx "${p%%=*}" <<<"$have" || want+=("$p"); done
  if ((${#want[@]})); then run ad app permission add --id "$APP_ID" --api "$api" --api-permissions "${want[@]}" -o none; fi
done

# 4. The service principal (enterprise app), then admin consent for the tenant.
if ! az ad sp show --id "$APP_ID" -o none 2>/dev/null; then run ad sp create --id "$APP_ID" -o none; fi
run ad app permission admin-consent --id "$APP_ID"

# 5. The client secret: written to Key Vault through a pipe, never into a variable, a file, the terminal or a log.
# --append keeps the previous secret valid until it expires, so a rotation never breaks the running app; remove the
# old one by hand (az ad app credential delete) once the app has restarted on the new one.
existing=$(az keyvault secret list --vault-name "$VAULT" --query "[?name=='$SECRET_NAME'].name | [0]" -o tsv 2>/dev/null || true)
if [[ -z $existing || $ROTATE -eq 1 ]]; then
  if ((DRY)); then echo "dry-run: new client secret into $VAULT/$SECRET_NAME"; else
    az ad app credential reset --id "$APP_ID" --display-name "focustime-$(date +%Y%m%d)" --years "$SECRET_YEARS" --append --query password -o tsv \
      | tr -d '\n' \
      | az keyvault secret set --vault-name "$VAULT" --name "$SECRET_NAME" --file /dev/stdin --encoding utf-8 \
          --content-type "Entra client secret for $NAME" --expires "$(date -u -d "+$SECRET_YEARS year" +%Y-%m-%dT%H:%M:%SZ)" -o none
    echo "Client secret written to Key Vault $VAULT as $SECRET_NAME"
  fi
else
  echo "Key Vault $VAULT already has $SECRET_NAME; pass --rotate-secret for a new one"
fi

# 6. What the registration looks like now (no secret values: only the credentials' names and end dates).
echo
echo "== $NAME"
az ad app show --id "$APP_ID" --query "{appId:appId, audience:signInAudience, redirectUris:web.redirectUris, implicitAccessTokens:web.implicitGrantSettings.enableAccessTokenIssuance, implicitIdTokens:web.implicitGrantSettings.enableIdTokenIssuance, secrets:passwordCredentials[].{name:displayName, ends:endDateTime}}" -o yaml
echo "== Delegated permissions"
az ad app permission list --id "$APP_ID" --query "[].{api:resourceAppId, ids:resourceAccess[].id}" -o yaml
echo "== Granted (admin consent)"
az ad app permission list-grants --id "$APP_ID" --query "[].{resource:resourceId, scope:scope, consentType:consentType}" -o yaml
