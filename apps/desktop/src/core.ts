/**
 * Pure, side-effect-free utilities shared between the app and the test suite.
 * No Tauri imports here — safe to import in Node / Vitest.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Target = 'claude' | 'codex' | 'cursor';
export type AppMode = 'welcome' | 'session' | 'confirmation';
export type WorkspaceSection = 'notes' | 'flow' | 'collab' | 'review' | 'submit' | 'insights';
export type SubmissionFlow = 'direct' | 'team' | 'public';
export type ProviderConnectionMethod = 'oauth' | 'api_key' | 'installed';

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
  webSessionId?: string | null;
  webSyncedAt?: string | null;
  webSyncStatus?: 'idle' | 'syncing' | 'synced' | 'failed';
  webSyncError?: string | null;
}

export interface DesktopSessionSyncPayload {
  localSessionId: string;
  title: string;
  about?: string;
  sessionNote?: string;
  projectFolder?: string | null;
  githubRepo?: string;
  submissionFlow: SubmissionFlow;
  providerTarget?: Target;
  captures: Array<{
    id: string;
    title?: string;
    note?: string;
    screenshotUrl?: string;
    previewDataUrl?: string;
    timestampMs?: number;
    annotations: Array<{
      id: string;
      text?: string;
      type?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>;
  }>;
}

export interface AgentFeedback {
  title: string;
  summary: string;
  rootCause?: string;
  suggestedFix?: string;
  codeSnippet?: string;
  promptText?: string;
  nextSteps: string[];
}

export interface ProviderConnectionState {
  connected: boolean;
  method: ProviderConnectionMethod | null;
  lastConnectedAt?: string;
}

export interface PickerSessionCacheItem {
  id: string;
  title: string;
  createdAt: string;
  annotationCount: number;
}

export interface AnnotationAppendPlan {
  existingCount: number;
  incomingCount: number;
  maxAnnotations: number;
  remainingBeforeAppend: number;
  acceptedCount: number;
  rejectedCount: number;
  canAppend: boolean;
}

export type ScreenshotRefKind = 'empty' | 'data_url' | 'absolute_path' | 'other';

export interface PromptDiagnostics {
  sessionId: string;
  captureCount: number;
  annotationCount: number;
  acceptedContributionCount: number;
  screenshotReferenceCount: number;
  hasSessionNote: boolean;
  hasProjectFolder: boolean;
  hasGithubRepo: boolean;
}

export type PromptReceiptItemState = 'ready' | 'attention' | 'neutral';

export interface PromptReceiptItem {
  icon: string;
  label: string;
  detail: string;
  confirmation: string;
  state: PromptReceiptItemState;
}

export interface PromptReceipt {
  headline: string;
  summary: string;
  modeLabel: string;
  destinationLabel: string;
  items: PromptReceiptItem[];
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
  if (value === 'codex') return 'Codex CLI';
  if (value === 'cursor') return 'Cursor';
  return 'Claude CLI';
}

export function providerSubtitle(value: Target): string {
  if (value === 'codex') return 'Terminal handoff with your OpenAI API key';
  if (value === 'cursor') return 'Open Cursor and paste the prompt';
  return 'Terminal handoff through the Claude CLI';
}

export function providerConnectionMethodLabel(method: ProviderConnectionMethod | null): string {
  if (method === 'oauth') return 'browser login';
  if (method === 'api_key') return 'API key';
  if (method === 'installed') return 'installed app';
  return 'connection';
}

export function isProviderConnected(
  provider: Target,
  connection: ProviderConnectionState | null | undefined,
): boolean {
  if (!connection?.connected) return false;
  if (provider === 'claude') return connection.method === 'oauth' || connection.method === 'api_key';
  if (provider === 'codex') return connection.method === 'api_key';
  return connection.method === 'installed';
}

export function providerConnectionPendingCopy(
  provider: Target,
  method: ProviderConnectionMethod,
): string {
  if (provider === 'claude' && method === 'api_key') {
    return 'Paste your Anthropic API key below and click Verify & Save. Dbugr verifies it before saving it locally, then uses Claude CLI in Terminal when you send.';
  }
  if (provider === 'claude') {
    return 'Dbugr will open a Terminal window and run `claude /login`. Finish the Claude CLI login flow, then click Done to verify it worked.';
  }
  if (provider === 'codex') {
    return 'Open the OpenAI API keys page, then paste your key below and click Verify & Save. When you send, Dbugr will launch Codex CLI in Terminal.';
  }
  return 'Install Cursor to open the project in Cursor and paste the session prompt there. No API key is required.';
}

export function providerConnectionReadyCopy(
  provider: Target,
  method: ProviderConnectionMethod | null,
): string {
  if (provider === 'claude' && method === 'api_key') {
    return 'Your Anthropic API key is stored locally on this Mac. When you click Send, Dbugr will open Claude CLI in Terminal and hand off the session there.';
  }
  if (provider === 'claude') {
    return 'You can now send any session straight to Claude CLI from the Submit tab. Terminal will open, Claude CLI will read your screenshots and annotations, and reply with a diagnosis.';
  }
  if (provider === 'codex') {
    return 'Your OpenAI API key is stored locally on this Mac. When you click Send, Dbugr will open Codex CLI in Terminal and hand off the session there.';
  }
  return 'No login needed. Dbugr will open Cursor.app and copy the session prompt so you can paste it into chat. No CLI window opens for Cursor.';
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAiCliCommand(
  cliName: 'claude' | 'codex',
  prompt: string,
  apiKey = '',
): string {
  const promptArg = shellSingleQuote(prompt);
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return `${cliName} ${promptArg}`;
  const envName = cliName === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  return `${envName}=${shellSingleQuote(trimmedKey)} ${cliName} ${promptArg}`;
}

export function flowLabel(flow: SubmissionFlow): string {
  if (flow === 'team') return 'Team review';
  if (flow === 'public') return 'Public feed';
  return 'Direct to AI';
}

export function sectionLabel(section: WorkspaceSection): string {
  if (section === 'notes') return 'Capture context';
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

export function planAnnotationAppend(
  existingCount: number,
  incomingCount: number,
  maxAnnotations = 5,
): AnnotationAppendPlan {
  const safeExisting = Math.max(0, Math.trunc(existingCount));
  const safeIncoming = Math.max(0, Math.trunc(incomingCount));
  const safeMax = Math.max(0, Math.trunc(maxAnnotations));
  const remainingBeforeAppend = Math.max(0, safeMax - safeExisting);
  const acceptedCount = Math.min(safeIncoming, remainingBeforeAppend);
  return {
    existingCount: safeExisting,
    incomingCount: safeIncoming,
    maxAnnotations: safeMax,
    remainingBeforeAppend,
    acceptedCount,
    rejectedCount: safeIncoming - acceptedCount,
    canAppend: acceptedCount > 0,
  };
}

export function acceptedContributions(session: Session): Contribution[] {
  return session.contributions.filter((item) => item.accepted);
}

export function getPendingSessions(sessions: Session[]): Session[] {
  return sortedSessions(sessions).filter(
    (s) => s.status === 'draft' && totalAnnotations(s) > 0,
  );
}

export function normalizeProjectFolderInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === '/') return trimmed;
  return trimmed.replace(/\/+$/g, '');
}

export function normalizeGithubRepoInput(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  const httpsMatch = trimmed.match(/github\.com[:/]([^/\s]+\/[^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+\/[^/\s#?]+?)(?:\.git)?$/i);
  const raw = httpsMatch?.[1] ?? sshMatch?.[1] ?? trimmed;
  return raw.replace(/\.git$/i, '').replace(/\/+$/g, '');
}

export function isAbsoluteFilesystemScreenshotRef(ref: string | null | undefined): boolean {
  const trimmed = ref?.trim();
  if (!trimmed || trimmed.startsWith('data:')) return false;
  return trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
}

export function classifyScreenshotRef(ref: string | null | undefined): ScreenshotRefKind {
  const trimmed = ref?.trim();
  if (!trimmed) return 'empty';
  if (trimmed.startsWith('data:image/')) return 'data_url';
  if (isAbsoluteFilesystemScreenshotRef(trimmed)) return 'absolute_path';
  return 'other';
}

export function normalizePersistedSession(
  session: Partial<Session>,
  fallbackCreatedAt = new Date().toISOString(),
): Session {
  return {
    id: session.id ?? uid('session'),
    title: session.title || 'Untitled session',
    createdAt: session.createdAt || fallbackCreatedAt,
    status: session.status === 'responded' || session.status === 'sent' ? session.status : 'draft',
    captures: Array.isArray(session.captures) ? session.captures : [],
    about: session.about ?? '',
    sessionNote: session.sessionNote ?? '',
    projectFolder: normalizeProjectFolderInput(session.projectFolder),
    githubRepo: normalizeGithubRepoInput(session.githubRepo),
    submissionFlow: session.submissionFlow === 'team' || session.submissionFlow === 'public' ? session.submissionFlow : 'direct',
    contributions: Array.isArray(session.contributions) ? session.contributions : [],
    collaborationReady: Boolean(session.collaborationReady),
    lastTarget: session.lastTarget === 'codex' || session.lastTarget === 'cursor' ? session.lastTarget : 'claude',
    lastExplicitSaveAt: session.lastExplicitSaveAt ?? null,
    webSessionId: session.webSessionId ?? null,
    webSyncedAt: session.webSyncedAt ?? null,
    webSyncStatus: session.webSyncStatus === 'syncing' || session.webSyncStatus === 'synced' || session.webSyncStatus === 'failed'
      ? session.webSyncStatus
      : 'idle',
    webSyncError: session.webSyncError ?? null,
  };
}

export function hydratePersistedSessions(input: unknown): Session[] {
  if (!Array.isArray(input)) return [];
  return input.map((session) => normalizePersistedSession(session as Partial<Session>));
}

export function buildPickerSessionCache(sessions: Session[]): PickerSessionCacheItem[] {
  return sortedSessions(sessions).map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    annotationCount: totalAnnotations(session),
  }));
}

export function buildSessionIdentityMap(sessions: Session[]): Map<string, Session> {
  const byId = new Map<string, Session>();
  for (const session of sessions) {
    byId.set(session.id, session);
    if (session.webSessionId) byId.set(session.webSessionId, session);
  }
  return byId;
}

/**
 * Build a structured plain-text prompt from a session.
 *
 * @param session       The session to build a prompt for.
 * @param screenshotPaths  Optional map of captureId → absolute file path of the
 *                         saved screenshot PNG.  When provided, each capture
 *                         section includes a `Screenshot:` line so the AI CLI
 *                         can view the image using its file-reading tools.
 */
export function buildSessionPrompt(
  session: Session,
  screenshotPaths: Map<string, string> = new Map(),
): string {
  const lines: string[] = [];
  const sessionNote = session.about?.trim() || session.sessionNote?.trim();
  const projectFolder = normalizeProjectFolderInput(session.projectFolder);
  const githubRepo = normalizeGithubRepoInput(session.githubRepo);
  lines.push(`# Dbugr session: ${session.title}`);
  if (sessionNote) lines.push(`\nSession note: ${sessionNote}`);
  if (projectFolder) lines.push(`\nProject folder: ${projectFolder}`);
  if (githubRepo) lines.push(`\nGitHub repo: ${githubRepo}`);

  session.captures.forEach((capture, ci) => {
    const captureTitle = capture.title?.trim() || 'Untitled';
    const capturePreview = capture.preview?.trim() || '';
    lines.push(`\n## Capture ${ci + 1}: ${captureTitle}`);
    if (
      capturePreview
      && capturePreview !== 'No annotation notes yet'
      && capturePreview !== captureTitle
    ) {
      lines.push(`Preview: ${capture.preview}`);
    }
    const shotPath = screenshotPaths.get(capture.id);
    if (shotPath) {
      lines.push(`Screenshot: ${shotPath}`);
    }
    capture.annotations.forEach((ann, ai) => {
      lines.push(`\n  Annotation ${ai + 1} (${ann.kind ?? 'pin'}):`);
      if (ann.text) lines.push(`    Note: ${ann.text}`);
      if (ann.tags?.length) lines.push(`    Tags: ${ann.tags.join(', ')}`);
    });
  });

  const accepted = acceptedContributions(session);
  if (accepted.length > 0) {
    lines.push('\n## Accepted feedback');
    accepted.forEach((item, index) => {
      const source = item.source === 'community' ? 'Public' : 'Team';
      const type = item.type.replaceAll('_', ' ');
      lines.push(`\n  Feedback ${index + 1} (${source} ${type} from ${item.author}):`);
      lines.push(`    ${item.body}`);
    });
  }

  lines.push('\n---');
  lines.push('Please analyse the above session and provide:');
  lines.push('1. The likely root cause of the issue');
  lines.push('2. A suggested fix with code if applicable');
  lines.push('3. Concrete next steps');
  if (screenshotPaths.size > 0) {
    lines.push('\nThe screenshots referenced above are saved locally — please read them to understand the visual context.');
  }

  return lines.join('\n');
}

export function getPromptDiagnostics(
  session: Session,
  screenshotPaths: Map<string, string> = new Map(),
): PromptDiagnostics {
  const screenshotReferenceCount = session.captures.reduce((count, capture) => {
    return count + (screenshotPaths.has(capture.id) ? 1 : 0);
  }, 0);

  return {
    sessionId: session.id,
    captureCount: session.captures.length,
    annotationCount: totalAnnotations(session),
    acceptedContributionCount: acceptedContributions(session).length,
    screenshotReferenceCount,
    hasSessionNote: Boolean(session.about?.trim() || session.sessionNote?.trim()),
    hasProjectFolder: Boolean(normalizeProjectFolderInput(session.projectFolder)),
    hasGithubRepo: Boolean(normalizeGithubRepoInput(session.githubRepo)),
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildPromptReceipt(
  session: Session,
  provider: Target,
  screenshotPaths: Map<string, string> = new Map(),
): PromptReceipt {
  const diagnostics = getPromptDiagnostics(session, screenshotPaths);
  const destinationLabel = providerLabel(provider);
  const modeLabel = flowLabel(session.submissionFlow);
  const contextParts = [
    diagnostics.hasSessionNote ? 'note' : '',
    diagnostics.hasProjectFolder ? 'folder' : '',
    diagnostics.hasGithubRepo ? 'repo' : '',
  ].filter(Boolean);
  const hasRepoContext = diagnostics.hasProjectFolder || diagnostics.hasGithubRepo;
  const screenshotDetail = diagnostics.screenshotReferenceCount > 0
    ? `${pluralize(diagnostics.captureCount, 'capture')} with ${pluralize(diagnostics.screenshotReferenceCount, 'saved screenshot path')}`
    : `${pluralize(diagnostics.captureCount, 'capture')} ready to review`;

  return {
    headline: `Ready for ${destinationLabel}`,
    summary: `${modeLabel} receipt for the exact prompt Dbugr will hand off.`,
    modeLabel,
    destinationLabel,
    items: [
      {
        icon: '📸',
        label: 'Screens',
        detail: screenshotDetail,
        confirmation: diagnostics.screenshotReferenceCount > 0
          ? 'Screenshot files are saved locally and referenced in the handoff prompt.'
          : 'Captured screens are part of this session. Review payload to save local screenshot paths before sending.',
        state: diagnostics.captureCount > 0 ? 'ready' : 'attention',
      },
      {
        icon: '✍️',
        label: 'Markup',
        detail: `${pluralize(diagnostics.annotationCount, 'annotation')} included`,
        confirmation: diagnostics.annotationCount > 0
          ? 'Annotation notes and tags are included in the prompt.'
          : 'Add at least one annotation so the agent knows what changed.',
        state: diagnostics.annotationCount > 0 ? 'ready' : 'attention',
      },
      {
        icon: '🧠',
        label: 'Context',
        detail: contextParts.length > 0
          ? `${contextParts.join(' + ')} attached`
          : 'Add a session note or repo context for stronger AI output',
        confirmation: contextParts.length > 0
          ? 'Session context is attached so the agent gets the why, not just the screenshot.'
          : 'Optional context is missing. Add a note, folder, or repo when the agent needs more background.',
        state: contextParts.length > 0 ? 'ready' : 'attention',
      },
      {
        icon: '🗂️',
        label: 'Repo signal',
        detail: hasRepoContext ? 'Agent can orient around the linked codebase' : 'No folder or GitHub repo attached yet',
        confirmation: hasRepoContext
          ? 'Repo context is included so the agent can connect visual feedback to code.'
          : 'This prompt can still be sent, but the agent will not receive repo context.',
        state: hasRepoContext ? 'ready' : 'neutral',
      },
      {
        icon: provider === 'cursor' ? '📋' : '🚀',
        label: 'Handoff',
        detail: provider === 'cursor'
          ? 'Copies prompt for Cursor chat'
          : `Launches ${destinationLabel} with this prompt`,
        confirmation: provider === 'cursor'
          ? 'Dbugr will copy the prompt and open Cursor. Paste it into Cursor chat to continue.'
          : `Dbugr will open ${destinationLabel} and pass the reviewed prompt to the CLI.`,
        state: 'ready',
      },
    ],
  };
}

export function getCombinedPromptDiagnostics(
  sessions: Session[],
  screenshotPaths: Map<string, string> = new Map(),
): PromptDiagnostics[] {
  return sessions.map((session) => getPromptDiagnostics(session, screenshotPaths));
}

export function buildCombinedPrompt(
  sessions: Session[],
  screenshotPaths: Map<string, string> = new Map(),
): string {
  if (sessions.length === 1) return buildSessionPrompt(sessions[0]!, screenshotPaths);

  const lines: string[] = [
    `# Dbugr — ${sessions.length} pending sessions\n`,
    `You have ${sessions.length} unsent annotation sessions. Please work through each one.\n`,
  ];
  sessions.forEach((session, i) => {
    lines.push(`\n${'='.repeat(60)}`);
    lines.push(`SESSION ${i + 1} OF ${sessions.length}`);
    lines.push('='.repeat(60));
    lines.push(buildSessionPrompt(session, screenshotPaths));
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
    webSessionId: null,
    webSyncedAt: null,
    webSyncStatus: 'idle',
    webSyncError: null,
    ...overrides,
  };
}

export function buildDesktopSessionSyncPayload(
  session: Session,
  providerTarget?: Target,
): DesktopSessionSyncPayload {
  const firstCaptureTimestampMs = session.captures
    .map((capture) => new Date(capture.timestamp).getTime())
    .find((timestampMs) => Number.isFinite(timestampMs)) ?? 0;

  return {
    localSessionId: session.id,
    title: session.title,
    about: session.about || undefined,
    sessionNote: session.sessionNote || undefined,
    projectFolder: session.projectFolder ?? undefined,
    githubRepo: session.githubRepo || undefined,
    submissionFlow: session.submissionFlow,
    providerTarget: providerTarget ?? session.lastTarget,
    captures: session.captures.map((capture, index) => {
      const screenshotUrl = capture.screenshotUrl?.startsWith('data:image/')
        ? undefined
        : capture.screenshotUrl;
      const previewDataUrl = capture.screenshotUrl?.startsWith('data:image/')
        ? capture.screenshotUrl
        : undefined;

      return {
        id: capture.id,
        title: capture.title,
        note: capture.preview,
        screenshotUrl,
        previewDataUrl,
        timestampMs: Number.isFinite(new Date(capture.timestamp).getTime())
          ? Math.max(0, new Date(capture.timestamp).getTime() - firstCaptureTimestampMs)
          : index,
        annotations: capture.annotations.map((annotation) => ({
          id: annotation.id,
          text: annotation.text,
          type: annotation.kind,
          x: annotation.x,
          y: annotation.y,
          width: annotation.width,
          height: annotation.height,
        })),
      };
    }),
  };
}

export function updateAnnotationNoteInCapture(
  capture: CaptureCard,
  annotationId: string,
  nextText: string,
) {
  const annotation = capture.annotations.find((item) => item.id === annotationId);
  if (!annotation) return false;

  annotation.text = nextText;
  capture.preview = capture.annotations
    .map((item) => item.text)
    .filter(Boolean)
    .join(' · ') || 'No annotation notes yet';
  capture.title = capture.annotations.find((item) => item.text.trim())?.text.slice(0, 40) || 'Untitled capture';
  return true;
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
