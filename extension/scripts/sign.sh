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
# web-ext is a Node tool; it moves to `gjsify exec` once gjsify can run Node bins on GJS.
set -eu
cd "$(dirname "$0")/.."
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
ls -1 .output/signed/*.xpi
