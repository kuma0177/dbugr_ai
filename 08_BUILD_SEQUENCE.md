# MVP Build Sequence

## Step 1: Create Monorepo

Create:

- apps/web
- apps/desktop
- apps/api
- apps/worker
- apps/mcp-server
- packages/db
- packages/shared
- packages/integrations
- packages/ai

## Step 2: Shared Types

Define:

- FeedbackSession
- FeedbackFrame
- CursorEvent
- FeedbackComment
- ImprovementTask
- IntegrationProvider
- AgentTaskBrief

## Step 3: Database

Implement schema for:

- users
- organizations
- projects
- feedback_sessions
- feedback_frames
- feedback_comments
- feedback_votes
- improvement_tasks
- integrations
- audit_logs

## Step 4: API

Implement:

- create feedback session
- finalize feedback session
- list feedback sessions
- get feedback session
- create comment
- vote on comment
- create task
- approve task
- send task

## Step 5: Worker

Implement mocked processing:

- create fake transcript
- create fake frames
- create fake summary
- create fake task brief
- mark feedback as ready

## Step 6: Web Dashboard

Implement:

- feedback inbox
- feedback detail page
- transcript view
- frames timeline
- comments
- task brief
- approve/send buttons

## Step 7: Desktop App

Implement:

- start recording button
- stop recording button
- cursor event collection
- mock upload
- session finalize

## Step 8: Integrations

Implement mock providers:

- JiraProvider
- GitHubProvider
- FigmaProvider
- CodexProvider
- ClaudeProvider

## Step 9: MCP Server

Implement:

- list_feedback
- get_feedback
- get_feedback_assets
- create_improvement_task
- send_approved_task

## Step 10: Replace Mocks

Replace in this order:

1. Real storage
2. Real transcription
3. Real summarization
4. Real GitHub/Jira
5. Real Figma
6. Real Codex/Claude routing
7. Social ingestion
