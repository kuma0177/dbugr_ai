#!/usr/bin/env bash
# Prepare a macOS machine for Dbugr provider handoffs.
#
# Default mode is verification-only. Use --install to opt into installing
# third-party provider CLIs from their official package channels.
set -euo pipefail

INSTALL=0
YES=0
SKIP_CLAUDE=0
SKIP_CODEX=0
SKIP_CURSOR=0
APP_PATH="${APP:-/Applications/Dbugr.app}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) ;;
    --install) INSTALL=1 ;;
    --yes|-y) YES=1 ;;
    --skip-claude) SKIP_CLAUDE=1 ;;
    --skip-codex) SKIP_CODEX=1 ;;
    --skip-cursor) SKIP_CURSOR=1 ;;
    --app) shift; APP_PATH="${1:-}" ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/setup-macos-providers.sh [options]

Options:
  --install        Install missing provider CLIs when possible.
  --yes, -y        Do not prompt before installs.
  --skip-claude    Skip Claude Code checks.
  --skip-codex     Skip Codex CLI checks.
  --skip-cursor    Skip Cursor checks.
  --app PATH       Dbugr app bundle path for Screen Recording registration.

Environment:
  APP=/Applications/Dbugr.app can also set the app bundle path.
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup helper is only for macOS." >&2
  exit 1
fi

ok() { printf '[ok] %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
info() { printf '[info] %s\n' "$*"; }

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

confirm() {
  local prompt="$1"
  if [[ "$YES" == "1" ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

run_with_timeout() {
  local seconds="$1"
  shift
  local output_file
  output_file="$(mktemp)"
  "$@" >"$output_file" 2>&1 &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" >/dev/null 2>&1; do
    if (( elapsed >= seconds )); then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
      cat "$output_file"
      rm -f "$output_file"
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  local status=0
  wait "$pid" || status=$?
  cat "$output_file"
  rm -f "$output_file"
  return "$status"
}

verify_command() {
  local label="$1"
  shift
  if output="$(run_with_timeout 12 "$@")"; then
    ok "$label: ${output:-available}"
    return 0
  fi
  local status=$?
  warn "$label check failed (exit $status)."
  if [[ -n "${output:-}" ]]; then
    printf '%s\n' "$output" >&2
  fi
  return "$status"
}

install_claude() {
  if has_cmd brew; then
    info "Installing Claude Code with Homebrew cask."
    brew install --cask claude-code
    return
  fi
  if has_cmd npm; then
    info "Installing Claude Code with npm."
    npm install -g @anthropic-ai/claude-code
    return
  fi
  warn "Install Homebrew or Node/npm, then rerun this script."
  return 1
}

install_codex() {
  if ! has_cmd npm; then
    warn "Codex CLI currently installs through npm. Install Node/npm, then rerun this script."
    return 1
  fi
  info "Installing Codex CLI with npm."
  npm install -g @openai/codex
}

install_cursor() {
  if has_cmd brew; then
    info "Installing Cursor with Homebrew cask."
    brew install --cask cursor
    return
  fi
  warn "Homebrew is required for unattended Cursor install. Download Cursor from https://cursor.com/ instead."
  return 1
}

check_claude() {
  if [[ "$SKIP_CLAUDE" == "1" ]]; then return; fi
  info "Checking Claude Code CLI..."
  if has_cmd claude && verify_command "Claude Code" claude --version; then
    return
  fi
  if [[ "$INSTALL" == "1" ]] && confirm "Install Claude Code CLI now?"; then
    install_claude && verify_command "Claude Code" claude --version || true
  else
    warn "Claude Code is not ready. Official install: brew install --cask claude-code"
  fi
}

check_codex() {
  if [[ "$SKIP_CODEX" == "1" ]]; then return; fi
  info "Checking Codex CLI..."
  if has_cmd codex && verify_command "Codex CLI" codex --version; then
    return
  fi
  if [[ "$INSTALL" == "1" ]] && confirm "Install Codex CLI now?"; then
    install_codex || true
    if ! verify_command "Codex CLI" codex --version; then
      warn "Codex installed but did not verify. If macOS shows a malware/XProtect warning, do not bypass it; remove the package with: npm uninstall -g @openai/codex"
    fi
  else
    warn "Codex CLI is not ready. Official install: npm install -g @openai/codex"
  fi
}

check_cursor() {
  if [[ "$SKIP_CURSOR" == "1" ]]; then return; fi
  info "Checking Cursor..."
  if [[ -d "/Applications/Cursor.app" || -d "$HOME/Applications/Cursor.app" ]]; then
    ok "Cursor app is installed."
    return
  fi
  if [[ "$INSTALL" == "1" ]] && confirm "Install Cursor now?"; then
    install_cursor || true
  else
    warn "Cursor is not installed. Install it from https://cursor.com/ or with: brew install --cask cursor"
  fi
}

check_debugr_permissions() {
  info "Checking Dbugr app bundle..."
  if [[ -d "$APP_PATH" ]]; then
    ok "Dbugr app found at $APP_PATH"
    info "Opening Dbugr once so macOS can list it under Screen Recording."
    open "$APP_PATH" >/dev/null 2>&1 || true
  else
    warn "Dbugr app bundle not found at $APP_PATH. Set APP=/path/to/Dbugr.app or use --app PATH."
  fi
  info "Opening macOS Screen Recording settings."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" >/dev/null 2>&1 || true
}

cat <<'EOF'
Dbugr macOS provider setup
--------------------------
This helper verifies the local tools Dbugr can hand sessions to:
Claude Code, Codex CLI, Cursor, and macOS Screen Recording.

It will not bypass macOS malware/XProtect warnings. If macOS blocks a provider
binary, remove that provider package and wait for a clean upstream release.
EOF

check_claude
check_codex
check_cursor
check_debugr_permissions

cat <<'EOF'

Done.
Next:
  1. Enable Dbugr in System Settings -> Privacy & Security -> Screen Recording.
  2. Run `claude` once to sign in if using Claude Code.
  3. Add your OpenAI API key inside Dbugr if using Codex CLI.
  4. In Dbugr, use Submit -> Recheck connections before sending a session.
EOF
