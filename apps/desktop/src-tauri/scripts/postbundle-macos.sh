#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/../target/release/bundle/macos"
APP_NAME="debugr.ai.app"
APP_PATH="$BUNDLE_DIR/$APP_NAME"
BUNDLE_ID="com.feedbackagent.desktop"

if [[ ! -d "$APP_PATH" ]]; then
  echo "postbundle-macos: app bundle not found at $APP_PATH" >&2
  exit 1
fi

echo "postbundle-macos: signing $APP_PATH with stable bundle identifier $BUNDLE_ID"
codesign --sign - --deep --force --identifier "$BUNDLE_ID" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | sed -n '1,24p'
