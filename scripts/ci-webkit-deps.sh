#!/usr/bin/env bash
# CI-2: WebKit's system packages for the browser jobs, surviving a package server outage.
#
# Usage: CI2_IMAGE=<runner image id> ci-webkit-deps.sh [cache dir]   (default ~/apt-webkit)
# Needs Playwright's WebKit browser already installed (or restored from its cache).
#
# 1. Offline first: when the cache was written on this same runner image and Playwright version and every file in it
#    matches its manifest, install exactly those .deb files with no network at all (`apt-get --no-download`). Installing
#    the cached files themselves, not what apt's lists call newest, is the point: on Nov 11 an exact cache hit still
#    failed because the lists named a newer libsoup than the cache held, and apt went to a mirror it couldn't reach.
# 2. Otherwise (no cache, another image or Playwright version, a damaged cache, or the offline install isn't complete):
#    the usual `playwright-core install-deps webkit`, seeded with whatever .deb files were cached, up to three attempts
#    of at most 3 minutes each with a wait between; then the cache is rewritten with exactly the installed versions for
#    the workflow to save.
# 3. If the usual way fails too (an outage on a new image or Playwright version): the files of whatever cache was
#    restored, from any image, with no network, accepted only when the check below passes.
#
# Done means complete: every package Playwright's own `install-deps --dry-run webkit` asks for is installed (a name it
# lists only because apt's lists know a newer version counts as installed), and WebKit launches headless and renders a
# page. A launch alone isn't enough: a partial install can start WebKit and still miss fonts or media libraries.
#
# Trust: local .deb files skip apt's signature check, and the manifest is written here. That is safe because GitHub
# scopes caches by ref: a pull request can only write its own scope, and ci.yml saves only from pushes to main.
#
# Ends with one line saying which path it took. Writes path=offline|online|fallback, save=true|false and hash=<16 hex>
# to $GITHUB_OUTPUT when set. Exits non-zero when no path gives a complete install.
set -euo pipefail

cache=$(realpath -m "${1:-$HOME/apt-webkit}")
image=${CI2_IMAGE:?set CI2_IMAGE to the runner image id}
pw=$(node -p "require('playwright-core/package.json').version")
stamp="image=$image playwright=$pw"
out=${GITHUB_OUTPUT:-/dev/null}
attempt_timeout=${CI2_ATTEMPT_TIMEOUT:-180}
apt=(sudo DEBIAN_FRONTEND=noninteractive apt-get -q -y)
hash=none attempt=0 count=0

log() { echo "webkit-deps: $*"; }
finish() { # path save note
  { echo "path=$1"; echo "save=$2"; echo "hash=$hash"; } >> "$out"
  echo "webkit-deps: took the $1 path: $3"
  exit 0
}
# dpkg's name for a package: arch "all" packages have no architecture qualifier.
qname() { if [[ $2 == all ]]; then echo "$1"; else echo "$1:$2"; fi; }
fields() { dpkg-deb -W --showformat='${Package} ${Version} ${Architecture}\n' "$1"; }

# Wait for another apt or dpkg (the runner's own jobs) instead of failing on the lock.
echo 'DPkg::Lock::Timeout "120";' | sudo tee /etc/apt/apt.conf.d/90ci2-lock >/dev/null

launches() {
  timeout 60 node -e '
    const { webkit } = require("playwright-core");
    (async () => {
      const b = await webkit.launch();
      const p = await b.newPage();
      await p.setContent("<p id=ok>ok</p>");
      if ((await p.textContent("#ok")) !== "ok") throw new Error("WebKit rendered nothing");
      await b.close();
    })().catch((e) => { console.error(String(e).split("\n").slice(0, 5).join("\n")); process.exit(1); });
  '
}

# Every package Playwright asks for is installed. The dry run simulates with apt's lists (no network); a package it
# names that dpkg has installed is only upgradable, which is fine.
packages_complete() {
  local report name missing=()
  report=$(npx playwright-core install-deps --dry-run webkit 2>&1) && return 0
  if ! grep -q '^Missing system dependencies' <<<"$report"; then
    log "the dry run failed:"; tail -5 <<<"$report"; return 1
  fi
  while read -r name; do
    [[ $(dpkg-query -W -f='${db:Status-Status}' "$name" 2>/dev/null) == installed ]] || missing+=("$name")
  done < <(sed -n '/^Missing system dependencies/,$ s/^  \([^ ]\{1,\}\)$/\1/p' <<<"$report")
  ((${#missing[@]} == 0)) && return 0
  log "${#missing[@]} packages missing: ${missing[*]:0:8}"
  return 1
}

# Complete, and WebKit starts (one retry: a cold first launch can be slow).
complete() {
  packages_complete || return 1
  launches || launches || { log "WebKit didn't start"; return 1; }
}

# A dpkg left half-way (a killed attempt, a failed install) is finished or cleaned before the next try.
repair() {
  sudo dpkg --configure -a >/dev/null 2>&1 || true
  timeout 120 "${apt[@]}" --no-download -f install >/dev/null 2>&1 || true
}

# The newest file per package and architecture, skipping any the system already has at that version or newer.
pick_debs() {
  local dir=$1 f pkg ver arch key have
  declare -A best=() bestver=()
  for f in "$dir"/*.deb; do
    [[ -e $f ]] || continue
    read -r pkg ver arch < <(fields "$f") || continue
    [[ -n $pkg && -n $ver ]] || continue
    key=$(qname "$pkg" "$arch")
    if [[ -z ${bestver[$key]:-} ]] || dpkg --compare-versions "$ver" gt "${bestver[$key]}"; then
      best[$key]=$f bestver[$key]=$ver
    fi
  done
  for key in "${!best[@]}"; do
    have=$(dpkg-query -W -f='${db:Status-Status} ${Version}' "$key" 2>/dev/null || true)
    if [[ $have == installed\ * ]] && dpkg --compare-versions "${have#installed }" ge "${bestver[$key]}"; then continue; fi
    echo "${best[$key]}"
  done
}

# The files are all there and intact, and nothing extra (a half-written or mixed cache fails here).
files_ok() {
  [[ -f $cache/manifest && -s $cache/manifest && -d $cache/debs ]] || { log "no complete cache"; return 1; }
  (cd "$cache" && sha256sum --quiet --strict -c manifest) || { log "cache files don't match their manifest"; return 1; }
  [[ $(find "$cache/debs" -name '*.deb' | wc -l) -eq $(wc -l < "$cache/manifest") ]] || { log "cache has files not in its manifest"; return 1; }
}

install_cached() {
  local debs
  mapfile -t debs < <(pick_debs "$cache/debs")
  count=${#debs[@]}
  ((count)) || return 0
  # --no-download: apt may use only these files and what is installed; anything else fails before dpkg runs.
  if ! "${apt[@]}" install --no-install-recommends --no-download -o Acquire::Retries=0 "${debs[@]}" > /tmp/ci2-offline.log 2>&1; then
    tail -5 /tmp/ci2-offline.log
    log "the install from the cache failed"
    repair
    return 1
  fi
}

offline() {
  [[ $image != *-unknown ]] || { log "the runner image isn't known, so no cache can match it"; return 1; }
  [[ -f $cache/stamp ]] || { log "no cache for this image"; return 1; }
  [[ $(cat "$cache/stamp") == "$stamp" ]] || { log "the cache is from $(cat "$cache/stamp"), this is $stamp"; return 1; }
  files_ok && install_cached && complete || { log "the offline install isn't complete"; return 1; }
}

online() {
  local n wait
  # Seed apt with whatever was cached (any image): apt checks each file against its lists and downloads only the rest.
  if compgen -G "$cache/debs/*.deb" >/dev/null; then sudo cp -n "$cache"/debs/*.deb /var/cache/apt/archives/ || true; fi
  for n in 1 2 3; do
    log "install-deps, attempt $n of 3"
    # Finish anything a failed attempt left broken, with the network this time.
    ((n == 1)) || timeout 120 "${apt[@]}" -f install >/dev/null 2>&1 || true
    # A mirror that answers slowly but never fails is cut off after $attempt_timeout seconds.
    if timeout --kill-after=15 "$attempt_timeout" npx playwright-core install-deps webkit && complete; then
      attempt=$n
      return 0
    fi
    repair
    if ((n < 3)); then wait=$((n * 20)); log "attempt $n failed, waiting ${wait}s"; sleep "$wait"; fi
  done
  return 1
}

# The cache, rewritten from scratch: exactly the installed version of each file apt holds, then the manifest, and the
# stamp last. Built beside the old one and swapped in, so a cache is never half-written.
write_cache() {
  local new=$cache.new f pkg ver arch
  rm -rf "$new"
  mkdir -p "$new/debs"
  for f in /var/cache/apt/archives/*.deb; do
    [[ -e $f ]] || continue
    read -r pkg ver arch < <(fields "$f") || continue
    [[ $(dpkg-query -W -f='${db:Status-Status} ${Version}' "$(qname "$pkg" "$arch")" 2>/dev/null) == "installed $ver" ]] \
      && cp "$f" "$new/debs/"
  done
  (cd "$new" && find debs -name '*.deb' -print0 | sort -z | xargs -0 -r sha256sum > manifest)
  [[ -s $new/manifest ]] || { log "no packages to cache"; rm -rf "$new"; return 1; }
  echo "$stamp" > "$new/stamp"
  rm -rf "$cache"
  mv "$new" "$cache"
  hash=$(cat "$cache/stamp" "$cache/manifest" | sha256sum | cut -c1-16)
}

if offline; then
  finish offline false "installed $count cached packages with no network ($stamp)"
fi
if online; then
  [[ $image != *-unknown ]] && write_cache && finish online true "install-deps on attempt $attempt; cache rewritten with $(wc -l < "$cache/manifest") packages, hash $hash"
  finish online false "install-deps on attempt $attempt; nothing cached"
fi
log "install-deps failed 3 times; trying whatever cache was restored, from any image, with no network"
if files_ok && install_cached && complete; then
  finish fallback false "installed $count packages from the cache of $(cat "$cache/stamp" 2>/dev/null || echo 'an unknown image') with no network"
fi
log "no complete install: WebKit's packages couldn't be installed"
exit 1
