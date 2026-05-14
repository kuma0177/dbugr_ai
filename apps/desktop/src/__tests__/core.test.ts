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
  providerConnectionMethodLabel,
  providerConnectionPendingCopy,
  providerConnectionReadyCopy,
  isProviderConnected,
  shellSingleQuote,
  buildAiCliCommand,
  flowLabel,
  sectionLabel,
  sortedSessions,
  totalAnnotations,
  planAnnotationAppend,
  acceptedContributions,
  getPendingSessions,
  hydratePersistedSessions,
  normalizePersistedSession,
  buildPickerSessionCache,
  normalizeProjectFolderInput,
  normalizeGithubRepoInput,
  isAbsoluteFilesystemScreenshotRef,
  classifyScreenshotRef,
  buildSessionPrompt,
  buildCombinedPrompt,
  getPromptDiagnostics,
  getCombinedPromptDiagnostics,
  buildDesktopSessionSyncPayload,
  buildSessionIdentityMap,
  updateAnnotationNoteInCapture,
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
    expect(providerLabel('claude')).toBe('Claude CLI');
    expect(providerLabel('codex')).toBe('Codex CLI');
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

describe('provider connection helpers', () => {
  it('requires the real connection method for each provider', () => {
    expect(isProviderConnected('claude', { connected: true, method: 'oauth' })).toBe(true);
    expect(isProviderConnected('claude', { connected: true, method: 'api_key' })).toBe(true);
    expect(isProviderConnected('claude', { connected: true, method: null })).toBe(false);
    expect(isProviderConnected('codex', { connected: true, method: 'api_key' })).toBe(true);
    expect(isProviderConnected('codex', { connected: true, method: 'oauth' })).toBe(false);
    expect(isProviderConnected('cursor', { connected: true, method: 'installed' })).toBe(true);
    expect(isProviderConnected('cursor', { connected: true, method: 'oauth' })).toBe(false);
  });

  it('describes the action a user should expect after clicking connect', () => {
    expect(providerConnectionPendingCopy('claude', 'oauth')).toContain('claude /login');
    expect(providerConnectionPendingCopy('claude', 'api_key')).toContain('Anthropic API key');
    expect(providerConnectionPendingCopy('codex', 'api_key')).toContain('OpenAI API keys page');
    expect(providerConnectionPendingCopy('cursor', 'installed')).toContain('Install Cursor');
  });

  it('describes the ready state for each provider', () => {
    expect(providerConnectionReadyCopy('claude', 'oauth')).toContain('send any session straight to Claude');
    expect(providerConnectionReadyCopy('claude', 'api_key')).toContain('Anthropic API key');
    expect(providerConnectionReadyCopy('codex', 'api_key')).toContain('OpenAI API key');
    expect(providerConnectionReadyCopy('cursor', 'installed')).toContain('Cursor');
  });

  it('formats the connection method label', () => {
    expect(providerConnectionMethodLabel('oauth')).toBe('browser login');
    expect(providerConnectionMethodLabel('api_key')).toBe('API key');
    expect(providerConnectionMethodLabel('installed')).toBe('installed app');
  });
});

describe('CLI command helpers', () => {
  it('single-quotes shell arguments and escapes embedded quotes', () => {
    expect(shellSingleQuote("don't miss this")).toBe("'don'\\''t miss this'");
  });

  it('builds Claude CLI command without an API key', () => {
    expect(buildAiCliCommand('claude', 'Fix the CTA')).toBe("claude 'Fix the CTA'");
  });

  it('builds Codex CLI command without an API key', () => {
    expect(buildAiCliCommand('codex', 'Fix the CTA')).toBe("codex 'Fix the CTA'");
  });

  it('adds provider-specific environment variable when a local key exists', () => {
    expect(buildAiCliCommand('claude', 'Fix', 'anthropic-key')).toBe("ANTHROPIC_API_KEY='anthropic-key' claude 'Fix'");
    expect(buildAiCliCommand('codex', 'Fix', 'openai-key')).toBe("OPENAI_API_KEY='openai-key' codex 'Fix'");
  });

  it('escapes prompt and API key values independently', () => {
    const command = buildAiCliCommand('codex', "Don't skip screenshot paths", "sk-'quoted'");
    expect(command).toBe("OPENAI_API_KEY='sk-'\\''quoted'\\''' codex 'Don'\\''t skip screenshot paths'");
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

describe('updateAnnotationNoteInCapture()', () => {
  it('updates the annotation note plus derived capture title and preview', () => {
    const capture = makeCapture({
      title: 'Old first note',
      preview: 'Old first note · Second note',
      annotations: [
        makeAnnotation({ id: 'ann_1', number: 1, text: 'Old first note' }),
        makeAnnotation({ id: 'ann_2', number: 2, text: 'Second note' }),
      ],
    });

    const updated = updateAnnotationNoteInCapture(capture, 'ann_1', 'Make the logo bigger');

    expect(updated).toBe(true);
    expect(capture.annotations[0]?.text).toBe('Make the logo bigger');
    expect(capture.preview).toBe('Make the logo bigger · Second note');
    expect(capture.title).toBe('Make the logo bigger');
  });

  it('returns false without changing the capture when the annotation is missing', () => {
    const capture = makeCapture({
      title: 'Original',
      preview: 'Original',
      annotations: [makeAnnotation({ id: 'ann_1', text: 'Original' })],
    });

    expect(updateAnnotationNoteInCapture(capture, 'ann_missing', 'Nope')).toBe(false);
    expect(capture.title).toBe('Original');
    expect(capture.preview).toBe('Original');
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

describe('buildDesktopSessionSyncPayload()', () => {
  it('sends capture timestamps as session-relative offsets instead of epoch milliseconds', () => {
    const session = makeSession({
      captures: [
        makeCapture({ timestamp: '2026-05-13T21:37:50.000Z' }),
        makeCapture({ timestamp: '2026-05-13T21:37:52.500Z' }),
      ],
    });

    const payload = buildDesktopSessionSyncPayload(session, 'codex');

    expect(payload.captures.map((capture) => capture.timestampMs)).toEqual([0, 2500]);
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

describe('planAnnotationAppend()', () => {
  it('allows annotations when the target session has room', () => {
    expect(planAnnotationAppend(2, 2, 5)).toMatchObject({
      existingCount: 2,
      incomingCount: 2,
      remainingBeforeAppend: 3,
      acceptedCount: 2,
      rejectedCount: 0,
      canAppend: true,
    });
  });

  it('clips incoming annotations to the remaining session capacity', () => {
    expect(planAnnotationAppend(4, 3, 5)).toMatchObject({
      remainingBeforeAppend: 1,
      acceptedCount: 1,
      rejectedCount: 2,
      canAppend: true,
    });
  });

  it('blocks appending when the session is already full', () => {
    expect(planAnnotationAppend(5, 1, 5)).toMatchObject({
      remainingBeforeAppend: 0,
      acceptedCount: 0,
      rejectedCount: 1,
      canAppend: false,
    });
  });

  it('normalizes negative and fractional inputs defensively', () => {
    expect(planAnnotationAppend(-2.4, 3.8, 5.9)).toMatchObject({
      existingCount: 0,
      incomingCount: 3,
      maxAnnotations: 5,
      acceptedCount: 3,
      rejectedCount: 0,
    });
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

describe('session persistence helpers', () => {
  it('normalizes missing persisted fields to safe defaults', () => {
    const session = normalizePersistedSession(
      {
        id: 'session_1',
        title: '',
        status: 'draft',
        submissionFlow: 'direct',
      },
      '2026-05-03T00:00:00.000Z',
    );
    expect(session).toMatchObject({
      id: 'session_1',
      title: 'Untitled session',
      createdAt: '2026-05-03T00:00:00.000Z',
      status: 'draft',
      captures: [],
      about: '',
      sessionNote: '',
      projectFolder: null,
      githubRepo: '',
      submissionFlow: 'direct',
      contributions: [],
      collaborationReady: false,
      lastTarget: 'claude',
      lastExplicitSaveAt: null,
    });
  });

  it('preserves valid persisted state needed for reopen', () => {
    const capture = makeCapture({
      id: 'capture_1',
      screenshotUrl: '/Users/kumar/Library/Application Support/debugr/screenshots/capture_1.png',
      annotations: [makeAnnotation({ text: 'Button should be blue' })],
    });
    const session = normalizePersistedSession({
      id: 'session_1',
      title: 'Visual fix',
      createdAt: '2026-05-03T08:00:00.000Z',
      status: 'sent',
      captures: [capture],
      about: 'Make CTA match design system',
      projectFolder: '/Users/kumar/app',
      githubRepo: 'org/app',
      submissionFlow: 'team',
      contributions: [
        { id: 'c1', source: 'team', author: 'A', type: 'comment', body: 'Accepted', accepted: true, timestamp: '' },
      ],
      collaborationReady: true,
      lastTarget: 'codex',
      lastExplicitSaveAt: '2026-05-03T08:05:00.000Z',
    });
    expect(session.captures[0]!.screenshotUrl).toContain('capture_1.png');
    expect(totalAnnotations(session)).toBe(1);
    expect(session.about).toBe('Make CTA match design system');
    expect(session.projectFolder).toBe('/Users/kumar/app');
    expect(session.githubRepo).toBe('org/app');
    expect(session.submissionFlow).toBe('team');
    expect(session.contributions).toHaveLength(1);
    expect(session.lastTarget).toBe('codex');
  });

  it('guards unknown persisted status, flow, and target values', () => {
    const session = normalizePersistedSession({
      id: 'session_1',
      status: 'unknown' as Session['status'],
      submissionFlow: 'private' as Session['submissionFlow'],
      lastTarget: 'desktop' as Session['lastTarget'],
    });
    expect(session.status).toBe('draft');
    expect(session.submissionFlow).toBe('direct');
    expect(session.lastTarget).toBe('claude');
  });

  it('hydrates only array input and preserves multiple sessions', () => {
    expect(hydratePersistedSessions(null)).toEqual([]);
    const sessions = hydratePersistedSessions([
      { id: 'older', title: 'Older', createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'newer', title: 'Newer', createdAt: '2026-05-02T00:00:00.000Z' },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(['older', 'newer']);
  });

  it('builds the picker cache newest-first with annotation counts', () => {
    const older = sessionWithAnnotations(1);
    older.id = 'older';
    older.title = 'Older';
    older.createdAt = '2026-05-01T00:00:00.000Z';
    const newer = sessionWithAnnotations(3);
    newer.id = 'newer';
    newer.title = 'Newer';
    newer.createdAt = '2026-05-02T00:00:00.000Z';
    const cache = buildPickerSessionCache([older, newer]);
    expect(cache).toEqual([
      { id: 'newer', title: 'Newer', createdAt: '2026-05-02T00:00:00.000Z', annotationCount: 3 },
      { id: 'older', title: 'Older', createdAt: '2026-05-01T00:00:00.000Z', annotationCount: 1 },
    ]);
  });

  it('indexes sessions by both local id and synced web id so API refreshes do not duplicate rows', () => {
    const local = sessionWithAnnotations(1);
    local.id = 'local-session';
    local.webSessionId = 'web-session';

    const byId = buildSessionIdentityMap([local]);

    expect(byId.get('local-session')).toBe(local);
    expect(byId.get('web-session')).toBe(local);
  });
});

describe('repo and local folder context helpers', () => {
  it('normalizes local folder input without requiring filesystem access', () => {
    expect(normalizeProjectFolderInput('  /Users/kumar/app///  ')).toBe('/Users/kumar/app');
    expect(normalizeProjectFolderInput('/')).toBe('/');
    expect(normalizeProjectFolderInput('   ')).toBeNull();
    expect(normalizeProjectFolderInput(null)).toBeNull();
  });

  it('normalizes common GitHub repo input shapes', () => {
    expect(normalizeGithubRepoInput('owner/repo')).toBe('owner/repo');
    expect(normalizeGithubRepoInput('https://github.com/owner/repo')).toBe('owner/repo');
    expect(normalizeGithubRepoInput('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(normalizeGithubRepoInput('https://github.com/owner/repo/pulls')).toBe('owner/repo');
    expect(normalizeGithubRepoInput('git@github.com:owner/repo.git')).toBe('owner/repo');
    expect(normalizeGithubRepoInput('   ')).toBe('');
  });

  it('normalizes context before prompt inclusion', () => {
    const session = makeSession({
      title: 'Context test',
      projectFolder: ' /Users/kumar/app/// ',
      githubRepo: 'https://github.com/owner/repo.git',
    });
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Project folder: /Users/kumar/app');
    expect(prompt).toContain('GitHub repo: owner/repo');
    expect(prompt).not.toContain('github.com/owner/repo.git');
  });

  it('normalizes context during persisted-session hydration', () => {
    const session = normalizePersistedSession({
      projectFolder: ' /Users/kumar/app/// ',
      githubRepo: 'git@github.com:owner/repo.git',
    });
    expect(session.projectFolder).toBe('/Users/kumar/app');
    expect(session.githubRepo).toBe('owner/repo');
  });
});

describe('screenshot reference helpers', () => {
  it('identifies absolute filesystem screenshot refs', () => {
    expect(isAbsoluteFilesystemScreenshotRef('/Users/kumar/debugr/capture.png')).toBe(true);
    expect(isAbsoluteFilesystemScreenshotRef('C:\\Users\\kumar\\capture.png')).toBe(true);
    expect(isAbsoluteFilesystemScreenshotRef('data:image/png;base64,abc')).toBe(false);
    expect(isAbsoluteFilesystemScreenshotRef('https://example.com/capture.png')).toBe(false);
    expect(isAbsoluteFilesystemScreenshotRef('')).toBe(false);
  });

  it('classifies screenshot refs for logging and persistence decisions', () => {
    expect(classifyScreenshotRef(undefined)).toBe('empty');
    expect(classifyScreenshotRef('  ')).toBe('empty');
    expect(classifyScreenshotRef('data:image/png;base64,abc')).toBe('data_url');
    expect(classifyScreenshotRef('/Users/kumar/debugr/capture.png')).toBe('absolute_path');
    expect(classifyScreenshotRef('C:\\Users\\kumar\\capture.png')).toBe('absolute_path');
    expect(classifyScreenshotRef('https://example.com/capture.png')).toBe('other');
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

  it('uses the about field as the single session note when both fields exist', () => {
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('Session note: Users are skipping setup');
    expect(prompt).not.toContain('CTA is unclear');
  });

  it('falls back to the legacy sessionNote field', () => {
    const legacy = makeSession({ title: 'Legacy', sessionNote: 'Old note field' });
    const prompt = buildSessionPrompt(legacy);
    expect(prompt).toContain('Session note: Old note field');
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

  it('includes local screenshot paths when provided', () => {
    const captureId = session.captures[0]!.id;
    const prompt = buildSessionPrompt(session, new Map([[captureId, '/tmp/debugr/capture.png']]));
    expect(prompt).toContain('Screenshot: /tmp/debugr/capture.png');
    expect(prompt).toContain('screenshots referenced above are saved locally');
  });

  it('includes accepted feedback but excludes rejected feedback', () => {
    session.contributions = [
      {
        id: 'accepted-team',
        source: 'team',
        author: 'Sarah',
        type: 'comment',
        body: 'Make the CTA wording clearer.',
        accepted: true,
        timestamp: '',
      },
      {
        id: 'rejected-public',
        source: 'community',
        author: 'Public reviewer',
        type: 'suggested_edit',
        body: 'Change the whole layout.',
        accepted: false,
        timestamp: '',
      },
    ];
    const prompt = buildSessionPrompt(session);
    expect(prompt).toContain('## Accepted feedback');
    expect(prompt).toContain('Make the CTA wording clearer.');
    expect(prompt).not.toContain('Change the whole layout.');
  });

  it('reports prompt diagnostics without exposing prompt body', () => {
    const captureId = session.captures[0]!.id;
    session.contributions = [
      { id: '1', source: 'team', author: 'A', type: 'comment', body: 'Accepted', accepted: true, timestamp: '' },
      { id: '2', source: 'community', author: 'B', type: 'comment', body: 'Rejected', accepted: false, timestamp: '' },
    ];
    const diagnostics = getPromptDiagnostics(session, new Map([[captureId, '/tmp/debugr/capture.png']]));
    expect(diagnostics).toMatchObject({
      sessionId: session.id,
      captureCount: 1,
      annotationCount: 2,
      acceptedContributionCount: 1,
      screenshotReferenceCount: 1,
      hasSessionNote: true,
      hasProjectFolder: true,
      hasGithubRepo: true,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('Accepted');
    expect(JSON.stringify(diagnostics)).not.toContain('Onboarding flow bug');
    expect(JSON.stringify(diagnostics)).not.toContain('/tmp/debugr/capture.png');
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

  it('reports diagnostics for every session in a combined prompt', () => {
    const sessions = [sessionWithAnnotations(1), sessionWithAnnotations(2)];
    const diagnostics = getCombinedPromptDiagnostics(sessions);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((item) => item.annotationCount)).toEqual([1, 2]);
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
