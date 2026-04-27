export const tools = [
  {
    name: 'list_feedback',
    description: 'List feedback sessions. Only returns non-private sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Filter by project ID' },
        status: {
          type: 'string',
          enum: ['ready', 'published', 'routed', 'resolved'],
          description: 'Filter by status',
        },
      },
    },
  },
  {
    name: 'get_feedback',
    description: 'Get full detail for a feedback session including transcript, frames, and comments.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string', description: 'Feedback session ID' },
      },
      required: ['feedback_id'],
    },
  },
  {
    name: 'get_feedback_assets',
    description: 'Get video URL and frame images for a feedback session.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string', description: 'Feedback session ID' },
      },
      required: ['feedback_id'],
    },
  },
  {
    name: 'create_improvement_task',
    description: 'Create an improvement task from a feedback session. Task will be in draft status pending human approval.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string' },
        target: { type: 'string', enum: ['jira', 'github', 'codex', 'claude', 'chatgpt', 'gemini', 'figma'] },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['feedback_id', 'target', 'title', 'description'],
    },
  },
  {
    name: 'send_approved_task',
    description: 'Send a human-approved task to its integration target. Fails if task is not approved.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  // ─── V2: Feedback → Claude Code Handoff ──────────────────────────────────
  {
    name: 'push_feedback_to_claude',
    description: 'Push feedback from FeedbackAgent to Claude Code for implementation. Returns task ID for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string', description: 'Feedback session ID to push' },
        target: {
          type: 'string',
          enum: ['claude', 'codex'],
          description: 'Which AI to target (claude or codex)',
        },
      },
      required: ['feedback_id', 'target'],
    },
  },
  {
    name: 'get_feedback_details',
    description: 'Get complete feedback details: transcript, frames, summary, acceptance criteria. Used by Claude to get full context.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string', description: 'Feedback session ID' },
      },
      required: ['feedback_id'],
    },
  },
  {
    name: 'register_completed_task',
    description: 'Register completed task: Claude Code calls this after creating PR. Links PR back to original feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback_id: { type: 'string', description: 'Original feedback session ID' },
        pr_url: { type: 'string', description: 'GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)' },
        pr_number: { type: 'integer', description: 'PR number (e.g., 123)' },
        branch_name: { type: 'string', description: 'Branch name created for changes' },
      },
      required: ['feedback_id', 'pr_url', 'pr_number'],
    },
  },
];
