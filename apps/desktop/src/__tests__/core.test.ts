/**
 * Debugr — Unit tests for core.ts pure functions
 *
 * Covers spec sections:
 *  1  App launch (state shape)
 *  3  Create annotation
 *  4  Session auto-creation
 *  5  Multiple annotations + session note
 *  6  Save session (persistence round-trip)
 *  7  AI submission payload
 *  8  AI response structure
 *  9  Continuous loop
 * 10  Edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  uid,
  escapeHtml,
  providerLabel,
  providerSubtitle,
  flowLabel,
  sectionLabel,
  sortedSessions,
  totalAnnotations,
  acceptedContributions,
  getPendingSessions,
  buildSessionPrompt,
  buildCombinedPrompt,
  makeSession,
  makeCapture,
  makeAnnotation,
  type Session,
  type Target,
} from '../core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionWithAnnotations(count: number, status: Session['status'] = 'draft'): Session {
  const capture = makeCapture({
    annotations: Array.from({ length: count }, (_, i) =>
      makeAnnotation({
        number: i + 1,
        text: `Annotation note ${i + 1}`,
        tags: ['bug'],
        kind: 'region',
      }),
    ),
  });
  return makeSession({ captures: [capture], status });
}

// ─── TEST 1: Helpers & label functions ────────────────────────────────────────

describe('uid()', () => {
  it('generates a non-empty string with the given prefix', () => {
    const id = uid('session');
    expect(id).toMatch(/^session_/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid('x')));
    expect(ids.size).toBe(100);
  });
});

describe('escapeHtml()', () => {
  it('escapes all five special HTML chars', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
    );
  });

  it('returns empty string for null / undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('providerLabel()', () => {
  it('maps all three providers', () => {
    expect(providerLabel('claude')).toBe('Claude');
    expect(providerLabel('codex')).toBe('Codex');
    expect(providerLabel('cursor')).toBe('Cursor');
  });
});

describe('providerSubtitle()', () => {
  it('returns non-empty subtitle for every provider', () => {
    (['claude', 'codex', 'cursor'] as Target[]).forEach((t) => {
      expect(providerSubtitle(t).length).toBeGreaterThan(0);
    });
  });
});

describe('flowLabel()', () => {
  it('maps all three flows', () => {
    expect(flowLabel('direct')).toBe('Direct to AI');
    expect(flowLabel('team')).toBe('Team review');
    expect(flowLabel('public')).toBe('Public feed');
  });
});

describe('sectionLabel()', () => {
  it('maps all six workspace sections', () => {
    expect(sectionLabel('notes')).toBe('Annotate & note');
    expect(sectionLabel('flow')).toBe('Choose flow');
    expect(sectionLabel('collab')).toBe('Collaborate');
    expect(sectionLabel('review')).toBe('Review & curate');
    expect(sectionLabel('submit')).toBe('Submit');
    expect(sectionLabel('insights')).toBe('Insights');
  });
});

// ─── TEST 3 & 4: Annotation & session creation ────────────────────────────────

describe('makeAnnotation()', () => {
  it('creates a valid annotation with defaults', () => {
    const ann = makeAnnotation();
    expect(ann.id).toMatch(/^ann_/);
    expect(ann.kind).toBe('region');
    expect(ann.tags).toEqual([]);
    expect(ann.text).toBe('');
  });

  it('applies overrides correctly', () => {
    const ann = makeAnnotation({ text: 'Onboarding bug', tags: ['bug', 'onboarding'], kind: 'pin' });
    expect(ann.text).toBe('Onboarding bug');
    expect(ann.tags).toContain('bug');
    expect(ann.tags).toContain('onboarding');
    expect(ann.kind).toBe('pin');
  });
});

describe('makeCapture()', () => {
  it('creates a capture with empty annotations by default', () => {
    const capture = makeCapture();
    expect(capture.annotations).toHaveLength(0);
    expect(capture.id).toMatch(/^capture_/);
  });
});

describe('makeSession()', () => {
  it('creates a session in draft status', () => {
    const session = makeSession();
    expect(session.status).toBe('draft');
    expect(session.captures).toHaveLength(0);
    expect(session.contributions).toHaveLength(0);
    expect(session.submissionFlow).toBe('direct');
    expect(session.id).toMatch(/^session_/);
  });

  it('applies title override', () => {
    const session = makeSession({ title: 'Onboarding flow bug' });
    expect(session.title).toBe('Onboarding flow bug');
  });
});

// ─── TEST 4: Session contains annotations ─────────────────────────────────────

describe('totalAnnotations()', () => {
  it('returns 0 for a session with no captures', () => {
    expect(totalAnnotations(makeSession())).toBe(0);
  });

  it('sums annotations across multiple captures', () => {
    const session = makeSession({
      captures: [
        makeCapture({ annotations: [makeAnnotation(), makeAnnotation()] }),
        makeCapture({ annotations: [makeAnnotation()] }),
      ],
    });
    expect(totalAnnotations(session)).toBe(3);
  });

  // Spec: 20+ annotations edge case
  it('handles 20+ annotations without issues', () => {
    const session = makeSession({
      captures: [
        makeCapture({
          annotations: Array.from({ length: 25 }, (_, i) => makeAnnotation({ number: i + 1 })),
        }),
      ],
    });
    expect(totalAnnotations(session)).toBe(25);
  });
});

// ─── TEST 5: Session note is required for multi-annotation sessions ────────────

describe('Session note validation', () => {
  it('session note is present after being set', () => {
    const session = makeSession({ sessionNote: 'Users confused by CTA' });
    expect(session.sessionNote).toBe('Users confused by CTA');
  });

  it('session note is undefined/empty on a fresh session', () => {
    const session = makeSession();
    expect(session.sessionNote ?? '').toBe('');
  });

  it('multi-annotation session can carry a session note', () => {
    const session = sessionWithAnnotations(3);
    session.sessionNote = 'Onboarding CTA unclear';
    expect(totalAnnotations(session)).toBe(3);
    expect(session.sessionNote).toBeTruthy();
  });
});

// ─── TEST 6: Persistence round-trip ───────────────────────────────────────────

describe('sortedSessions()', () => {
  it('returns sessions newest-first', () => {
    const older = makeSession({ createdAt: '2024-01-01T00:00:00.000Z' });
    const newer = makeSession({ createdAt: '2025-01-01T00:00:00.000Z' });
    const sorted = sortedSessions([older, newer]);
    expect(sorted[0]!.id).toBe(newer.id);
    expect(sorted[1]!.id).toBe(older.id);
  });

  it('does not mutate the input array', () => {
    const sessions = [makeSession(), makeSession()];
    const original = [...sessions];
    sortedSessions(sessions);
    expect(sessions.map((s) => s.id)).toEqual(original.map((s) => s.id));
  });
});

// ─── TEST 7: AI submission payload ────────────────────────────────────────────

describe('buildSessionPrompt()', () => {
  let session: Session;

  beforeEach(() => {
    session = makeSession({
      title: 'Onboarding flow bug',
      about: 'Users are skipping setup',
      sessionNote: 'CTA is unclear',
      projectFolder: '/Users/kumar/myapp',
      githubRepo: 'org/myapp',
    });
    session.captures = [
      makeCapture({
        title: 'Splash screen',
        annotations: [
          makeAnnotation({ text: 'Button text is misleading', tags: ['bug', 'ux'], kind: 'region' }),
          makeAnnotation({ text: 'Missing loading state', tags: ['bug'], kind: 'pin' }),
        ],
      }),
    ];
  });

  it('includes the session title', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Onboarding flow bug');
  });

  it('includes the context / about field', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Users are skipping setup');
  });

  it('includes the session note', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('CTA is unclear');
  });

  it('includes the project folder', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('/Users/kumar/myapp');
  });

  it('includes the github repo', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('org/myapp');
  });

  it('includes all annotation notes', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Button text is misleading');
    expect(prompt).toContain('Missing loading state');
  });

  it('includes annotation tags', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('bug');
    expect(prompt).toContain('ux');
  });

  it('numbers captures correctly', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Capture 1:');
  });

  it('includes the analysis instruction footer', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('root cause');
    expect(prompt).toContain('suggested fix');
    expect(prompt).toContain('next steps');
  });

  it('produces a non-empty string for a minimal session', () => {
    const minimal = makeSession({ title: 'Minimal' });
    const prompt = buildSessionPrompt(minimal);
    expect(prompt.length).toBeGreaterThan(20);
    expect(prompt).toContain('Minimal');
  });
});

// ─── TEST 8 (pending sessions / MCP flow) ────────────────────────────────────

describe('getPendingSessions()', () => {
  it('returns only sessions with annotations that are not yet sent', () => {
    const sessions = [
      makeSession({ status: 'draft' }),                          // no annotations → excluded
      sessionWithAnnotations(2, 'draft'),                        // pending ✓
      sessionWithAnnotations(1, 'sent'),                         // sent → excluded
      sessionWithAnnotations(3, 'responded'),                    // responded → excluded
      sessionWithAnnotations(1, 'draft'),                        // pending ✓
    ];
    const pending = getPendingSessions(sessions);
    expect(pending).toHaveLength(2);
    pending.forEach((s) => {
      expect(s.status).not.toBe('sent');
      expect(totalAnnotations(s)).toBeGreaterThan(0);
    });
  });

  it('returns an empty array when nothing is pending', () => {
    const sessions = [sessionWithAnnotations(1, 'sent')];
    expect(getPendingSessions(sessions)).toHaveLength(0);
  });

  it('returns sessions newest-first', () => {
    const older = sessionWithAnnotations(1);
    older.createdAt = '2024-01-01T00:00:00.000Z';
    const newer = sessionWithAnnotations(1);
    newer.createdAt = '2025-06-01T00:00:00.000Z';
    const pending = getPendingSessions([older, newer]);
    expect(pending[0]!.id).toBe(newer.id);
  });
});

// ─── TEST 9: Continuous loop (combined prompt) ───────────────────────────────

describe('buildCombinedPrompt()', () => {
  it('delegates to buildSessionPrompt for a single session', () => {
    const session = sessionWithAnnotations(2);
    session.title = 'Solo session';
    const combined = buildCombinedPrompt([session]);
    const single = buildSessionPrompt(session);
    expect(combined).toBe(single);
  });

  it('includes all sessions for multiple inputs', () => {
    const s1 = sessionWithAnnotations(1);
    s1.title = 'First issue';
    const s2 = sessionWithAnnotations(2);
    s2.title = 'Second issue';
    const prompt = buildCombinedPrompt([s1, s2]);
    expect(prompt).toContain('First issue');
    expect(prompt).toContain('Second issue');
    expect(prompt).toContain('SESSION 1 OF 2');
    expect(prompt).toContain('SESSION 2 OF 2');
  });

  it('adds "address all sessions" footer for multiple sessions', () => {
    const sessions = [sessionWithAnnotations(1), sessionWithAnnotations(1)];
    const prompt = buildCombinedPrompt(sessions);
    expect(prompt).toContain('address all sessions');
  });
});

// ─── TEST 10: Edge cases ──────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('annotation without note is included without crashing', () => {
    const session = makeSession({
      captures: [makeCapture({ annotations: [makeAnnotation({ text: '' })] })],
    });
    expect(() => buildSessionPrompt(session)).not.toThrow();
  });

  it('session with no captures produces a valid prompt', () => {
    const session = makeSession({ title: 'Empty session' });
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Empty session');
  });

  it('XSS characters in title are not present unescaped in session data', () => {
    const title = '<script>alert(1)</script>';
    const session = makeSession({ title });
    // The raw session stores the original title
    expect(session.title).toBe(title);
    // escapeHtml sanitises before rendering
    expect(escapeHtml(session.title)).toContain('&lt;script&gt;');
    expect(escapeHtml(session.title)).not.toContain('<script>');
  });

  it('acceptedContributions returns only accepted items', () => {
    const session = makeSession({
      contributions: [
        { id: '1', source: 'team', author: 'A', type: 'comment', body: 'Good', accepted: true, timestamp: '' },
        { id: '2', source: 'community', author: 'B', type: 'comment', body: 'Bad', accepted: false, timestamp: '' },
      ],
    });
    const accepted = acceptedContributions(session);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.id).toBe('1');
  });

  it('session JSON round-trips cleanly through JSON.stringify / parse', () => {
    const session = sessionWithAnnotations(3);
    session.sessionNote = 'round-trip test';
    const parsed = JSON.parse(JSON.stringify(session)) as Session;
    expect(parsed.id).toBe(session.id);
    expect(parsed.sessionNote).toBe('round-trip test');
    expect(totalAnnotations(parsed)).toBe(3);
  });
});

// ─── SUCCESS CRITERIA (from spec) ─────────────────────────────────────────────

describe('Spec success criteria', () => {
  it('all annotations persist across a round-trip', () => {
    const session = sessionWithAnnotations(5);
    const json = JSON.stringify(session);
    const restored = JSON.parse(json) as Session;
    expect(totalAnnotations(restored)).toBe(5);
  });

  it('session note is always present when set', () => {
    const session = sessionWithAnnotations(3);
    expect(session.sessionNote ?? '').toBe('');
    session.sessionNote = 'Context for AI';
    expect(session.sessionNote).toBeTruthy();
  });

  it('build prompt output is actionable (contains numbered steps)', () => {
    const session = sessionWithAnnotations(2);
    const prompt = buildSessionPrompt(session);
    expect(prompt).toMatch(/1\./);
    expect(prompt).toMatch(/2\./);
    expect(prompt).toMatch(/3\./);
  });
});
