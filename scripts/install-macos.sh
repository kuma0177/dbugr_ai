#!/usr/bin/env bash
# Download and install the packaged Dbugr macOS app from GitHub Releases.
#
# This helper is intentionally small and conservative:
# - it does not install provider CLIs
# - it does not remove macOS quarantine
# - it does not bypass Gatekeeper, XProtect, or Screen Recording prompts
set -euo pipefail

DMG_URL="${DMG_URL:-https://www.dbugr.ai/downloads/Dbugr_0.0.1_aarch64.dmg}"
DMG_PATH="${DMG_PATH:-}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
BUNDLE_ID="${BUNDLE_ID:-com.feedbackagent.desktop}"
OPEN_APP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      shift
      DMG_URL="${1:-}"
      ;;
    --dmg)
      shift
      DMG_PATH="${1:-}"
      ;;
    --install-dir)
      shift
      INSTALL_DIR="${1:-}"
      ;;
    --no-open)
      OPEN_APP=0
      ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/install-macos.sh [options]

Downloads or uses a local packaged Dbugr DMG, mounts it, and copies
Dbugr.app into /Applications.

Options:
  --url URL          Override the DMG download URL.
  --dmg PATH         Install from a local DMG instead of downloading.
  --install-dir DIR  Install into another Applications folder.
  --no-open          Do not open Dbugr after copying it.
  --help, -h         Show this help.

Environment:
  DMG_URL=...        Override the DMG download URL.
  DMG_PATH=...       Install from a local DMG instead of downloading.
  INSTALL_DIR=...    Override the install directory.
  BUNDLE_ID=...      Override the stable macOS bundle identifier.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is only for macOS." >&2
  exit 1
fi

if [[ -z "$DMG_PATH" && -z "$DMG_URL" ]]; then
  echo "No DMG URL was provided." >&2
  exit 1
fi

for tool in curl hdiutil ditto; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required macOS tool: $tool" >&2
    exit 1
  fi
done

tmp_dir="$(mktemp -d)"
mount_dir="$tmp_dir/mount"
cleanup() {
  if [[ -n "$mount_dir" && -d "$mount_dir" ]]; then
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if [[ -n "$DMG_PATH" ]]; then
  if [[ ! -f "$DMG_PATH" ]]; then
    echo "Local DMG not found: $DMG_PATH" >&2
    exit 1
  fi
  dmg_path="$DMG_PATH"
else
  dmg_path="$tmp_dir/dbugr-ai.dmg"

echo "Downloading Dbugr for macOS..."
  curl -L --fail --progress-bar "$DMG_URL" -o "$dmg_path"
fi

echo "Mounting installer..."
mkdir -p "$mount_dir"
hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" >/dev/null

if [[ -z "$mount_dir" || ! -d "$mount_dir" ]]; then
  echo "Could not mount the Dbugr DMG." >&2
  exit 1
fi

app_path="$(find "$mount_dir" -maxdepth 2 -name '*.app' -type d | head -n 1)"
if [[ -z "$app_path" || ! -d "$app_path" ]]; then
  echo "Could not find a .app bundle inside the DMG." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
target_app="$INSTALL_DIR/$(basename "$app_path")"

echo "Copying $(basename "$app_path") to $INSTALL_DIR..."
rm -rf "$target_app"
ditto "$app_path" "$target_app"

echo "Signing $(basename "$target_app") with stable bundle identifier $BUNDLE_ID..."
codesign --sign - --deep --force --identifier "$BUNDLE_ID" "$target_app" >/dev/null 2>&1

echo "Installed: $target_app"

echo "Registering Dbugr with macOS Screen Recording..."
open "$target_app" --args --request-screen-recording-permission >/dev/null 2>&1 || true
sleep 2

echo
echo "Next steps:"
echo "  1. Open Dbugr from Applications."
echo "  2. If macOS shows a first-run warning, choose Open."
echo "  3. Grant Screen Recording permission when Dbugr asks."
echo "     If Dbugr is not listed, click + and choose /Applications/Dbugr.app."
echo "  4. Link this Mac from Dbugr web onboarding."
echo
echo "Dbugr does not install Claude, Codex, or Cursor for you."
echo "Install those tools separately if you want direct AI handoff."

if [[ "$OPEN_APP" == "1" ]]; then
  open "$target_app" >/dev/null 2>&1 || true
fi
