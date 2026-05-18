# Install Guide

This guide walks through installing and running Dbugr locally on macOS.

If you only want to install the Mac app and do not plan to work on the code,
start with [Install Dbugr on a Mac](docs/install-for-mac-users.md).

## Choose A Path

Use one of these paths depending on what you want to do:

- **Try the packaged Mac app** if you only want to test the current desktop build.
- **Run the local development stack** if you want the desktop app, API, worker, database, and web dashboard.
- **Run the web app only** if you are working on homepage, dashboard, or review UI.
- **Run the native macOS prototype** if you are exploring the Swift/AppKit migration.

## Requirements

For source development:

- macOS 13 or newer
- Node.js 20 or newer
- pnpm 9 or newer
- Rust toolchain
- Xcode Command Line Tools
- Git

Check your machine:

```bash
node -v
pnpm -v
rustc -V
xcode-select -p
git --version
```

Install Xcode Command Line Tools if needed:

```bash
xcode-select --install
```

Install Rust if needed:

```bash
curl https://sh.rustup.rs -sSf | sh
```

Restart your terminal after installing Rust.

## Option 1: Install The Packaged Mac App

Download the current DMG:

- [Dbugr for macOS](https://www.dbugr.ai/downloads/Dbugr_0.0.1_aarch64.dmg)

Then:

1. Open the `.dmg`.
2. Drag `Dbugr` into `Applications`.
3. Launch `Dbugr` from `Applications`.
4. If macOS shows a first-run warning, choose `Open`.
5. Grant Screen Recording permission when prompted.

This packaged app is useful for product testing. For development, use the source setup below.

Optional Terminal installer:

```bash
curl -L https://raw.githubusercontent.com/kuma0177/debgr_ai/main/scripts/install-macos.sh | bash
```

The installer downloads the GitHub Release DMG, copies Dbugr into Applications,
and opens the app. It does not bypass macOS security prompts.

### Provider Setup After DMG Install

Dbugr can hand a saved session to Claude Code, Codex CLI, or Cursor, but those
provider tools are installed and trusted separately by macOS. A drag-and-drop
DMG should not silently install third-party binaries or bypass macOS security
warnings.

After installing the app, run the provider readiness helper from a checkout of
this repo:

```bash
pnpm setup:macos-providers
```

That command verifies:

- `claude --version` for Claude Code
- `codex --version` for Codex CLI
- `/Applications/Cursor.app` for Cursor
- the Dbugr app path used for Screen Recording permission

To opt into installing missing provider tools from their official package
channels, run:

```bash
pnpm setup:macos-providers:install
```

The helper uses these official install routes when requested:

- Claude Code: `brew install --cask claude-code` when Homebrew exists, otherwise `npm install -g @anthropic-ai/claude-code`
- Codex CLI: `npm install -g @openai/codex`
- Cursor: `brew install --cask cursor` when Homebrew exists, otherwise it prints the manual download path

If macOS shows a malware or XProtect warning for any provider binary, do not
bypass it. Remove that provider package and wait for a clean upstream release.
For Codex CLI, removal is:

```bash
npm uninstall -g @openai/codex
```

## Option 2: Run From Source

Clone the repo:

```bash
git clone <repo-url>
cd debugr
```

Create your local environment file:

```bash
cp .env.example .env
```

Install dependencies:

```bash
pnpm install
```

Verify or install the local provider tools used by Direct AI handoff:

```bash
pnpm setup:macos-providers
# or, to install missing tools interactively:
pnpm setup:macos-providers:install
```

Create and seed the local SQLite database:

```bash
pnpm db:setup
```

The local database lives at:

```text
packages/db/prisma/dev.db
```

## Run The Full Local Stack

Open four terminal windows or tabs.

Terminal 1:

```bash
cd apps/api
pnpm dev
```

Terminal 2:

```bash
cd apps/worker
pnpm dev
```

Terminal 3:

```bash
cd apps/web
pnpm dev
```

Terminal 4:

```bash
cd apps/desktop
pnpm dev
```

Expected local services:

- Web dashboard: `http://localhost:3000`
- API: `http://localhost:3001`
- Worker: `http://localhost:3002`
- Desktop frontend dev server: `http://127.0.0.1:5173`

The Tauri command opens the desktop shell and starts the Vite frontend behind it.

## Run Only The Web App

Use this for homepage or dashboard UI work:

```bash
cd apps/web
pnpm dev
```

Open:

```text
http://localhost:3000
```

The homepage can run by itself. Feed/session data expects the API to be running.

## Run The MCP Server

For the main MCP server:

```bash
cd apps/mcp-server
pnpm dev
```

For the desktop MCP bridge experiment:

```bash
cd apps/desktop-mcp
pnpm dev
```

Client-specific MCP configuration is still evolving, so treat these as local development paths rather than polished end-user setup.

## Run The Native macOS Prototype

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Capture smoke test:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac --capture-smoke
```

See [apps/desktop-native-mac/README.md](apps/desktop-native-mac/README.md) for details.

## macOS Permissions

Screen capture requires Screen Recording permission.

If capture is blank or fails:

1. Open `System Settings -> Privacy & Security -> Screen Recording`.
2. Enable permission for `Dbugr`, Terminal, iTerm, or the shell app used to launch Dbugr.
3. If Dbugr is not listed, click `+` and choose `/Applications/Dbugr.app`.
4. Restart the desktop app after granting permission.

Some shortcut/focus workflows may also need Accessibility permission:

1. Open `System Settings -> Privacy & Security -> Accessibility`.
2. Enable permission for the app or terminal used to launch it.
3. Restart the desktop app.

## Environment Variables

The default `.env.example` is designed for local development.

The most important values are:

```text
DATABASE_URL=file:./packages/db/prisma/dev.db
NEXT_PUBLIC_API_URL=http://localhost:3001/api
PORT=3001
WORKER_URL=http://localhost:3002
```

Optional values:

- `ANTHROPIC_API_KEY` for Anthropic-powered summaries and prompt work
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` for GitHub issue integration tests
- `JIRA_*` for Jira integration tests
- auth/email/storage variables for future hosted workflows

If no AI key is configured, local development can still use mock behavior in supported flows.

## Build And Test

Build everything:

```bash
pnpm build
```

Build the web app:

```bash
pnpm --filter @feedbackagent/web build
```

Build the desktop app:

```bash
cd apps/desktop
pnpm build
```

Run desktop tests:

```bash
pnpm --filter @feedbackagent/desktop test
```

Run API smoke tests:

```bash
pnpm --filter @feedbackagent/api test:phase2:all
```

## Database Commands

```bash
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm db:migrate
pnpm db:setup
```

If the database gets into a bad local state, the simplest recovery is usually:

```bash
pnpm db:push
pnpm db:seed
```

## Troubleshooting

### `pnpm install` fails

Check Node and pnpm versions:

```bash
node -v
pnpm -v
```

Use Node 20+ and pnpm 9+.

### Tauri desktop app does not build

Verify Rust and Xcode tooling:

```bash
rustc -V
xcode-select -p
```

Then retry:

```bash
cd apps/desktop
pnpm dev
```

### Web dashboard has no data

Start the API and worker:

```bash
cd apps/api
pnpm dev
```

```bash
cd apps/worker
pnpm dev
```

Then refresh `http://localhost:3000`.

### API cannot find the database

Run:

```bash
pnpm db:setup
```

Make sure `DATABASE_URL` in `.env` points to:

```text
file:./packages/db/prisma/dev.db
```

### Capture is blank

Grant Screen Recording permission and restart the desktop app. On macOS, permission changes do not always apply until the app is relaunched.

### Port already in use

Default ports are:

- web: `3000`
- API: `3001`
- worker: `3002`
- desktop Vite server: `5173`

Stop the process using the port or change the relevant env/script for your local run.

## Next Steps

After installation:

- read [README.md](README.md) for the product overview
- read [02_ARCHITECTURE.md](02_ARCHITECTURE.md) for the system design
- read [docs/design-system-dbugr.md](docs/design-system-dbugr.md) before UI work
- read [docs/native-macos-migration.md](docs/native-macos-migration.md) before native desktop work
