# Architecture

## Apps

### 1. Web Dashboard

Path: `apps/web`

Use Next.js + TypeScript.

Responsibilities:

- Feedback inbox
- Feedback detail page
- Public feedback thread
- Comments/upvotes
- Task creation/approval
- Integration settings
- Admin moderation

### 2. Desktop Recorder

Path: `apps/desktop`

Use Tauri + React + TypeScript if possible. Electron is acceptable if Tauri blocks progress.

Responsibilities:

- Start/stop screen recording
- Capture microphone audio
- Capture cursor coordinates
- Capture clicks and timestamps
- Upload recording and metadata

For the first milestone, this may be mocked or simplified.

### 3. API Server

Path: `apps/api`

Use Node.js + TypeScript.

Responsibilities:

- Auth placeholder
- Feedback sessions CRUD
- Comments/votes
- Task creation/approval/sending
- Integration routing
- Audit logging

### 4. Worker

Path: `apps/worker`

Responsibilities:

- Process uploaded media
- Extract audio
- Extract key frames
- Transcribe audio
- Generate AI summary
- Generate task brief

For the MVP, implement mocked processing first.

### 5. MCP Server

Path: `apps/mcp-server`

Responsibilities:

- Expose feedback context to agents
- Provide read tools
- Provide write tools only with human approval

## Packages

### `packages/db`

Database schema and client.

### `packages/shared`

Shared TypeScript types and schemas.

### `packages/ai`

AI provider interfaces and mock AI provider.

### `packages/integrations`

Integration provider interfaces and mock providers.

## Storage

- Postgres for relational data
- S3/R2 for videos, audio, screenshots, and extracted frames
- Redis/BullMQ for background processing jobs

For the MVP, local filesystem and mocked queue are acceptable.

## Pipeline

```text
feedback_session_created
→ media_uploaded_or_mocked
→ processing_started
→ transcript_generated
→ frames_extracted
→ summary_generated
→ task_brief_created
→ feedback_ready
→ human_reviewed
→ task_approved
→ task_routed
→ status_updated
```
