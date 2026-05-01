# debugr.ai

Native macOS feedback capture for AI coding workflows. Debugr lets a user open the desktop app, freeze the exact browser tab or app view they want help with, annotate it, confirm the linked GitHub repo context, and send the report to Claude Code or Codex.

## Monorepo Structure

```text
debugr/
├── apps/
│   ├── desktop/      Tauri native capture app
│   ├── web/          Next.js review dashboard (port 3000)
│   ├── api/          Express REST API (port 3001)
│   ├── worker/       Mock processing worker (port 3002)
│   └── mcp-server/   MCP server (stdio)
├── packages/
│   ├── shared/       TypeScript types
│   ├── db/           Prisma schema + SQLite client
│   ├── ai/           AI provider interfaces (stub)
│   └── integrations/ Integration providers and env config
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- macOS for the native DMG app flow

## Setup

1. Copy `.env.example` to `.env` at the repo root.
2. Install dependencies.
3. Create and seed the local SQLite database.

```bash
cp .env.example .env
pnpm install
pnpm db:setup
```

The database lives in `packages/db/prisma/dev.db`. It is a local SQLite file, so every clone gets its own copy once `pnpm db:setup` runs.

## Running Locally

Open four terminals:

```bash
# Terminal 1 — Desktop app
cd apps/desktop && pnpm dev

# Terminal 2 — API
cd apps/api && pnpm dev

# Terminal 3 — Worker
cd apps/worker && pnpm dev

# Terminal 4 — Web dashboard
cd apps/web && pnpm dev
```

During development:

- Desktop app preview: `http://127.0.0.1:5173`
- Review dashboard: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:3001`
- Worker: `http://127.0.0.1:3002`

If you need to reset the local store after changing the schema:

```bash
pnpm db:push
pnpm db:seed
```

## Product Flow

1. Open the DMG app on macOS.
2. Start a capture by opening the target browser page or pointing Debugr at another app or experience on screen.
3. Confirm the screen or window in the macOS picker and freeze the screenshot.
4. Debugr asks the user to confirm that the screenshot belongs to the current Claude/Codex work and linked GitHub repo.
5. The user chooses to submit feedback to Claude Code or Codex.
6. Debugr returns an immediate feedback response with task context and next steps, and stores the session for later review in the web dashboard.

## MCP Server

The MCP server exposes saved feedback context to AI coding agents via stdio.

```bash
cd apps/mcp-server && pnpm dev
```

Tools:

- `list_feedback` — list non-private sessions
- `get_feedback` — full session detail including annotations, screenshots, comments, and task brief
- `get_feedback_assets` — saved capture assets
- `create_improvement_task` — create a draft task
- `send_approved_task` — send an approved task to an integration target

## Current State

- [x] Native macOS capture app with screenshot freeze + box annotations
- [x] Express API for sessions, comments, tasks, integrations, and handoff context
- [x] Next.js dashboard for review, summaries, and follow-up actions
- [x] MCP server for Claude/Codex-style agent access
- [x] Repo-aware confirmation step before sending to Claude or Codex
- [x] Immediate handoff feedback returned to the user after submit

## Remaining Work

- [ ] Windows and Linux native desktop builds
- [ ] Deeper Claude/Codex session awareness beyond manual confirmation
- [ ] Real GitHub / Jira / Figma routing instead of mock task handoff
- [ ] Richer agent feedback beyond the immediate handoff response
- [ ] Auth
- [ ] Durable asset storage for screenshots and generated artifacts
- [ ] Background job queue for async processing
