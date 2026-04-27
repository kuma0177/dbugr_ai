import express from 'express';
import cors from 'cors';
import { feedbackSessionRouter } from './routes/feedbackSessions';
import { commentsRouter } from './routes/comments';
import { tasksRouter } from './routes/tasks';
import { integrationsRouter } from './routes/integrations';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', feedbackSessionRouter);
app.use('/api', commentsRouter);
app.use('/api', tasksRouter);
app.use('/api', integrationsRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
