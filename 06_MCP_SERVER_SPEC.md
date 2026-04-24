# MCP Server Spec

## Goal

Expose feedback sessions, frames, transcripts, comments, and approved tasks to coding/product agents.

## Safety Rules

- Read tools are allowed by default.
- Write tools require explicit human approval.
- Never expose raw credentials.
- Never send private feedback to public agents without approval.
- Log every tool call.

## MCP Tools

### list_feedback

Input:

```json
{
  "project_id": "string",
  "status": "ready | published | routed | resolved"
}
```

Output:

```json
{
  "feedback": [
    {
      "id": "fb_123",
      "title": "",
      "summary": "",
      "status": "",
      "visibility": ""
    }
  ]
}
```

### get_feedback

Input:

```json
{
  "feedback_id": "fb_123"
}
```

Output:

```json
{
  "id": "",
  "title": "",
  "summary": "",
  "transcript": "",
  "frames": [],
  "comments": [],
  "task_brief": ""
}
```

### get_feedback_assets

Input:

```json
{
  "feedback_id": "fb_123"
}
```

Output:

```json
{
  "video_url": "",
  "frames": [
    {
      "timestamp_ms": 0,
      "image_url": "",
      "cursor": { "x": 0, "y": 0 }
    }
  ]
}
```

### create_improvement_task

Input:

```json
{
  "feedback_id": "",
  "target": "jira | github | codex | claude",
  "title": "",
  "description": ""
}
```

Output:

```json
{
  "task_id": "",
  "status": "draft"
}
```

### send_approved_task

Input:

```json
{
  "task_id": ""
}
```

Output:

```json
{
  "status": "sent",
  "external_url": ""
}
```
