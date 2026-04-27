import { prisma } from '@feedbackagent/db';
import { cleanTranscript, summarizeFeedback } from '@feedbackagent/ai';
import { MOCK_FRAMES, MOCK_SUMMARY, MOCK_TASK_BRIEF, MOCK_TRANSCRIPT } from './mockData';

export async function processSession(sessionId: string): Promise<void> {
  console.log(`[worker] Processing session ${sessionId}`);

  await prisma.feedbackSession.update({
    where: { id: sessionId },
    data: { status: 'processing' },
  });

  // ── 1. Transcription cleanup ──────────────────────────────────────────────
  // TODO: replace rawTranscript source with real Whisper/AssemblyAI output
  const rawTranscript = MOCK_TRANSCRIPT;
  let transcript = rawTranscript;
  let userIntent: string | undefined;

  const cleaned = await cleanTranscript({ rawTranscript });
  if (cleaned) {
    transcript = cleaned.clean_transcript;
    userIntent = cleaned.user_intent;
    console.log(`[worker] AI transcript cleanup done (intent: ${userIntent})`);
  } else {
    console.log('[worker] AI unavailable — using raw mock transcript');
  }

  // ── 2. Frame extraction ───────────────────────────────────────────────────
  // Extract frames from annotations (from finalize endpoint)
  await prisma.feedbackFrame.deleteMany({ where: { feedbackSessionId: sessionId } });

  // Get the session to check if it has a video file
  const session = await prisma.feedbackSession.findUnique({
    where: { id: sessionId },
  });

  if (session?.videoUrl) {
    // In production, extract frames from video file using ffmpeg
    // For MVP, create frame records from key timestamps
    // Frames will be generated from annotations during finalization
    console.log(`[worker] Video file available: ${session.videoUrl}`);

    // Create placeholder frames at 2-second intervals
    const frames = [];
    const durationSeconds = 30; // estimate
    for (let t = 0; t < durationSeconds; t += 2) {
      frames.push({
        feedbackSessionId: sessionId,
        timestampMs: t * 1000,
        imageUrl: `${session.videoUrl}?t=${t}`, // Mock: reference video with timestamp
        cursorX: 640,
        cursorY: 360,
        clickType: undefined,
        description: undefined,
      });
    }

    await prisma.feedbackFrame.createMany({ data: frames });
    console.log(`[worker] Created ${frames.length} placeholder frames`);
  } else {
    // Fallback to mock frames if no video
    await prisma.feedbackFrame.createMany({
      data: MOCK_FRAMES.map((f) => ({ ...f, feedbackSessionId: sessionId })),
    });
  }

  // ── 3. AI summarization + task brief ─────────────────────────────────────
  let aiSummary = MOCK_SUMMARY;
  let aiTaskBrief = MOCK_TASK_BRIEF;

  const frames = await prisma.feedbackFrame.findMany({ where: { feedbackSessionId: sessionId } });
  const summarized = await summarizeFeedback({
    transcript,
    frames: frames.map((f) => ({
      timestampMs: f.timestampMs,
      description: f.description ?? undefined,
      cursorX: f.cursorX,
      cursorY: f.cursorY,
    })),
  });

  if (summarized) {
    aiSummary = summarized.summary;
    aiTaskBrief = JSON.stringify({
      title: summarized.agent_task.title,
      description: summarized.agent_task.description,
      implementation_notes: summarized.agent_task.implementation_notes,
      files_or_areas_to_inspect: summarized.agent_task.files_or_areas_to_inspect,
      severity: summarized.severity,
      category: summarized.category,
      acceptance_criteria: summarized.acceptance_criteria,
    });
    console.log(`[worker] AI summarization done (severity: ${summarized.severity})`);
  } else {
    console.log('[worker] AI unavailable — using mock summary');
  }

  // ── 4. Persist results ────────────────────────────────────────────────────
  await prisma.feedbackSession.update({
    where: { id: sessionId },
    data: {
      transcript,
      aiSummary,
      aiTaskBrief,
      userIntent: userIntent ?? null,
      status: 'ready',
    },
  });

  console.log(`[worker] Session ${sessionId} ready`);
}
