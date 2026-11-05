#!/usr/bin/env bash
# FocusTime: create or update the "FocusTime" Entra web app registration (written in A0; --local run in A2, full run in A4).
#
# Idempotent: finds the registration by display name and brings it to the state below; running it again changes
# nothing. It prints the registration's settings at the end and never prints, logs or stores a secret: the client
# secret goes from `az ad app credential reset` straight into Key Vault through a pipe.
#
#   - single tenant (AzureADMyOrg), platform web, implicit flow off (no access or ID tokens from /authorize)
#   - the acct optional claim in the ID token (HK-1), keeping any other optional claims
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
#     [--prod-url https://<prod app>.centralus.azurecontainerapps.io] --vault <key vault name> [--rotate-secret] [--dry-run]
#
# The redirect list is replaced with exactly the URLs given (plus local), so A5 passes --dev-url and --prod-url both.
#   infra/scripts/app-registration.sh --local [--port 5317] [--rotate-secret] [--dry-run]
#   infra/scripts/app-registration.sh --claims-only [--dry-run]
#
# --claims-only (HK-1): only the optional claims (step 2b), nothing else: no redirect URIs, permissions, grants or
# secrets. Use it to add a claim to the existing registration. A full run re-grants consent with `az ad app permission
# grant`, which deletes every grant the app has for that API (people's own consents too, azure-cli issue 20974) and
# makes one tenant-wide grant of GRAPH_SCOPES; a scope consented later (Chat.Read, AP-1) is lost. See
# docs/open-questions.md (Q-HK1-1) before a full run.
#
# --local (A2, before any vault exists): the developer loop only. The redirect URI is http://localhost:<port> alone,
# and the client secret goes through a pipe into the local host's secret store (Secret Service, service "focustime",
# account entra-client-secret) instead of Key Vault. A4 runs it again with the dev and prod URLs and a vault.
set -euo pipefail

NAME="FocusTime"
# Key Vault secret name (A4); the local host's secret store keeps its own name, entra-client-secret.
SECRET_NAME="ft-entra-client-secret"
LOCAL_SECRET_NAME="entra-client-secret"
SECRET_YEARS=1
LOCAL_URL="http://localhost:5317"
CALLBACK="/auth/microsoft/callback"
GRAPH_API="00000003-0000-0000-c000-000000000000"
ARM_API="797f4846-ba00-4fd7-ba43-dac1f8f63013"
# Delegated scopes (docs/azure/A0-inventory.md section 7). Calendars.ReadWrite covers ReadBasic; MailboxSettings.Read
# gives each user's time zone (section 6). Presence.Read.All and ProfilePhoto.Read.All are the tenant-wide reads.
# Chat.ReadBasic (T-2): names and members of the person's own Teams chats for delivery chats, never messages; a user can
# consent to it, and the grant below allows it for the tenant.
GRAPH_SCOPES=(openid profile email offline_access User.Read Calendars.ReadWrite MailboxSettings.Read Presence.ReadWrite Presence.Read.All ProfilePhoto.Read.All Chat.ReadBasic)
ARM_SCOPES=(user_impersonation)

DEV_URL="" PROD_URL="" VAULT="" ROTATE=0 DRY=0 LOCAL=0 PORT=5317 CLAIMS_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL=1; shift ;;
    --claims-only) CLAIMS_ONLY=1; shift ;;
    --port) PORT=$2; shift 2 ;;
    --dev-url) DEV_URL=${2%/}; shift 2 ;;
    --prod-url) PROD_URL=${2%/}; shift 2 ;;
    --vault) VAULT=$2; shift 2 ;;
    --rotate-secret) ROTATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if ((CLAIMS_ONLY)); then
  [[ -z $DEV_URL && -z $PROD_URL && -z $VAULT && $LOCAL -eq 0 && $ROTATE -eq 0 ]] || { echo "--claims-only takes only --dry-run" >&2; exit 2; }
elif ((LOCAL)); then
  [[ -z $DEV_URL && -z $PROD_URL && -z $VAULT ]] || { echo "--local takes no --dev-url, --prod-url or --vault" >&2; exit 2; }
  [[ $PORT =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || { echo "--port must be 1024-65535" >&2; exit 2; }
  command -v secret-tool >/dev/null || { echo "secret-tool not found (the local host's secret store)" >&2; exit 1; }
  LOCAL_URL="http://localhost:$PORT"
else
  [[ -n $DEV_URL && -n $VAULT ]] || { echo "usage: $0 --dev-url URL [--prod-url URL] --vault NAME [--rotate-secret] [--dry-run], or $0 --local [--port N]" >&2; exit 2; }
  for u in "$DEV_URL" ${PROD_URL:+"$PROD_URL"}; do [[ $u =~ ^https://[a-z0-9.-]+$ ]] || { echo "not an https origin: $u" >&2; exit 2; }; done
fi

command -v az >/dev/null || { echo "Azure CLI not found" >&2; exit 1; }
az account show -o none 2>/dev/null || { echo "Run az login first" >&2; exit 1; }
run() { if ((DRY)); then echo "dry-run: az $*"; else az "$@"; fi; }

if ((LOCAL)); then REDIRECTS=("$LOCAL_URL$CALLBACK"); else REDIRECTS=("$DEV_URL$CALLBACK" ${PROD_URL:+"$PROD_URL$CALLBACK"} "$LOCAL_URL$CALLBACK"); fi

# 1. The registration, found by display name (exactly one, or none).
ids=$(az ad app list --display-name "$NAME" --query "[?displayName=='$NAME'].appId" -o tsv)
count=$(grep -c . <<<"$ids" || true)
if ((count > 1)); then echo "More than one registration is named $NAME; fix that by hand first" >&2; exit 1; fi
if ((count == 0 && CLAIMS_ONLY)); then echo "No registration named $NAME; run the full script first" >&2; exit 1; fi
if ((count == 0)); then
  echo "Creating $NAME"
  if ((DRY)); then APP_ID="00000000-0000-0000-0000-000000000000"; else
    APP_ID=$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
  fi
else
  APP_ID=$ids
  echo "Found $NAME ($APP_ID)"
fi

# 2. Platform web, the redirect URIs, implicit flow off. (Replaces the web redirect list with exactly these.)
((CLAIMS_ONLY)) || run ad app update --id "$APP_ID" --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "${REDIRECTS[@]}" \
  --enable-access-token-issuance false --enable-id-token-issuance false -o none

# 2b. HK-1 (Q-ADM2-2): the acct optional claim in the ID token (0 member, 1 guest; Microsoft Learn, optional claims
# reference, checked Nov 5 2026), so sign-in tells a guest from the token first (ADM-2's guestToken: acct, then idp, then
# a #EXT# UPN). The optionalClaims object is replaced on update, so every claim already there is kept and acct is added
# to the idToken list only when it is missing: a rerun changes nothing.
command -v jq >/dev/null || { echo "jq not found (needed to keep the registration's other optional claims)" >&2; exit 1; }
claims=$(az ad app show --id "$APP_ID" --query optionalClaims -o json 2>/dev/null || true)
[[ -n $claims && $claims != null ]] || claims='{}'
if jq -e '(.idToken // []) | any(.name == "acct")' <<<"$claims" >/dev/null; then
  echo "The ID token already has the acct optional claim"
else
  merged=$(jq -c '{idToken: ((.idToken // []) + [{name: "acct", source: null, essential: false, additionalProperties: []}]), accessToken: (.accessToken // []), saml2Token: (.saml2Token // [])}' <<<"$claims")
  run ad app update --id "$APP_ID" --optional-claims "$merged" -o none
  ((DRY)) || echo "Added the acct optional claim to the ID token"
fi
if ((CLAIMS_ONLY)); then
  echo "== $NAME: ID token optional claims"
  az ad app show --id "$APP_ID" --query "optionalClaims.idToken[].name" -o tsv
  exit 0
fi

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
# Tenant-wide consent for the delegated scopes: one AllPrincipals grant per API (`permission grant` creates or updates
# it, so a rerun changes nothing). `permission admin-consent` goes through a legacy portal endpoint that fails once the
# service principal exists, so it isn't used.
grant() { # api, scope names...
  local api=$1; shift
  run ad app permission grant --id "$APP_ID" --api "$api" --scope "$*" -o none
}
grant "$GRAPH_API" "${GRAPH_SCOPES[@]}"
grant "$ARM_API" "${ARM_SCOPES[@]}"

# 5. The client secret: written to Key Vault through a pipe, never into a variable, a file, the terminal or a log.
# --append keeps the previous secret valid until it expires, so a rotation never breaks the running app; remove the
# old one by hand (az ad app credential delete) once the app has restarted on the new one.
if ((LOCAL)); then
  # Whether the store has one already, without printing it (lookup's output goes nowhere).
  if secret-tool lookup service focustime account "$LOCAL_SECRET_NAME" >/dev/null 2>&1 && ((ROTATE == 0)); then
    echo "The local secret store already has $LOCAL_SECRET_NAME; pass --rotate-secret for a new one"
  elif ((DRY)); then echo "dry-run: new client secret into the local secret store (focustime/$LOCAL_SECRET_NAME)"; else
    az ad app credential reset --id "$APP_ID" --display-name "focustime-local-$(date +%Y%m%d)" --years "$SECRET_YEARS" --append --query password -o tsv \
      | tr -d '\n' \
      | secret-tool store --label "FocusTime: $LOCAL_SECRET_NAME" service focustime account "$LOCAL_SECRET_NAME"
    echo "Client secret written to the local secret store as focustime/$LOCAL_SECRET_NAME"
  fi
else
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
fi

# 6. What the registration looks like now (no secret values: only the credentials' names and end dates).
if ((DRY)) && [[ $APP_ID == 00000000-0000-0000-0000-000000000000 ]]; then echo "dry-run: nothing to show yet"; exit 0; fi
echo
echo "== $NAME"
az ad app show --id "$APP_ID" --query "{appId:appId, audience:signInAudience, redirectUris:web.redirectUris, implicitAccessTokens:web.implicitGrantSettings.enableAccessTokenIssuance, implicitIdTokens:web.implicitGrantSettings.enableIdTokenIssuance, idTokenClaims:optionalClaims.idToken[].name, secrets:passwordCredentials[].{name:displayName, ends:endDateTime}}" -o yaml
echo "== Delegated permissions"
az ad app permission list --id "$APP_ID" --query "[].{api:resourceAppId, ids:resourceAccess[].id}" -o yaml
echo "== Granted (admin consent)"
az ad app permission list-grants --id "$APP_ID" --query "[].{resource:resourceId, scope:scope, consentType:consentType}" -o yaml
