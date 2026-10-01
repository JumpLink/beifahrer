#!/bin/sh
# Sign the Firefox build on AMO as an UNLISTED add-on: Mozilla signs it, nothing is listed in the
# store, and Firefox Release then keeps it installed across restarts. The signed .xpi lands in
# .output/signed/.
#
# Credentials never live in the repo. Put them in ~/.config/beifahrer/amo.env (chmod 600):
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=…
# (issued at https://addons.mozilla.org/developers/addon/api/key/)
#
# `sh scripts/sign.sh v0.2.0` also writes ../updates.json, the manifest Firefox polls to find this
# build (issue #3). With no tag it only signs — the file is per release, and inventing a tag for it
# would produce an update_link that 404s on the person's machine.
#
# `web-ext lint` REJECTS the update_url in manifest.ts (MANIFEST_UPDATE_URL, addons-linter.js:3559):
# it is an error for a Mozilla-hosted add-on, and only `--self-hosted` downgrades it — and an unlisted
# add-on is self-hosted by definition. So `web-ext lint .output/firefox-mv2` reports a build that is
# perfectly signable. Two ways to read that, both wrong: deleting update_url (which leaves every
# installed copy without updates, permanently, since Firefox keeps the URL it was given) or adding
# --self-hosted to a lint that is not part of this script. Lint it as what it is:
#
#   node_modules/.bin/web-ext lint --source-dir .output/firefox-mv2 --self-hosted
#
# `web-ext sign` itself never runs the linter (util/manifest.js only checks name/version/id), which is
# why signing succeeds where lint complains.
#
# web-ext is a Node tool; it moves to `gjsify exec` once gjsify can run Node bins on GJS.
set -eu
cd "$(dirname "$0")/.."
TAG="${1:-}"
ENV_FILE="${BEIFAHRER_AMO_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/beifahrer/amo.env}"
if [ ! -r "$ENV_FILE" ]; then
  echo "missing $ENV_FILE — see the header of $0" >&2
  exit 2
fi
set -a
. "$ENV_FILE"
set +a
gjsify run build
../node_modules/.bin/web-ext sign \
  --source-dir .output/firefox-mv2 \
  --artifacts-dir .output/signed \
  --channel unlisted
# The newest .xpi, which is this one: sign.sh always signs the build it just made, and web-ext names
# the file after the manifest's version, so "newest" is unambiguous in a directory that may hold
# older ones from earlier runs.
SIGNED=$(ls -1t .output/signed/*.xpi | head -1)
ls -1 .output/signed/*.xpi

if [ -n "$TAG" ]; then
  ../node_modules/.bin/gjsify build scripts/updates-json.ts --app gjs \
    --outfile dist/updates-json.gjs.mjs
  ../node_modules/.bin/gjsify run dist/updates-json.gjs.mjs "$SIGNED" "$TAG"
  # Flat next to the .xpi, because web-ext's artifacts dir holds files, not per-tag folders
  # (util/artifacts.js refuses a path that is not a directory, and submit-addon.js writes the .xpi
  # under the name AMO's own download URL carries). The name must be exactly `updates.json`, with no
  # version in it, because that is what manifest.ts's update_url asks for.
  mv updates.json .output/signed/updates.json
  echo "attach .output/signed/updates.json to the $TAG release, under that exact name"
fi
