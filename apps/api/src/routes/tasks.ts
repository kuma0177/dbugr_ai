import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';
import { auditLog } from '../lib/audit';
import { dispatchTask, configFromEnv } from '@feedbackagent/integrations';

export const tasksRouter = Router();

const DEMO_USER_ID = 'user_demo';
const DEMO_ORG_ID = 'org_demo';

const createTaskSchema = z.object({
  target: z.enum(['jira', 'github', 'codex', 'claude', 'chatgpt', 'gemini', 'figma']),
  title: z.string().min(1),
  description: z.string().min(1),
});

// POST /api/feedback-sessions/:id/tasks
tasksRouter.post('/feedback-sessions/:id/tasks', async (req: Request, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const task = await prisma.improvementTask.create({
    data: {
      feedbackSessionId: req.params.id,
      title: parsed.data.title,
      description: parsed.data.description,
      target: parsed.data.target,
      status: 'draft',
    },
  });
  return res.status(201).json({ data: task });
});

// POST /api/tasks/:id/approve
tasksRouter.post('/tasks/:id/approve', async (req: Request, res: Response) => {
  const task = await prisma.improvementTask.update({
    where: { id: req.params.id },
    data: { status: 'approved' },
  });

  await auditLog({
    organizationId: DEMO_ORG_ID,
    actorId: DEMO_USER_ID,
    action: 'task.approved',
    targetType: 'ImprovementTask',
    targetId: task.id,
  });

  return res.json({ data: task });
});

// POST /api/tasks/:id/send
tasksRouter.post('/tasks/:id/send', async (req: Request, res: Response) => {
  const task = await prisma.improvementTask.findUnique({
    where: { id: req.params.id },
    include: { session: true },
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'approved') {
    return res.status(400).json({ error: 'Task must be approved before sending' });
  }

  // Build config: env vars (local dev) or tokens stored in DB (production)
  const envConfig = configFromEnv();

  // Look up org integration record and merge any stored config
  const integration = await prisma.integration.findFirst({
    where: { organizationId: DEMO_ORG_ID, provider: task.target },
  });

  let storedConfig: Record<string, string> = {};
  if (integration?.configJson) {
    try {
      storedConfig = JSON.parse(integration.configJson) as Record<string, string>;
    } catch {
      // ignore malformed config
    }
  }

  // Env vars take precedence for local dev; DB config fills gaps
  const config = { ...storedConfig, ...envConfig };

  let result;
  try {
    result = await dispatchTask(
      {
        title: task.title,
        description: task.description,
        target: task.target,
        sessionId: task.feedbackSessionId,
        sessionTitle: task.session?.title,
      },
      config
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api] dispatchTask error:', msg);
    return res.status(502).json({ error: `Integration error: ${msg}` });
  }

  const updated = await prisma.improvementTask.update({
    where: { id: task.id },
    data: {
      status: 'sent',
      externalUrl: result.externalUrl,
      externalId: result.externalId,
    },
  });

  await auditLog({
    organizationId: DEMO_ORG_ID,
    actorId: DEMO_USER_ID,
    action: 'task.sent',
    targetType: 'ImprovementTask',
    targetId: task.id,
    metadata: {
      target: task.target,
      provider: result.provider,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
    },
  });

  return res.json({ data: updated });
});
