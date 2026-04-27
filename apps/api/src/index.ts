import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

async function main() {
  const app = express();
  const PORT = process.env.PORT ?? 3001;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const [{ feedbackSessionRouter }, { commentsRouter }, { tasksRouter }, { integrationsRouter }, { liveSessionsRouter }] =
    await Promise.all([
      import('./routes/feedbackSessions'),
      import('./routes/comments'),
      import('./routes/tasks'),
      import('./routes/integrations'),
      import('./routes/liveSessions'),
    ]);

  app.use('/api', feedbackSessionRouter);
  app.use('/api', commentsRouter);
  app.use('/api', tasksRouter);
  app.use('/api', integrationsRouter);
  app.use('/api', liveSessionsRouter);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

void main().catch((error) => {
  console.error('[api] Fatal startup error:', error);
  process.exitCode = 1;
});
