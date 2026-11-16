#!/usr/bin/env bash
# Records the extension's own pages (docs/images/{options,popup,confirm}-*.png) by running the e2e's
# page scenario in Chromium — the SAME capture path the test suite uses, with the screenshot
# environment set in one place instead of in a shell history.
#
# The environment below is the extension's half of ONE story, the other half being the synthetic
# registry entry in tools/desktop-shots.sh: the same agent (`claude-code`), the same session label
# (`claude-code · my-project`) and the same browser, so the options page in a composed picture and
# the app window beside it describe one run rather than two unrelated ones. The label is set the way
# a person sets it (BEIFAHRER_SESSION_LABEL); without it the bridge derives one from the checkout
# directory, which is how `beifahrer-e2e · beifahrer` ended up in a shipped store screenshot.
#
# Usage: tools/page-shots.sh [outdir]   (default docs/images; run from the beifahrer checkout)
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$root/docs/images}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

for lang in en de; do
  mkdir -p "$tmp/$lang"
  # --lang alone does not decide Chromium's UI language on Linux, so `en` has to be passed as
  # explicitly as `de`: with the variable unset the browser follows the machine's locale, and this
  # workstation's is German — which produced a German "options-light.png" once already.
  BEIFAHRER_E2E_SCREENSHOTS="$tmp/$lang" \
    BEIFAHRER_E2E_SCALE=2 \
    BEIFAHRER_E2E_CLIENT=claude-code \
    BEIFAHRER_SESSION_LABEL='claude-code · my-project' \
    BEIFAHRER_E2E_LANG=$lang \
    BEIFAHRER_E2E_ONLY=pages \
    node "$root/tests/e2e/browsers.e2e.mjs" chromium >"$tmp/$lang.log" 2>&1 ||
    {
      tail -30 "$tmp/$lang.log"
      exit 1
    }
  for page in options popup confirm; do
    for theme in light dark; do
      name=$page-$theme.png
      [ $lang = de ] && name=$page-de-$theme.png
      cp "$tmp/$lang/$page-$theme.png" "$out/$name"
      echo "wrote $out/$name"
    done
  done
done
