#!/bin/sh
# Wrap Safari's two manual steps (docs/macos-run.md §3.2) into one repeatable command: package the
# built safari-mv3 extension into an Xcode project with `xcrun safari-web-extension-packager`
# (Apple's current name for what used to be `safari-web-extension-converter`), then build the
# macOS app ad-hoc ("Sign to Run Locally") so it runs without a Developer ID certificate.
#
# Needs Xcode itself, not just the Command Line Tools:
#   export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
#
# The packager mangles its own identifiers: given --app-name "Beifahrer"
# --bundle-identifier eu.jumplink.beifahrer, Xcode 27.1 writes the EXTENSION target's id as given
# (eu.jumplink.beifahrer.Extension) but derives the APP target's id by capitalizing --app-name
# (eu.jumplink.Beifahrer) instead — a build that fails `ValidateEmbeddedBinary` because the
# embedded extension's id is no longer prefixed by its parent's. This script normalizes the app
# id back to lowercase after packaging. <verify: whether a later Xcode fixes this> by checking
# project.pbxproj for PRODUCT_BUNDLE_IDENTIFIER after an upgrade.
set -eu

cd "$(dirname "$0")/.."   # extension/

EXT_DIR="${1:-.output/safari-mv3}"
XCODE_DIR="${2:-.output-safari-xcode}"
APP_NAME="Beifahrer"
BUNDLE_ID="eu.jumplink.beifahrer"

if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "safari-build: no extension build at $EXT_DIR — run 'gjsify workspace beifahrer-extension build' first" >&2
  exit 1
fi

: "${DEVELOPER_DIR:?set DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer (the Command Line Tools alone cannot run xcodebuild)}"

rm -rf "$XCODE_DIR"
xcrun safari-web-extension-packager \
  --project-location "$XCODE_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only --swift --no-open --no-prompt --force \
  "$EXT_DIR"

PROJECT="$XCODE_DIR/$APP_NAME/$APP_NAME.xcodeproj"
sed -i '' -E "s/PRODUCT_BUNDLE_IDENTIFIER = eu\\.jumplink\\.[A-Za-z]+;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/" \
  "$PROJECT/project.pbxproj"

xcodebuild -project "$PROJECT" -scheme "$APP_NAME" -configuration Debug \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  ONLY_ACTIVE_ARCH=YES -derivedDataPath "$XCODE_DIR/$APP_NAME/build" build

APP="$XCODE_DIR/$APP_NAME/build/Build/Products/Debug/$APP_NAME.app"
echo "safari-build: built $APP (ad-hoc signed, Sign to Run Locally)"
echo "safari-build: open it once, then load the extension in Safari — docs/macos-run.md §3.2"
