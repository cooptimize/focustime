#!/usr/bin/env bash
# FocusTime (ADM-1): the "FocusTime Admins" Entra security group, whose members are FocusTime's admins (dev and prod
# share it: one tenant). Idempotent; shows what it will do and asks before any change:
#   1. creates the group when there is none (a security group, not mail enabled, no owners but you);
#   2. adds you (the signed-in az user) as its first member when you aren't one;
#   3. on the FocusTime web registration (--app-id, never "Coopilot Desktop"), turns on the groups claim for security
#      groups (groupMembershipClaims = SecurityGroup) when it's off, so sign-in can tell admins without a Graph call;
#   4. sets the GitHub variable FT_ADMIN_GROUP_ID to the group's object id (--github), which deploy-dev.yml and
#      deploy-prod.yml pass to Bicep as FOCUSTIME_ADMIN_GROUP_ID. The next deploy of each environment picks it up.
# Nothing secret is read or written. FocusTime itself never adds anyone to the group: manage members in Entra
# (docs/azure/runbook.md, "Admins").
#
# Usage: infra/scripts/admin-group.sh --app-id <FocusTime web client id> [--github <owner/repo>] [--yes] [--dry-run]
set -euo pipefail
NAME="FocusTime Admins" NICK="focustime-admins" APP_ID="" REPO="" YES=0 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-id) APP_ID=$2; shift 2 ;;
    --github) REPO=$2; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n $APP_ID ]] || { echo "usage: $0 --app-id <FocusTime web client id> [--github owner/repo] [--yes] [--dry-run]" >&2; exit 2; }
command -v az >/dev/null || { echo "az not found" >&2; exit 1; }

me=$(az ad signed-in-user show --query id -o tsv)
app_name=$(az ad app show --id "$APP_ID" --query displayName -o tsv)
[[ $app_name == "Coopilot Desktop" ]] && { echo "That is the Coopilot Desktop registration; FocusTime leaves it alone. Pass the FocusTime web registration's client id." >&2; exit 1; }
group=$(az ad group list --filter "displayName eq '$NAME'" --query "[0].id" -o tsv)
claims=$(az ad app show --id "$APP_ID" --query groupMembershipClaims -o tsv)

plan=()
[[ -z $group ]] && plan+=("create the security group \"$NAME\"")
if [[ -n $group ]]; then
  member=$(az ad group member check --group "$group" --member-id "$me" --query value -o tsv)
  [[ $member == "true" ]] || plan+=("add you ($me) to \"$NAME\"")
else
  plan+=("add you ($me) to \"$NAME\"")
fi
[[ $claims == "SecurityGroup" || $claims == "All" ]] || plan+=("turn on the groups claim (SecurityGroup) on \"$app_name\" (now: ${claims:-none})")
[[ -n $REPO ]] && plan+=("set the GitHub variable FT_ADMIN_GROUP_ID on $REPO")

if [[ ${#plan[@]} -eq 0 ]]; then echo "Nothing to do: \"$NAME\" is $group, you are a member, the groups claim is on."; exit 0; fi
echo "This will:"; printf '  - %s\n' "${plan[@]}"
if ((DRY)); then echo "dry-run: nothing changed"; exit 0; fi
if ((YES == 0)); then read -r -p "Go ahead? [y/N] " ok; [[ $ok == y || $ok == Y ]] || { echo "Nothing changed."; exit 0; }; fi

if [[ -z $group ]]; then
  group=$(az ad group create --display-name "$NAME" --mail-nickname "$NICK" --description "FocusTime admins: manage FocusTime's settings and see its health (ADM-1)" --query id -o tsv)
  echo "Created \"$NAME\": $group"
fi
if [[ $(az ad group member check --group "$group" --member-id "$me" --query value -o tsv) != "true" ]]; then
  az ad group member add --group "$group" --member-id "$me"
  echo "Added you to \"$NAME\""
fi
if [[ $claims != "SecurityGroup" && $claims != "All" ]]; then
  az ad app update --id "$APP_ID" --set groupMembershipClaims=SecurityGroup
  echo "Groups claim on for \"$app_name\""
fi
if [[ -n $REPO ]]; then
  command -v gh >/dev/null || { echo "gh not found: set FT_ADMIN_GROUP_ID=$group on $REPO by hand" >&2; exit 1; }
  gh variable set FT_ADMIN_GROUP_ID --repo "$REPO" --body "$group"
  echo "FT_ADMIN_GROUP_ID set on $REPO"
else
  echo "Next: gh variable set FT_ADMIN_GROUP_ID --repo <owner/repo> --body $group"
fi
echo "Then run deploy-dev (and deploy-prod) so the app gets FOCUSTIME_ADMIN_GROUP_ID."
