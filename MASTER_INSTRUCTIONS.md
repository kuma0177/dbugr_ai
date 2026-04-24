# MASTER INSTRUCTIONS: FeedbackAgent Build Pack

You are a product manager and senior staff SWE at Anthropic and are building **FeedbackAgent**, a feedback-to-agent orchestration platform.

## Product Summary

FeedbackAgent turns screen recordings, voice notes, screenshots, cursor metadata, human comments, and community feedback into structured product improvement tasks that can be routed to Jira, GitHub, Figma, Codex, Claude, ChatGPT, Gemini, and other agents/tools.

## Core Product Flow

```text
Screen recording + voice notes
→ transcription + screenshots + cursor coordinates
→ structured feedback notes
→ AI-generated summary/task brief
→ public/private feedback thread
→ human/community review
→ route to Codex, Claude, ChatGPT, Gemini, Jira, GitHub, Figma
→ AI improvement task
→ agent/code/product update
→ changelog/status update
```

## Your Job

Read this file first. Then inspect the subfiles in this folder and use the relevant ones for each task.

Start by building the mocked local MVP before integrating real external APIs.

## Subfiles

1. `01_PRODUCT_BRIEF.md` — product definition, users, MVP scope.
2. `02_ARCHITECTURE.md` — system architecture and app structure.
3. `03_DATABASE_SCHEMA.md` — database models.
4. `04_API_SPEC.md` — REST API requirements.
5. `05_AI_PROCESSING_PROMPTS.md` — prompts for transcription cleanup, summarization, and community feedback aggregation.
6. `06_MCP_SERVER_SPEC.md` — MCP tools and safety rules.
7. `07_INTEGRATION_PLAN.md` — Jira, GitHub, Figma, Codex, Claude, YouTube, Twitch, Instagram, X.
8. `08_BUILD_SEQUENCE.md` — step-by-step MVP implementation order.
9. `09_AGENT_TASK_TEMPLATE.md` — template for tasks sent to AI coding/product agents.
10. `10_ROADMAP.md` — MVP to V4 roadmap.
11. `11_FIRST_IMPLEMENTATION_COMMAND.md` — immediate first command to execute.
12. `12_ACCEPTANCE_CRITERIA.md` — what must be true for the MVP to be considered working.

## Build Rules

- Use TypeScript across the stack.
- Use a monorepo.
- Prefer Next.js for the web dashboard.
- Prefer Tauri for the desktop recorder, but Electron is acceptable if Tauri blocks progress.
- Use Node.js/TypeScript for the API.
- Use Postgres with Prisma or Drizzle.
- Use mocked providers first.
- Do not integrate real external APIs until the mocked end-to-end flow works.
- Human approval is required before sending tasks externally.
- Public/private visibility must be respected.
- Every external routing action must be audit logged.
- Integration tokens must be encrypted before storage.
- Add TODO markers where real integrations should replace mocks.

## MVP Deliverable

Build a local demo where:

1. A user creates a feedback session.
2. The session has mock recording metadata, mock transcript, mock frames, and mock cursor coordinates.
3. A worker generates an AI-style summary and task brief.
4. The web dashboard lists feedback sessions.
5. The feedback detail page shows transcript, frames, summary, comments, and task brief.
6. A user can comment and upvote.
7. A user can create and approve an improvement task.
8. A user can send the task to a mock Jira/GitHub provider.
9. An MCP server exposes `list_feedback` and `get_feedback`.

## Recommended First Action

Open `11_FIRST_IMPLEMENTATION_COMMAND.md` and execute it.
