import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const liveSessionsRouter = Router();

const annotationSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  description: z.string(),
  timestamp: z.number(),
  color: z.string(),
  voiceNoteDataUrl: z.string().optional(),
  voiceNoteDurationSec: z.number().optional(),
});

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

const heartbeatSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['idle', 'selecting', 'recording', 'paused', 'stopped']),
  timestampSec: z.number().min(0),
});

const upsertAnnotationsSchema = z.object({
  annotations: z.array(annotationSchema),
});

const draftSchema = z.object({
  id: z.string(),
  description: z.string().max(1000).optional().default(''),
  voiceNoteDataUrl: z.string().optional(),
  voiceNoteDurationSec: z.number().max(30).optional(),
  createdAt: z.string(),
});

type LiveAnnotation = z.infer<typeof annotationSchema>;
type ControllerDraft = z.infer<typeof draftSchema>;

type LiveSession = {
  id: string;
  title: string;
  status: 'idle' | 'selecting' | 'recording' | 'paused' | 'stopped';
  timestampSec: number;
  annotations: LiveAnnotation[];
  pendingDraft: ControllerDraft | null;
  updatedAt: string;
  createdAt: string;
};

const sessions = new Map<string, LiveSession>();

function createId() {
  return Math.random().toString(36).slice(2, 8);
}

function getSessionOr404(id: string, res: Response) {
  const session = sessions.get(id);
  if (!session) {
    res.status(404).json({ error: 'Live session not found' });
    return null;
  }
  return session;
}

liveSessionsRouter.post('/live-sessions', (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = createId();
  const now = new Date().toISOString();

  const session: LiveSession = {
    id,
    title: parsed.data.title,
    status: 'idle',
    timestampSec: 0,
    annotations: [],
    pendingDraft: null,
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(id, session);
  return res.status(201).json({ data: session });
});

liveSessionsRouter.get('/live-sessions/:id', (req: Request, res: Response) => {
  const session = getSessionOr404(req.params.id, res);
  if (!session) return;
  return res.json({ data: session });
});

liveSessionsRouter.post('/live-sessions/:id/heartbeat', (req: Request, res: Response) => {
  const session = getSessionOr404(req.params.id, res);
  if (!session) return;

  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  session.status = parsed.data.status;
  session.timestampSec = parsed.data.timestampSec;
  if (parsed.data.title) session.title = parsed.data.title;
  session.updatedAt = new Date().toISOString();

  return res.json({ data: session });
});

liveSessionsRouter.put('/live-sessions/:id/annotations', (req: Request, res: Response) => {
  const session = getSessionOr404(req.params.id, res);
  if (!session) return;

  const parsed = upsertAnnotationsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  session.annotations = parsed.data.annotations;
  session.updatedAt = new Date().toISOString();

  return res.json({ data: session });
});

liveSessionsRouter.post('/live-sessions/:id/drafts', (req: Request, res: Response) => {
  const session = getSessionOr404(req.params.id, res);
  if (!session) return;

  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  session.pendingDraft = parsed.data;
  session.updatedAt = new Date().toISOString();

  return res.status(201).json({ data: session.pendingDraft });
});

liveSessionsRouter.delete('/live-sessions/:id/drafts/current', (req: Request, res: Response) => {
  const session = getSessionOr404(req.params.id, res);
  if (!session) return;

  session.pendingDraft = null;
  session.updatedAt = new Date().toISOString();

  return res.json({ data: { cleared: true } });
});
