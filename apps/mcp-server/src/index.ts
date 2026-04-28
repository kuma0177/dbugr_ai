import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { prisma } from '@feedbackagent/db';
import { auditToolCall } from './audit';
import { tools } from './tools';

const server = new Server(
  { name: 'feedbackagent-mcp', version: '0.0.1' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  await auditToolCall(name, args ?? {});

  switch (name) {
    case 'list_feedback':
      return handleListFeedback(args as { project_id?: string; status?: string });
    case 'get_feedback':
      return handleGetFeedback(args as { feedback_id: string });
    case 'get_feedback_assets':
      return handleGetFeedbackAssets(args as { feedback_id: string });
    case 'create_improvement_task':
      return handleCreateTask(args as { feedback_id: string; target: string; title: string; description: string });
    case 'send_approved_task':
      return handleSendTask(args as { task_id: string });
    // V2: Feedback → Claude Code handoff
    case 'push_feedback_to_claude':
      return handlePushFeedbackToClaude(args as { feedback_id: string; target: string });
    case 'get_feedback_details':
      return handleGetFeedbackDetails(args as { feedback_id: string });
    case 'register_completed_task':
      return handleRegisterCompletedTask(args as { feedback_id: string; pr_url: string; pr_number: number; branch_name?: string });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function handleListFeedback(args: { project_id?: string; status?: string }) {
  const sessions = await prisma.feedbackSession.findMany({
    where: {
      ...(args.project_id ? { projectId: args.project_id } : {}),
      ...(args.status ? { status: args.status } : {}),
      visibility: { not: 'private' }, // never expose private sessions to agents
    },
    select: { id: true, title: true, aiSummary: true, status: true, visibility: true },
    orderBy: { createdAt: 'desc' },
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ feedback: sessions }, null, 2) }],
  };
}

async function handleGetFeedback(args: { feedback_id: string }) {
  const session = await prisma.feedbackSession.findUnique({
    where: { id: args.feedback_id },
    include: {
      frames: { select: { timestampMs: true, imageUrl: true, cursorX: true, cursorY: true, description: true } },
      comments: { where: { visibility: { not: 'private' } }, select: { body: true, votesCount: true, createdAt: true } },
    },
  });

  if (!session) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not found' }) }], isError: true };
  }
  if (session.visibility === 'private') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Access denied: private session' }) }], isError: true };
  }

  const result = {
    id: session.id,
    title: session.title,
    summary: session.aiSummary,
    transcript: session.transcript,
    task_brief: session.aiTaskBrief,
    frames: session.frames,
    comments: session.comments,
  };

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

async function handleGetFeedbackAssets(args: { feedback_id: string }) {
  const session = await prisma.feedbackSession.findUnique({
    where: { id: args.feedback_id },
    include: { frames: true },
  });

  if (!session || session.visibility === 'private') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not found or access denied' }) }], isError: true };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        video_url: session.videoUrl,
        frames: session.frames.map((f) => ({
          timestamp_ms: f.timestampMs,
          image_url: f.imageUrl,
          cursor: { x: f.cursorX, y: f.cursorY },
        })),
      }, null, 2),
    }],
  };
}

async function handleCreateTask(args: { feedback_id: string; target: string; title: string; description: string }) {
  const task = await prisma.improvementTask.create({
    data: {
      feedbackSessionId: args.feedback_id,
      target: args.target,
      title: args.title,
      description: args.description,
      status: 'draft',
    },
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ task_id: task.id, status: task.status }, null, 2) }],
  };
}

async function handleSendTask(args: { task_id: string }) {
  const task = await prisma.improvementTask.findUnique({ where: { id: args.task_id } });
  if (!task) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found' }) }], isError: true };
  }
  if (task.status !== 'approved') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Task must be approved by a human before sending' }) }], isError: true };
  }

  // TODO: dispatch to real integration provider
  const externalUrl = `https://mock-${task.target}.example.com/issues/MOCK-${Date.now()}`;
  const updated = await prisma.improvementTask.update({
    where: { id: task.id },
    data: { status: 'sent', externalUrl },
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ status: updated.status, external_url: externalUrl }, null, 2) }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2: Feedback → Claude Code Handoff Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePushFeedbackToClaude(args: { feedback_id: string; target: string }) {
  const session = await prisma.feedbackSession.findUnique({
    where: { id: args.feedback_id },
  });

  if (!session) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Feedback not found' }) }], isError: true };
  }
  if (session.visibility === 'private') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Cannot push private feedback' }) }], isError: true };
  }

  // Create an improvement task that represents the Claude Code handoff
  const task = await prisma.improvementTask.create({
    data: {
      feedbackSessionId: args.feedback_id,
      target: args.target,
      title: session.title,
      description: session.aiSummary || 'Feedback summary pending...',
      status: 'draft', // Will be approved by Claude Code when it creates PR
    },
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        task_id: task.id,
        feedback_id: args.feedback_id,
        status: 'pushed_to_claude',
        message: `Feedback pushed to ${args.target}. Claude Code can now retrieve full details.`,
      }, null, 2),
    }],
  };
}

async function handleGetFeedbackDetails(args: { feedback_id: string }) {
  const session = await prisma.feedbackSession.findUnique({
    where: { id: args.feedback_id },
    include: {
      frames: true,
      comments: { where: { visibility: { not: 'private' } } },
      tasks: true,
    },
  });

  if (!session) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Feedback not found' }) }], isError: true };
  }
  if (session.visibility === 'private') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Access denied: private session' }) }], isError: true };
  }

  // Parse task brief if available
  let taskBrief = null;
  if (session.aiTaskBrief) {
    try {
      taskBrief = JSON.parse(session.aiTaskBrief);
    } catch {}
  }

  const result = {
    id: session.id,
    title: session.title,
    summary: session.aiSummary,
    problem_statement: session.aiSummary ? 'See summary above' : null,
    transcript: session.transcript,
    task_brief: taskBrief,
    acceptance_criteria: taskBrief?.context?.reproSteps || [],
    frames_count: session.frames.length,
    comments_count: session.comments.length,
    visibility: session.visibility,
    created_at: session.createdAt,
  };

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

async function handleRegisterCompletedTask(args: {
  feedback_id: string;
  pr_url: string;
  pr_number: number;
  branch_name?: string;
}) {
  // Find the task created for this feedback when it was pushed to Claude
  const task = await prisma.improvementTask.findFirst({
    where: {
      feedbackSessionId: args.feedback_id,
      status: 'draft',
    },
  });

  if (!task) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No pending task found for this feedback. Did you call push_feedback_to_claude first?',
        }),
      }],
      isError: true,
    };
  }

  // Update task with PR details
  const updated = await prisma.improvementTask.update({
    where: { id: task.id },
    data: {
      status: 'sent',
      externalId: String(args.pr_number),
      externalUrl: args.pr_url,
    },
  });

  // Update feedback session status
  await prisma.feedbackSession.update({
    where: { id: args.feedback_id },
    data: { status: 'routed' },
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        task_id: updated.id,
        pr_url: args.pr_url,
        pr_number: args.pr_number,
        message: 'Task registered. PR is now tracked in debugr.ai.',
      }, null, 2),
    }],
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('debugr.ai MCP server running on stdio');
}

main().catch(console.error);
