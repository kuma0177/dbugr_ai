import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';

export const feedbackSessionRouter = Router();

const DEMO_USER_ID = 'user_demo';
const DEMO_ORG_ID = 'org_demo';

const createSchema = z.object({
  title: z.string().min(1),
  visibility: z.enum(['private', 'public', 'org']).default('private'),
});

const finalizeSchema = z.object({
  durationMs: z.number(),
  cursorEvents: z
    .array(
      z.object({
        timestampMs: z.number(),
        x: z.number(),
        y: z.number(),
        type: z.enum(['move', 'click', 'scroll']),
      })
    )
    .optional(),
});

const patchSchema = z.object({
  title: z.string().optional(),
  visibility: z.enum(['private', 'public', 'org']).optional(),
  aiSummary: z.string().optional(),
  aiTaskBrief: z.string().optional(),
});

// POST /api/projects/:projectId/feedback-sessions
feedbackSessionRouter.post(
  '/projects/:projectId/feedback-sessions',
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const session = await prisma.feedbackSession.create({
      data: {
        projectId: req.params.projectId,
        createdBy: DEMO_USER_ID,
        title: parsed.data.title,
        visibility: parsed.data.visibility,
        status: 'draft',
      },
    });
    return res.status(201).json({ data: session });
  }
);

// POST /api/feedback-sessions/:id/finalize
feedbackSessionRouter.post(
  '/feedback-sessions/:id/finalize',
  async (req: Request, res: Response) => {
    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const session = await prisma.feedbackSession.update({
      where: { id: req.params.id },
      data: { status: 'processing' },
    });

    // Trigger async mock worker via HTTP (fire-and-forget)
    const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3002';
    fetch(`${workerUrl}/process/${session.id}`, { method: 'POST' }).catch(() => {
      // TODO: replace with BullMQ job queue
      console.warn('Worker not reachable, processing skipped');
    });

    return res.json({ data: session });
  }
);

// GET /api/feedback-sessions
feedbackSessionRouter.get('/feedback-sessions', async (_req: Request, res: Response) => {
  const sessions = await prisma.feedbackSession.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { comments: true, tasks: true } } },
  });
  return res.json({ data: sessions });
});

// GET /api/feedback-sessions/:id
feedbackSessionRouter.get('/feedback-sessions/:id', async (req: Request, res: Response) => {
  const session = await prisma.feedbackSession.findUnique({
    where: { id: req.params.id },
    include: {
      frames: { orderBy: { timestampMs: 'asc' } },
      comments: {
        where: { parentCommentId: null },
        include: {
          author: true,
          replies: { include: { author: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      tasks: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!session) return res.status(404).json({ error: 'Not found' });
  return res.json({ data: session });
});

// PATCH /api/feedback-sessions/:id
feedbackSessionRouter.patch('/feedback-sessions/:id', async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const session = await prisma.feedbackSession.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  return res.json({ data: session });
});

// POST /api/feedback-sessions/:id/send-to-claude
// V2: Send feedback to Claude Code for implementation
feedbackSessionRouter.post('/feedback-sessions/:id/send-to-claude', async (req: Request, res: Response) => {
  const { target } = req.body;

  const session = await prisma.feedbackSession.findUnique({
    where: { id: req.params.id },
  });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Create an improvement task representing the Claude Code handoff
  const task = await prisma.improvementTask.create({
    data: {
      feedbackSessionId: session.id,
      target: target || 'claude',
      title: session.title,
      description: session.aiSummary || 'Feedback ready for implementation',
      status: 'draft',
    },
  });

  return res.status(201).json({
    data: {
      task_id: task.id,
      feedback_id: session.id,
      message: `Feedback sent to ${target || 'claude'}. Your Claude Code instance can now call the 'get_feedback_details' MCP tool to access the full context.`,
      mcp_instructions: `
In your Claude Code instance:
1. Call get_feedback_details with feedback_id: "${session.id}"
2. Implement the code changes
3. Call register_completed_task with the PR details when done
      `.trim(),
    },
  });
});
