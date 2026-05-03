# REST API Spec

## Feedback Sessions

### POST /api/projects/:projectId/feedback-sessions

Create a draft feedback session.

Request:

```json
{
  "title": "Checkout page CTA issue",
  "visibility": "private"
}
```

Response:

```json
{
  "id": "fb_123",
  "status": "draft"
}
```

### POST /api/feedback-sessions/:id/finalize

Finalize upload and start processing.

Request:

```json
{
  "durationMs": 42000,
  "cursorEvents": [
    { "timestampMs": 1200, "x": 812, "y": 433, "type": "move" },
    { "timestampMs": 5200, "x": 900, "y": 510, "type": "click" }
  ]
}
```

### GET /api/feedback-sessions

List feedback sessions.

### GET /api/feedback-sessions/:id

Return full feedback session, transcript, frames, comments, and tasks.

### PATCH /api/feedback-sessions/:id

Update title, visibility, summary, or task brief.

## Comments

### POST /api/feedback-sessions/:id/comments

```json
{
  "body": "This button also looks broken on mobile.",
  "parentCommentId": null
}
```

### POST /api/comments/:id/vote

```json
{
  "value": 1
}
```

## Tasks

### POST /api/feedback-sessions/:id/tasks

```json
{
  "target": "jira",
  "title": "Fix checkout CTA overlap",
  "description": "The checkout CTA overlaps at mobile widths."
}
```

### POST /api/tasks/:id/approve

Approve task for sending.

### POST /api/tasks/:id/send

Send task to selected integration.

## Integrations

### GET /api/integrations

List connected integrations.

### POST /api/integrations/:provider/connect

Start OAuth/token setup.

### DELETE /api/integrations/:id

Disconnect integration.