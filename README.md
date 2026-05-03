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

1. Open the macOS app and start a new annotation or append to an existing session.
2. Capture the content on screen, freeze it, and add annotation notes to the screenshot.
3. Choose an existing session or create a new one if needed.
4. When creating a new session, attach the GitHub repo or local project folder that the work belongs to.
5. Save the notes into the session and show a clear confirmation with next actions.
6. Choose whether to submit the saved session to Claude, Codex, or Cursor.
7. On first submission, complete the provider connection flow if the target is not yet linked.
8. Show the prompt summary that is being handed off, then show the immediate provider response or handoff result.

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
- [x] Native macOS prototype with local session persistence and prompt-preview groundwork
- [x] Express API for sessions, comments, tasks, integrations, and handoff context
- [x] Next.js dashboard for review, summaries, and follow-up actions
- [x] MCP server for Claude/Codex-style agent access
- [x] Repo-aware confirmation step before sending to Claude or Codex
- [x] Immediate handoff feedback returned to the user after submit

## Native macOS Migration

Debugr is moving toward a macOS-native-first desktop app. See [Native macOS Migration Guide](docs/native-macos-migration.md) for the migration context, target user flow, capture UX decisions, and milestone plan.

## Remaining Work

- [ ] Windows and Linux native desktop builds
- [ ] Deeper Claude/Codex session awareness beyond manual confirmation
- [ ] Real GitHub / Jira / Figma routing instead of mock task handoff
- [ ] Richer agent feedback beyond the immediate handoff response
- [ ] Auth
- [ ] Durable asset storage for screenshots and generated artifacts
- [ ] Background job queue for async processing
