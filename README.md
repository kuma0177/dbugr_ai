# Dbugr.ai

Dbugr.ai is a macOS screen-capture and annotation tool for AI coding workflows. It lets you capture what is on screen, mark the exact area that needs attention, attach project context, and hand the resulting session to Claude, Codex, Cursor, or an MCP-aware coding agent.

The project is a local-first open-source monorepo with a Tauri desktop app, a Next.js review surface, local API and worker services, shared packages, and MCP server experiments.

## Why It Exists

AI coding agents are strongest when they receive the same context a human reviewer would ask for: the screen state, the affected product surface, the repo or workspace, and a clear note about what should change. Dbugr turns visual feedback into structured agent context instead of loose screenshots and scattered notes.

## Current Status

Dbugr is usable for local development and product iteration on macOS. Packaged macOS builds are published through GitHub Releases for people who want to try the desktop app without running the full source stack.

What works today:

- macOS desktop capture and annotation through the Tauri app
- local session persistence with SQLite
- review dashboard for sessions, notes, summaries, and handoff state
- API and worker services for local processing
- MCP server paths for agent access to saved feedback
- Swift/AppKit native macOS prototype for the longer-term desktop migration

Still in progress:

- production-grade auth and organization management
- hosted artifact storage
- durable background jobs
- full native macOS parity
- production signing/notarization for packaged macOS builds
- hosted storage hardening for team/public review artifacts

## Repository Structure

```text
debugr/
|-- apps/
|   |-- desktop/             Tauri desktop app for the current product flow
|   |-- desktop-native-mac/  Swift/AppKit native macOS prototype
|   |-- desktop-mcp/         local MCP bridge experiment for desktop clients
|   |-- web/                 Next.js review dashboard and homepage
|   |-- api/                 Express API for sessions, integrations, and handoff
|   |-- worker/              background/mock processing worker
|   `-- mcp-server/          stdio MCP server for saved feedback context
|-- packages/
|   |-- shared/              shared TypeScript types and schemas
|   |-- db/                  Prisma schema and SQLite client
|   |-- ai/                  AI provider interfaces and mock provider
|   `-- integrations/        integration providers and handoff configuration
|-- docs/                    design, deployment, migration, and planning docs
|-- 02_ARCHITECTURE.md       system architecture overview
`-- INSTALL.md               setup and local run guide
```

## Quick Start

Requirements:

- macOS 13+
- Node.js 20+
- pnpm 9+
- Rust toolchain
- Xcode Command Line Tools

```bash
git clone <repo-url>
cd debugr
cp .env.example .env
pnpm install
pnpm db:setup
```

Run the main local product flow in four terminals:

```bash
# Terminal 1
cd apps/desktop
pnpm dev

# Terminal 2
cd apps/api
pnpm dev

# Terminal 3
cd apps/worker
pnpm dev

# Terminal 4
cd apps/web
pnpm dev
```

Local URLs:

- Web dashboard: `http://localhost:3000`
- API: `http://localhost:3001`
- Worker: `http://localhost:3002`
- Desktop frontend dev server: `http://127.0.0.1:5173`

For detailed setup, permissions, troubleshooting, and install options, see [INSTALL.md](INSTALL.md).

## Product Flow

1. Open the macOS app.
2. Capture a screen, window, browser tab, or visible region.
3. Draw annotation boxes and add notes.
4. Attach or confirm the related repo/workspace context.
5. Save the session locally.
6. Review the structured prompt package.
7. Send the context to Claude, Codex, Cursor, or expose it through MCP.
8. Continue reviewing the session in the web dashboard.

## Common Commands

```bash
# install dependencies
pnpm install

# verify Claude/Codex/Cursor handoff tools on macOS
pnpm setup:macos-providers

# generate Prisma client, push schema, and seed local data
pnpm db:setup

# build all packages and apps
pnpm build

# build the web app only
pnpm --filter @feedbackagent/web build

# run desktop unit tests
pnpm --filter @feedbackagent/desktop test
```

Database helpers:

```bash
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm db:migrate
```

## Native macOS Prototype

The Swift/AppKit migration prototype lives in `apps/desktop-native-mac`.

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Capture smoke test:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac --capture-smoke
```

See [apps/desktop-native-mac/README.md](apps/desktop-native-mac/README.md) and [docs/native-macos-migration.md](docs/native-macos-migration.md) for the native migration plan.

## Documentation

- [INSTALL.md](INSTALL.md) - install, local development, permissions, and troubleshooting
- [docs/install-for-mac-users.md](docs/install-for-mac-users.md) - plain-English Mac install guide
- [02_ARCHITECTURE.md](02_ARCHITECTURE.md) - system architecture and data flow
- [docs/design-system-dbugr.md](docs/design-system-dbugr.md) - product design system
- [docs/native-macos-migration.md](docs/native-macos-migration.md) - native macOS migration plan
- [docs/local-development.md](docs/local-development.md) - older local development notes

## Download A Packaged macOS Build

If you want to try the current packaged macOS build instead of running from source:

- [Download Dbugr for macOS](https://github.com/kuma0177/debgr_ai/releases/download/pre-open-source-ready-stable/dbugr-ai-0.0.1-macos-aarch64.dmg)
- [Release page](https://github.com/kuma0177/debgr_ai/releases/tag/pre-open-source-ready-stable)
- [Non-technical install guide](docs/install-for-mac-users.md)

Optional Terminal installer:

```bash
curl -L https://raw.githubusercontent.com/kuma0177/debgr_ai/main/scripts/install-macos.sh | bash
```

macOS may require Screen Recording permission before capture works. See [INSTALL.md](INSTALL.md#macos-permissions) for details.

Claude, Codex, and Cursor handoffs depend on provider tools installed on the
user's Mac. Use the setup helper to verify them:

```bash
pnpm setup:macos-providers
```

Use `pnpm setup:macos-providers:install` only when you want the helper to
install missing provider CLIs from official package channels. The helper will
not bypass macOS malware/XProtect warnings.

## Environment

Start from `.env.example`:

```bash
cp .env.example .env
```

The defaults are enough for local development with SQLite and mock processing. API keys and integration tokens are optional unless you are testing those providers.

Important local defaults:

- `DATABASE_URL` points at `packages/db/prisma/dev.db`
- `NEXT_PUBLIC_API_URL` points the web app at the local API
- `ANTHROPIC_API_KEY` is optional for local runs
- GitHub and Jira variables are optional integration settings

## Open Source

Dbugr is released under the [MIT License](LICENSE).

Useful project files:

- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, checks, and pull request guidance
- [SECURITY.md](SECURITY.md) - private vulnerability reporting and data-safety notes
- [docs/releasing-macos.md](docs/releasing-macos.md) - DMG release workflow

Do not post private screenshots, customer data, API keys, or local workspace paths in public issues.
