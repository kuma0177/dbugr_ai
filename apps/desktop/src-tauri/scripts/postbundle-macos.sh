#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/../target/release/bundle/macos"
APP_NAME="dbugr.ai.app"
APP_PATH="$BUNDLE_DIR/$APP_NAME"
BUNDLE_ID="com.feedbackagent.desktop"
LEGACY_APP_PATHS=("$BUNDLE_DIR/debugr.ai.app")

for legacy_app_path in "${LEGACY_APP_PATHS[@]}"; do
  if [[ -d "$legacy_app_path" ]]; then
    echo "postbundle-macos: removing legacy duplicate app bundle $legacy_app_path"
    rm -rf "$legacy_app_path"
  fi
done

if [[ ! -d "$APP_PATH" ]]; then
  echo "postbundle-macos: app bundle not found at $APP_PATH" >&2
  exit 1
fi

echo "postbundle-macos: signing $APP_PATH with stable bundle identifier $BUNDLE_ID"
codesign --sign - --deep --force --identifier "$BUNDLE_ID" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | sed -n '1,24p'
