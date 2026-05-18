#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/../target/release/bundle/macos"
LEGACY_APP_PATHS=("$BUNDLE_DIR/Dbugr.ai.app" "$BUNDLE_DIR/debugr.ai.app" "$BUNDLE_DIR/dbugr.ai.app" "$BUNDLE_DIR/Dbugr.app")

for legacy_app_path in "${LEGACY_APP_PATHS[@]}"; do
  if [[ -d "$legacy_app_path" ]]; then
    echo "prebundle-macos: removing stale app bundle $legacy_app_path"
    rm -rf "$legacy_app_path"
  fi
done
