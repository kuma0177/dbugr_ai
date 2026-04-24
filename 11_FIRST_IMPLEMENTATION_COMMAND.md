# First Implementation Command

Copy and paste this into Codex or Claude after uploading this folder.

```text
You are building the FeedbackAgent MVP using the instruction files in this folder.

First, read MASTER_INSTRUCTIONS.md.
Then inspect the relevant subfiles.

Create the initial monorepo for FeedbackAgent.

Start with a mocked local MVP. Do not integrate real external APIs yet.

Implement:

1. TypeScript monorepo.
2. Next.js web dashboard.
3. Node.js API.
4. Postgres schema using Prisma or Drizzle.
5. Shared feedback/task types.
6. Mock worker that turns a feedback session into:
   - transcript
   - summary
   - task brief
7. Feedback inbox page.
8. Feedback detail page with comments.
9. Task approval and mock send button.
10. MCP server with list_feedback and get_feedback.

Use clean architecture and leave TODOs for:
- real screen recording
- real transcription
- real frame extraction
- real Jira/GitHub/Figma/Codex/Claude integrations

After scaffolding, provide:
- file tree
- setup instructions
- commands to run locally
- what was implemented
- what remains
```
