#!/bin/bash
# Debugr post-install setup
# Run once after dragging Debugr to /Applications.
# - Re-signs the app bundle so macOS TCC uses a stable bundle identifier
#   (com.feedbackagent.desktop) across every future update.
# - Registers the app in the Screen Recording list so it appears immediately
#   when the user opens System Settings — no manual "+" click needed.
set -euo pipefail

APP="/Applications/debugr.ai.app"
BUNDLE_ID="com.feedbackagent.desktop"

if [[ ! -d "$APP" ]]; then
  echo "Debugr not found at $APP — drag it to Applications first, then re-run this script."
  exit 1
fi

echo "Signing Debugr with stable bundle identifier…"
codesign --sign - --deep --force --identifier "$BUNDLE_ID" "$APP" 2>&1
echo "✓ Signed"

echo "Registering screen-recording permission with macOS…"
# Launch the app briefly so it calls CGRequestScreenCaptureAccess() and
# appears in System Settings > Screen Recording before the user opens it.
open -a "$APP" --args --request-permissions 2>/dev/null || open -a "$APP"
sleep 3
# Open System Settings directly to Screen Recording
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

echo ""
echo "✓ Done. In the System Settings window that just opened:"
echo "  1. Find 'Debugr' (or 'feedbackagent-desktop') in the list"
echo "  2. Toggle it ON"
echo "  3. Return to Debugr — it will detect the change automatically"
