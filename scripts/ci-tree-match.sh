#!/usr/bin/env bash
# deploy-dev's reuse check (S1, D456): did a passing ci run of the PR this commit came from test exactly this tree?
# Usage: ci-tree-match.sh <owner/repo> <merged commit sha>. Writes tested=true|false and pr=<n>|none to $GITHUB_OUTPUT
# (or prints them). Read-only: GitHub's API and git only.
#
# How the match works: ci.yml's test job saves `git rev-parse HEAD^{tree}` as the artifact "tested-tree". For a PR run
# HEAD is GitHub's merge of the PR into main at that moment. The merged commit on main has the same tree exactly when
# nothing else reached main in between (or the PR was up to date), so equal trees mean the same code was tested.
# Anything missing or different (no PR, no passing run, an expired artifact, main moved) answers false: the full suite runs.
set -euo pipefail
repo=$1 sha=$2
out=${GITHUB_OUTPUT:-/dev/stdout}
answer() { echo "tested=$1" >> "$out"; echo "pr=$2" >> "$out"; echo "reuse: tested=$1 pr=$2 ($3)"; exit 0; }

tree=$(git rev-parse "$sha^{tree}")
pr=$(gh api "repos/$repo/commits/$sha/pulls" --jq '[.[] | select(.merged_at != null)][0].number // empty' 2>/dev/null || true)
[[ -n $pr ]] || answer false none "no merged PR for $sha"
head=$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)
# The newest passing pull_request run of ci on the PR's last commit.
run=$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$head&event=pull_request&status=success&per_page=1" --jq '.workflow_runs[0].id // empty')
[[ -n $run ]] || answer false "$pr" "no passing ci run for the PR's head $head"
dir=$(mktemp -d)
gh run download "$run" -R "$repo" -n tested-tree -D "$dir" >/dev/null 2>&1 || answer false "$pr" "run $run has no tested-tree artifact"
tested=$(tr -d '[:space:]' < "$dir/tested-tree.txt")
[[ $tested == "$tree" ]] && answer true "$pr" "run $run tested tree $tree" || answer false "$pr" "run $run tested $tested, merged tree is $tree"
