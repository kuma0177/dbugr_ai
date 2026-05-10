# Architecture

Dbugr is a local-first macOS capture system with a web review surface and agent handoff layer. The core path is:

```text
capture screen context
-> annotate what matters
-> attach repo/workspace context
-> persist a session
-> review or curate it
-> hand structured context to an AI coding agent
```

## System Overview

```text
+-------------------+
| macOS Desktop App |
| apps/desktop      |
+---------+---------+
          |
          | creates sessions, captures, annotations
          v
+-------------------+       +-------------------+
| API Server        | ----> | SQLite / Prisma   |
| apps/api          |       | packages/db       |
+---------+---------+       +-------------------+
          |
          | queues or requests processing
          v
+-------------------+
| Worker            |
| apps/worker       |
+---------+---------+
          |
          | summaries, task briefs, metadata
          v
+-------------------+       +-------------------+
| Web Dashboard     | <---> | MCP Servers       |
| apps/web          |       | apps/mcp-server   |
+-------------------+       | apps/desktop-mcp  |
                            +-------------------+
```

## Applications

### Desktop App

Path: `apps/desktop`

Stack: Tauri 2, Vite, TypeScript, Rust.

Responsibilities:

- serve as the primary macOS product entry point
- capture visible screen state through macOS APIs
- freeze captured screenshots for annotation
- collect box-based notes on a captured frame
- collect or confirm project/repo context
- save annotation sessions through the local API
- initiate handoff to Claude, Codex, Cursor, or MCP consumers
- request macOS permissions needed for capture and shortcut flows

### Native macOS Prototype

Path: `apps/desktop-native-mac`

Stack: Swift Package, AppKit.

Responsibilities:

- explore the native replacement for the Tauri desktop shell
- validate capture, overlay, persistence, and prompt-preview UX in AppKit
- provide a migration path toward a smaller and more native macOS app

The current production-like local path still uses `apps/desktop`; the Swift app is a prototype and migration track.

### Web Dashboard

Path: `apps/web`

Stack: Next.js, React, TypeScript.

Responsibilities:

- render the public homepage
- show saved sessions and annotation notes
- support team/public review surfaces
- expose summaries, handoff state, and follow-up actions
- provide admin and onboarding surfaces used by the local prototype

### API Server

Path: `apps/api`

Stack: Express, TypeScript.

Responsibilities:

- session, capture, comment, task, and integration endpoints
- local identity/onboarding state used by the prototype
- repo and handoff context orchestration
- GitHub/Jira integration adapters
- Claude/Codex style prompt package generation
- audit and admin-oriented endpoints
- seed script for local development data

### Worker

Path: `apps/worker`

Stack: Express, TypeScript.

Responsibilities:

- process saved feedback artifacts
- generate summaries and task briefs
- prepare downstream metadata for coding agents
- provide mock processing when provider keys are not configured

The current worker is intentionally lightweight; durable queue-backed processing is a future production concern.

### MCP Servers

Paths:

- `apps/mcp-server`
- `apps/desktop-mcp`

Responsibilities:

- expose feedback sessions and annotation context to MCP-aware clients
- provide read tools over sessions, assets, and prepared prompts
- keep write behavior constrained to explicitly supported flows
- experiment with local desktop-client bridges for Claude/Codex-style workflows

## Shared Packages

### `packages/db`

Owns the Prisma schema, SQLite client, generated Prisma client, and database build output.

### `packages/shared`

Owns shared TypeScript types and schemas used across apps.

### `packages/ai`

Owns AI provider interfaces and mock provider behavior.

### `packages/integrations`

Owns integration interfaces and provider configuration for GitHub, Jira, and handoff targets.

## Data And Storage

Local development uses SQLite:

```text
packages/db/prisma/dev.db
```

The data model centers on:

- sessions
- captures/screenshots
- annotation notes
- comments and votes
- task briefs
- integration/handoff state
- audit/admin records

Screenshots and generated artifacts are local-first today. Production storage is expected to move behind a provider abstraction such as S3, R2, Supabase Storage, or Vercel Blob.

## Runtime Flow

```text
desktop_app_opened
-> macos_capture_permission_checked
-> native_screen_picker_opened
-> screenshot_frozen
-> annotation_boxes_created
-> session_context_selected
-> repo_or_workspace_context_attached
-> feedback_session_saved
-> optional_team_or_public_review
-> prompt_package_generated
-> handoff_target_selected
-> claude_codex_cursor_or_mcp_context_sent
-> immediate_handoff_feedback_returned
-> dashboard_summary_updated
```

## Local Development Topology

```text
apps/web      http://localhost:3000
apps/api      http://localhost:3001
apps/worker   http://localhost:3002
apps/desktop  http://127.0.0.1:5173 through Tauri dev
```

The desktop app should be run with the API and worker for the full local product experience. The web dashboard can run by itself for homepage and UI work, but feed/session data expects the API.

## Boundary Principles

- Desktop owns capture UX and local user intent.
- API owns persistence, integration routing, and session-level orchestration.
- Worker owns heavier processing and generated artifacts.
- Web owns review, admin, onboarding, and public/team presentation.
- Shared packages own cross-app contracts; app-specific UI state should stay inside apps.
- MCP surfaces should expose prepared context, not become a second source of truth.

## Production Gaps

Before a public hosted version, the architecture needs:

- formal auth and session management
- organization membership and role enforcement
- durable object storage for screenshots
- queue-backed background jobs
- production observability and audit retention
- explicit data deletion and export flows
- clearer provider credential isolation

These gaps do not block local development, but they matter before inviting broad external usage.
