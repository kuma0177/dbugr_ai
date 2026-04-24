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
];
