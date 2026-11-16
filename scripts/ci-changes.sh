#!/usr/bin/env bash
# CI-3: does this ci run need the heavy jobs (the browser shards, the WebKit job, the image)? Prints code=true or
# code=false (for $GITHUB_OUTPUT) and says why on stderr. Read-only: git only.
#
# code=false only when all of these hold, else code=true:
#   - the run is for a pull request (a push to main, and deploy-dev calling ci, always run everything);
#   - HEAD is GitHub's merge of the pull request into main and its first parent (main at that moment) is here;
#   - at least one file changed, and every changed path, before and after a rename, is under docs/ but not under
#     docs/technical/ (the app shows those pages and the image carries them). Nothing else under docs/ is read by a
#     browser test or the image: .dockerignore leaves docs/ out except docs/technical/, and the tests that read a file
#     there (decisions, the build guide, the guards) are in the unit job, which always runs.
# Anything else, including a file at the top of the repo (the image copies those), is code.
#
# Usage: ci-changes.sh <event name>              compares HEAD^1 with HEAD
#        ci-changes.sh --classify < paths        one path per line, for the tests
set -uo pipefail

docs_only() {
  local any=false path
  while IFS= read -r path; do
    [[ -z $path ]] && continue
    any=true
    [[ $path == docs/* && $path != docs/technical/* && $path != docs/technical ]] || { echo "code: $path" >&2; return 1; }
  done
  [[ $any == true ]] || { echo "code: no changed files found" >&2; return 1; }
  return 0
}

answer() { echo "code=$1"; echo "ci-changes: code=$1 ($2)" >&2; exit 0; }

if [[ ${1:-} == --classify ]]; then
  docs_only && answer false "only docs outside docs/technical" || answer true "a path that can change the app or its tests"
fi

[[ ${1:-} == pull_request ]] || answer true "event ${1:-none}: not a pull request"
git rev-parse -q --verify 'HEAD^1' >/dev/null 2>&1 || answer true "no first parent to compare with"
git rev-parse -q --verify 'HEAD^2' >/dev/null 2>&1 || answer true "HEAD is not a merge commit"
files=$(git diff --name-only --no-renames 'HEAD^1' HEAD) || answer true "git diff failed"
docs_only <<< "$files" && answer false "only docs outside docs/technical: $(wc -l <<< "$files") file(s)" || answer true "a path that can change the app or its tests"
