#!/usr/bin/env bash
# FocusTime: what must exist before the first deploy of an environment (A4 for dev, A5 for prod). Run once by hand by
# someone who can create Entra groups and assign roles; idempotent, so running it again changes nothing.
#
#   1. The resource providers the template uses (a subscription setting; registering one creates no resource).
#   2. The resource group FocusTime-<env> (prod: FocusTime) in Central US.
#   3. The Entra security group "FocusTime DB Admins" (shared by dev and prod): the SQL servers' Entra admin and
#      Key Vault Secrets Officer. Members are added, never removed.
#   4. The deploy identity ft-<env>-deploy (a user-assigned managed identity in the resource group) with a federated
#      credential for GitHub Actions on main (no client secret anywhere), Contributor and User Access Administrator on
#      that resource group only, and membership of the DB admins group (the post-deploy database script runs with its
#      token, never by hand).
#   5. The GitHub repository variables the workflows read (ids only, never a secret).
#
# Prints names and ids, never a secret (there are none here).
#
# Usage: infra/scripts/bootstrap.sh --env dev --member <upn> [--member <upn> ...] [--dry-run]
set -euo pipefail

SUBSCRIPTION="65be698f-0695-48f4-b322-1aa1c387d5e2"
LOCATION="centralus"
REPO="cooptimize/focustime"
GROUP="FocusTime DB Admins"
ENV="" DRY=0 MEMBERS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV=$2; shift 2 ;;
    --member) MEMBERS+=("$2"); shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ENV" in dev) RG="FocusTime-dev" ;; prod) RG="FocusTime" ;; *) echo "usage: $0 --env dev|prod --member UPN ... [--dry-run]" >&2; exit 2 ;; esac
UAMI="ft-$ENV-deploy"
run() { if ((DRY)); then echo "dry-run: az $*"; else az "$@"; fi; }

command -v az >/dev/null || { echo "Azure CLI not found" >&2; exit 1; }
[[ $(az account show --query id -o tsv) == "$SUBSCRIPTION" ]] || { echo "The current subscription is not $SUBSCRIPTION (az account set --subscription $SUBSCRIPTION)" >&2; exit 1; }
TENANT=$(az account show --query tenantId -o tsv)

# 1. Providers.
for p in Microsoft.App Microsoft.ContainerRegistry Microsoft.OperationalInsights Microsoft.Insights Microsoft.Sql Microsoft.KeyVault Microsoft.ManagedIdentity; do
  if [[ $(az provider show -n "$p" --query registrationState -o tsv) != Registered ]]; then
    echo "Registering $p"; run provider register -n "$p" --wait -o none
  fi
done

# 2. Resource group.
if [[ $(az group exists -n "$RG") == true ]]; then echo "Resource group $RG exists"; else
  echo "Creating resource group $RG"; run group create -n "$RG" -l "$LOCATION" --tags app=focustime env="$ENV" -o none
fi

# 3. The DB admins group and its members.
GROUP_ID=$(az ad group list --display-name "$GROUP" --query "[?displayName=='$GROUP'].id" -o tsv)
if (($(grep -c . <<<"$GROUP_ID" || true) > 1)); then echo "More than one group is named $GROUP; fix that by hand first" >&2; exit 1; fi
if [[ -z $GROUP_ID ]]; then
  echo "Creating group $GROUP"
  if ((DRY)); then GROUP_ID="00000000-0000-0000-0000-000000000000"; else
    GROUP_ID=$(az ad group create --display-name "$GROUP" --mail-nickname focustime-db-admins \
      --description "FocusTime: Entra admins of the FocusTime SQL databases; Key Vault Secrets Officer" --query id -o tsv)
  fi
else echo "Group $GROUP exists ($GROUP_ID)"; fi
add_member() { # object id, label
  if ((DRY)) || [[ $(az ad group member check --group "$GROUP_ID" --member-id "$1" --query value -o tsv) != true ]]; then
    echo "Adding $2 to $GROUP"; run ad group member add --group "$GROUP_ID" --member-id "$1" -o none
  fi
}
for upn in "${MEMBERS[@]}"; do add_member "$(az ad user show --id "$upn" --query id -o tsv)" "$upn"; done

# 4. The deploy identity.
if ! az identity show -g "$RG" -n "$UAMI" -o none 2>/dev/null; then
  echo "Creating identity $UAMI"; run identity create -g "$RG" -n "$UAMI" -l "$LOCATION" --tags app=focustime env="$ENV" -o none
fi
if ((DRY)) && ! az identity show -g "$RG" -n "$UAMI" -o none 2>/dev/null; then CLIENT_ID="(new)" PRINCIPAL_ID=""; else
  CLIENT_ID=$(az identity show -g "$RG" -n "$UAMI" --query clientId -o tsv)
  PRINCIPAL_ID=$(az identity show -g "$RG" -n "$UAMI" --query principalId -o tsv)
fi
# GitHub's token subject: the name form, and the immutable-id form this organization's tokens use
# (repo:<owner>@<owner id>/<repo>@<repo id>:...). Both are added, so either format signs in.
SUBJECT="repo:$REPO:ref:refs/heads/main"
IDS=$(gh api "repos/$REPO" --jq '"\(.owner.id) \(.id)"' 2>/dev/null || true)
SUBJECTS=("github-main=$SUBJECT")
if [[ -n $IDS ]]; then SUBJECTS+=("github-main-ids=repo:${REPO%%/*}@${IDS%% *}/${REPO#*/}@${IDS#* }:ref:refs/heads/main"); fi
for pair in "${SUBJECTS[@]}"; do
  name=${pair%%=*} sub=${pair#*=}
  if [[ -z $(az identity federated-credential list -g "$RG" --identity-name "$UAMI" --query "[?subject=='$sub'].name" -o tsv 2>/dev/null) ]]; then
    echo "Adding the federated credential $name ($sub)"
    run identity federated-credential create -g "$RG" --identity-name "$UAMI" -n "$name" \
      --issuer https://token.actions.githubusercontent.com --subject "$sub" --audiences api://AzureADTokenExchange -o none
  fi
done
if [[ -n $PRINCIPAL_ID ]]; then
  RG_ID=$(az group show -n "$RG" --query id -o tsv)
  for role in Contributor "User Access Administrator"; do
    if [[ -z $(az role assignment list --assignee "$PRINCIPAL_ID" --scope "$RG_ID" --role "$role" --query "[].id" -o tsv) ]]; then
      echo "Assigning $role on $RG to $UAMI"
      # A new identity can take a minute to appear to the role service.
      for i in 1 2 3 4 5 6; do
        run role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "$role" --scope "$RG_ID" -o none && break
        ((i < 6)) || exit 1; sleep 15
      done
    fi
  done
  add_member "$PRINCIPAL_ID" "$UAMI"
fi

# 5. GitHub repository variables (ids, not secrets).
if command -v gh >/dev/null; then
  E=${ENV^^}
  for kv in "AZURE_TENANT_ID=$TENANT" "AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION" "AZURE_${E}_CLIENT_ID=$CLIENT_ID" "AZURE_${E}_RESOURCE_GROUP=$RG" "AZURE_DB_ADMIN_GROUP_ID=$GROUP_ID"; do
    if ((DRY)); then echo "dry-run: gh variable set ${kv%%=*}"; else gh variable set "${kv%%=*}" --repo "$REPO" --body "${kv#*=}"; fi
  done
else echo "gh not found: set the repository variables by hand (docs/azure/runbook.md)"; fi

echo
echo "== $ENV"
echo "resource group:   $RG ($LOCATION)"
echo "db admins group:  $GROUP ($GROUP_ID)"
echo "deploy identity:  $UAMI (client id $CLIENT_ID)"
printf "federated:        %s\n" "${SUBJECTS[@]#*=}"
