#!/usr/bin/env bash
# Download and install the packaged Dbugr macOS app from GitHub Releases.
#
# This helper is intentionally small and conservative:
# - it does not install provider CLIs
# - it does not remove macOS quarantine
# - it does not bypass Gatekeeper, XProtect, or Screen Recording prompts
set -euo pipefail

DMG_URL="${DMG_URL:-https://github.com/kuma0177/debgr_ai/releases/download/pre-open-source-ready-stable/dbugr-ai-0.0.1-macos-aarch64.dmg}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
OPEN_APP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      shift
      DMG_URL="${1:-}"
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

Downloads the latest packaged Dbugr DMG, mounts it, and copies Dbugr.ai.app
into /Applications.

Options:
  --url URL          Override the DMG download URL.
  --install-dir DIR  Install into another Applications folder.
  --no-open          Do not open Dbugr after copying it.
  --help, -h         Show this help.

Environment:
  DMG_URL=...        Override the DMG download URL.
  INSTALL_DIR=...    Override the install directory.
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

if [[ -z "$DMG_URL" ]]; then
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
mount_dir=""
cleanup() {
  if [[ -n "$mount_dir" && -d "$mount_dir" ]]; then
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

dmg_path="$tmp_dir/dbugr-ai.dmg"

echo "Downloading Dbugr for macOS..."
curl -L --fail --progress-bar "$DMG_URL" -o "$dmg_path"

echo "Mounting installer..."
mount_dir="$(hdiutil attach "$dmg_path" -nobrowse -quiet | awk '/\/Volumes\// { for (i=3; i<=NF; i++) printf("%s%s", i==3 ? "" : " ", $i); print "" }' | tail -n 1)"

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

echo "Installed: $target_app"
echo
echo "Next steps:"
echo "  1. Open Dbugr.ai from Applications."
echo "  2. If macOS shows a first-run warning, choose Open."
echo "  3. Grant Screen Recording permission when Dbugr asks."
echo "  4. Link this Mac from Dbugr web onboarding."
echo
echo "Dbugr does not install Claude, Codex, or Cursor for you."
echo "Install those tools separately if you want direct AI handoff."

if [[ "$OPEN_APP" == "1" ]]; then
  open "$target_app" >/dev/null 2>&1 || true
fi
