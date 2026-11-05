#!/bin/sh
# Compile the Safari helper with plain `swiftc` — no Xcode project needed (ADR 0026 § 4). Output is
# gitignored (app/native/safari-ext-helper/.build/); `gjsify ship darwin` stages it into
# `Contents/Helpers/safari-ext-helper` once that step exists (docs/gjsify-gaps.md).
set -eu

cd "$(dirname "$0")"
mkdir -p .build
swiftc -O main.swift -o .build/safari-ext-helper
echo "safari-ext-helper: built .build/safari-ext-helper"
