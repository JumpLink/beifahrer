#!/usr/bin/env bash
# Records the native window (docs/images/desktop-*.png) headless against a synthetic registry entry,
# so no real session label, port or browser version shows. Needs `gjsify workspace beifahrer-app build`.
# Usage: tools/desktop-shots.sh [outdir]   (default docs/images; run from the beifahrer checkout)
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$root/docs/images}
headless=${HEADLESS_RUN:-$HOME/Projekte/werkstatt/scripts/headless-run}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out" "$tmp/reg" "$tmp/cfg"
chmod 700 "$tmp/reg"
node -e '
const now = new Date().toISOString();
const e = { v: 1, instance: "demo", label: "claude-code · my-project", pid: process.pid, port: 51813,
  startedAt: now, updatedAt: new Date(Date.now() + 3600e3).toISOString(), bridgeVersion: "0.1.4",
  browsers: [{ id: "b0", family: "firefox", name: "Firefox", version: "145.0", extensionVersion: "0.1.4", connectedAt: now, paused: false }] };
require("fs").writeFileSync(process.argv[1] + "/demo.json", JSON.stringify(e) + "\n", { mode: 0o600 });
' "$tmp/reg"
for lang in en de; do
  loc=en_US; [ $lang = de ] && loc=de_DE
  for theme in light dark; do
    dark=""; [ $theme = dark ] && dark="--dark"
    name=desktop-$theme.png; [ $lang = de ] && name=desktop-de-$theme.png
    BEIFAHRER_REGISTRY_DIR=$tmp/reg XDG_CONFIG_HOME=$tmp/cfg BEIFAHRER_PORT=47981 BEIFAHRER_PORT_COUNT=3 \
      LANGUAGE=$lang LC_ALL=$loc.UTF-8 \
      "$headless" --size 2000x1600 --scale 2 $dark --shot-delay 3 --window-shot "$out/$name" -- gjs -m "$root/app/dist/gjs/window.mjs"
  done
done
