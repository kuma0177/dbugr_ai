import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { generateClaudeFeedback, generateCodexFeedback, type CaptureContext } from '../services/claude';

export const feedbackSessionRouter = Router();

const DEMO_USER_ID = 'user_demo';
const DEMO_ORG_ID = 'org_demo';

// Configure multer for video uploads
const uploadDir = process.env.UPLOAD_DIR ?? '/tmp/feedbackagent-videos';
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max
  },
});

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
  userIntent: z.string().optional(), // stores serialized native capture annotations
});

function getRepoContext() {
  const repoUrl = process.env.TARGET_REPO_URL?.trim()
    || (process.env.GITHUB_OWNER && process.env.GITHUB_REPO
      ? `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
      : '');
  const repoBranch = process.env.TARGET_REPO_BRANCH?.trim() || 'main';
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  const repoName = match ? `${match[1]}/${match[2].replace(/\.git$/, '')}` : '';
  return { repoUrl, repoName, repoBranch };
}

// POST /api/feedback-sessions/upload (from recorder)
feedbackSessionRouter.post(
  '/feedback-sessions/upload',
  upload.single('video'),
  async (req: Request, res: Response) => {
    try {
      const title = (req.body?.title as string) || 'Untitled Recording';
      const durationMs = parseInt((req.body?.durationMs as string) || '0');
      const videoPath = req.file?.path;

      // Create a draft session
      const session = await prisma.feedbackSession.create({
        data: {
          projectId: 'proj_demo',
          createdBy: DEMO_USER_ID,
          title,
          visibility: 'private',
          status: 'draft',
          videoUrl: videoPath || undefined, // Store path to video file
        },
      });

      console.log(`[upload] Session created: ${session.id}, video: ${videoPath}`);
      return res.status(201).json({ data: { id: session.id } });
    } catch (err) {
      console.error('[upload] Error:', err);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// POST /api/projects/:projectId/feedback-sessions
feedbackSessionRouter.post(
  '/projects/:projectId/feedback-sessions',
  async (req: Request, res: Response) => {
    console.log('[api] POST /projects/:projectId/feedback-sessions body:', req.body);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[api] create session validation failed:', parsed.error.flatten());
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const session = await prisma.feedbackSession.create({
      data: {
        projectId: req.params.projectId,
        createdBy: DEMO_USER_ID,
        title: parsed.data.title,
        visibility: parsed.data.visibility,
        status: 'draft',
      },
    });
    console.log('[api] session created:', session.id, 'title:', session.title);
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
  console.log('[api] PATCH /feedback-sessions/:id', req.params.id, 'keys:', Object.keys(req.body));
  if (req.body.userIntent) {
    try {
      const intent = JSON.parse(req.body.userIntent);
      console.log('[api] userIntent received — boxes:', intent.boxes?.length ?? 0, 'pageUrl:', intent.pageUrl);
    } catch {
      console.warn('[api] userIntent present but not valid JSON');
    }
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[api] patch validation failed:', parsed.error.flatten());
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = await prisma.feedbackSession.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  console.log('[api] session patched:', session.id, 'status:', session.status);
  return res.json({ data: session });
});

// POST /api/feedback-sessions/:id/send-to-claude
// V2: Send feedback to Claude Code for implementation with real AI feedback
feedbackSessionRouter.post('/feedback-sessions/:id/send-to-claude', async (req: Request, res: Response) => {
  const { target } = req.body;
  console.log('[api] POST /feedback-sessions/:id/send-to-claude id:', req.params.id, 'target:', target);

  const session = await prisma.feedbackSession.findUnique({
    where: { id: req.params.id },
  });

  if (!session) {
    console.warn('[api] send-to-claude: session not found:', req.params.id);
    return res.status(404).json({ error: 'Session not found' });
  }
  console.log('[api] session found:', session.id, 'userIntent length:', session.userIntent?.length ?? 0);

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

  const resolvedTarget = target === 'codex' ? 'codex' : 'claude';
  const targetLabel = resolvedTarget === 'codex' ? 'Codex' : 'Claude Code';
  const { repoUrl, repoName, repoBranch } = getRepoContext();

  // Parse userIntent if available (from native capture)
  let captureContext: CaptureContext | null = null;
  if (session.userIntent) {
    try {
      const parsed = JSON.parse(session.userIntent);
      captureContext = {
        title: session.title,
        notes: parsed.sessionNote || parsed.notes,
        boxes: parsed.boxes || [],
        repoUrl,
        repoName,
        repoBranch,
      };
      console.log('[api] Parsed capture context for feedback generation:', { boxes: captureContext.boxes.length });
    } catch (e) {
      console.warn('[api] Failed to parse userIntent:', e);
    }
  }

  // Generate real feedback from Claude or Codex
  let agentFeedback;
  try {
    if (resolvedTarget === 'codex') {
      agentFeedback = await generateCodexFeedback(
        captureContext || {
          title: session.title,
          boxes: [],
          repoUrl,
          repoName,
          repoBranch,
        },
        session.id
      );
    } else {
      agentFeedback = await generateClaudeFeedback(
        captureContext || {
          title: session.title,
          boxes: [],
          repoUrl,
          repoName,
          repoBranch,
        },
        session.id
      );
    }
    console.log('[api] Feedback generated successfully:', agentFeedback.title);
  } catch (error) {
    console.error('[api] Error generating feedback:', error);
    agentFeedback = {
      title: 'Feedback generation failed',
      summary: `Could not generate feedback: ${error instanceof Error ? error.message : 'Unknown error'}`,
      next_steps: ['Check API configuration', 'Verify network connection', 'Try again'],
    };
  }

  return res.status(201).json({
    data: {
      task_id: task.id,
      feedback_id: session.id,
      message: `Feedback from ${targetLabel} is ready.`,
      agent_feedback: agentFeedback,
    },
  });
});
