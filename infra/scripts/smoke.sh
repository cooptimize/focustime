#!/usr/bin/env bash
# FocusTime: a read-only check after a deploy (HK-2), run by hand with your own `az login` (Reader on the resource
# group is enough). It changes nothing in Azure and prints no secret, no user data and no message text: only states,
# counts and ids. Checks:
#   1. the database: its tier (dev S0, prod S1) and that it's Online
#   2. health: /healthz and /readyz answer 200, /version serves this environment (and --sha, when given)
#   3. the database through the app: /api/db-status says "ok"
#   4. migrations at head: opening the store migrates it, so a served build with a working database is at its head;
#      App Insights must show no database migration error since the running revision started
#   5. both pollers ran in the last --minutes (default 30): the Teams chats job (plan/requests_poll) and the DevOps
#      checks (devops/check). Both run only inside someone's working hours, so outside them this is a warning only.
# Admin › Status is the last check and needs a signed-in admin: open it in the app.
#
# Usage: infra/scripts/smoke.sh --env dev|prod [--sha <7-char commit>] [--minutes 30]
set -euo pipefail
shopt -s inherit_errexit

ENV="" SHA="" MINUTES=30
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV=$2; shift 2 ;;
    --sha) SHA=$2; shift 2 ;;
    --minutes) MINUTES=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ENV" in
  dev) RG="FocusTime-dev" WANT_SKU="S0" ;;
  prod) RG="FocusTime" WANT_SKU="S1" ;;
  *) echo "Usage: $0 --env dev|prod [--sha <commit>] [--minutes 30]" >&2; exit 2 ;;
esac
[[ $MINUTES =~ ^[0-9]+$ ]] || { echo "--minutes takes a whole number" >&2; exit 2; }

FAILED=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; FAILED=1; }
warn() { echo "warn  $*"; }

# 1. The database's tier.
SQL=$(az sql server list -g "$RG" --query "[0].name" -o tsv)
read -r SKU STATUS <<<"$(az sql db show -g "$RG" -s "$SQL" -n focustime --query "[sku.name, status]" -o tsv | tr '\n' ' ')"
if [[ $SKU == "$WANT_SKU" && $STATUS == Online ]]; then ok "database: $SKU, $STATUS"; else bad "database: $SKU, $STATUS (want $WANT_SKU, Online)"; fi

# 2. Health and the served build. The public URL is the last deploy's output.
URL=$(az deployment group show -g "$RG" -n "ft-$ENV" --query properties.outputs.publicUrl.value -o tsv)
URL=${URL%/}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
# Dev may be scaled to zero: the first request wakes it.
for _ in $(seq 1 18); do [[ $(code "$URL/healthz") == 200 ]] && break; sleep 10; done
for p in /healthz /readyz; do
  c=$(code "$URL$p"); if [[ $c == 200 ]]; then ok "$p 200"; else bad "$p $c"; fi
done
served=$(curl -fsS --max-time 20 "$URL/version" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(`${v.env} ${v.sha}`)})') || served="unreadable"
if [[ $served == "$ENV "* && ( -z $SHA || $served == "$ENV $SHA"* ) ]]; then ok "serves: $served"; else bad "serves: $served (want $ENV${SHA:+ $SHA})"; fi

# 3. The database through the app (a POST with the app's own origin, as the page sends it).
db=$(curl -s --max-time 60 -X POST -H "Origin: $URL" -H "content-type: application/json" -d '{}' "$URL/api/db-status" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).status)}catch{console.log("unreadable")}})')
if [[ $db == ok ]]; then ok "database through the app: ok"; else bad "database through the app: $db"; fi

# 4 and 5 read App Insights (the workspace's App* tables).
WS=$(az monitor log-analytics workspace show -g "$RG" -n "ft-$ENV-log" --query customerId -o tsv)
query() { az monitor log-analytics query -w "$WS" --analytics-query "$1" --query "[0].n" -o tsv 2>/dev/null || echo "?"; }
REV_START=$(az containerapp revision list -g "$RG" -n "ft-$ENV-app" --query "[?properties.active] | [0].properties.createdTime" -o tsv)
errors=$(query "union AppTraces, AppExceptions | where TimeGenerated > datetime($REV_START) | where tostring(Properties.source) == 'database' and SeverityLevel >= 2 | summarize n=count()")
if [[ $errors == 0 ]]; then ok "migrations: no database errors since the revision started ($REV_START)"; else bad "migrations: $errors database errors since $REV_START (App Insights, source database)"; fi

ran() { query "AppTraces | where TimeGenerated > ago(${MINUTES}m) | where tostring(Properties.source) == '$1' and tostring(Properties.op) == '$2' | summarize n=count()"; }
for job in "plan requests_poll Teams chats poller" "devops check DevOps checks"; do
  read -r src op label <<<"$job"
  n=$(ran "$src" "$op")
  if [[ $n =~ ^[1-9] ]]; then ok "$label: $n runs in the last $MINUTES minutes"
  else warn "$label: no runs in the last $MINUTES minutes (expected only inside someone's working hours; dev only while awake)"; fi
done

echo "Admin › Status: open $URL as an admin to finish the check."
exit "$FAILED"
