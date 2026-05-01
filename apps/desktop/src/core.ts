/**
 * Pure, side-effect-free utilities shared between the app and the test suite.
 * No Tauri imports here — safe to import in Node / Vitest.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Target = 'claude' | 'codex' | 'cursor';
export type AppMode = 'welcome' | 'session' | 'confirmation';
export type WorkspaceSection = 'notes' | 'flow' | 'collab' | 'review' | 'submit' | 'insights';
export type SubmissionFlow = 'direct' | 'team' | 'public';

export interface Annotation {
  id: string;
  number: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  kind?: 'pin' | 'region';
  text: string;
  tags: string[];
  timestamp: string;
}

export interface CaptureCard {
  id: string;
  title: string;
  preview: string;
  screenshotUrl?: string;
  annotations: Annotation[];
  timestamp: string;
}

export interface Contribution {
  id: string;
  source: 'team' | 'community';
  author: string;
  type: 'annotation' | 'comment' | 'session_note';
  body: string;
  accepted: boolean;
  timestamp: string;
}

export interface Session {
  id: string;
  title: string;
  captures: CaptureCard[];
  createdAt: string;
  status: 'draft' | 'sent' | 'responded';
  about?: string;
  sessionNote?: string;
  projectFolder?: string | null;
  githubRepo?: string;
  submissionFlow: SubmissionFlow;
  contributions: Contribution[];
  collaborationReady: boolean;
  lastTarget?: Target;
  lastExplicitSaveAt?: string | null;
}

export interface AgentFeedback {
  title: string;
  summary: string;
  rootCause?: string;
  suggestedFix?: string;
  codeSnippet?: string;
  nextSteps: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function escapeHtml(value: string | undefined | null): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function providerLabel(value: Target): string {
  if (value === 'codex') return 'Codex';
  if (value === 'cursor') return 'Cursor';
  return 'Claude';
}

export function providerSubtitle(value: Target): string {
  if (value === 'codex') return 'GPT-4.1 or local CLI';
  if (value === 'cursor') return 'Cursor background agent';
  return 'Anthropic Claude';
}

export function flowLabel(flow: SubmissionFlow): string {
  if (flow === 'team') return 'Team review';
  if (flow === 'public') return 'Public feed';
  return 'Direct to AI';
}

export function sectionLabel(section: WorkspaceSection): string {
  if (section === 'notes') return 'Annotate & note';
  if (section === 'flow') return 'Choose flow';
  if (section === 'collab') return 'Collaborate';
  if (section === 'review') return 'Review & curate';
  if (section === 'submit') return 'Submit';
  return 'Insights';
}

export function sortedSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function totalAnnotations(session: Session): number {
  return session.captures.reduce((count, capture) => count + capture.annotations.length, 0);
}

export function acceptedContributions(session: Session): Contribution[] {
  return session.contributions.filter((item) => item.accepted);
}

export function getPendingSessions(sessions: Session[]): Session[] {
  return sortedSessions(sessions).filter(
    (s) => s.status === 'draft' && totalAnnotations(s) > 0,
  );
}

export function buildSessionPrompt(session: Session): string {
  const lines: string[] = [];
  lines.push(`# Debugr session: ${session.title}`);
  if (session.about) lines.push(`\nContext: ${session.about}`);
  if (session.sessionNote) lines.push(`\nSession note: ${session.sessionNote}`);
  if (session.projectFolder) lines.push(`\nProject folder: ${session.projectFolder}`);
  if (session.githubRepo) lines.push(`\nGitHub repo: ${session.githubRepo}`);

  session.captures.forEach((capture, ci) => {
    lines.push(`\n## Capture ${ci + 1}: ${capture.title || 'Untitled'}`);
    if (capture.preview && capture.preview !== 'No annotation notes yet') {
      lines.push(`Preview: ${capture.preview}`);
    }
    capture.annotations.forEach((ann, ai) => {
      lines.push(`\n  Annotation ${ai + 1} (${ann.kind ?? 'pin'}):`);
      if (ann.text) lines.push(`    Note: ${ann.text}`);
      if (ann.tags?.length) lines.push(`    Tags: ${ann.tags.join(', ')}`);
    });
  });

  lines.push('\n---');
  lines.push('Please analyse the above session and provide:');
  lines.push('1. The likely root cause of the issue');
  lines.push('2. A suggested fix with code if applicable');
  lines.push('3. Concrete next steps');

  return lines.join('\n');
}

export function buildCombinedPrompt(sessions: Session[]): string {
  if (sessions.length === 1) return buildSessionPrompt(sessions[0]!);

  const lines: string[] = [
    `# Debugr — ${sessions.length} pending sessions\n`,
    `You have ${sessions.length} unsent annotation sessions. Please work through each one.\n`,
  ];
  sessions.forEach((session, i) => {
    lines.push(`\n${'='.repeat(60)}`);
    lines.push(`SESSION ${i + 1} OF ${sessions.length}`);
    lines.push('='.repeat(60));
    lines.push(buildSessionPrompt(session));
  });
  lines.push('\n---');
  lines.push('Please address all sessions above in order.');
  return lines.join('\n');
}

// ── Session factory ───────────────────────────────────────────────────────────

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: uid('session'),
    title: 'Untitled session',
    captures: [],
    createdAt: new Date().toISOString(),
    status: 'draft',
    submissionFlow: 'direct',
    contributions: [],
    collaborationReady: false,
    ...overrides,
  };
}

export function makeCapture(overrides: Partial<CaptureCard> = {}): CaptureCard {
  return {
    id: uid('capture'),
    title: 'Untitled capture',
    preview: '',
    annotations: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: uid('ann'),
    number: 1,
    x: 100,
    y: 200,
    kind: 'region',
    text: '',
    tags: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
