import { prisma } from '@feedbackagent/db';
import { MOCK_FRAMES, MOCK_SUMMARY, MOCK_TASK_BRIEF, MOCK_TRANSCRIPT } from './mockData';

export async function processSession(sessionId: string): Promise<void> {
  console.log(`[worker] Processing session ${sessionId}`);

  await prisma.feedbackSession.update({
    where: { id: sessionId },
    data: { status: 'processing' },
  });

  // TODO: replace with real transcription service (e.g. Whisper, AssemblyAI)
  await sleep(300);

  // TODO: replace with real frame extraction from video
  // Delete existing frames first (idempotent re-processing)
  await prisma.feedbackFrame.deleteMany({ where: { feedbackSessionId: sessionId } });
  await prisma.feedbackFrame.createMany({
    data: MOCK_FRAMES.map((f) => ({ ...f, feedbackSessionId: sessionId })),
  });

  // TODO: replace with real AI summarization (Claude, GPT-4, etc.)
  await sleep(300);

  await prisma.feedbackSession.update({
    where: { id: sessionId },
    data: {
      transcript: MOCK_TRANSCRIPT,
      aiSummary: MOCK_SUMMARY,
      aiTaskBrief: MOCK_TASK_BRIEF,
      status: 'ready',
    },
  });

  console.log(`[worker] Session ${sessionId} ready`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
