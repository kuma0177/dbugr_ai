# Dbugr.ai

Native macOS feedback capture for AI coding workflows. Dbugr lets you capture the exact browser tab, app window, or visible screen content you want help with, annotate it, attach project context, and send the session to Claude, Codex, or Cursor.

## GitHub About

Suggested GitHub repository description:

`Native macOS screenshot annotation and AI handoff tool for Claude, Codex, and Cursor.`

Suggested repository website / docs link:

- `README.md` for local install and run instructions
- `docs/native-macos-migration.md` for the native-app roadmap

## What You Can Run Today

- `apps/desktop` — the main Tauri desktop app used for the current local product flow
- `apps/desktop-native-mac` — the Swift/AppKit native macOS prototype
- `apps/api` — local Express API
- `apps/worker` — local background/mock processing worker
- `apps/web` — local Next.js review dashboard
- `apps/mcp-server` — stdio MCP server for agent access to saved feedback

If you want the full current product experience, run the Tauri desktop app plus the API, worker, and web apps.

If you want to experiment with the native migration, run `apps/desktop-native-mac`.

## Monorepo Structure

```text
debugr/
├── apps/
│   ├── desktop/             Tauri desktop app
│   ├── desktop-native-mac/  Swift/AppKit native macOS prototype
│   ├── web/                 Next.js review dashboard (port 3000)
│   ├── api/                 Express REST API (port 3001)
│   ├── worker/              Worker service (port 3002)
│   └── mcp-server/          MCP server (stdio)
├── packages/
│   ├── shared/              Shared TypeScript types
│   ├── db/                  Prisma schema + SQLite client
│   ├── ai/                  AI provider interfaces
│   └── integrations/        Integration providers and env config
```

## Requirements

For local development on macOS, install:

- macOS
- Node.js `20+`
- `pnpm 9+`
- Rust toolchain
- Xcode Command Line Tools

Recommended checks:

```bash
node -v
pnpm -v
rustc -V
xcode-select -p
```

Why these are needed:

- `apps/desktop` is a Tauri app, so it depends on Node, pnpm, Rust, and macOS build tooling.
- `apps/desktop-native-mac` is a Swift Package, so it also depends on Apple developer tooling.
- Screen capture features require macOS Screen Recording permission when you first run the app.

## First-Time Setup

1. Clone the repo.
2. Copy `.env.example` to `.env` at the repo root.
3. Install workspace dependencies.
4. Create and seed the local SQLite database.

```bash
git clone <your-fork-or-this-repo-url>
cd debugr
cp .env.example .env
pnpm install
pnpm db:setup
```

The local database is created at:

`packages/db/prisma/dev.db`

Every clone gets its own local SQLite database after `pnpm db:setup`.

## Run The Main App Locally

For the current end-to-end product flow, open four terminals:

```bash
# Terminal 1 — Tauri desktop app
cd apps/desktop
pnpm dev

# Terminal 2 — API
cd apps/api
pnpm dev

# Terminal 3 — Worker
cd apps/worker
pnpm dev

# Terminal 4 — Web dashboard
cd apps/web
pnpm dev
```

Local endpoints:

- Desktop frontend preview: `http://127.0.0.1:5173`
- Review dashboard: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:3001`
- Worker: `http://127.0.0.1:3002`

## Run The Native macOS Prototype

If you want to test the Swift/AppKit native migration path:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Capture smoke test:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac --capture-smoke
```

More native-app details live in:

- [apps/desktop-native-mac/README.md](/Users/kumar/debugr/apps/desktop-native-mac/README.md)
- [docs/native-macos-migration.md](/Users/kumar/debugr/docs/native-macos-migration.md)

## Environment Variables

Start with:

```bash
cp .env.example .env
```

Important defaults from [.env.example](/Users/kumar/debugr/.env.example:1):

- `DATABASE_URL` points at the local SQLite database
- `NEXT_PUBLIC_API_URL` points the web app at the local API
- `ANTHROPIC_API_KEY` is optional for local runs
- GitHub and Jira variables are optional unless you want those integrations

Current local behavior:

- If no AI key is configured, the worker falls back to mock summaries in some flows.
- Integration routes are present, but some production-grade routing and auth work are still pending.

## Permissions On First Run

The macOS desktop app may ask for:

- Screen Recording permission
- Accessibility permission in some shortcut/focus flows

If capture looks blank or fails:

1. Open `System Settings -> Privacy & Security -> Screen Recording`
2. Make sure the app or terminal you launched it from has permission
3. Restart the app after granting permission

## Common Commands

Database:

```bash
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm db:migrate
```

Build all packages and apps:

```bash
pnpm build
```

Build just the desktop app:

```bash
cd apps/desktop
pnpm build
```

Run MCP server:

```bash
cd apps/mcp-server
pnpm dev
```

## Product Flow

1. Open the macOS app and start a new annotation or append to an existing session.
2. Capture the content on screen, freeze it, and add annotation notes to the screenshot.
3. Choose an existing session or create a new one if needed.
4. When creating a new session, attach the GitHub repo or local project folder that the work belongs to.
5. Save the notes into the session and confirm what session was updated.
6. Choose whether to submit the saved session to Claude, Codex, or Cursor.
7. On first submission, complete the provider connection flow if the target is not yet linked.
8. Review the prompt summary that is being handed off, then submit.

## Current State

- [x] Tauri desktop app for the current local workflow
- [x] Native macOS prototype with local session persistence and prompt-preview groundwork
- [x] Express API for sessions, comments, tasks, integrations, and handoff context
- [x] Next.js dashboard for review, summaries, and follow-up actions
- [x] MCP server for Claude/Codex-style agent access
- [x] Repo-aware confirmation step before sending to Claude or Codex
- [x] Immediate handoff feedback returned to the user after submit

## Native macOS Migration

Dbugr is moving toward a macOS-native-first desktop app. See [docs/native-macos-migration.md](/Users/kumar/debugr/docs/native-macos-migration.md:1) for the migration context, target user flow, capture UX decisions, and milestone plan.

## Detailed Setup Guide

For a cleaner step-by-step install and troubleshooting flow, see:

- [docs/local-development.md](/Users/kumar/debugr/docs/local-development.md:1)

## Design Reference

Dbugr's canonical product design language lives in:

- [docs/design-system-dbugr.md](/Users/kumar/debugr/docs/design-system-dbugr.md:1)

Use this guide for desktop, web, onboarding, review feed, public feed, and submit-flow UI changes.

## Product Roadmap

The current phased scope and architecture plan lives in:

- [docs/phase-roadmap-and-architecture.md](/Users/kumar/debugr/docs/phase-roadmap-and-architecture.md:1)
- [docs/phase-2-social-refinement-plan.md](/Users/kumar/debugr/docs/phase-2-social-refinement-plan.md:1)

## Remaining Work

- [ ] Windows and Linux native desktop builds
- [ ] Deeper Claude/Codex session awareness beyond manual confirmation
- [ ] Real GitHub / Jira / Figma routing instead of mock task handoff
- [ ] Richer agent feedback beyond the immediate handoff response
- [ ] Auth
- [ ] Durable asset storage for screenshots and generated artifacts
- [ ] Background job queue for async processing
