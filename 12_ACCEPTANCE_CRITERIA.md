# MVP Acceptance Criteria

The MVP is complete when all of the following are true.

## Core Flow

- User can create a feedback session.
- Feedback session can be finalized.
- Worker can process the session with mocked transcript, frames, summary, and task brief.
- Session status changes from draft to processing to ready.

## Dashboard

- User can view feedback inbox.
- User can open a feedback detail page.
- Page shows title, status, visibility, transcript, summary, frames, cursor metadata, comments, and tasks.
- User can create a comment.
- User can upvote/downvote a comment.

## Tasks

- User can create an improvement task from feedback.
- Task starts in draft state.
- User can approve the task.
- User can send approved task to a mock provider.
- External URL or mock external ID is shown after send.

## MCP

- MCP server starts locally.
- `list_feedback` returns feedback sessions.
- `get_feedback` returns a selected feedback session with transcript, summary, comments, frames, and task brief.

## Safety

- Private feedback is not publicly exposed.
- Task sending requires approval.
- All send actions are audit logged.
- Integration tokens are not stored in plaintext in production paths.

## Developer Experience

- README explains setup.
- `.env.example` exists.
- Local seed data exists.
- TypeScript builds.
- Core tests pass.
