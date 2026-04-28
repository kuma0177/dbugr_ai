import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const overlayAutomationRouter = Router();

type OverlayTarget = 'claude' | 'codex';

interface OverlayCommand {
  sessionId: string;
  title: string;
  target: OverlayTarget;
  url: string;
  createdAt: number;
  consumedAt?: number;
}

const commandTtlMs = 10 * 60 * 1000;
const commandsByUrl = new Map<string, OverlayCommand>();

const launchSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1),
  target: z.enum(['claude', 'codex']).default('claude'),
  url: z.string().url(),
});

const consumeSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url(),
});

function normalizeUrl(input: string) {
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return input;
  }
}

function isExpired(command: OverlayCommand) {
  return Date.now() - command.createdAt > commandTtlMs;
}

function cleanupExpired() {
  for (const [key, command] of commandsByUrl.entries()) {
    if (isExpired(command)) commandsByUrl.delete(key);
  }
}

// Used by web app when user launches a session.
overlayAutomationRouter.post('/overlay/launch', (req: Request, res: Response) => {
  const parsed = launchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  cleanupExpired();

  const normalizedUrl = normalizeUrl(parsed.data.url);
  const command: OverlayCommand = {
    sessionId: parsed.data.sessionId,
    title: parsed.data.title,
    target: parsed.data.target,
    url: normalizedUrl,
    createdAt: Date.now(),
  };
  commandsByUrl.set(normalizedUrl, command);

  return res.status(201).json({ data: command });
});

// Used by extension to discover what to inject on current active tab.
overlayAutomationRouter.get('/overlay/next', (req: Request, res: Response) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) return res.json({ data: null });

  cleanupExpired();
  const command = commandsByUrl.get(normalizeUrl(url));
  if (!command || command.consumedAt || isExpired(command)) return res.json({ data: null });

  return res.json({ data: command });
});

// Used by extension after successful injection to avoid repeated reinjection loops.
overlayAutomationRouter.post('/overlay/consume', (req: Request, res: Response) => {
  const parsed = consumeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const key = normalizeUrl(parsed.data.url);
  const command = commandsByUrl.get(key);
  if (!command) return res.json({ data: { consumed: false } });
  if (command.sessionId !== parsed.data.sessionId) return res.status(409).json({ error: 'Session mismatch' });

  command.consumedAt = Date.now();
  commandsByUrl.set(key, command);
  return res.json({ data: { consumed: true } });
});
