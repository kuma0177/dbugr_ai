# FeedbackAgent

Feedback-to-agent orchestration platform. Turns screen recordings, voice notes, and community feedback into structured improvement tasks routed to Jira, GitHub, Figma, Codex, Claude, and more.

## Monorepo Structure

```
feedbackagent/
├── apps/
│   ├── web/          Next.js dashboard (port 3000)
│   ├── api/          Express REST API  (port 3001)
│   ├── worker/       Mock processing worker (port 3002)
│   ├── mcp-server/   MCP server (stdio)
│   └── desktop/      Tauri recorder (not yet scaffolded)
├── packages/
│   ├── shared/       TypeScript types
│   ├── db/           Prisma schema + SQLite client
│   ├── ai/           AI provider interfaces (stub)
│   └── integrations/ Integration providers (stub)
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm i -g pnpm`)

## Setup

```bash
# 1. Install all dependencies
pnpm install

# 2. Generate Prisma client
pnpm db:generate

# 3. Push schema to SQLite (creates packages/db/prisma/dev.db)
pnpm db:push

# 4. Seed demo org, project, and user
cd apps/api
pnpm ts-node src/lib/seed.ts
cd ../..
```

## Running Locally

Open three terminals:

```bash
# Terminal 1 — API
cd apps/api && pnpm dev

# Terminal 2 — Worker
cd apps/worker && pnpm dev

# Terminal 3 — Web dashboard
cd apps/web && pnpm dev
```

Then open http://localhost:3000.

## Core Flow (MVP)

1. Click **+ New Session** in the dashboard
2. Enter a title → session is created and auto-finalized
3. The worker generates a mock transcript, 3 frames, an AI summary, and a task brief
4. The session appears in the inbox with status `ready`
5. Click into it to see the transcript, frames, comments, and AI task brief
6. Add comments and upvote them
7. Create an improvement task, select a target (github, jira, etc.)
8. **Approve** the task, then **Send** it to the mock provider
9. The task gets a mock external URL and is marked `sent`

## MCP Server

Exposes feedback context to AI coding agents via stdio.

```bash
cd apps/mcp-server && pnpm dev
```

**Tools available:**
- `list_feedback` — list non-private sessions
- `get_feedback` — full session detail (transcript, frames, comments, task brief)
- `get_feedback_assets` — video URL + frame images
- `create_improvement_task` — create a draft task (requires human approval before sending)
- `send_approved_task` — send an approved task to its integration target

To wire it into Claude Code, add to `.claude/settings.json`:
```json
{
  "mcpServers": {
    "feedbackagent": {
      "command": "node",
      "args": ["apps/mcp-server/dist/index.js"]
    }
  }
}
```

## What's Implemented (MVP)

- [x] TypeScript monorepo with pnpm workspaces
- [x] Prisma schema (SQLite for local dev)
- [x] Shared types package
- [x] REST API — sessions, comments, votes, tasks, integrations
- [x] Mock worker — transcript, frames, summary, task brief
- [x] Next.js dashboard — inbox, detail page, comments, task panel
- [x] MCP server — all 5 tools with audit logging
- [x] Human approval gate before sending tasks
- [x] Audit log for every task approve/send/MCP call
- [x] Integration tokens never exposed via API

## What Remains (TODOs)

- [ ] Real screen recording (Tauri desktop app)
- [ ] Real transcription (Whisper / AssemblyAI)
- [ ] Real frame extraction from video
- [ ] Real AI summarization (Claude API)
- [ ] Real GitHub / Jira / Figma integration
- [ ] Real Codex / Claude / ChatGPT task routing
- [ ] Auth (replace hardcoded `DEMO_USER_ID`)
- [ ] BullMQ job queue (replace fire-and-forget HTTP worker call)
- [ ] S3/R2 storage for video, audio, frames
- [ ] Social ingestion (YouTube, Twitch, Instagram, X)
- [ ] Public feedback threads
