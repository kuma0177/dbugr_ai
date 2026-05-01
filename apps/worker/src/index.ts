import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { processSession } from './processor';

function loadLocalEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim().replace(/^"(.*)"$/, '$1');
      if (key === 'DATABASE_URL' && rawValue.startsWith('file:')) {
        const filePath = rawValue.slice('file:'.length);
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(path.dirname(envPath), filePath);
        process.env[key] = `file:${absolutePath}`;
      } else {
        process.env[key] = rawValue;
      }
    }

    return;
  }
}

loadLocalEnv();

const app = express();
const PORT = process.env.PORT ?? 3002;

app.use(express.json());

// Called by the API after a session is finalized
// TODO: replace with BullMQ job queue consumer
app.post('/process/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  res.json({ queued: true, sessionId });

  // Process asynchronously after responding
  processSession(sessionId).catch((err) =>
    console.error(`[worker] Failed to process ${sessionId}:`, err)
  );
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Worker running on http://localhost:${PORT}`);
});
