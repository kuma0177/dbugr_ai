import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';
import { auditLog } from '../lib/audit';

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
  const task = await prisma.improvementTask.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'approved') {
    return res.status(400).json({ error: 'Task must be approved before sending' });
  }

  // TODO: replace with real integration provider dispatch
  const mockExternalUrl = `https://mock-${task.target}.example.com/issues/MOCK-${Date.now()}`;

  const updated = await prisma.improvementTask.update({
    where: { id: task.id },
    data: { status: 'sent', externalUrl: mockExternalUrl, externalId: `MOCK-${Date.now()}` },
  });

  await auditLog({
    organizationId: DEMO_ORG_ID,
    actorId: DEMO_USER_ID,
    action: 'task.sent',
    targetType: 'ImprovementTask',
    targetId: task.id,
    metadata: { target: task.target, externalUrl: mockExternalUrl },
  });

  return res.json({ data: updated });
});
