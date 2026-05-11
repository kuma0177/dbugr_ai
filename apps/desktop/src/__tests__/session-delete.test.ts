import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const desktopMainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const apiFeedbackSessionsSource = readFileSync(
  resolve(testDir, '../../../api/src/routes/feedbackSessions.ts'),
  'utf8',
);

function functionBlock(source: string, startPattern: RegExp) {
  const start = source.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error('Could not parse function block');
}

describe('desktop session deletion', () => {
  it('persists a local tombstone and asks the API to delete the remote session', () => {
    const deleteSessionBlock = functionBlock(desktopMainSource, /function deleteSession\(/);
    const deleteRemoteSessionBlock = functionBlock(desktopMainSource, /async function deleteRemoteSession\(/);

    expect(deleteSessionBlock).toContain('deletedSessionIds.add(sessionId)');
    expect(deleteSessionBlock).toContain('persistAppState()');
    expect(deleteSessionBlock).toContain('deleteRemoteSession(sessionId)');
    expect(deleteRemoteSessionBlock).toContain("method: 'DELETE'");
    expect(deleteRemoteSessionBlock).toContain('/feedback-sessions/');
    expect(desktopMainSource).toContain('deletedSessionIds.has(remote.id)');
  });

  it('exposes a backend delete route that removes dependent session records first', () => {
    expect(apiFeedbackSessionsSource).toContain("feedbackSessionRouter.delete('/feedback-sessions/:id'");
    expect(apiFeedbackSessionsSource).toContain('tx.submission.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.aIReviewSummary.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.improvementTask.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.curationDecision.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.feedbackVote.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.feedbackComment.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.feedbackFrame.deleteMany');
    expect(apiFeedbackSessionsSource).toContain('tx.feedbackSession.delete');
  });
});
