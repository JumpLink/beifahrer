#!/bin/sh
# Compile the Safari helper with plain `swiftc` — no Xcode project needed (ADR 0026 § 4). Output is
# gitignored (app/native/safari-ext-helper/.build/); `gjsify ship darwin` stages it into
# `Contents/Helpers/safari-ext-helper` (app/package.json#gjsify.ship.helperExecutables).
#
# Built UNIVERSAL (lipo'd arm64 + x86_64) by default, the same shape `xcodebuild
# ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO` gives the `.appex` in safari-build.sh — one binary
# serves both of ci.yml's `gjsify ship darwin --arch <a>` passes, so `gjsify.ship.helperExecutables`
# in app/package.json needs no per-arch path. `--arch arm64|x64` builds one slice only, for a
# faster local loop. Needs `xcrun`, not a bare `swiftc`, for the cross target's stdlib — a bare
# `swiftc -target x86_64-apple-macosx11.0` on an arm64 host links against the wrong (arm64-only)
# compatibility libs and fails at the final link, measured 2026-11-06 — so the x86_64 and
# universal paths need Xcode itself, same requirement as safari-build.sh.
set -eu

cd "$(dirname "$0")"
mkdir -p .build

build_slice() {
  xcrun swiftc -O -target "$1" main.swift -o "$2"
}

arch="${1:-universal}"
if [ "$arch" != "arm64" ]; then
  : "${DEVELOPER_DIR:?set DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer — the x86_64 slice needs Xcode's Swift libs, not the Command Line Tools'}"
fi

case "$arch" in
  arm64) build_slice arm64-apple-macosx11.0 .build/safari-ext-helper; echo "safari-ext-helper: built .build/safari-ext-helper (arm64)" ;;
  x64) build_slice x86_64-apple-macosx11.0 .build/safari-ext-helper; echo "safari-ext-helper: built .build/safari-ext-helper (x86_64)" ;;
  universal)
    build_slice arm64-apple-macosx11.0 .build/safari-ext-helper-arm64
    build_slice x86_64-apple-macosx11.0 .build/safari-ext-helper-x64
    lipo -create .build/safari-ext-helper-arm64 .build/safari-ext-helper-x64 -output .build/safari-ext-helper
    echo "safari-ext-helper: built .build/safari-ext-helper (universal: arm64 + x86_64)"
    ;;
  *) echo "safari-ext-helper: unknown arch '$1' — known: arm64, x64, universal" >&2; exit 1 ;;
esac
