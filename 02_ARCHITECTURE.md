# Architecture

## Apps

### 1. Desktop App

Path: `apps/desktop`

Use Tauri + TypeScript.

Responsibilities:

- Serve as the primary DMG-based product entry point on macOS
- Let the user open a browser page or point to any other app or screen experience
- Start native screen capture with the macOS picker
- Freeze a screenshot for annotation
- Collect box-based notes on the captured frame
- Load linked GitHub repo context for Claude/Codex handoff
- Require explicit user confirmation that the capture belongs to the active AI coding work
- Submit the feedback package and show the immediate response from Claude/Codex

### 2. Web Dashboard

Path: `apps/web`

Use Next.js + TypeScript.

Responsibilities:

- Review saved sessions
- Show annotation summaries and screenshots
- Display handoff state and follow-up feedback
- Comments and upvotes
- Task history and approval flows
- Public or organization-visible session pages

### 3. API Server

Path: `apps/api`

Use Node.js + TypeScript.

Responsibilities:

- Auth placeholder
- Feedback sessions CRUD
- Linked repo and target handoff context
- Comments and votes
- Task creation, approval, and sending
- Claude/Codex handoff response generation
- Audit logging

### 4. Worker

Path: `apps/worker`

Responsibilities:

- Process uploaded feedback artifacts
- Generate AI summary
- Generate task brief
- Prepare downstream metadata for agents

For the current MVP, mocked processing is acceptable.

### 5. MCP Server

Path: `apps/mcp-server`

Responsibilities:

- Expose feedback context to coding agents
- Provide read tools over sessions and assets
- Provide write tools only where explicitly allowed

## Packages

### `packages/db`

Database schema and client.

### `packages/shared`

Shared TypeScript types and schemas.

### `packages/ai`

AI provider interfaces and mock AI provider.

### `packages/integrations`

Integration provider interfaces, handoff config, and mock providers.

## Storage

- Relational store for sessions, tasks, and comments
- Local filesystem or object storage for screenshots and generated artifacts
- Optional Redis/BullMQ for background processing jobs

## Pipeline

```text
desktop_app_opened
→ native_screen_picker_opened
→ screenshot_frozen
→ annotation_boxes_saved
→ repo_context_loaded
→ user_confirms_capture_matches_claude_or_codex_work
→ feedback_session_created
→ handoff_sent
→ immediate_agent_feedback_returned
→ summary_available_in_dashboard
→ optional_worker_processing
→ task_brief_created
→ feedback_ready
→ follow_up_agent_work_registered
→ status_updated
```
