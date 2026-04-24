# Database Schema

Use Prisma or Drizzle.

## users

- id
- email
- name
- avatar_url
- role
- created_at

## organizations

- id
- name
- slug
- created_at

## projects

- id
- organization_id
- name
- slug
- repo_url
- jira_project_key
- figma_file_key
- visibility_default
- created_at

## feedback_sessions

- id
- project_id
- created_by
- title
- status: draft | processing | ready | published | routed | resolved
- visibility: private | public | org
- video_url
- audio_url
- transcript
- ai_summary
- ai_task_brief
- user_intent: bug | feature_request | copy_feedback | design_feedback | ux_feedback | general
- created_at
- updated_at

## feedback_frames

- id
- feedback_session_id
- timestamp_ms
- image_url
- cursor_x
- cursor_y
- click_type
- region_x
- region_y
- region_w
- region_h
- description

## feedback_comments

- id
- feedback_session_id
- parent_comment_id
- author_id
- body
- visibility
- votes_count
- created_at

## feedback_votes

- id
- feedback_comment_id
- user_id
- value: 1 | -1
- created_at

## improvement_tasks

- id
- feedback_session_id
- title
- description
- status: draft | approved | sent | in_progress | completed | rejected
- target: jira | github | codex | claude | chatgpt | gemini | figma
- external_url
- external_id
- created_at
- updated_at

## integrations

- id
- organization_id
- provider: jira | github | figma | codex | claude | openai | gemini | youtube | twitch | instagram | x
- encrypted_access_token
- encrypted_refresh_token
- config_json
- created_at
- updated_at

## audit_logs

- id
- organization_id
- actor_id
- action
- target_type
- target_id
- metadata_json
- created_at
