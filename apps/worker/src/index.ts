import express from 'express';
import { processSession } from './processor';

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
