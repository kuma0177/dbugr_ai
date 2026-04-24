import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';

export const commentsRouter = Router();

const DEMO_USER_ID = 'user_demo';

const createCommentSchema = z.object({
  body: z.string().min(1),
  parentCommentId: z.string().optional().nullable(),
});

const voteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
});

// POST /api/feedback-sessions/:id/comments
commentsRouter.post('/feedback-sessions/:id/comments', async (req: Request, res: Response) => {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const comment = await prisma.feedbackComment.create({
    data: {
      feedbackSessionId: req.params.id,
      authorId: DEMO_USER_ID,
      body: parsed.data.body,
      parentCommentId: parsed.data.parentCommentId ?? null,
    },
    include: { author: true },
  });
  return res.status(201).json({ data: comment });
});

// POST /api/comments/:id/vote
commentsRouter.post('/comments/:id/vote', async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.feedbackVote.findUnique({
    where: { feedbackCommentId_userId: { feedbackCommentId: req.params.id, userId: DEMO_USER_ID } },
  });

  if (existing) {
    await prisma.feedbackVote.delete({ where: { id: existing.id } });
    await prisma.feedbackComment.update({
      where: { id: req.params.id },
      data: { votesCount: { decrement: existing.value } },
    });
    return res.json({ data: { removed: true } });
  }

  await prisma.feedbackVote.create({
    data: { feedbackCommentId: req.params.id, userId: DEMO_USER_ID, value: parsed.data.value },
  });
  await prisma.feedbackComment.update({
    where: { id: req.params.id },
    data: { votesCount: { increment: parsed.data.value } },
  });

  return res.json({ data: { voted: true, value: parsed.data.value } });
});
