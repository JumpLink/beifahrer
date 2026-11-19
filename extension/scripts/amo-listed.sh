#!/bin/sh
# Fetch the LISTED Firefox build AMO signed for a tag, and write `updates.json` for it.
#
#   sh extension/scripts/amo-listed.sh v0.1.35 [minutes to wait, default 40]
#
# Since the public listing, every version goes to AMO's listed channel only: AMO accepts a version
# number once across BOTH channels (addons-server, "Add-ons" API: "unique across all channels"), so
# a version cannot also be signed unlisted for the GitHub release. The GitHub release carries the
# file AMO signed instead, and `updates.json` points at it. A copy installed from GitHub (0.1.34 and
# older carry manifest.ts's update_url) takes that update, and from then on updates from AMO by id,
# because the listed build has no update_url.
#
# AMO signs a listed version only after review, which can take minutes or days. The public API
# answers for a version once it is public, without a key, so this script needs no credentials: it
# polls until the file is public or the time is up, and a later run (release.yml's re-cut) picks up
# where it stopped.
set -eu
cd "$(dirname "$0")/.."
TAG="${1:?usage: amo-listed.sh <tag> [minutes]}"
MINUTES="${2:-40}"
VERSION="${TAG#v}"
GUID=$(sed -n "s/^export const GECKO_ID = '\(.*\)';$/\1/p" manifest.ts)
[ -n "$GUID" ] || { echo "no GECKO_ID in $(pwd)/manifest.ts" >&2; exit 2; }
API="https://addons.mozilla.org/api/v5/addons/addon/$GUID/versions/v$VERSION/"
OUT=.output/signed
mkdir -p "$OUT"

i=0
while :; do
  body=$(curl -fsS "$API" 2>/dev/null || true)
  url=$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const f=JSON.parse(s).file;if(f&&f.status==="public"&&f.url)console.log(f.url+" "+(f.hash||""))}catch{}})')
  [ -n "$url" ] && break
  i=$((i + 1))
  if [ "$i" -gt "$MINUTES" ]; then
    echo "AMO has not made $VERSION public within $MINUTES min (still in review, or not submitted)." >&2
    echo "Re-run release.yml by hand for $TAG (publish) once it is approved." >&2
    exit 3
  fi
  sleep 60
done

hash=${url#* }
url=${url%% *}
file="$OUT/$(basename "$url")"
curl -fsSL -o "$file" "$url"
if [ "${hash#sha256:}" != "$hash" ]; then
  got=$(sha256sum "$file" | cut -d' ' -f1)
  [ "sha256:$got" = "$hash" ] || { echo "hash mismatch for $file: AMO says $hash, got sha256:$got" >&2; exit 4; }
fi

../node_modules/.bin/gjsify build scripts/updates-json.ts --app gjs --outfile dist/updates-json.gjs.mjs
../node_modules/.bin/gjsify run dist/updates-json.gjs.mjs "$file" "$TAG"
mv updates.json "$OUT/updates.json"
# The setup assistant links to `releases/latest/download/beifahrer.xpi`; updates.json points at
# AMO's own file name.
cp "$file" "$OUT/beifahrer.xpi"
ls -la "$OUT"
