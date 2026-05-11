import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen, emit } from '@tauri-apps/api/event';
import './index.css';
import {
  type Target,
  type WorkspaceSection,
  type SubmissionFlow,
  type Session,
  type CaptureCard,
  type Annotation,
  type Contribution,
  type AgentFeedback,
  type ProviderConnectionState,
  type ProviderConnectionMethod,
  uid,
  escapeHtml,
  providerLabel,
  providerSubtitle,
  providerConnectionPendingCopy,
  providerConnectionReadyCopy,
  isProviderConnected,
  flowLabel,
  sectionLabel,
  sortedSessions as sortedSessionsUtil,
  totalAnnotations,
  acceptedContributions,
  getPendingSessions,
  hydratePersistedSessions,
  buildPickerSessionCache,
  normalizeProjectFolderInput,
  normalizeGithubRepoInput,
  isAbsoluteFilesystemScreenshotRef,
  classifyScreenshotRef,
  planAnnotationAppend,
  buildSessionPrompt,
  buildCombinedPrompt,
  getPromptDiagnostics,
  getCombinedPromptDiagnostics,
  buildAiCliCommand,
  buildDesktopSessionSyncPayload,
} from './core';

/** Image URL suitable for `<img src>` — Tauri cannot load raw POSIX paths without conversion. */
function screenshotImgSrc(ref?: string): string | undefined {
  const trimmed = ref?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image/')) return trimmed;
  if (isAbsoluteFilesystemScreenshotRef(trimmed)) {
    const cached = screenshotFileDataUrlCache.get(trimmed);
    if (cached) return cached;
    void ensureScreenshotFileDataUrl(trimmed);
    return undefined;
  }
  return trimmed;
}

function captureDashboardImgSrc(capture?: CaptureCard): string | undefined {
  const screenshotUrl = capture?.screenshotUrl?.trim();
  return screenshotUrl ? screenshotImgSrc(screenshotUrl) : undefined;
}

const brandIconUrl = new URL('./assets/brand-icon.png', import.meta.url).href;
const logoClaudeUrl = new URL('./assets/logo-claude.png', import.meta.url).href;
const logoCodexUrl = new URL('./assets/logo-codex.png', import.meta.url).href;
const logoCursorUrl = new URL('./assets/logo-cursor.png', import.meta.url).href;

type AppMode = 'welcome' | 'session' | 'confirmation';

interface AuthState {
  authenticated: boolean;
  profileInitialized: boolean;
  name: string;
  email: string;
  avatarInitials: string;
  company: string;
  role: string;
}

interface PersistedState {
  sessions: Session[];
  authState: AuthState;
  providerConnections: Record<Target, ProviderConnectionState>;
  target: Target;
  deletedSessionIds?: string[];
}

interface DesktopLinkProfile {
  userId: string;
  userEmail: string;
  userName: string;
  organizationId: string;
  organizationName: string;
  apiBaseUrl: string;
  appUrl?: string;
  linkedAt: string;
  deviceId: string;
}

const DEFAULT_API = 'http://127.0.0.1:3001/api';
const WEB_APP_URL = (import.meta.env.VITE_DEBUGR_WEB_APP_URL as string | undefined)?.trim() || 'http://localhost:3000';
const API_BASE_URL_KEY = 'debugr-desktop-api-base-url';
const DESKTOP_LINK_PROFILE_KEY = 'debugr-desktop-link-profile';
const DESKTOP_DEVICE_ID_KEY = 'debugr-desktop-device-id';
const APP_STATE_KEY = 'debugr-desktop-v2-state';
const MAX_ANNOTATIONS = 5;
const UI_LOG_PREFIX = '[debugr-ui]';
const SCREENSHOT_SUPPORT_ROLLOUT_AT = new Date('2026-05-01T11:00:00-07:00').getTime();
const PERSIST_MIRROR_DEBOUNCE_MS = 250;
const SESSION_API_REFRESH_INTERVAL_MS = 10_000;
const PERMISSION_REFRESH_INTERVAL_MS = 15_000;
const LOADING_INDICATOR_DELAY_MS = 500;

let appMode: AppMode = 'welcome';
let sessions: Session[] = [];
let deletedSessionIds = new Set<string>();
let activeSessionId: string | null = null;
let activeCaptureId: string | null = null;
let activeAnnotationId: string | null = null;
let activePreviewCaptureId: string | null = null;
let workspaceSection: WorkspaceSection = 'notes';
let target: Target = 'claude';
let feedback: AgentFeedback | null = null;
let isSending = false;
let isAuthenticating = false;
let contextToggles = { consoleLogs: true, networkLogs: true, environmentInfo: true };
let lastSavedCapture: { sessionId: string; sessionTitle: string; annotationCount: number; totalSessionAnnotations: number } | null = null;
/** Inline validation when Send is blocked (e.g. missing session note). */
let submitGateError = '';
/** Stored Codex API key (loaded from disk on startup). */
let codexApiKey = '';
let claudeApiKey = '';
/** Whether the user has completed Claude login (stored on disk). */
let claudeConnected = false;
/** true while connect-claude terminal is open and we're waiting for confirmation */
let claudeConnecting = false;
let claudeConnectMode: ProviderConnectionMethod = 'oauth';
/** true after "Connect Codex" is clicked — shows the key-paste step */
let codexConnecting = false;
let codexConnectMode: ProviderConnectionMethod = 'api_key';
/** true if Cursor.app is found on disk (checked at startup) */
let cursorInstalled = false;
/** Verification error shown below the connect card */
let connectVerifyError = '';
let providerRecheckError = '';
const screenshotFileDataUrlCache = new Map<string, string>();
const screenshotFileLoadsInFlight = new Set<string>();
let screenshotCacheRefreshQueued = false;
let persistMirrorsTimer: number | null = null;
let sessionsApiLoadInFlight: Promise<void> | null = null;
let lastSessionsApiLoadAt = 0;
let pendingSessionSwitchId: string | null = null;
let pendingFlowSelection: SubmissionFlow | null = null;
let visiblePendingSessionSwitchId: string | null = null;
let pendingSessionSwitchTimer: number | null = null;
let visiblePendingFlowSelection: SubmissionFlow | null = null;
let pendingFlowSelectionTimer: number | null = null;
let showSendLoadingIndicator = false;
let sendLoadingTimer: number | null = null;
let promptPreviewPreparing = false;
let promptPreviewState: {
  sessionId: string;
  target: Target;
  fingerprint: string;
  prompt: string;
  screenshotPaths: Map<string, string>;
  generatedAt: string;
} | null = null;
let permissionCheckInFlight: Promise<void> | null = null;
let lastPermissionCheckAt = 0;
let lastPermissionMarkup = '';
let lastPermissionClassName = 'perm-note';
let lastPermissionExecutablePath = '';
let lastSuccessfulScreenCaptureAt = 0;
let permissionAttentionMessage = '';
let authState: AuthState = {
  authenticated: false,
  profileInitialized: false,
  name: 'Kumar',
  email: 'kumar@example.com',
  avatarInitials: 'KU',
  company: '',
  role: '',
};
let providerConnections: Record<Target, ProviderConnectionState> = {
  claude: { connected: false, method: null },
  codex: { connected: false, method: null },
  cursor: { connected: false, method: null },
};

const win = getCurrentWindow();
const app = document.querySelector<HTMLDivElement>('#app')!;

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function apiBaseUrl() {
  return localStorage.getItem(API_BASE_URL_KEY) || DEFAULT_API;
}

function desktopWebAuthUrl() {
  const url = new URL('/onboarding', WEB_APP_URL);
  url.searchParams.set('desktop', '1');
  url.searchParams.set('flow', 'sign-in');
  url.searchParams.set('source', 'desktop');
  return url.toString();
}

function getDesktopDeviceId() {
  const existing = localStorage.getItem(DESKTOP_DEVICE_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(DESKTOP_DEVICE_ID_KEY, next);
  return next;
}

function saveDesktopLinkProfile(profile: DesktopLinkProfile) {
  localStorage.setItem(DESKTOP_LINK_PROFILE_KEY, JSON.stringify(profile));
  localStorage.setItem(API_BASE_URL_KEY, profile.apiBaseUrl);
}

function readDesktopLinkProfile(): DesktopLinkProfile | null {
  const raw = localStorage.getItem(DESKTOP_LINK_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DesktopLinkProfile;
  } catch {
    localStorage.removeItem(DESKTOP_LINK_PROFILE_KEY);
    return null;
  }
}

function scheduleScreenshotCacheRefresh() {
  if (screenshotCacheRefreshQueued) return;
  screenshotCacheRefreshQueued = true;
  queueMicrotask(() => {
    screenshotCacheRefreshQueued = false;
    render();
  });
}

async function ensureScreenshotFileDataUrl(path: string) {
  const trimmed = path.trim();
  if (!trimmed || screenshotFileDataUrlCache.has(trimmed) || screenshotFileLoadsInFlight.has(trimmed)) return;
  screenshotFileLoadsInFlight.add(trimmed);
  try {
    const dataUrl = await invoke<string>('load_screenshot_data_url', { path: trimmed });
    screenshotFileDataUrlCache.set(trimmed, dataUrl);
    logUi('workspace_screenshot_file_loaded', {
      pathChars: trimmed.length,
      dataUrlChars: dataUrl.length,
    });
    scheduleScreenshotCacheRefresh();
  } catch (error) {
    const fallback = convertFileSrc(trimmed);
    screenshotFileDataUrlCache.set(trimmed, fallback);
    logUi('workspace_screenshot_file_load_failed', {
      pathChars: trimmed.length,
      error: String(error).slice(0, 300),
      fallbackChars: fallback.length,
    });
    scheduleScreenshotCacheRefresh();
  } finally {
    screenshotFileLoadsInFlight.delete(trimmed);
  }
}

function logUi(event: string, details: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString();
  try {
    console.info(`${UI_LOG_PREFIX} ${stamp} ${event}`, details);
  } catch {
    console.info(`${UI_LOG_PREFIX} ${stamp} ${event}`);
  }
  const serialized = Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  void invoke('append_overlay_debug_log', {
    scope: 'workspace',
    message: `[${stamp}] ${event}${serialized ? ` ${serialized}` : ''}`,
  }).catch(() => {});
}

function activeSession() {
  return sessions.find((session) => session.id === activeSessionId);
}

function activeCapture() {
  return activeSession()?.captures.find((capture) => capture.id === activeCaptureId);
}

function activeAnnotation() {
  const capture = activeCapture();
  if (!capture) return undefined;
  if (activeAnnotationId) {
    const selected = capture.annotations.find((annotation) => annotation.id === activeAnnotationId);
    if (selected) return selected;
  }
  return capture.annotations[0];
}

function activePreviewCapture() {
  const session = activeSession();
  if (!session || !activePreviewCaptureId) return undefined;
  return session.captures.find((capture) => capture.id === activePreviewCaptureId);
}

function sessionLevelNote(session: Session): string {
  return session.about?.trim() || session.sessionNote?.trim() || '';
}

function promptPreviewFingerprint(session: Session, provider: Target): string {
  return JSON.stringify({
    provider,
    title: session.title,
    about: session.about ?? '',
    sessionNote: session.sessionNote ?? '',
    projectFolder: normalizeProjectFolderInput(session.projectFolder),
    githubRepo: normalizeGithubRepoInput(session.githubRepo),
    captures: session.captures.map((capture) => ({
      id: capture.id,
      title: capture.title,
      preview: capture.preview,
      screenshotUrl: capture.screenshotUrl ?? '',
      annotations: capture.annotations.map((annotation) => ({
        id: annotation.id,
        kind: annotation.kind ?? 'pin',
        text: annotation.text,
        tags: annotation.tags,
      })),
    })),
    acceptedContributionIds: acceptedContributions(session).map((item) => item.id),
  });
}

function currentPromptPreview(session: Session) {
  const fingerprint = promptPreviewFingerprint(session, target);
  if (
    promptPreviewState?.sessionId === session.id
    && promptPreviewState.target === target
    && promptPreviewState.fingerprint === fingerprint
  ) {
    return promptPreviewState;
  }
  return null;
}

function invalidatePromptPreview(sessionId?: string) {
  if (!promptPreviewState) return;
  if (!sessionId || promptPreviewState.sessionId === sessionId) {
    promptPreviewState = null;
  }
}

function sandclockMarkup(label: string) {
  return `<span class="sandclock-inline"><span class="sandclock-spinner" aria-hidden="true">⌛</span><span>${label}</span></span>`;
}

function loadingDots(label: string) {
  return sandclockMarkup(`${label}…`);
}

function clearPendingSessionSwitchIndicator() {
  if (pendingSessionSwitchTimer !== null) {
    window.clearTimeout(pendingSessionSwitchTimer);
    pendingSessionSwitchTimer = null;
  }
  visiblePendingSessionSwitchId = null;
}

function schedulePendingSessionSwitchIndicator(sessionId: string) {
  clearPendingSessionSwitchIndicator();
  pendingSessionSwitchTimer = window.setTimeout(() => {
    pendingSessionSwitchTimer = null;
    if (pendingSessionSwitchId === sessionId) {
      visiblePendingSessionSwitchId = sessionId;
      if (appMode === 'welcome') {
        renderWelcome();
      } else {
        renderSessionList();
      }
    }
  }, LOADING_INDICATOR_DELAY_MS);
}

function clearSendLoadingIndicator() {
  if (sendLoadingTimer !== null) {
    window.clearTimeout(sendLoadingTimer);
    sendLoadingTimer = null;
  }
  showSendLoadingIndicator = false;
}

function scheduleSendLoadingIndicator() {
  clearSendLoadingIndicator();
  sendLoadingTimer = window.setTimeout(() => {
    sendLoadingTimer = null;
    if (isSending) {
      showSendLoadingIndicator = true;
      renderWorkspacePanel();
    }
  }, LOADING_INDICATOR_DELAY_MS);
}

function clearPendingFlowSelectionIndicator() {
  if (pendingFlowSelectionTimer !== null) {
    window.clearTimeout(pendingFlowSelectionTimer);
    pendingFlowSelectionTimer = null;
  }
  visiblePendingFlowSelection = null;
}

function schedulePendingFlowSelectionIndicator(flow: SubmissionFlow) {
  clearPendingFlowSelectionIndicator();
  pendingFlowSelectionTimer = window.setTimeout(() => {
    pendingFlowSelectionTimer = null;
    if (pendingFlowSelection === flow) {
      visiblePendingFlowSelection = flow;
      renderWorkspacePanel();
    }
  }, LOADING_INDICATOR_DELAY_MS);
}

function refreshSessionMetaDisplay(session: Session) {
  const meta = document.getElementById('session-meta-display');
  if (!meta) return;
  meta.textContent = `${fmtDate(session.createdAt)} · ${fmtTime(session.createdAt)} · ${flowLabel(session.submissionFlow)} · ${buildStatusCopy(session)}`;
}

function providerLogoUrl(provider: Target) {
  if (provider === 'claude') return logoClaudeUrl;
  if (provider === 'codex') return logoCodexUrl;
  return logoCursorUrl;
}

function overlayLaunchForSession(session: Session | undefined) {
  return session
    ? {
        targetSessionId: session.id,
        newSessionName: session.title,
        newSessionAbout: session.about ?? '',
        localFolder: session.projectFolder ?? null,
        githubRepo: session.githubRepo ?? '',
        skipPicker: true,
      }
    : null;
}

function bindPermissionNoteActions(executablePath: string) {
  document.getElementById('repair-screen-permission-btn')?.addEventListener('click', async () => {
    const button = document.getElementById('repair-screen-permission-btn') as HTMLButtonElement | null;
    const previous = button?.textContent ?? 'Repair Screen Recording & retry';
    if (button) {
      button.disabled = true;
      button.textContent = 'Repairing…';
    }
    try {
      const result = await invoke<{
        effectiveGranted: boolean;
        message: string;
      }>('repair_screen_capture_permission');
      permissionAttentionMessage = result.message || '';
      lastPermissionMarkup = '';
      await checkPermission();
      if (result.effectiveGranted) {
        await invoke('show_overlay', { launch: overlayLaunchForSession(activeSession()) });
      }
    } catch (error) {
      permissionAttentionMessage = `Debugr could not repair Screen Recording automatically: ${safeErrorMessage(error)}`;
      lastPermissionMarkup = '';
      await checkPermission();
    } finally {
      const latestButton = document.getElementById('repair-screen-permission-btn') as HTMLButtonElement | null;
      if (latestButton) {
        latestButton.disabled = false;
        latestButton.textContent = previous;
      }
    }
  });
  document.getElementById('open-screen-settings-btn')?.addEventListener('click', async () => {
    // Do not request TCC permission from the session window. Opening settings
    // keeps the Apple modal from blocking Debugr's own chooser/sidebar.
    await win.hide().catch(() => {});
    await invoke('open_screen_capture_settings').catch(() => {});
  });
  document.getElementById('reveal-runtime-btn')?.addEventListener('click', () => {
    void invoke('reveal_in_finder', { path: executablePath }).catch(() => {});
  });
}

function captureNeedsLegacyScreenshotLabel(capture: CaptureCard) {
  if (capture.screenshotUrl) return false;
  const timestamps = [
    new Date(capture.timestamp).getTime(),
    ...capture.annotations.map((annotation) => new Date(annotation.timestamp).getTime()),
  ].filter((value) => !Number.isNaN(value));
  if (timestamps.length === 0) return true;
  return Math.min(...timestamps) <= SCREENSHOT_SUPPORT_ROLLOUT_AT;
}

function deleteCaptureFromSession(session: Session, captureId: string) {
  const nextCaptures = session.captures.filter((capture) => capture.id !== captureId);
  session.captures = nextCaptures;
  if (activeCaptureId === captureId) {
    activeCaptureId = nextCaptures[0]?.id ?? null;
    activeAnnotationId = nextCaptures[0]?.annotations[0]?.id ?? null;
  }
  if (activePreviewCaptureId === captureId) {
    activePreviewCaptureId = null;
  }
  persistAppState();
}

function deleteSession(sessionId: string) {
  const index = sessions.findIndex((session) => session.id === sessionId);
  deletedSessionIds.add(sessionId);
  if (index !== -1) {
    sessions.splice(index, 1);
  }
  if (activeSessionId === sessionId) {
    const nextSession = sessions[index] ?? sessions[index - 1] ?? sessions[0] ?? null;
    activeSessionId = nextSession?.id ?? null;
    activeCaptureId = nextSession?.captures[0]?.id ?? null;
    activeAnnotationId = nextSession?.captures[0]?.annotations[0]?.id ?? null;
  }
  activePreviewCaptureId = null;
  feedback = null;
  persistAppState();
}

function deleteAnnotationFromCapture(session: Session, captureId: string, annotationId: string) {
  const capture = session.captures.find((item) => item.id === captureId);
  if (!capture) return;
  capture.annotations = capture.annotations.filter((annotation) => annotation.id !== annotationId);
  capture.preview = capture.annotations.map((annotation) => annotation.text).filter(Boolean).join(' · ') || 'No annotation notes yet';
  capture.title = capture.annotations[0]?.text?.slice(0, 40) || capture.title;
  if (capture.annotations.length === 0) {
    deleteCaptureFromSession(session, captureId);
    return;
  }
  capture.annotations.forEach((annotation, index) => {
    annotation.number = index + 1;
  });
  if (activeAnnotationId === annotationId) {
    activeAnnotationId = capture.annotations[0]?.id ?? null;
  }
  persistAppState();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Local wrappers so module-level `sessions` state is used transparently
function sortedSessions() { return sortedSessionsUtil(sessions); }

function localDesktopSessionsForPicker() {
  return sortedSessions().filter((session) => session.captures.length > 0 || totalAnnotations(session) > 0);
}

function groupSessions() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const groups = new Map<string, Session[]>();
  for (const session of sortedSessions()) {
    const createdAt = new Date(session.createdAt);
    const label = createdAt.toDateString() === now.toDateString()
      ? 'Today'
      : createdAt.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : createdAt.toLocaleDateString();
    groups.set(label, [...(groups.get(label) ?? []), session]);
  }
  return groups;
}

function normalizeProviderConnection(
  provider: Target,
  connection: ProviderConnectionState | undefined,
): ProviderConnectionState {
  if (!connection) {
    return providerConnections[provider];
  }
  if (connection.connected && !connection.method) {
    return {
      ...connection,
      method: provider === 'cursor' ? 'installed' : provider === 'codex' ? 'api_key' : 'oauth',
    };
  }
  return connection;
}

function persistAppState() {
  const payload: PersistedState = {
    sessions,
    authState,
    providerConnections,
    target,
    deletedSessionIds: Array.from(deletedSessionIds),
  };
  try {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload));
  } catch {
    // ignore persistence errors
  }
  queuePersistMirrors();
}

function queuePersistMirrors() {
  if (persistMirrorsTimer !== null) {
    window.clearTimeout(persistMirrorsTimer);
  }
  persistMirrorsTimer = window.setTimeout(() => {
    persistMirrorsTimer = null;
    const localSessions = localDesktopSessionsForPicker();
    const pickerSessions = buildPickerSessionCache(localSessions);
    logUi('workspace_persist_local_session_mirrors', {
      totalSessions: sessions.length,
      localPickerSessions: localSessions.length,
      skippedRemoteOrEmptySessions: Math.max(0, sessions.length - localSessions.length),
    });
    // Mirror sessions to disk so the local MCP server can read them.
    // Fire-and-forget — never block the UI on this.
    invoke('save_sessions_to_disk', { payload: { sessions: localSessions } }).catch(() => {
      // silently ignore — disk write is best-effort
    });
    invoke('save_picker_sessions_cache', {
      sessions: pickerSessions,
    }).catch(() => {
      // silently ignore — picker cache is best-effort
    });
  }, PERSIST_MIRROR_DEBOUNCE_MS);
}

function hydrateAppState() {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    deletedSessionIds = new Set(Array.isArray(parsed.deletedSessionIds) ? parsed.deletedSessionIds.filter((id): id is string => typeof id === 'string') : []);
    if (Array.isArray(parsed.sessions)) {
      sessions = hydratePersistedSessions(parsed.sessions).filter((session) => !deletedSessionIds.has(session.id));
    }
    if (parsed.authState) {
      authState = {
        authenticated: Boolean(parsed.authState.authenticated),
        profileInitialized: Boolean(parsed.authState.profileInitialized),
        name: parsed.authState.name || authState.name,
        email: parsed.authState.email || authState.email,
        avatarInitials: parsed.authState.avatarInitials || authState.avatarInitials,
        company: typeof parsed.authState.company === 'string' ? parsed.authState.company : '',
        role: typeof parsed.authState.role === 'string' ? parsed.authState.role : '',
      };
    }
    if (parsed.providerConnections) {
      providerConnections = {
        claude: normalizeProviderConnection('claude', parsed.providerConnections.claude ?? providerConnections.claude),
        codex: normalizeProviderConnection('codex', parsed.providerConnections.codex ?? providerConnections.codex),
        cursor: normalizeProviderConnection('cursor', parsed.providerConnections.cursor ?? providerConnections.cursor),
      };
    }
    if (parsed.target === 'codex' || parsed.target === 'cursor') {
      target = parsed.target;
    }
    activeSessionId = sessions[0]?.id ?? null;
    activeCaptureId = sessions[0]?.captures[0]?.id ?? null;
  } catch {
    // ignore corrupt cache
  }
}

function sessionWindowSize(): [number, number] {
  const width = Math.round(Math.max(980, Math.min(1460, window.screen.width * 0.9)));
  const height = Math.round(Math.max(700, Math.min(940, window.screen.height * 0.88)));
  return [width, height];
}

function welcomeWindowSize(): [number, number] {
  const width = Math.round(Math.max(1160, Math.min(1500, window.screen.availWidth * 0.88)));
  const height = Math.round(Math.max(840, Math.min(1000, window.screen.availHeight * 0.9)));
  return [width, height];
}

function pushPendingButtonText() {
  return 'Send pending sessions';
}

function pushPendingButtonSubtext(currentTarget: Target) {
  return `Current target: ${providerLabel(currentTarget)}. Switch between Claude CLI, Codex CLI, or Cursor in Submit.`;
}

async function fitWindowToContent() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (appMode !== 'confirmation') return;
  const card = document.querySelector<HTMLElement>('.welcome-card');
  if (!card) return;
  const maxHeight = Math.round(window.screen.availHeight * 0.9);
  const height = Math.min(card.scrollHeight + 48, maxHeight);
  await win.setSize(new LogicalSize(Math.min(980, Math.max(460, card.scrollWidth + 48)), height));
}

async function fitWelcomeWindow() {
  if (appMode !== 'welcome') return;
  const [width, height] = welcomeWindowSize();
  await win.setSize(new LogicalSize(width, height));
  if (appMode !== 'welcome') return;
  await win.setResizable(true);
  if (appMode !== 'welcome') return;
  await win.center();
}

async function enterSessionMode(
  section: WorkspaceSection = 'notes',
  options: { preserveWindowFrame?: boolean } = {},
) {
  appMode = 'session';
  workspaceSection = section;
  render();
  await win.setResizable(true);
  if (options.preserveWindowFrame) {
    return;
  }
  const [width, height] = sessionWindowSize();
  await win.setSize(new LogicalSize(width, height));
  await win.center();
}

function connectedProviderCount() {
  return (['claude', 'codex', 'cursor'] as Target[]).filter((provider) => isProviderConnected(provider, providerConnections[provider])).length;
}

function mockContributionBody(flow: SubmissionFlow, session: Session, index: number) {
  const capture = session.captures[index % Math.max(1, session.captures.length)];
  const annotation = capture?.annotations[index % Math.max(1, capture.annotations.length)];
  const note = annotation?.text || sessionLevelNote(session) || 'The onboarding flow needs a closer look.';
  if (flow === 'public') {
    const ideas = [
      `${note} needs a tighter explanation before this reaches the AI summary.`,
      'This is reproducible and should stay in the curated packet.',
      'The screenshot context is good, but the expected behavior should be clearer.',
    ];
    return ideas[index % ideas.length];
  }
  const ideas = [
    `${note} looks like the primary user pain point.`,
    'We should include the repo context so the coding agent lands in the right files.',
    'This session note is helpful and should be included in the final submission.',
  ];
  return ideas[index % ideas.length];
}

function ensureContributionSeed(session: Session) {
  if (session.submissionFlow === 'direct') {
    session.contributions = [];
    session.collaborationReady = true;
    return;
  }
  if (session.contributions.length > 0) {
    session.collaborationReady = true;
    return;
  }
  const source = session.submissionFlow === 'public' ? 'community' : 'team';
  const names = source === 'team'
    ? ['Sarah Chen', 'Mike Johnson', 'Priya Patel']
    : ['RandoUser42', 'Emily', 'MakerMia'];
  session.contributions = names.map((author, index) => ({
    id: uid('contrib'),
    source,
    author,
    type: index === 1 ? 'session_note' : index === 2 ? 'annotation' : 'comment',
    body: mockContributionBody(session.submissionFlow, session, index),
    accepted: true,
    timestamp: new Date(Date.now() - index * 240_000).toISOString(),
  }));
  session.collaborationReady = true;
}

function buildStatusCopy(session: Session) {
  if (session.status === 'responded') return 'AI insights ready';
  if (session.status === 'sent') return 'Awaiting AI response';
  if (session.submissionFlow === 'direct') return 'Ready to send directly';
  if (session.collaborationReady) return 'Curated context ready';
  return 'Needs review context';
}

function render() {
  if (appMode === 'welcome') {
    renderWelcome();
    return;
  }
  if (appMode === 'confirmation') {
    renderConfirmation();
    return;
  }
  renderSession();
}

function renderWelcome() {
  const recentSessions = sortedSessions().slice(0, 4);
  const canFinishSetup = authState.authenticated && connectedProviderCount() > 0;
  const claudeReady = isProviderConnected('claude', providerConnections.claude);
  const codexReady = isProviderConnected('codex', providerConnections.codex);
  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card welcome-journey-card">
        <div class="welcome-hero">
          <img class="app-icon" src="${brandIconUrl}" alt="Debugr logo" />
          <div class="welcome-hero-copy">
            <h1>dbugr.ai</h1>
            <p>A desktop-first capture flow for sign-in, MCP setup, session notes, review, and AI submission.</p>
          </div>
        </div>

        <div class="welcome-grid">
          <section class="welcome-panel">
            <div class="panel-kicker">Launch & sign in</div>
            <h2>${authState.authenticated ? `Welcome back, ${escapeHtml(authState.name)}` : 'Sign in to Debugr'}</h2>
            <p class="panel-copy">
              ${authState.authenticated
                ? 'This Mac is linked to your Debugr workspace. Captures, session notes, and AI handoffs can now stay attached to your profile.'
                : 'Continue in your browser to sign in, choose your workspace, and link this Mac back to the desktop app.'}
            </p>
            <button class="btn-primary" id="web-auth-btn" ${authState.authenticated || isAuthenticating ? 'disabled' : ''}>
              ${isAuthenticating ? 'Opening browser…' : authState.authenticated ? 'Mac linked' : 'Continue in browser'}
            </button>
            <div class="onboarding-list">
              <div class="onboarding-item ${authState.authenticated ? 'done' : ''}">
                <span class="onboarding-dot"></span>
                <div>
                  <strong>Web sign-in</strong>
                  <span>${authState.authenticated ? escapeHtml(authState.email) : 'Use the web app for Google, email, workspace, and team setup.'}</span>
                </div>
              </div>
              <div class="onboarding-item ${connectedProviderCount() > 0 ? 'done' : ''}">
                <span class="onboarding-dot"></span>
                <div>
                  <strong>MCP providers</strong>
                  <span>${connectedProviderCount()} of 3 connected</span>
                </div>
              </div>
              <div class="onboarding-item ${authState.profileInitialized ? 'done' : ''}">
                <span class="onboarding-dot"></span>
                <div>
                  <strong>Profile ready</strong>
                  <span>${authState.profileInitialized ? 'The workspace is ready for capture and routing.' : 'Finish setup after at least one provider is connected.'}</span>
                </div>
              </div>
            </div>
            <button class="btn-secondary wide-btn" id="finish-setup-btn" ${canFinishSetup ? '' : 'disabled'}>
              ${authState.profileInitialized ? 'Setup complete' : 'Finish setup'}
            </button>
            ${authState.authenticated ? `
            <div class="welcome-profile-fields">
              <div class="panel-kicker">Optional profile</div>
              <p class="panel-copy">Company and role are saved locally and included in AI submission payloads.</p>
              <label class="field-block welcome-field">
                <span class="field-label-inline">Company <span class="field-optional">(optional)</span></span>
                <input class="field-input" id="profile-company-input" type="text" value="${escapeHtml(authState.company)}" placeholder="Acme Inc." autocomplete="organization" />
              </label>
              <label class="field-block welcome-field">
                <span class="field-label-inline">Role <span class="field-optional">(optional)</span></span>
                <input class="field-input" id="profile-role-input" type="text" value="${escapeHtml(authState.role)}" placeholder="Engineer, PM, …" autocomplete="organization-title" />
              </label>
            </div>` : ''}
          </section>

          <section class="welcome-panel">
            <div class="panel-kicker">AI connection status</div>
            <h2>Connect your AI</h2>
            <p class="panel-copy">Connect once here, then send any session straight from the workspace.</p>

            ${/* ── Claude ── */ ''}
            <div class="wc-provider-block">
              <div class="wc-provider-header">
                <div class="wc-provider-name">
                  <img class="provider-logo" src="${logoClaudeUrl}" alt="Claude CLI" /><strong>Claude CLI</strong>
                  <span class="provider-pill ${claudeReady ? 'connected' : ''}">${claudeReady ? '● Connected' : '○ Not connected'}</span>
                </div>
                ${claudeReady ? `<button class="wc-disconnect-btn" id="wc-disconnect-claude">Disconnect</button>` : ''}
              </div>
              ${claudeReady ? `
                <p class="wc-hint wc-connected-hint">${escapeHtml(providerConnectionReadyCopy('claude', providerConnections.claude.method))}</p>
              ` : `
                <div class="wc-connect-body">
                  <div class="wc-connect-mode-switch">
                    <button class="wc-mode-btn ${claudeConnectMode === 'oauth' ? 'active' : ''}" id="wc-claude-mode-oauth">Browser login</button>
                    <button class="wc-mode-btn ${claudeConnectMode === 'api_key' ? 'active' : ''}" id="wc-claude-mode-api">API key</button>
                  </div>
                  ${claudeConnectMode === 'api_key' ? `
                    <p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('claude', 'api_key'))}</p>
                    ${connectVerifyError ? `<div class="wc-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
                    <div class="wc-key-row">
                      <input class="connect-key-input" id="wc-claude-key" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
                      <button class="connect-save-btn" id="wc-save-claude">Verify &amp; Save</button>
                    </div>
                    <div class="connect-key-hint">Stored locally on this Mac only — never sent anywhere.</div>
                  ` : claudeConnecting ? `
                    <p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</p>
                    <div class="wc-waiting">${sandclockMarkup('Waiting for you to finish in the browser…')}</div>
                    ${connectVerifyError ? `<div class="wc-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
                    <button class="wc-done-btn" id="wc-claude-done">✓ Done — verify my login</button>
                  ` : `
                    <p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</p>
                    <button class="wc-connect-btn" id="wc-connect-claude">Connect Claude CLI →</button>
                  `}
                </div>
              `}
            </div>

            ${/* ── Codex ── */ ''}
            <div class="wc-provider-block">
              <div class="wc-provider-header">
                <div class="wc-provider-name">
                  <img class="provider-logo" src="${logoCodexUrl}" alt="Codex CLI" /><strong>Codex CLI</strong>
                  <span class="provider-pill ${codexReady ? 'connected' : ''}">${codexReady ? '● Connected' : '○ Not connected'}</span>
                </div>
                ${codexReady ? `<button class="wc-disconnect-btn" id="wc-disconnect-codex">Disconnect</button>` : ''}
              </div>
              ${codexReady ? `
                <p class="wc-hint wc-connected-hint">${escapeHtml(providerConnectionReadyCopy('codex', 'api_key'))}</p>
              ` : `
                <div class="wc-connect-body">
                  <p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('codex', 'api_key'))}</p>
                  ${connectVerifyError ? `<div class="wc-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
                  <div class="wc-key-row">
                    <input class="connect-key-input" id="wc-codex-key" type="password" placeholder="sk-…" autocomplete="off" spellcheck="false" />
                    <button class="connect-save-btn" id="wc-save-codex">Verify &amp; Save</button>
                  </div>
                  <div class="connect-key-hint">Stored locally on this Mac only — never sent anywhere.</div>
                  <div class="wc-inline-actions">
                    <button class="wc-connect-btn secondary" id="wc-open-codex-keys">Open API keys page</button>
                  </div>
                </div>
              `}
            </div>

            ${/* ── Cursor ── */ ''}
            <div class="wc-provider-block">
              <div class="wc-provider-header">
                <div class="wc-provider-name">
                  <img class="provider-logo" src="${logoCursorUrl}" alt="Cursor" /><strong>Cursor</strong>
                  <span class="provider-pill ${cursorInstalled ? 'connected' : 'not-installed'}">${cursorInstalled ? '● Ready' : '○ Not installed'}</span>
                </div>
                ${!cursorInstalled ? `<a class="wc-disconnect-btn" id="wc-get-cursor" href="#">Get Cursor →</a>` : ''}
              </div>
              ${cursorInstalled
                ? `<p class="wc-hint wc-connected-hint">${escapeHtml(providerConnectionReadyCopy('cursor', 'installed'))}</p>`
                : `<p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('cursor', 'installed'))}</p>`
              }
            </div>
          </section>
          ${providerRecheckError ? `<div class="submit-gate-error" role="alert">${escapeHtml(providerRecheckError)}</div>` : ''}
        </div>

        <div class="welcome-grid">
          <section class="welcome-panel">
            <div class="panel-kicker">Start capturing</div>
            <h2>Always one shortcut away</h2>
            <p class="panel-copy">Debugr stays in the background. Press <strong>Control + Command + Z</strong> from any app to open the annotation overlay.</p>
            <div class="shortcut-row large-shortcut">
              <span class="shortcut-label">Global shortcut</span>
              <kbd>⌃</kbd><kbd>⌘</kbd><kbd>Z</kbd>
            </div>
            <button class="btn-secondary wide-btn" id="start-bg-btn">Start background mode</button>
          </section>

          <section class="welcome-panel">
            <div class="panel-kicker">Sessions</div>
            <h2>Start or continue a session</h2>
            <p class="panel-copy">Open an existing session or create a new one to start capturing.</p>
            <button class="btn-primary" id="open-workspace-btn">+ New session</button>
            ${recentSessions.length > 0 ? `
              <div class="sessions-divider"><span>or continue</span></div>
              <div class="recent-session-list">
                ${recentSessions.map((session) => `
                  <button class="recent-session-tile ${visiblePendingSessionSwitchId === session.id ? 'loading' : ''}" data-session-id="${session.id}" ${pendingSessionSwitchId ? 'disabled' : ''}>
                    <strong>${escapeHtml(session.title)}</strong>
                    <span>${visiblePendingSessionSwitchId === session.id
                      ? loadingDots('Opening session')
                      : `${flowLabel(session.submissionFlow)} · ${totalAnnotations(session)} annotations · ${fmtDate(session.createdAt)}`}</span>
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </section>
        </div>
      </div>
    </div>
  `;

  document.getElementById('web-auth-btn')?.addEventListener('click', async () => {
    isAuthenticating = true;
    renderWelcome();
    const url = desktopWebAuthUrl();
    logUi('desktop_web_auth_open_started', { url });
    try {
      await invoke('open_url', { url });
      logUi('desktop_web_auth_open_completed', { url });
    } catch (error) {
      logUi('desktop_web_auth_open_failed', { error: safeErrorMessage(error).slice(0, 300) });
      window.alert(`Could not open Debugr in your browser.\n\n${safeErrorMessage(error)}`);
    } finally {
      isAuthenticating = false;
      renderWelcome();
    }
  });

  document.getElementById('finish-setup-btn')?.addEventListener('click', () => {
    if (!canFinishSetup) return;
    authState.profileInitialized = true;
    persistAppState();
    renderWelcome();
  });

  document.getElementById('profile-company-input')?.addEventListener('input', (event) => {
    authState.company = (event.target as HTMLInputElement).value;
    persistAppState();
  });
  document.getElementById('profile-role-input')?.addEventListener('input', (event) => {
    authState.role = (event.target as HTMLInputElement).value;
    persistAppState();
  });

  document.getElementById('start-bg-btn')?.addEventListener('click', async () => {
    await invoke('hide_main_window');
  });

  document.getElementById('open-workspace-btn')?.addEventListener('click', () => {
    // Always create a fresh session when clicking "New session"
    const session: Session = {
      id: uid('session'),
      title: `Session ${fmtTime(new Date().toISOString())}`,
      createdAt: new Date().toISOString(),
      status: 'draft',
      captures: [],
      about: '',
      sessionNote: '',
      projectFolder: null,
      githubRepo: '',
      submissionFlow: 'direct',
      contributions: [],
      collaborationReady: false,
      lastTarget: target,
      lastExplicitSaveAt: null,
      webSessionId: null,
      webSyncedAt: null,
      webSyncStatus: 'idle',
      webSyncError: null,
    };
    sessions.unshift(session);
    activeSessionId = session.id;
    activeCaptureId = null;
    activeAnnotationId = null;
    persistAppState();
    void enterSessionMode('notes', { preserveWindowFrame: true });
  });

  document.getElementById('wc-claude-mode-oauth')?.addEventListener('click', () => {
    claudeConnectMode = 'oauth';
    claudeConnecting = false;
    connectVerifyError = '';
    renderWelcome();
  });

  document.getElementById('wc-claude-mode-api')?.addEventListener('click', () => {
    claudeConnectMode = 'api_key';
    claudeConnecting = false;
    connectVerifyError = '';
    renderWelcome();
  });

  // ── Claude connect (welcome screen) ─────────────────────────────────────
  document.getElementById('wc-connect-claude')?.addEventListener('click', async () => {
    claudeConnecting = true;
    connectVerifyError = '';
    renderWelcome();
    const script = [
      `echo "=== Connecting Debugr to Claude CLI ==="`,
      `echo ""`,
      `echo "Complete the Claude CLI login flow, then come back to Debugr and click Done."`,
      `echo ""`,
      `claude /login`,
    ].join(' && ');
    await invoke('open_command_in_terminal', {
      cwd: process.env['HOME'] || '~',
      command: script,
      title: 'Connect Debugr to Claude CLI',
    }).catch(() => {
      claudeConnecting = false;
      connectVerifyError = 'Could not open Claude CLI login automatically. Open Terminal, run `claude /login`, finish the login flow, then return here and click Done.';
      renderWelcome();
    });
  });

  document.getElementById('wc-claude-done')?.addEventListener('click', async () => {
    connectVerifyError = '';
    renderWelcome(); // show spinner-like state while verifying
    try {
      const version = await invoke<string>('verify_claude_auth');
      claudeApiKey = '';
      claudeConnected = true;
      claudeConnecting = false;
      claudeConnectMode = 'oauth';
      providerConnections.claude = { connected: true, method: 'oauth' };
      providerRecheckError = '';
      connectVerifyError = '';
      await saveProviderConfig();
      // Briefly show version before re-render
      console.info('Claude verified:', version);
    } catch (err) {
      connectVerifyError = String(err);
    }
    renderWelcome();
  });

  document.getElementById('wc-save-claude')?.addEventListener('click', async () => {
    const input = document.getElementById('wc-claude-key') as HTMLInputElement | null;
    const key = input?.value.trim() ?? '';
    connectVerifyError = '';
    try {
      await invoke<string>('verify_claude_api_key', { apiKey: key });
      claudeApiKey = key;
      claudeConnected = true;
      claudeConnecting = false;
      claudeConnectMode = 'api_key';
      providerConnections.claude = { connected: true, method: 'api_key' };
      providerRecheckError = '';
      await saveProviderConfig();
    } catch (err) {
      connectVerifyError = String(err);
    }
    renderWelcome();
  });

  document.getElementById('wc-disconnect-claude')?.addEventListener('click', async () => {
    claudeApiKey = '';
    claudeConnected = false;
    claudeConnecting = false;
    claudeConnectMode = 'oauth';
    providerConnections.claude = { connected: false, method: null };
    providerRecheckError = '';
    connectVerifyError = '';
    await saveProviderConfig();
    renderWelcome();
  });

  // ── Codex connect (welcome screen) ──────────────────────────────────────
  document.getElementById('wc-open-codex-keys')?.addEventListener('click', async () => {
    codexConnecting = true;
    connectVerifyError = '';
    renderWelcome();
    await invoke('open_auth_popup', {
      url: 'https://platform.openai.com/api-keys',
      title: 'Connect Debugr to Codex',
      label: 'auth-codex-key',
    }).catch(() => {});
  });

  document.getElementById('wc-save-codex')?.addEventListener('click', async () => {
    const input = document.getElementById('wc-codex-key') as HTMLInputElement | null;
    const key = input?.value.trim() ?? '';
    connectVerifyError = '';
    try {
      await invoke<string>('verify_codex_key', { apiKey: key });
      codexApiKey = key;
      codexConnecting = false;
      providerConnections.codex = { connected: true, method: 'api_key' };
      providerRecheckError = '';
      await saveProviderConfig();
    } catch (err) {
      connectVerifyError = String(err);
    }
    renderWelcome();
  });

  document.getElementById('wc-disconnect-codex')?.addEventListener('click', async () => {
    codexApiKey = '';
    codexConnecting = false;
    providerConnections.codex = { connected: false, method: null };
    providerRecheckError = '';
    connectVerifyError = '';
    await saveProviderConfig();
    renderWelcome();
  });

  // ── Cursor (welcome screen) ──────────────────────────────────────────────
  document.getElementById('wc-get-cursor')?.addEventListener('click', (e) => {
    e.preventDefault();
    void invoke('open_url', { url: 'https://cursor.sh' });
  });

  document.querySelectorAll<HTMLButtonElement>('.recent-session-tile').forEach((button) => {
    button.addEventListener('click', () => {
      if (pendingSessionSwitchId) return;
      const sessionId = button.dataset.sessionId;
      if (!sessionId) return;
      pendingSessionSwitchId = sessionId;
      schedulePendingSessionSwitchIndicator(sessionId);
      renderWelcome();
      window.requestAnimationFrame(() => {
        activeSessionId = sessionId;
        const firstCapture = sessions.find((session) => session.id === sessionId)?.captures[0];
        activeCaptureId = firstCapture?.id ?? null;
        activeAnnotationId = firstCapture?.annotations[0]?.id ?? null;
        feedback = null;
        void enterSessionMode('notes', { preserveWindowFrame: true }).finally(() => {
          clearPendingSessionSwitchIndicator();
          pendingSessionSwitchId = null;
        });
      });
    });
  });

  void fitWelcomeWindow();
}


function renderConfirmation() {
  const info = lastSavedCapture;
  const nextStepLabel = activeSession()?.submissionFlow === 'direct' ? 'Submit' : 'Review & curate';
  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card confirmation-card">
        <div class="confirm-check">✓</div>
        <h1>Capture saved</h1>
        <p class="confirm-sub">
          ${info
            ? `<strong>${escapeHtml(info.sessionTitle)}</strong> · added ${info.annotationCount} annotation${info.annotationCount === 1 ? '' : 's'} · ${info.totalSessionAnnotations} total in this session`
            : 'Your annotation was added to the active session.'}
        </p>
        <div class="confirm-summary">
          <div><strong>Saved to:</strong> ${info ? `<strong>${escapeHtml(info.sessionTitle)}</strong>` : 'your active session'}.</div>
          <div><strong>Next:</strong> open the session board, then go to <strong>${nextStepLabel}</strong> to choose Claude CLI, Codex CLI, or Cursor. Captures are not sent from the overlay itself.</div>
        </div>
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirm-more-btn">+ Add more annotations</button>
          <button class="btn-primary" id="confirm-open-btn">Open session board →</button>
        </div>
        <button class="confirm-view-session" id="confirm-review-btn">Go straight to ${nextStepLabel}</button>
      </div>
    </div>
  `;

  document.getElementById('confirm-more-btn')?.addEventListener('click', async () => {
    await invoke('show_overlay');
  });

  document.getElementById('confirm-open-btn')?.addEventListener('click', () => {
    void enterSessionMode('notes');
  });

  document.getElementById('confirm-review-btn')?.addEventListener('click', () => {
    workspaceSection = activeSession()?.submissionFlow === 'direct' ? 'submit' : 'review';
    void enterSessionMode(workspaceSection);
  });

  void fitWindowToContent();
}

function renderSession() {
  const session = activeSession();
  const capture = activeCapture();
  const selectedSessionCount = sessions.length;
  logUi('render_session', {
    sessionId: session?.id ?? null,
    captureId: capture?.id ?? null,
    annotationId: activeAnnotationId,
    workspaceSection,
    target,
    appMode,
    sessionCount: sessions.length,
  });
  app.innerHTML = `
    <div class="app-shell visible">
      <div class="topbar">
        <div class="topbar-left">
<button class="topbar-back-link" id="back-home-btn">← Back to home</button>
        </div>
        <div class="topbar-title">
          <img class="topbar-brand-icon" src="${brandIconUrl}" alt="" />
          <span>Debugr</span>
        </div>
        <div class="topbar-actions">
          <button class="btn-new-capture" id="new-ann-btn">+ New Capture</button>
        </div>
      </div>

      <div class="journey-tabs">
        ${(['notes', 'flow', 'collab', 'review', 'submit', 'insights'] as WorkspaceSection[]).map((section) => `
          <button class="journey-tab ${workspaceSection === section ? 'active' : ''}" data-section="${section}">
            <span class="journey-step">${section === 'insights' ? 6 : ['notes', 'flow', 'collab', 'review', 'submit'].indexOf(section) + 1}</span>
            <span>${sectionLabel(section)}</span>
          </button>
        `).join('')}
      </div>

      <div class="app-body">
        <aside class="sidebar">
          <div class="sidebar-label">Workspace</div>
          <div class="sidebar-title-row">
            <strong>Sessions</strong>
            <span>${selectedSessionCount} total</span>
          </div>
          <div class="sidebar-helper">Choose a saved session, refresh from the API, or start a new capture.</div>
          <div id="session-list"></div>
          <button class="view-all-link" id="view-all-sessions-btn">Refresh sessions ↻</button>
          <button class="push-pending-btn" id="push-pending-btn" title="Send every unsent session to your currently selected AI target. Change the target in Submit.">
            <span class="push-pending-icon">↗</span>
            <span class="push-pending-copy">
              <strong>${pushPendingButtonText()}</strong>
              <span>${pushPendingButtonSubtext(target)}</span>
            </span>
          </button>
          <div class="perm-note" id="perm-note">Checking permissions…</div>
        </aside>

        <main class="main-pane">
          ${session ? `
            <div class="session-header session-header-rich">
              <div class="session-title-row">
                <div class="session-title-block">
                  <input class="session-title-inline" id="header-title-input" value="${escapeHtml(session.title)}" placeholder="Untitled session" spellcheck="false" />
                  <div class="session-header-note" id="header-note-display">${sessionLevelNote(session) ? escapeHtml(sessionLevelNote(session)) : '<span class="session-header-note-placeholder">Add a session note…</span>'}</div>
                  <div class="session-meta" id="session-meta-display">${fmtDate(session.createdAt)} · ${fmtTime(session.createdAt)} · ${flowLabel(session.submissionFlow)} · ${buildStatusCopy(session)}</div>
                </div>
                <div class="session-header-actions">
                  <button type="button" class="mini-action" id="save-session-btn">Save session</button>
                  <button type="button" class="mini-action mini-action-danger" id="delete-session-btn">Delete session</button>
                  <div class="session-badge responded">${escapeHtml(session.status === 'responded' ? 'AI ready' : session.status === 'sent' ? 'Sent to AI' : 'Draft')}</div>
                </div>
              </div>
              <div class="session-summary-strip">
                <div class="summary-chip">${session.captures.length} capture${session.captures.length === 1 ? '' : 's'}</div>
                <div class="summary-chip">${totalAnnotations(session)} annotations</div>
                <div class="summary-chip">${acceptedContributions(session).length} curated items</div>
                <div class="summary-chip">${providerConnections[target].connected ? `${providerLabel(target)} connected` : `${providerLabel(target)} pending`}</div>
                ${session.lastExplicitSaveAt ? `<div class="summary-chip subtle">Checkpoint ${fmtTime(session.lastExplicitSaveAt)}</div>` : ''}
              </div>
            </div>

            <div class="workspace-scroll">
              <div class="session-context-grid">
                <section class="context-card">
                  <div class="context-card-head">
                    <h3>Session framing</h3>
                    <span class="field-helper">This helps Claude, Codex, or Cursor understand what kind of issue the annotations are describing.</span>
                  </div>
                  <label class="field-block">
                    <span class="field-label-inline">Title</span>
                    <input class="field-input" id="session-title-input" value="${escapeHtml(session.title)}" placeholder="Onboarding flow bug" />
                  </label>
                  <label class="field-block">
                    <span class="field-label-inline">Session Note <span id="about-count">${sessionLevelNote(session).length}</span>/200</span>
                    <textarea class="field-textarea" id="session-about-input" maxlength="200" placeholder="Add session-level notes, expected behavior, reproduction detail, or the frame for this issue.">${escapeHtml(sessionLevelNote(session))}</textarea>
                    <span class="field-helper">This is the one session-level note that should travel with the whole session and frame the annotations for the AI.</span>
                    ${totalAnnotations(session) > 1 && !sessionLevelNote(session)
    ? '<span class="field-helper field-helper-warn">Required before you can send to AI when this session has more than one annotation.</span>'
    : ''}
                  </label>
                </section>

                <section class="context-card">
                  <div class="context-card-head">
                    <h3>Repo context</h3>
                    <span class="field-helper">Folder and GitHub details keep the coding agent grounded in the right codebase when it turns feedback into changes.</span>
                  </div>
                  <label class="field-block">
                    <span class="field-label-inline">Project folder</span>
                    <input class="field-input" id="session-folder-input" value="${escapeHtml(session.projectFolder ?? '')}" placeholder="/Users/kumar/debugr" />
                    <span class="field-helper">Use the local folder if the AI should inspect files, package config, or app state from this machine.</span>
                  </label>
                  <label class="field-block">
                    <span class="field-label-inline">GitHub repo</span>
                    <input class="field-input" id="session-repo-input" value="${escapeHtml(session.githubRepo ?? '')}" placeholder="owner/repo" />
                    <span class="field-helper">Add the repo name if the team will review this session remotely or if the AI should reference the source of truth in GitHub.</span>
                  </label>
                  <div class="context-pill-row">
                    <button type="button" class="summary-chip subtle summary-chip-action" id="session-folder-chip">${session.projectFolder ? 'Local folder linked' : 'No folder linked yet'}</button>
                    <button type="button" class="summary-chip subtle summary-chip-action" id="session-repo-chip">${session.githubRepo ? 'GitHub repo linked' : 'GitHub optional'}</button>
                  </div>
                </section>
              </div>

              <section class="capture-section">
                <div class="capture-section-head">
                  <div>
                    <h3>Captures & annotations</h3>
                    <p>${capture ? 'Select a capture to preview the exact annotation cluster for this session.' : 'Your captures land here after each overlay save.'}</p>
                  </div>
                </div>
                ${session.captures.length === 0 ? `
                  <div class="empty-state capture-empty-state">
                    <div class="empty-icon">⌃⌘Z</div>
                    <div class="empty-title">No captures yet</div>
                    <div class="empty-copy">Press <strong>Control + Command + Z</strong> or use New Capture to start annotating from any app.</div>
                  </div>
                ` : `
                  <div class="capture-preview-card">
                    <div class="capture-preview-title-row">
                      <div class="capture-preview-title">${escapeHtml(capture?.title ?? session.captures[0].title)}</div>
                      ${captureNeedsLegacyScreenshotLabel(capture ?? session.captures[0]) ? '<span class="capture-legacy-badge">Saved before screenshot support</span>' : ''}
                    </div>
                    <div class="capture-preview-copy">${escapeHtml(capture?.preview ?? session.captures[0].preview)}</div>
                  </div>
                  <div class="capture-list" id="capture-list"></div>
                  <div class="capture-payload" id="capture-payload"></div>
                `}
              </section>
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <div class="empty-title">No session selected</div>
              <div class="empty-copy">Create a capture or pick a saved session to continue the Debugr journey.</div>
            </div>
          `}
        </main>

        <aside class="right-panel visible" id="right-panel"></aside>
      </div>
    </div>
  `;

  renderSessionList();
  if (session?.captures.length) {
    if (!activeCaptureId) activeCaptureId = session.captures[0]?.id ?? null;
    const currentCapture = session.captures.find((item) => item.id === activeCaptureId) ?? session.captures[0];
    if (!activeAnnotationId || !currentCapture?.annotations.some((item) => item.id === activeAnnotationId)) {
      activeAnnotationId = currentCapture?.annotations[0]?.id ?? null;
    }
    renderCaptureList(session);
    renderCapturePayload(session);
  }
  renderWorkspacePanel();
  bindSessionActions();
  checkPermission();
}

function renderSessionList() {
  const list = document.getElementById('session-list');
  if (!list) return;
  const groups = groupSessions();
  if (groups.size === 0) {
    list.innerHTML = '<div class="sidebar-empty">No sessions yet. Save your first capture to create one.</div>';
    return;
  }
  list.innerHTML = '';
  groups.forEach((group, label) => {
    const labelEl = document.createElement('div');
    labelEl.className = 'session-group-label';
    labelEl.textContent = label;
    list.appendChild(labelEl);
    group.forEach((session) => {
      const row = document.createElement('div');
      row.className = `session-item ${session.id === activeSessionId ? 'active' : ''} ${visiblePendingSessionSwitchId === session.id ? 'loading' : ''}`;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.innerHTML = `
        <div class="session-item-copy">
          <strong>${escapeHtml(session.title)}</strong>
          <span>${visiblePendingSessionSwitchId === session.id ? loadingDots('Opening session') : `${flowLabel(session.submissionFlow)} · ${fmtTime(session.createdAt)}`}</span>
        </div>
        <button type="button" class="session-item-delete" data-delete-session="${session.id}" aria-label="Delete session">Delete</button>
      `;
      const selectSession = () => {
        if (pendingSessionSwitchId || activeSessionId === session.id) return;
        pendingSessionSwitchId = session.id;
        schedulePendingSessionSwitchIndicator(session.id);
        renderSessionList();
        window.requestAnimationFrame(() => {
        activeSessionId = session.id;
        activeCaptureId = session.captures[0]?.id ?? null;
        activeAnnotationId = session.captures[0]?.annotations[0]?.id ?? null;
        feedback = session.status === 'responded' ? feedback : null;
        clearPendingSessionSwitchIndicator();
        pendingSessionSwitchId = null;
        persistAppState();
        renderSession();
        });
      };
      row.addEventListener('click', selectSession);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectSession();
        }
      });
      const deleteButton = row.querySelector<HTMLButtonElement>('[data-delete-session]');
      deleteButton?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      deleteButton?.addEventListener('keydown', (event) => {
        event.stopPropagation();
      });
      deleteButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        logUi('workspace_sidebar_delete_session_click', { sessionId: session.id });
        deleteSession(session.id);
        renderSessionList();
        renderSession();
      });
      list.appendChild(row);
    });
  });
}

function renderCaptureList(session: Session) {
  const list = document.getElementById('capture-list');
  if (!list) return;
  list.innerHTML = '';
  session.captures.forEach((capture) => {
    const showLegacyLabel = captureNeedsLegacyScreenshotLabel(capture);
    const thumbSrc = captureDashboardImgSrc(capture);
    logUi('workspace_render_capture_card', {
      sessionId: session.id,
      captureId: capture.id,
      activeCaptureId,
      screenshotKind: classifyScreenshotRef(capture.screenshotUrl),
      screenshotChars: capture.screenshotUrl?.length ?? 0,
      usedLatestAnnotationFallback: Boolean(!capture.screenshotUrl && thumbSrc),
      thumbSrcKind: thumbSrc
        ? thumbSrc.startsWith('data:image/')
          ? 'data_url'
          : 'file_src'
        : 'none',
      thumbSrcChars: thumbSrc?.length ?? 0,
    });
    const card = document.createElement('div');
    card.className = `capture-card ${capture.id === activeCaptureId ? 'active' : ''}`;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.innerHTML = `
      <button type="button" class="capture-thumb capture-thumb-preview" data-open-capture-preview="${capture.id}" aria-label="Preview screenshot">
        ${thumbSrc ? `<img src="${thumbSrc}" alt="" />` : '📷'}
      </button>
      <div class="capture-body">
        <div class="capture-title-row">
          <div class="capture-title">${escapeHtml(capture.title)}</div>
          ${showLegacyLabel ? '<span class="capture-legacy-badge">Saved before screenshot support</span>' : ''}
        </div>
        <div class="capture-preview">${escapeHtml(capture.preview)}</div>
        <div class="capture-time">${fmtTime(capture.timestamp)} · ${capture.annotations.length} annotations</div>
      </div>
      <button type="button" class="capture-card-delete" data-delete-capture="${capture.id}" aria-label="Delete capture">Delete</button>
    `;
    const selectCapture = () => {
      activeCaptureId = capture.id;
      activeAnnotationId = capture.annotations[0]?.id ?? null;
      logUi('workspace_capture_selected', {
        sessionId: session.id,
        captureId: capture.id,
        annotationCount: capture.annotations.length,
      });
      renderSession();
    };
    card.addEventListener('click', selectCapture);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectCapture();
      }
    });
    card.querySelector<HTMLButtonElement>('[data-delete-capture]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCaptureFromSession(session, capture.id);
      renderSession();
    });
    card.querySelector<HTMLButtonElement>('[data-open-capture-preview]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!captureDashboardImgSrc(capture)) return;
      activeCaptureId = capture.id;
      activeAnnotationId = capture.annotations[0]?.id ?? null;
      activePreviewCaptureId = capture.id;
      renderSession();
    });
    const thumbImg = card.querySelector<HTMLImageElement>('img');
    if (thumbImg) {
      thumbImg.addEventListener('load', () => {
        logUi('workspace_capture_thumb_loaded', {
          captureId: capture.id,
          naturalWidth: thumbImg.naturalWidth,
          naturalHeight: thumbImg.naturalHeight,
        });
      }, { once: true });
      thumbImg.addEventListener('error', () => {
        logUi('workspace_capture_thumb_failed', {
          captureId: capture.id,
          thumbSrc: thumbSrc ?? '',
          screenshotUrl: capture.screenshotUrl ?? '',
        });
      }, { once: true });
    }
    list.appendChild(card);
  });
}

function renderCapturePayload(session: Session) {
  const root = document.getElementById('capture-payload');
  if (!root) return;
  const capture = activeCapture() ?? session.captures[0];
  if (!capture) {
    root.innerHTML = '';
    return;
  }

  const selected = activeAnnotation() ?? capture.annotations[0];
  const payloadImgSrc = captureDashboardImgSrc(capture);
  const hasScreenshot = Boolean(payloadImgSrc);
  const showLegacyLabel = captureNeedsLegacyScreenshotLabel(capture);
  const annotationRows = capture.annotations.map((annotation) => `
    <div class="annotation-row ${selected?.id === annotation.id ? 'active' : ''}" data-annotation-id="${annotation.id}" role="button" tabindex="0">
      <span class="annotation-row-index">#${annotation.number}</span>
      <span class="annotation-row-text">${escapeHtml(annotation.text || 'No note text')}</span>
      <span class="annotation-row-time">${fmtTime(annotation.timestamp)}</span>
      <button type="button" class="annotation-row-delete" data-delete-annotation="${annotation.id}" aria-label="Delete annotation">Delete</button>
    </div>
  `).join('');

  const previewCapture = activePreviewCapture();
  const previewImgSrc = captureDashboardImgSrc(previewCapture);
  const isPreviewOpen =
    previewCapture?.id === capture.id && Boolean(previewImgSrc);

    logUi('workspace_render_capture_payload', {
      sessionId: session.id,
      captureId: capture.id,
      activeCaptureId,
      activePreviewCaptureId,
      annotationCount: capture.annotations.length,
    screenshotKind: classifyScreenshotRef(capture.screenshotUrl),
    screenshotChars: capture.screenshotUrl?.length ?? 0,
    usedLatestAnnotationFallback: Boolean(!capture.screenshotUrl && payloadImgSrc),
    payloadImgSrcKind: payloadImgSrc
      ? payloadImgSrc.startsWith('data:image/')
        ? 'data_url'
        : 'file_src'
      : 'none',
    payloadImgSrcChars: payloadImgSrc?.length ?? 0,
    previewOpen: isPreviewOpen,
  });

  root.innerHTML = `
    <div class="capture-payload-head">
      <strong>Payload preview</strong>
      <span>What ${providerLabel(target)} receives when you click Send</span>
    </div>
    <div class="capture-payload-grid">
      <div class="capture-payload-image-wrap">
        <div class="capture-payload-image-actions">
          <button type="button" class="capture-preview-action" id="open-capture-preview" ${hasScreenshot ? '' : 'disabled'}>Open full resolution</button>
          <span class="capture-preview-hint">${hasScreenshot
            ? 'Check readability before sending to Claude or Codex.'
            : showLegacyLabel
              ? 'Legacy capture: this was saved before screenshot support shipped, so only the note payload remains.'
              : 'This capture was saved without a screenshot. Pick a different capture or take a fresh one to send visual context.'}</span>
        </div>
        ${hasScreenshot
          ? `<button type="button" class="capture-payload-image-button" id="capture-payload-image-button" aria-label="Open full resolution screenshot preview"><img class="capture-payload-image" src="${payloadImgSrc}" alt="Selected screenshot payload" /></button>`
          : `<div class="capture-payload-empty">${showLegacyLabel ? 'Legacy capture: saved before screenshot support.' : 'No screenshot was saved with this capture.'}</div>`}
      </div>
      <div class="capture-payload-meta">
        <div class="capture-payload-list">
          ${annotationRows || '<div class="capture-payload-empty">No annotations on this capture yet.</div>'}
        </div>
        ${selected ? `
          <div class="capture-payload-note">
            <div class="capture-payload-note-title">Selected annotation note</div>
            <div class="capture-payload-note-body">${escapeHtml(selected.text || 'No note text')}</div>
            <div class="capture-payload-tags">${selected.tags.length ? selected.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('') : '<span>No tags</span>'}</div>
          </div>
        ` : ''}
        <div class="capture-payload-context">
          <div><strong>Session note:</strong> ${escapeHtml(sessionLevelNote(session) || 'Not set')}</div>
        </div>
      </div>
    </div>
    ${isPreviewOpen ? `
      <div class="capture-preview-modal" id="capture-preview-modal">
        <button type="button" class="capture-preview-backdrop" id="close-capture-preview" aria-label="Close screenshot preview"></button>
        <div class="capture-preview-panel">
          <div class="capture-preview-panel-head">
            <strong>Screenshot quality check</strong>
            <button type="button" class="capture-preview-close" id="close-capture-preview-x">Close</button>
          </div>
          <div class="capture-preview-panel-copy">This is the full image that will be saved with the session and referenced in the AI handoff.</div>
          <img class="capture-preview-modal-image" id="capture-preview-modal-image" src="${previewImgSrc}" alt="Full resolution screenshot preview" />
          <div class="capture-preview-meta" id="capture-preview-meta">Loading resolution…</div>
        </div>
      </div>
    ` : ''}
  `;

  root.querySelectorAll<HTMLElement>('[data-annotation-id]').forEach((row) => {
    const selectAnnotation = () => {
      const annotationId = row.dataset.annotationId;
      if (!annotationId) return;
      activeAnnotationId = annotationId;
      logUi('workspace_annotation_selected', {
        sessionId: session.id,
        captureId: capture.id,
        annotationId,
      });
      renderCapturePayload(session);
    };
    row.addEventListener('click', selectAnnotation);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectAnnotation();
      }
    });
  });

  root.querySelectorAll<HTMLElement>('[data-delete-annotation]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const annotationId = button.getAttribute('data-delete-annotation');
      if (!annotationId) return;
      deleteAnnotationFromCapture(session, capture.id, annotationId);
      renderCaptureList(session);
      renderCapturePayload(session);
    });
  });

  document.getElementById('open-capture-preview')?.addEventListener('click', () => {
    if (!captureDashboardImgSrc(capture)) return;
    logUi('workspace_open_capture_preview_click', {
      captureId: capture.id,
      screenshotChars: capture.screenshotUrl?.length ?? 0,
    });
    activePreviewCaptureId = capture.id;
    renderCapturePayload(session);
  });
  document.getElementById('capture-payload-image-button')?.addEventListener('click', () => {
    if (!captureDashboardImgSrc(capture)) return;
    logUi('workspace_payload_image_click', {
      captureId: capture.id,
      screenshotChars: capture.screenshotUrl?.length ?? 0,
    });
    activePreviewCaptureId = capture.id;
    renderCapturePayload(session);
  });
  document.getElementById('close-capture-preview')?.addEventListener('click', () => {
    activePreviewCaptureId = null;
    renderCapturePayload(session);
  });
  document.getElementById('close-capture-preview-x')?.addEventListener('click', () => {
    activePreviewCaptureId = null;
    renderCapturePayload(session);
  });

  const previewImage = document.getElementById('capture-preview-modal-image') as HTMLImageElement | null;
  const previewMeta = document.getElementById('capture-preview-meta');
  if (previewImage && previewMeta) {
    const updateMeta = () => {
      previewMeta.textContent = `Resolution: ${previewImage.naturalWidth} × ${previewImage.naturalHeight}`;
      logUi('workspace_preview_modal_loaded', {
        captureId: previewCapture?.id ?? capture.id,
        naturalWidth: previewImage.naturalWidth,
        naturalHeight: previewImage.naturalHeight,
      });
    };
    if (previewImage.complete) {
      updateMeta();
    } else {
      previewImage.addEventListener('load', updateMeta, { once: true });
    }
    previewImage.addEventListener('error', () => {
      logUi('workspace_preview_modal_failed', {
        captureId: previewCapture?.id ?? capture.id,
        src: previewImage.currentSrc || previewImage.src,
      });
    }, { once: true });
  }

  const payloadImage = document.querySelector<HTMLImageElement>('.capture-payload-image');
  if (payloadImage) {
    payloadImage.addEventListener('load', () => {
      logUi('workspace_payload_image_loaded', {
        captureId: capture.id,
        naturalWidth: payloadImage.naturalWidth,
        naturalHeight: payloadImage.naturalHeight,
      });
    }, { once: true });
    payloadImage.addEventListener('error', () => {
      logUi('workspace_payload_image_failed', {
        captureId: capture.id,
        src: payloadImage.currentSrc || payloadImage.src,
      });
    }, { once: true });
  }
}

function renderWorkspacePanel() {
  const panel = document.getElementById('right-panel');
  const session = activeSession();
  if (!panel || !session) return;
  logUi('render_workspace_panel', {
    section: workspaceSection,
    sessionId: session.id,
    target,
    status: session.status,
  });

  if (workspaceSection === 'notes') {
    panel.innerHTML = `
      <div class="right-panel-head">
        <div class="right-panel-title">Annotate & session notes</div>
        <div class="right-panel-sub">Stage 4 of the journey: add annotations, title the session clearly, and write the context the AI needs.</div>
      </div>
      <div class="right-panel-body stacked-panel">
        <div class="journey-card">
          <strong>Why this matters</strong>
          <p>Strong session framing keeps the AI from guessing what the user wanted, what the screenshot means, or which codebase the fix belongs to.</p>
        </div>
        <div class="journey-card">
          <strong>Checklist</strong>
          <ul class="bullet-list">
            <li>Give the session a concrete title.</li>
            <li>Use the session note field to frame the problem and expected behavior.</li>
            <li>Link the folder or GitHub repo if code changes are the likely next step.</li>
          </ul>
        </div>
        <button class="send-btn" id="notes-next-btn">Choose submission flow →</button>
      </div>
    `;
    document.getElementById('notes-next-btn')?.addEventListener('click', () => {
      workspaceSection = 'flow';
      renderSession();
    });
    return;
  }

  if (workspaceSection === 'flow') {
    panel.innerHTML = `
      <div class="right-panel-head">
        <div class="right-panel-title">Choose submission flow</div>
        <div class="right-panel-sub">Decide whether this session goes straight to AI, through your team, or through a public curation pass.</div>
      </div>
      <div class="right-panel-body stacked-panel">
        ${([
          {
            flow: 'direct',
            title: 'Direct to AI',
            copy: 'Send the current session straight to Claude, Codex, or Cursor.',
          },
          {
            flow: 'team',
            title: 'Submit for team review',
            copy: 'Let teammates add more notes and annotations before the AI sees it.',
          },
          {
            flow: 'public',
            title: 'Share on public feed',
            copy: 'Gather community signal, then curate the best context into the final submission.',
          },
        ] as const).map((item) => `
          <button class="flow-card ${session.submissionFlow === item.flow ? 'active' : ''} ${visiblePendingFlowSelection === item.flow ? 'loading' : ''}" data-flow="${item.flow}" ${pendingFlowSelection ? 'disabled' : ''}>
            <strong>${item.title}</strong>
            <span>${visiblePendingFlowSelection === item.flow ? sandclockMarkup('Processing…') : item.copy}</span>
          </button>
        `).join('')}
        <div class="flow-selection-status" aria-live="polite">
          <strong>${visiblePendingFlowSelection ? `${loadingDots('Processing')}` : 'Selected:'}</strong> ${flowLabel(pendingFlowSelection ?? session.submissionFlow)}
          <span>${(pendingFlowSelection ?? session.submissionFlow) === 'direct'
            ? 'You will send this session straight to Claude, Codex, or Cursor.'
            : (pendingFlowSelection ?? session.submissionFlow) === 'team'
              ? 'Teammates can add notes and annotations before you submit it.'
              : 'Community feedback will be curated before the final submission.'}</span>
        </div>
        <button class="send-btn" id="flow-next-btn" ${pendingFlowSelection ? 'disabled' : ''}>${session.submissionFlow === 'direct' ? 'Skip to submit →' : 'Start collaboration →'}</button>
      </div>
    `;
    document.querySelectorAll<HTMLButtonElement>('[data-flow]').forEach((button) => {
      button.addEventListener('click', () => {
        const flow = button.dataset.flow as SubmissionFlow | undefined;
        if (!flow || pendingFlowSelection) return;
        pendingFlowSelection = flow;
        schedulePendingFlowSelectionIndicator(flow);
        session.submissionFlow = flow;
        session.collaborationReady = flow === 'direct';
        if (flow === 'direct') session.contributions = [];
        renderWorkspacePanel();
        refreshSessionMetaDisplay(session);
        renderSessionList();
        window.requestAnimationFrame(() => {
          persistAppState();
          void syncSessionToWeb(session, 'submission_flow_selected');
          clearPendingFlowSelectionIndicator();
          pendingFlowSelection = null;
          renderWorkspacePanel();
          refreshSessionMetaDisplay(session);
          renderSessionList();
        });
      });
    });
    document.getElementById('flow-next-btn')?.addEventListener('click', () => {
      workspaceSection = session.submissionFlow === 'direct' ? 'submit' : 'collab';
      renderSession();
    });
    return;
  }

  if (workspaceSection === 'collab') {
    panel.innerHTML = `
      <div class="right-panel-head">
        <div class="right-panel-title">Collaborate / gather feedback</div>
        <div class="right-panel-sub">${session.submissionFlow === 'public' ? 'Community members' : 'Team members'} can add more context before you curate the final packet.</div>
      </div>
      <div class="right-panel-body stacked-panel">
        ${session.submissionFlow === 'direct'
          ? `<div class="journey-card"><strong>Direct flow selected</strong><p>This path skips collaboration and goes straight to submission.</p></div>`
          : `
            <div class="journey-card">
              <strong>${session.submissionFlow === 'public' ? 'Public feed' : 'Team review'} status</strong>
              <p>${session.collaborationReady
                ? `${session.contributions.length} contributions are ready for curation.`
                : 'No contributions collected yet. Seed the review queue so you can validate the rest of the journey.'}</p>
            </div>
            <button class="send-btn" id="seed-collab-btn">${session.collaborationReady ? 'Refresh review signal' : 'Collect review context'}</button>
            <div class="contribution-list compact-list">
              ${session.contributions.length === 0
                ? '<div class="empty-inline">Nothing added yet.</div>'
                : session.contributions.map((item) => `
                    <div class="contribution-item">
                      <strong>${escapeHtml(item.author)}</strong>
                      <span>${escapeHtml(item.body)}</span>
                    </div>
                  `).join('')}
            </div>
          `}
        <button class="btn-secondary wide-btn" id="collab-next-btn">${session.submissionFlow === 'direct' ? 'Go to submit' : 'Review & curate →'}</button>
      </div>
    `;
    document.getElementById('seed-collab-btn')?.addEventListener('click', () => {
      ensureContributionSeed(session);
      persistAppState();
      renderSession();
    });
    document.getElementById('collab-next-btn')?.addEventListener('click', () => {
      workspaceSection = session.submissionFlow === 'direct' ? 'submit' : 'review';
      renderSession();
    });
    return;
  }

  if (workspaceSection === 'review') {
    if (session.submissionFlow !== 'direct') ensureContributionSeed(session);
    panel.innerHTML = `
      <div class="right-panel-head">
        <div class="right-panel-title">Review & curate</div>
        <div class="right-panel-sub">Accept or reject the context that should travel to the AI.</div>
      </div>
      <div class="right-panel-body stacked-panel">
        <div class="journey-card">
          <strong>Curated payload</strong>
          <p>${acceptedContributions(session).length} of ${session.contributions.length} contribution${session.contributions.length === 1 ? '' : 's'} will be included.</p>
        </div>
        <div class="contribution-list">
          ${session.submissionFlow === 'direct'
            ? '<div class="empty-inline">Direct flow does not require extra curation.</div>'
            : session.contributions.map((item) => `
                <label class="review-item">
                  <input type="checkbox" data-contribution-id="${item.id}" ${item.accepted ? 'checked' : ''} />
                  <div>
                    <strong>${escapeHtml(item.author)}</strong>
                    <span>${escapeHtml(item.body)}</span>
                  </div>
                </label>
              `).join('')}
        </div>
        <button class="send-btn" id="review-next-btn">Prepare submission →</button>
      </div>
    `;
    document.querySelectorAll<HTMLInputElement>('[data-contribution-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const contribution = session.contributions.find((item) => item.id === checkbox.dataset.contributionId);
        if (!contribution) return;
        contribution.accepted = checkbox.checked;
        invalidatePromptPreview(session.id);
        persistAppState();
        renderSession();
      });
    });
    document.getElementById('review-next-btn')?.addEventListener('click', () => {
      workspaceSection = 'submit';
      renderSession();
    });
    return;
  }

  if (workspaceSection === 'submit') {
    const annCount = totalAnnotations(session);
    const isClaudeReady = isProviderConnected('claude', providerConnections.claude);
    const isCodexReady = isProviderConnected('codex', providerConnections.codex);
    const isCursorReady = isProviderConnected('cursor', providerConnections.cursor);
    const isReady = target === 'claude' ? isClaudeReady : target === 'codex' ? isCodexReady : isCursorReady;
    const preview = currentPromptPreview(session);

    // ── Connect card for Claude ─────────────────────────────────────────────
    const claudeConnectCard = isClaudeReady ? '' : `
      <div class="connect-card">
          <div class="connect-card-title">Connect Claude CLI</div>
        ${claudeConnecting ? `
          <div class="connect-card-body">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</div>
          <div class="connect-waiting">${sandclockMarkup('Waiting for browser login…')}</div>
          ${connectVerifyError ? `<div class="connect-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
          <button class="connect-done-btn" id="claude-done-btn">✓ Done — verify my login</button>
        ` : `
          <div class="connect-card-body">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</div>
          <button class="connect-primary-btn" id="connect-claude-btn">Connect Claude CLI →</button>
        `}
      </div>
    `;

    // ── Connect card for Codex ──────────────────────────────────────────────
    const codexConnectCard = isCodexReady ? '' : `
      <div class="connect-card">
        <div class="connect-card-title">Connect Codex CLI</div>
        <div class="connect-card-body">${escapeHtml(providerConnectionPendingCopy('codex', 'api_key'))}</div>
        ${connectVerifyError ? `<div class="connect-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
        <div class="connect-key-row">
          <input class="connect-key-input" id="codex-key-input" type="password" placeholder="sk-…" autocomplete="off" spellcheck="false" />
          <button class="connect-save-btn" id="save-codex-key-btn">Verify &amp; Save</button>
        </div>
        <div class="connect-key-hint">Stored locally on this Mac only — never sent anywhere.</div>
        <button class="connect-primary-btn secondary" id="connect-codex-btn">Open API keys page</button>
      </div>
    `;

    panel.innerHTML = `
      <div class="right-panel-head submit-panel-head">
        <div class="right-panel-title">Send session</div>
        <div class="right-panel-sub">${annCount} capture${session.captures.length !== 1 ? 's' : ''} · ${annCount} annotation${annCount !== 1 ? 's' : ''}</div>
      </div>
      <div class="right-panel-body stacked-panel submit-panel-body">
        ${submitGateError ? `<div class="submit-gate-error" role="alert">${escapeHtml(submitGateError)}</div>` : ''}

        <div class="submit-kicker">Send to</div>
        <div class="target-grid" role="radiogroup" aria-label="Choose AI destination">
          ${(['claude', 'codex', 'cursor'] as Target[]).map((provider) => {
            const connected = provider === 'claude' ? isClaudeReady : provider === 'codex' ? isCodexReady : isCursorReady;
            return `
              <button class="target-card ${target === provider ? 'active' : ''}" data-target="${provider}" role="radio" aria-checked="${target === provider ? 'true' : 'false'}">
                <span class="target-card-radio" aria-hidden="true">
                  <span class="target-card-radio-dot"></span>
                </span>
                <span class="target-card-main">
                  <span class="target-card-head">
                    <img class="provider-logo target-provider-logo" src="${providerLogoUrl(provider)}" alt="" />
                    <strong>${providerLabel(provider)}</strong>
                  </span>
                  <span class="target-status ${connected ? 'connected' : 'not-connected'}">
                    ${connected ? 'Ready' : 'Not connected'}
                  </span>
                </span>
              </button>
            `;
          }).join('')}
        </div>

        ${isReady ? `
          <div class="save-banner">✓ ${escapeHtml(providerConnectionReadyCopy(target, providerConnections[target].method))}</div>
          <div class="prompt-preview-card ${preview ? 'ready' : ''}" id="prompt-preview-card">
            <div class="prompt-preview-head">
              <div>
                <div class="prompt-preview-title">Payload preview</div>
                <div class="prompt-preview-sub">${preview
                  ? `${preview.screenshotPaths.size} screenshot path${preview.screenshotPaths.size === 1 ? '' : 's'} · ${preview.prompt.length.toLocaleString()} characters`
                  : 'Review the exact prompt before Debugr opens the provider handoff.'}</div>
              </div>
              <button type="button" class="prompt-preview-btn" id="prepare-prompt-preview-btn" ${promptPreviewPreparing || isSending ? 'disabled' : ''}>
                ${promptPreviewPreparing ? sandclockMarkup('Preparing…') : preview ? 'Refresh preview' : 'Review payload'}
              </button>
            </div>
            ${preview ? `
              <pre class="prompt-preview-text" id="prompt-preview-text">${escapeHtml(preview.prompt)}</pre>
              <div class="prompt-preview-foot">Generated ${fmtTime(preview.generatedAt)} for ${providerLabel(target)}. Any edit to the session requires a refreshed preview.</div>
            ` : `
              <div class="prompt-preview-empty">No provider will launch until this preview is generated.</div>
            `}
          </div>
          <button class="send-btn" id="send-btn" ${isSending || !preview ? 'disabled' : ''}>
            ${isSending
              ? (showSendLoadingIndicator ? sandclockMarkup('Opening…') : 'Opening…')
              : preview ? `Send to ${providerLabel(target)} ⌘↵` : `Review payload first`}
          </button>
          <div class="send-tip">${target === 'cursor'
            ? 'Debugr will open Cursor with your project folder and the session prompt ready to paste.'
            : 'Tip: set a project folder so the agent can navigate your code.'}</div>
          ${session.projectFolder
            ? `<div class="context-folder">📁 ${escapeHtml(session.projectFolder)}</div>`
            : `<button class="link-btn" id="add-folder-btn">+ Add project folder</button>`}
          ${target === 'claude' ? `<button class="disconnect-btn" id="disconnect-claude-btn">Disconnect Claude CLI</button>` : ''}
          ${target === 'codex' ? `<button class="disconnect-btn" id="disconnect-codex-btn">Disconnect Codex CLI</button>` : ''}
        ` : (target === 'claude' ? claudeConnectCard : codexConnectCard)}
      </div>
    `;

    // Provider selection
    document.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const newTarget = button.dataset.target as Target | undefined;
        if (!newTarget) return;
        target = newTarget;
        invalidatePromptPreview(session.id);
        claudeConnecting = false;
        codexConnecting = false;
        persistAppState();
        renderSession();
      });
    });

    document.getElementById('prepare-prompt-preview-btn')?.addEventListener('click', () => {
      void preparePromptPreview(session);
    });

    // Send
    document.getElementById('send-btn')?.addEventListener('click', () => void sendSession());

    // Add folder
    document.getElementById('add-folder-btn')?.addEventListener('click', async () => {
      const folder = await invoke<string | null>('pick_folder');
      if (folder) { session.projectFolder = folder; invalidatePromptPreview(session.id); persistAppState(); renderSession(); }
    });

    // ── Claude connect (Submit tab) ─────────────────────────────────────────
    document.getElementById('connect-claude-btn')?.addEventListener('click', async () => {
      claudeConnecting = true;
      connectVerifyError = '';
      renderSession();
      // Also try Terminal for the Claude CLI auth step
      const script = [
        `echo "=== Connecting Debugr to Claude CLI ==="`,
        `echo ""`,
        `echo "Complete the Claude CLI login flow, then come back to Debugr and click Done."`,
        `echo ""`,
        `claude /login`,
      ].join(' && ');
      await invoke('open_command_in_terminal', {
        cwd: process.env['HOME'] || '~',
        command: script,
        title: 'Connect Debugr to Claude CLI',
      }).catch(() => {
        claudeConnecting = false;
        connectVerifyError = 'Could not open Claude CLI login automatically. Open Terminal, run `claude /login`, finish the login flow, then return here and click Done.';
        renderSession();
      });
    });

    document.getElementById('claude-done-btn')?.addEventListener('click', async () => {
      connectVerifyError = '';
      try {
      await invoke<string>('verify_claude_auth');
      claudeApiKey = '';
      claudeConnected = true;
      claudeConnecting = false;
      claudeConnectMode = 'oauth';
      providerConnections.claude = { connected: true, method: 'oauth' };
      providerRecheckError = '';
        connectVerifyError = '';
        await saveProviderConfig();
      } catch (err) {
        connectVerifyError = String(err);
      }
      renderSession();
    });

    // ── Codex connect (Submit tab) ──────────────────────────────────────────
    document.getElementById('connect-codex-btn')?.addEventListener('click', async () => {
      codexConnecting = true;
      connectVerifyError = '';
      renderSession();
      await invoke('open_auth_popup', {
        url: 'https://platform.openai.com/api-keys',
        title: 'Connect Debugr to Codex',
        label: 'auth-codex-key',
      }).catch(() => {});
    });

    document.getElementById('save-codex-key-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('codex-key-input') as HTMLInputElement | null;
      const key = input?.value.trim() ?? '';
      connectVerifyError = '';
      try {
        await invoke<string>('verify_codex_key', { apiKey: key });
      } catch (err) {
        connectVerifyError = String(err);
        renderSession();
        return;
      }
      codexApiKey = key;
      codexConnecting = false;
      providerConnections.codex = { connected: true, method: 'api_key' };
      providerRecheckError = '';
      await saveProviderConfig();
      renderSession();
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    document.getElementById('disconnect-claude-btn')?.addEventListener('click', async () => {
      claudeApiKey = '';
      claudeConnected = false;
      claudeConnectMode = 'oauth';
      providerConnections.claude = { connected: false, method: null };
      providerRecheckError = '';
      await saveProviderConfig();
      renderSession();
    });
    document.getElementById('disconnect-codex-btn')?.addEventListener('click', async () => {
      codexApiKey = '';
      codexConnecting = false;
      providerConnections.codex = { connected: false, method: null };
      providerRecheckError = '';
      await saveProviderConfig();
      renderSession();
    });

    return;
  }

  const targetName = providerLabel(target);
  panel.innerHTML = `
    <div class="right-panel-head">
      <div class="right-panel-title">AI insights & next steps</div>
      <div class="right-panel-sub">${session.status === 'responded' ? `${targetName} has responded.` : 'Send the session to an AI provider to see the response here.'}</div>
    </div>
    <div class="right-panel-body stacked-panel">
      ${feedback ? `
        <div class="message surfaced">
          <div class="msg-role ${target}">${targetName}</div>
          <div class="msg-body">
            <strong>${escapeHtml(feedback.title)}</strong>
            <p>${escapeHtml(feedback.summary)}</p>
            ${feedback.rootCause ? `<p class="feedback-label">Root cause</p><p>${escapeHtml(feedback.rootCause)}</p>` : ''}
            ${feedback.suggestedFix ? `<p class="feedback-label">Suggested fix</p><p>${escapeHtml(feedback.suggestedFix)}</p>` : ''}
            ${feedback.codeSnippet ? `<pre><code>${escapeHtml(feedback.codeSnippet)}</code></pre>` : ''}
            <div class="next-step-list">
              ${(feedback.nextSteps ?? []).map((step) => `<div class="next-step-item">${escapeHtml(step)}</div>`).join('')}
            </div>
            <div class="insights-actions">
              <button type="button" class="btn-secondary" id="copy-insights-summary">Copy summary</button>
              ${feedback.codeSnippet ? '<button type="button" class="btn-secondary" id="copy-insights-code">Copy code</button>' : ''}
              <button type="button" class="btn-secondary" id="open-in-cursor-btn">Open in Cursor</button>
            </div>
          </div>
        </div>
      ` : `
        <div class="journey-card">
          <strong>No response yet</strong>
          <p>Once you send the session, this panel becomes the review surface for summary, root cause, suggested fix, and next actions.</p>
        </div>
      `}
      <button class="btn-secondary wide-btn" id="insights-back-btn">Back to submit</button>
    </div>
  `;
  document.getElementById('insights-back-btn')?.addEventListener('click', () => {
    workspaceSection = 'submit';
    renderSession();
  });

  const currentFeedback = feedback;
  if (currentFeedback) {
    document.getElementById('copy-insights-summary')?.addEventListener('click', async () => {
      const text = [
        currentFeedback.title,
        currentFeedback.summary,
        currentFeedback.rootCause ? `Root cause:\n${currentFeedback.rootCause}` : '',
        currentFeedback.suggestedFix ? `Suggested fix:\n${currentFeedback.suggestedFix}` : '',
        (currentFeedback.nextSteps ?? []).length > 0
          ? `Next steps:\n${(currentFeedback.nextSteps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        window.alert('Could not copy to clipboard.');
      }
    });
    document.getElementById('copy-insights-code')?.addEventListener('click', async () => {
      if (!currentFeedback.codeSnippet) return;
      try {
        await navigator.clipboard.writeText(currentFeedback.codeSnippet);
      } catch {
        window.alert('Could not copy to clipboard.');
      }
    });
    document.getElementById('open-in-cursor-btn')?.addEventListener('click', async () => {
      const folder = activeSession()?.projectFolder?.trim();
      try {
        await invoke('open_in_cursor', { projectFolder: folder && folder.length > 0 ? folder : null });
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Could not open Cursor. Is it installed?');
      }
    });
  }
}

function bindSessionActions() {
  const session = activeSession();
  document.getElementById('back-home-btn')?.addEventListener('click', async () => {
    logUi('workspace_back_home_click');
    appMode = 'welcome';
    claudeConnecting = false;
    await win.setResizable(true);
    render();
  });
  document.getElementById('new-ann-btn')?.addEventListener('click', async () => {
    logUi('workspace_new_capture_click', { sessionId: session?.id ?? null });
    await invoke('show_overlay', {
      launch: overlayLaunchForSession(session),
    });
  });
  document.getElementById('view-all-sessions-btn')?.addEventListener('click', () => {
    logUi('workspace_refresh_sessions_click');
    void loadSessionsFromApi();
  });
  document.getElementById('push-pending-btn')?.addEventListener('click', () => {
    logUi('workspace_push_pending_click');
    void pushPendingSessions();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section as WorkspaceSection | undefined;
      if (!section) return;
      logUi('workspace_section_change', { from: workspaceSection, to: section, sessionId: session?.id ?? null });
      workspaceSection = section;
      if (section === 'submit') submitGateError = '';
      renderSession();
    });
  });
  if (!session) return;

  document.getElementById('save-session-btn')?.addEventListener('click', () => {
    logUi('workspace_save_session_click', { sessionId: session.id });
    session.lastExplicitSaveAt = new Date().toISOString();
    persistAppState();
    renderSession();
  });
  document.getElementById('delete-session-btn')?.addEventListener('click', (event) => {
    logUi('workspace_delete_session_click', { sessionId: session.id });
    deleteSession(session.id);
    renderSession();
  });
  const headerTitleInput = document.getElementById('header-title-input') as HTMLInputElement | null;
  headerTitleInput?.addEventListener('input', () => {
    session.title = headerTitleInput.value || 'Untitled session';
    invalidatePromptPreview(session.id);
    const panelTitle = document.getElementById('session-title-input') as HTMLInputElement | null;
    if (panelTitle) panelTitle.value = session.title;
    logUi('workspace_title_input', { sessionId: session.id, length: session.title.length });
    persistAppState();
  });

  const titleInput = document.getElementById('session-title-input') as HTMLInputElement | null;
  const aboutInput = document.getElementById('session-about-input') as HTMLTextAreaElement | null;
  const folderInput = document.getElementById('session-folder-input') as HTMLInputElement | null;
  const repoInput = document.getElementById('session-repo-input') as HTMLInputElement | null;

  titleInput?.addEventListener('input', () => {
    session.title = titleInput.value || 'Untitled session';
    invalidatePromptPreview(session.id);
    logUi('workspace_title_input', { sessionId: session.id, length: session.title.length });
    persistAppState();
    const h = document.getElementById('header-title-input') as HTMLInputElement | null;
    if (h) h.value = session.title;
  });
  aboutInput?.addEventListener('input', () => {
    session.about = aboutInput.value.slice(0, 200);
    session.sessionNote = '';
    invalidatePromptPreview(session.id);
    logUi('workspace_about_input', { sessionId: session.id, length: session.about.length });
    const count = document.getElementById('about-count');
    if (count) count.textContent = String(session.about.length);
    submitGateError = '';
    persistAppState();
    const noteDisplay = document.getElementById('header-note-display');
    if (noteDisplay) {
      noteDisplay.innerHTML = session.about.trim()
        ? escapeHtml(session.about)
        : '<span class="session-header-note-placeholder">Add a session note…</span>';
    }
  });
  folderInput?.addEventListener('input', () => {
    session.projectFolder = normalizeProjectFolderInput(folderInput.value);
    invalidatePromptPreview(session.id);
    logUi('workspace_project_folder_input', {
      sessionId: session.id,
      hasProjectFolder: Boolean(session.projectFolder),
    });
    syncRepoContextChips(session);
    persistAppState();
  });
  repoInput?.addEventListener('input', () => {
    session.githubRepo = normalizeGithubRepoInput(repoInput.value);
    invalidatePromptPreview(session.id);
    logUi('workspace_github_repo_input', {
      sessionId: session.id,
      hasGithubRepo: Boolean(session.githubRepo),
    });
    syncRepoContextChips(session);
    persistAppState();
  });

  const folderChip = document.getElementById('session-folder-chip');
  if (!folderChip) {
    logUi('workspace_folder_chip_missing', { sessionId: session.id });
  } else {
    folderChip.addEventListener('click', async (event) => {
      event.preventDefault();
      logUi('workspace_folder_chip_click', { sessionId: session.id, hasFolder: Boolean(session.projectFolder?.trim()) });
      let picked: string | null = null;
      try {
        picked = await invoke<string | null>('pick_folder', {
          defaultPath: session.projectFolder?.trim() || null,
        });
      } catch (error) {
        logUi('workspace_folder_picker_failed', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logUi('workspace_folder_picker_result', { sessionId: session.id, picked: picked ?? null });
      if (!picked) return;
      session.projectFolder = normalizeProjectFolderInput(picked);
      invalidatePromptPreview(session.id);
      if (folderInput) folderInput.value = session.projectFolder ?? '';
      syncRepoContextChips(session);
      persistAppState();
    });
  }

  const repoChip = document.getElementById('session-repo-chip');
  if (!repoChip) {
    logUi('workspace_repo_chip_missing', { sessionId: session.id });
    return;
  }
  repoChip.addEventListener('click', (event) => {
    event.preventDefault();
    logUi('workspace_repo_chip_click', {
      sessionId: session.id,
      hasExistingRepo: Boolean(repoInput?.value.trim()),
    });
    if (!repoInput) return;
    if (!repoInput.value.trim()) {
      repoInput.value = 'owner/repo';
      session.githubRepo = 'owner/repo';
      syncRepoContextChips(session);
      persistAppState();
      repoInput.focus();
      repoInput.select();
      return;
    }
    const normalized = normalizeGithubRepoInput(repoInput.value);
    const targetUrl = /^https?:\/\//i.test(normalized) ? normalized : `https://github.com/${normalized}`;
    void invoke('open_url', { url: targetUrl }).catch((error) => {
      logUi('workspace_repo_chip_open_failed', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function syncRepoContextChips(session: Session) {
  const folderChip = document.getElementById('session-folder-chip');
  if (folderChip) folderChip.textContent = session.projectFolder ? 'Local folder linked' : 'No folder linked yet';
  const repoChip = document.getElementById('session-repo-chip');
  if (repoChip) repoChip.textContent = session.githubRepo?.trim() ? 'GitHub repo linked' : 'GitHub optional';
}

function renderPermissionReady(note: HTMLElement, detail = 'Debugr can capture your screen and create new annotations.') {
  note.innerHTML = `
    <strong>Screen capture ready</strong>
    <span>${escapeHtml(detail)}</span>
  `;
  note.className = 'perm-note ok';
  lastPermissionMarkup = note.innerHTML;
  lastPermissionClassName = note.className;
  lastPermissionCheckAt = Date.now();
  permissionAttentionMessage = '';
}

async function checkPermission() {
  const note = document.getElementById('perm-note');
  if (!note) return;
  if (lastSuccessfulScreenCaptureAt > 0) {
    renderPermissionReady(note, 'A screenshot was captured successfully in this app session.');
    return;
  }
  if (lastPermissionMarkup && Date.now() - lastPermissionCheckAt < PERMISSION_REFRESH_INTERVAL_MS) {
    note.innerHTML = lastPermissionMarkup;
    note.className = lastPermissionClassName;
    if (lastPermissionClassName.includes('warn') && lastPermissionExecutablePath) {
      bindPermissionNoteActions(lastPermissionExecutablePath);
    }
    return;
  }
  if (permissionCheckInFlight) return permissionCheckInFlight;
  permissionCheckInFlight = (async () => {
    try {
      const diagnostics = await invoke<{
      preflight: boolean;
      probe: boolean;
      granted: boolean;
      bundle_identifier: string;
      executable_path: string;
    }>('get_screen_capture_diagnostics');
      logUi('workspace_permission_diagnostics', diagnostics);
      const granted = diagnostics.granted;
      if (granted) {
        renderPermissionReady(note);
        return;
      }
      const executable = diagnostics.executable_path ?? '';
      lastPermissionExecutablePath = executable;
      const isInstalledApp = executable.includes('/Applications/dbugr.ai.app/');
      const runtimeName = isInstalledApp ? 'dbugr.ai' : 'this Debugr build';
      const runtimeHint = isInstalledApp
        ? 'If you already turned it on, quit Debugr completely and reopen it from Applications so macOS applies the permission.'
        : 'macOS grants Screen Recording per app build. If you switch between the dev build and the packaged app, each one may need its own Screen Recording entry.';
      const attention = permissionAttentionMessage
        ? `<span class="perm-attention">${escapeHtml(permissionAttentionMessage)}</span>`
        : '';
      note.innerHTML = `
      <strong>Screen capture status needs a refresh</strong>
      ${attention}
      <span>macOS says ${escapeHtml(runtimeName)} is not currently cleared for Screen Recording. If screenshots are working, this is a stale macOS permission check and you can keep using Debugr.</span>
      <span>If captures fail, open Screen Recording settings, turn on <strong>dbugr.ai</strong>, then quit and reopen Debugr.</span>
      <span>${escapeHtml(runtimeHint)}</span>
      <span class="perm-runtime-detail"><strong>Current app:</strong> ${escapeHtml(diagnostics.bundle_identifier || 'Unknown')}<br /><strong>Path:</strong> <code>${escapeHtml(diagnostics.executable_path || executable || 'Unknown')}</code></span>
      <span class="perm-runtime-detail"><strong>Not listed?</strong> Click <strong>+</strong>, press <strong>⌘⇧G</strong>, then paste the path above.</span>
      <button type="button" class="perm-note-action primary" id="repair-screen-permission-btn">Repair Screen Recording &amp; retry</button>
      <button type="button" class="perm-note-action" id="open-screen-settings-btn">Open Screen Recording settings</button>
      <button type="button" class="perm-note-action" id="reveal-runtime-btn">Reveal current runtime in Finder</button>
    `;
      note.className = 'perm-note warn';
      lastPermissionMarkup = note.innerHTML;
      lastPermissionClassName = note.className;
      lastPermissionCheckAt = Date.now();
      bindPermissionNoteActions(executable);
      return;
    } catch {
      logUi('workspace_permission_check_failed');
      note.innerHTML = `
      <strong>Screen capture status unavailable</strong>
      <span>Debugr could not check macOS screen-recording permissions right now. Try reopening the app, then open System Settings if capture still fails.</span>
    `;
      note.className = 'perm-note warn';
      lastPermissionMarkup = note.innerHTML;
      lastPermissionClassName = note.className;
      lastPermissionCheckAt = Date.now();
    } finally {
      permissionCheckInFlight = null;
    }
  })();
  return permissionCheckInFlight;
}

async function loadSessionsFromApi(options: { force?: boolean } = {}) {
  if ((window as unknown as { __DBUGR_DISABLE_API_SYNC__?: boolean }).__DBUGR_DISABLE_API_SYNC__) {
    logUi('workspace_load_sessions_skipped_for_test');
    return;
  }
  const { force = false } = options;
  if (!force) {
    if (sessionsApiLoadInFlight) return sessionsApiLoadInFlight;
    if (Date.now() - lastSessionsApiLoadAt < SESSION_API_REFRESH_INTERVAL_MS) return;
  }
  sessionsApiLoadInFlight = (async () => {
  try {
    logUi('workspace_load_sessions_start', { existingLocalSessions: sessions.length });
    const response = await fetch(`${apiBaseUrl()}/feedback-sessions`);
    if (!response.ok) throw new Error('Could not load sessions');
    const json = await response.json() as {
      data: Array<{
        id: string;
        title: string;
        createdAt: string;
        status: string;
        about?: string;
        projectFolder?: string | null;
        project_folder?: string | null;
        githubRepo?: string | null;
        github_repo?: string | null;
      }>;
    };
    const byId = new Map(sessions.map((session) => [session.id, session]));
    for (const remote of json.data ?? []) {
      if (deletedSessionIds.has(remote.id)) {
        continue;
      }
      const existing = byId.get(remote.id);
      if (existing) {
        existing.title = remote.title || existing.title;
        existing.createdAt = remote.createdAt || existing.createdAt;
        existing.status = remote.status === 'responded' || remote.status === 'sent' ? remote.status : existing.status;
        existing.about = remote.about ?? existing.about;
        existing.projectFolder = normalizeProjectFolderInput(remote.projectFolder ?? remote.project_folder ?? existing.projectFolder ?? null);
        existing.githubRepo = normalizeGithubRepoInput(remote.githubRepo ?? remote.github_repo ?? existing.githubRepo ?? '');
        continue;
      }
      sessions.push({
        id: remote.id,
        title: remote.title || 'Untitled session',
        createdAt: remote.createdAt || new Date().toISOString(),
        status: remote.status === 'responded' || remote.status === 'sent' ? remote.status : 'draft',
        captures: [],
        about: remote.about ?? '',
        sessionNote: '',
        projectFolder: normalizeProjectFolderInput(remote.projectFolder ?? remote.project_folder ?? null),
        githubRepo: normalizeGithubRepoInput(remote.githubRepo ?? remote.github_repo ?? ''),
        submissionFlow: 'direct',
        contributions: [],
        collaborationReady: false,
        lastTarget: 'claude',
        lastExplicitSaveAt: null,
      });
    }
    sessions = sortedSessions();
    logUi('workspace_load_sessions_success', {
      remoteSessions: (json.data ?? []).length,
      mergedSessions: sessions.length,
      activeSessionId,
    });
    activeSessionId ??= sessions[0]?.id ?? null;
    const firstCapture = activeSession()?.captures[0];
    activeCaptureId = firstCapture?.id ?? activeCaptureId;
    activeAnnotationId = firstCapture?.annotations[0]?.id ?? activeAnnotationId;
    lastSessionsApiLoadAt = Date.now();
    persistAppState();
    render();
  } catch {
    logUi('workspace_load_sessions_failed');
    render();
  }
  })();
  try {
    await sessionsApiLoadInFlight;
  } finally {
    sessionsApiLoadInFlight = null;
  }
}

async function loadDesktopLinkToken(): Promise<string | null> {
  try {
    const token = await invoke<string | null>('load_desktop_link_token');
    return token?.trim() || null;
  } catch (error) {
    logUi('desktop_link_token_load_failed', { error: safeErrorMessage(error).slice(0, 180) });
    return null;
  }
}

async function syncSessionToWeb(session: Session, reason: string) {
  if ((window as unknown as { __DBUGR_DISABLE_API_SYNC__?: boolean }).__DBUGR_DISABLE_API_SYNC__) {
    logUi('desktop_session_sync_skipped_for_test', { sessionId: session.id, reason });
    return;
  }

  session.webSyncStatus = 'syncing';
  session.webSyncError = null;
  persistAppState();
  refreshSessionMetaDisplay(session);
  renderSessionList();

  const token = await loadDesktopLinkToken();
  if (!token) {
    session.webSyncStatus = 'failed';
    session.webSyncError = 'Link this Mac from Dbugr web onboarding before syncing team or public review.';
    persistAppState();
    refreshSessionMetaDisplay(session);
    renderSessionList();
    logUi('desktop_session_sync_missing_token', {
      sessionId: session.id,
      reason,
      flow: session.submissionFlow,
    });
    return;
  }

  const payload = buildDesktopSessionSyncPayload(session, target);
  logUi('desktop_session_sync_started', {
    sessionId: session.id,
    reason,
    flow: session.submissionFlow,
    captureCount: payload.captures.length,
    annotationCount: payload.captures.reduce((count, capture) => count + capture.annotations.length, 0),
    apiBaseUrl: apiBaseUrl(),
  });

  try {
    const response = await fetch(`${apiBaseUrl()}/phase2/desktop-sessions/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({})) as {
      data?: { session?: { id?: string }; nextAction?: string };
      error?: unknown;
    };
    if (!response.ok) {
      const message = typeof json.error === 'string'
        ? json.error
        : response.status === 401
          ? 'This Mac is not linked anymore. Use Relink Mac app from onboarding.'
          : `Web sync failed with status ${response.status}.`;
      throw new Error(message);
    }

    session.webSessionId = json.data?.session?.id ?? session.webSessionId ?? null;
    session.webSyncedAt = new Date().toISOString();
    session.webSyncStatus = 'synced';
    session.webSyncError = null;
    persistAppState();
    refreshSessionMetaDisplay(session);
    renderSessionList();
    logUi('desktop_session_sync_completed', {
      sessionId: session.id,
      webSessionId: session.webSessionId,
      reason,
      nextAction: json.data?.nextAction ?? null,
    });
  } catch (error) {
    session.webSyncStatus = 'failed';
    session.webSyncError = safeErrorMessage(error);
    persistAppState();
    refreshSessionMetaDisplay(session);
    renderSessionList();
    logUi('desktop_session_sync_failed', {
      sessionId: session.id,
      reason,
      flow: session.submissionFlow,
      error: session.webSyncError.slice(0, 300),
    });
  }
}

async function handleDesktopDeepLink(rawUrl: string) {
  logUi('desktop_link_deep_link_received', { urlChars: rawUrl.length });
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    logUi('desktop_link_deep_link_invalid_url');
    return;
  }

  const code = parsed.searchParams.get('code')?.trim();
  const apiParam = parsed.searchParams.get('api')?.trim();
  const appParam = parsed.searchParams.get('app')?.trim();
  if (!code) {
    logUi('desktop_link_deep_link_missing_code');
    return;
  }
  if (apiParam) localStorage.setItem(API_BASE_URL_KEY, apiParam);

  const baseUrl = apiParam || apiBaseUrl();
  const deviceId = getDesktopDeviceId();
  logUi('desktop_link_redeem_started', {
    apiBaseUrl: baseUrl,
    deviceId,
    codeChars: code.length,
  });

  try {
    const response = await fetch(`${baseUrl}/phase2/desktop-link/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        desktopDeviceId: deviceId,
        desktopDeviceName: 'Dbugr Mac app',
      }),
    });
    const json = await response.json().catch(() => ({})) as {
      data?: {
        desktopLinkToken?: string;
        user?: { id?: string; email?: string; name?: string };
        organization?: { id?: string; name?: string };
      };
      error?: unknown;
    };
    if (!response.ok || !json.data?.desktopLinkToken) {
      const message = typeof json.error === 'string'
        ? json.error
        : `Could not link this Mac. Status ${response.status}.`;
      throw new Error(message);
    }

    await invoke('save_desktop_link_token', { token: json.data.desktopLinkToken });
    const user = json.data.user ?? {};
    const organization = json.data.organization ?? {};
    const profile: DesktopLinkProfile = {
      userId: user.id ?? '',
      userEmail: user.email ?? authState.email,
      userName: user.name ?? authState.name,
      organizationId: organization.id ?? '',
      organizationName: organization.name ?? authState.company,
      apiBaseUrl: baseUrl,
      appUrl: appParam,
      linkedAt: new Date().toISOString(),
      deviceId,
    };
    saveDesktopLinkProfile(profile);
    authState = {
      ...authState,
      authenticated: true,
      profileInitialized: true,
      name: profile.userName || authState.name,
      email: profile.userEmail || authState.email,
      company: profile.organizationName || authState.company,
      avatarInitials: (profile.userName || profile.userEmail || 'DB')
        .split(/\s+|@/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'DB',
    };
    persistAppState();
    logUi('desktop_link_redeem_completed', {
      userId: profile.userId,
      organizationId: profile.organizationId,
      apiBaseUrl: profile.apiBaseUrl,
      deviceId: profile.deviceId,
    });
    render();
  } catch (error) {
    logUi('desktop_link_redeem_failed', { error: safeErrorMessage(error).slice(0, 300) });
    window.alert(`${safeErrorMessage(error)}\n\nUse Relink Mac app from Dbugr onboarding to create a fresh link.`);
  }
}

/**
 * Find every session that has annotations but hasn't been sent yet,
 * build a combined prompt, and open the active AI CLI (Claude or Codex)
 * in a Terminal window.
 *
 * Mirrors the MCP flow:  get_pending_sessions → get_session → build_prompt
 */
async function pushPendingSessions() {
  const pending = getPendingSessions(sessions);

  const btn = document.getElementById('push-pending-btn') as HTMLButtonElement | null;

  if (pending.length === 0) {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<span class="push-pending-copy"><strong>No pending sessions</strong><span>Every saved session has already been routed.</span></span>';
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.disabled = false;
      }, 2000);
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="push-pending-copy"><strong>${sandclockMarkup(`Opening ${pending.length} session${pending.length > 1 ? 's' : ''}…`)}</strong><span>Preparing the prompt and handing it to ${providerLabel(target)}.</span></span>`;
  }

  // Save sessions + screenshots to disk before the CLI reads them
  await invoke('save_sessions_to_disk', { payload: { sessions } }).catch(() => {});
  const allCaptures = pending.flatMap((s) => s.captures);
  const screenshotPaths = await saveScreenshots(allCaptures);

  try {
    const diagnostics = getCombinedPromptDiagnostics(pending, screenshotPaths);
    const prompt = buildCombinedPrompt(pending, screenshotPaths);
    logUi('workspace_push_pending_prompt_ready', {
      target,
      sessionCount: pending.length,
      promptLength: prompt.length,
      diagnostics,
    });
    const cwd = normalizeProjectFolderInput(pending.find((s) => s.projectFolder?.trim())?.projectFolder) || '';
    const titleSuffix = pending.length === 1 ? pending[0]!.title : `${pending.length} pending sessions`;

    if (target === 'cursor') {
      await invoke('open_in_cursor', { projectFolder: cwd || null });
      await invoke('copy_to_clipboard', { text: prompt }).catch(() => {});
    } else {
      const cliName = target === 'codex' ? 'codex' : 'claude';
      const command = buildCliCommand(cliName, prompt);
      await invoke('open_command_in_terminal', {
        cwd: cwd || process.env['HOME'] || '~',
        command,
        title: `Debugr → ${providerLabel(target)}: ${titleSuffix}`,
      });
    }

    pending.forEach((s) => { s.status = 'sent'; s.lastTarget = target; });
    persistAppState();
    renderSession();
  } catch (err) {
    console.error('[Debugr] pushPendingSessions failed:', err);
    const hint = target === 'codex'
      ? 'Go to Submit tab → Connect Codex CLI to enter your API key'
      : 'Go to Submit tab → Connect Claude CLI to log in';
    if (btn) {
      btn.title = hint;
      btn.innerHTML = `<span class="push-pending-copy"><strong>Could not open ${providerLabel(target)}</strong><span>See the terminal, then reconnect or retry from Submit.</span></span>`;
      setTimeout(() => {
        btn.disabled = false;
        btn.title = '';
        btn.innerHTML = `<span class="push-pending-icon">↗</span><span class="push-pending-copy"><strong>${pushPendingButtonText()}</strong><span>${pushPendingButtonSubtext(target)}</span></span>`;
      }, 4000);
      return;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<span class="push-pending-icon">↗</span><span class="push-pending-copy"><strong>${pushPendingButtonText()}</strong><span>${pushPendingButtonSubtext(target)}</span></span>`;
  }
}

/**
 * Save all screenshots for a list of sessions to disk.
 * Returns a Map of captureId → absolute PNG path.
 * Fire-and-forget on individual failures — a missing screenshot is non-fatal.
 */
async function saveScreenshots(capturesToSave: Array<{ id: string; screenshotUrl?: string }>): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  await Promise.all(
    capturesToSave.map(async (c) => {
      try {
        const url = c.screenshotUrl?.trim();
        if (!url) return;
        const kind = classifyScreenshotRef(url);
        if (kind === 'data_url') {
          const path = await invoke<string>('save_screenshot', {
            captureId: c.id,
            dataUrl: url,
          });
          paths.set(c.id, path);
          return;
        }
        if (kind === 'absolute_path') {
          paths.set(c.id, url);
        }
      } catch {
        // screenshot save failed — omit path
      }
    }),
  );
  return paths;
}

/** Build the shell command string for launching the AI CLI with auth guidance. */
function buildCliCommand(cliName: 'claude' | 'codex', prompt: string): string {
  const apiKey = cliName === 'codex' ? codexApiKey : claudeApiKey;
  return buildAiCliCommand(cliName, prompt, apiKey);
}

async function preparePromptPreview(session: Session) {
  if (promptPreviewPreparing) return;
  promptPreviewPreparing = true;
  submitGateError = '';
  renderSession();
  logUi('workspace_prompt_preview_start', {
    sessionId: session.id,
    target,
    captureCount: session.captures.length,
    annotationCount: totalAnnotations(session),
    acceptedContributionCount: acceptedContributions(session).length,
  });

  try {
    const screenshotPaths = await saveScreenshots(session.captures);
    const prompt = buildSessionPrompt(session, screenshotPaths);
    promptPreviewState = {
      sessionId: session.id,
      target,
      fingerprint: promptPreviewFingerprint(session, target),
      prompt,
      screenshotPaths,
      generatedAt: new Date().toISOString(),
    };
    logUi('workspace_prompt_preview_ready', {
      sessionId: session.id,
      target,
      promptLength: prompt.length,
      diagnostics: getPromptDiagnostics(session, screenshotPaths),
    });
  } catch (error) {
    submitGateError = `Could not prepare prompt preview: ${error instanceof Error ? error.message : String(error)}`;
    logUi('workspace_prompt_preview_failed', {
      sessionId: session.id,
      target,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    promptPreviewPreparing = false;
    renderSession();
  }
}

async function sendSession() {
  const session = activeSession();
  if (!session) return;
  logUi('workspace_send_start', {
    sessionId: session.id,
    target,
    captureCount: session.captures.length,
    annotationCount: totalAnnotations(session),
  });

  submitGateError = '';
  const preview = currentPromptPreview(session);
  if (!preview) {
    submitGateError = 'Review the payload preview before sending this session.';
    logUi('workspace_send_blocked_missing_prompt_preview', { sessionId: session.id, target });
    renderSession();
    return;
  }
  if (target === 'claude' || target === 'codex') {
    const verification = await verifyProviderConnection(target);
    logUi('workspace_send_provider_verification', { target, ok: verification.ok, transient: verification.transient ?? false, error: verification.error ?? null });
    if (!verification.ok) {
      submitGateError = verification.error
        ? `${providerLabel(target)} connection check failed: ${verification.error}`
        : `${providerLabel(target)} is not connected.`;
      if (!verification.transient) {
        if (target === 'claude') {
          claudeConnected = false;
          providerConnections.claude = { connected: false, method: null };
        } else {
          codexApiKey = '';
          providerConnections.codex = { connected: false, method: null };
        }
        await saveProviderConfig();
      }
      renderSession();
      return;
    }
  }

  isSending = true;
  scheduleSendLoadingIndicator();
  session.status = 'sent';
  session.lastTarget = target;
  persistAppState();
  renderSession();

  const screenshotPaths = preview.screenshotPaths;
  logUi('workspace_send_screenshots_saved', { sessionId: session.id, screenshotCount: screenshotPaths.size });
  const prompt = preview.prompt;
  logUi('workspace_send_prompt_ready', {
    sessionId: session.id,
    target,
    promptLength: prompt.length,
    diagnostics: getPromptDiagnostics(session, screenshotPaths),
  });
  const cwd = normalizeProjectFolderInput(session.projectFolder) || normalizeProjectFolderInput(await invoke<string>('pick_folder').catch(() => '')) || '';
  const title = `Debugr → ${providerLabel(target)}: ${session.title}`;

  try {
    if (target === 'cursor') {
      logUi('workspace_send_cursor_launch', { sessionId: session.id, cwd });
      await invoke('open_in_cursor', { projectFolder: cwd || null });
      feedback = {
        title: 'Cursor opened',
        summary: 'Your project has been opened in Cursor. The session prompt has been copied to your clipboard — paste it into Cursor chat to continue.',
        nextSteps: ['Paste the session prompt into Cursor chat', 'The agent will analyse the annotated areas'],
      };
      await invoke('copy_to_clipboard', { text: prompt }).catch(() => {});
    } else {
      const cliName = target === 'codex' ? 'codex' : 'claude';
      const command = buildCliCommand(cliName, prompt);
      logUi('workspace_send_cli_launch', { sessionId: session.id, cliName, cwd, promptLength: prompt.length });
      await invoke('open_command_in_terminal', { cwd: cwd || process.env['HOME'] || '~', command, title });
      feedback = {
        title: `${providerLabel(target)} is running in Terminal`,
        summary: `A Terminal window has opened with your session context. ${screenshotPaths.size > 0 ? `${screenshotPaths.size} screenshot(s) saved locally and referenced in the prompt.` : ''} ${providerLabel(target)} is now analysing your annotations.`.trim(),
        nextSteps: [
          'Check the Terminal window that just opened',
          screenshotPaths.size > 0 ? `${providerLabel(target)} will read the screenshot(s) from disk` : `${providerLabel(target)} will respond with its analysis there`,
          'Copy any suggested fixes back to your editor',
        ],
      };
    }
  } catch (err) {
    logUi('workspace_send_failed', { sessionId: session.id, target, error: err instanceof Error ? err.message : String(err) });
    feedback = {
      title: target === 'cursor' ? 'Could not open Cursor' : 'Could not launch CLI',
      summary: target === 'cursor'
        ? `Failed to open Cursor: ${err instanceof Error ? err.message : String(err)}. Make sure Cursor is installed on this Mac.`
        : `Failed to open ${providerLabel(target)}: ${err instanceof Error ? err.message : String(err)}. Make sure the CLI is installed and on your PATH.`,
      nextSteps: [
        target === 'cursor'
          ? 'Make sure Cursor is installed on this Mac'
          : target === 'codex'
            ? 'Make sure Codex CLI is installed on this Mac'
            : 'Make sure Claude CLI is installed on this Mac',
        target === 'cursor'
          ? 'Retry after opening Cursor manually once'
          : target === 'codex'
            ? 'Go to the Submit tab → Connect Codex CLI to enter your API key'
            : 'Go to the Submit tab → Connect Claude CLI to log in',
        'Try sending again after reconnecting',
      ],
    };
  }

  session.status = 'responded';
  logUi('workspace_send_complete', { sessionId: session.id, target, status: session.status });
  isSending = false;
  clearSendLoadingIndicator();
  persistAppState();
  renderSession();
}

async function listenForAnnotations() {
  await listen<string>('dbugr-deep-link', (event) => {
    void handleDesktopDeepLink(event.payload);
  });

  await listen('request-sessions', async () => {
    const emitPickerSessions = async () => {
      const pickerSessions = localDesktopSessionsForPicker();
      logUi('workspace_picker_sessions_emit', {
        source: 'local_desktop_only',
        localPickerSessions: pickerSessions.length,
        totalSessions: sessions.length,
      });
      await emit('sessions-list', pickerSessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        annotationCount: totalAnnotations(session),
      })));
    };

    await emitPickerSessions();
    logUi('workspace_picker_sessions_api_refresh_skipped', {
      reason: 'Annotation picker must only show local desktop sessions. Web review sessions are opened from the web dashboard.',
    });
  });

  await listen<{
    annotations: Annotation[];
    targetSessionId?: string | null;
    newSessionName?: string;
    newSessionAbout?: string;
    localFolder?: string | null;
    githubRepo?: string;
    screenshotUrl?: string;
  }>('annotations-saved', async (event) => {
    const saveTraceId = typeof event.payload.saveTraceId === 'string'
      ? event.payload.saveTraceId
      : 'missing_trace';
    const targetSessionId = event.payload.targetSessionId ?? null;
    const targetSession = targetSessionId
      ? sessions.find((session) => session.id === targetSessionId)
      : null;
    const payloadTitle = event.payload.newSessionName?.trim() || '';
    const payloadAbout = event.payload.newSessionAbout?.trim() || '';
    const payloadGithubRepo = normalizeGithubRepoInput(event.payload.githubRepo);
    const payloadProjectFolder = normalizeProjectFolderInput(event.payload.localFolder);
    if ((event.payload.annotations ?? []).length === 0) {
      logUi('workspace_annotations_saved_prepare_session_event', {
        traceId: saveTraceId,
        targetSessionId,
        titleChars: payloadTitle.length,
        hasAbout: Boolean(payloadAbout),
      });
      if (!targetSessionId || !payloadTitle) return;
      const existing = sessions.find((session) => session.id === targetSessionId);
      if (existing) {
        existing.title = payloadTitle;
        existing.about = payloadAbout || existing.about;
        existing.projectFolder = payloadProjectFolder ?? existing.projectFolder ?? null;
        existing.githubRepo = payloadGithubRepo || existing.githubRepo || '';
        activeSessionId = existing.id;
      } else {
        const session: Session = {
          id: targetSessionId,
          title: payloadTitle,
          createdAt: new Date().toISOString(),
          status: 'draft',
          captures: [],
          about: payloadAbout,
          sessionNote: '',
          projectFolder: payloadProjectFolder,
          githubRepo: payloadGithubRepo,
          submissionFlow: 'direct',
          contributions: [],
          collaborationReady: false,
          lastTarget: target,
          lastExplicitSaveAt: null,
          webSessionId: null,
          webSyncedAt: null,
          webSyncStatus: 'idle',
          webSyncError: null,
        };
        sessions.unshift(session);
        activeSessionId = session.id;
      }
      sessions = sortedSessions();
      persistAppState();
      renderSessionList();
      renderSession();
      logUi('workspace_session_prepared_from_overlay', {
        traceId: saveTraceId,
        sessionId: targetSessionId,
        title: payloadTitle,
        hasAbout: Boolean(payloadAbout),
        hasLocalFolder: Boolean(payloadProjectFolder),
        hasGithubRepo: Boolean(payloadGithubRepo),
      });
      return;
    }
    const appendPlan = planAnnotationAppend(
      targetSession ? totalAnnotations(targetSession) : 0,
      event.payload.annotations?.length ?? 0,
      MAX_ANNOTATIONS,
    );
    const annotations = (event.payload.annotations ?? []).slice(0, appendPlan.acceptedCount);
    if (annotations.length === 0) {
      logUi('workspace_annotations_saved_no_accepted_annotations', {
        traceId: saveTraceId,
        targetSessionId,
        incomingCount: event.payload.annotations?.length ?? 0,
        existingSessionAnnotationCount: appendPlan.existingCount,
        maxAnnotations: appendPlan.maxAnnotations,
      });
      return;
    }
    const priorAppMode = appMode;
    const priorWorkspaceSection = workspaceSection;
    const priorActiveSessionId = activeSessionId;
    const rawShot = event.payload.screenshotUrl?.trim();
    const rawShotKind = classifyScreenshotRef(rawShot);

    logUi('workspace_annotations_saved_event', {
      traceId: saveTraceId,
      targetSessionId: event.payload.targetSessionId ?? null,
      annotationCount: annotations.length,
      rejectedAnnotationCount: appendPlan.rejectedCount,
      existingSessionAnnotationCount: appendPlan.existingCount,
      maxAnnotations: appendPlan.maxAnnotations,
      priorAppMode,
      priorWorkspaceSection,
      priorActiveSessionId,
      hasLocalFolder: Boolean(normalizeProjectFolderInput(event.payload.localFolder)),
      hasGithubRepo: Boolean(payloadGithubRepo),
      hasScreenshot: Boolean(rawShot),
      rawScreenshotKind: rawShotKind,
      rawScreenshotChars: rawShot?.length ?? 0,
    });

    const captureId = uid('capture');
    logUi('workspace_capture_materialize_start', {
      traceId: saveTraceId,
      captureId,
      rawScreenshotKind: rawShotKind,
      rawScreenshotChars: rawShot?.length ?? 0,
      annotationCount: annotations.length,
    });
    let screenshotStored: string | undefined;
    if (rawShot?.startsWith('data:image/')) {
      screenshotStored = rawShot;
    } else if (rawShot && isAbsoluteFilesystemScreenshotRef(rawShot)) {
      try {
        screenshotStored = await invoke<string>('finalize_capture_screenshot', {
          captureId,
          pendingPath: rawShot,
        });
      } catch (err) {
        logUi('workspace_finalize_screenshot_failed', {
          traceId: saveTraceId,
          captureId,
          pendingPathChars: rawShot.length,
          error: String(err).slice(0, 300),
        });
        console.warn('[Debugr] finalize_capture_screenshot failed:', err);
        screenshotStored = rawShot;
      }
    } else if (rawShot) {
      screenshotStored = rawShot;
    }

    const capture: CaptureCard = {
      id: captureId,
      title: annotations[0]?.text?.slice(0, 40) || `Capture ${fmtTime(new Date().toISOString())}`,
      preview: annotations.map((annotation) => annotation.text).filter(Boolean).join(' · ') || 'No annotation notes yet',
      annotations,
      timestamp: new Date().toISOString(),
      screenshotUrl: screenshotStored,
    };

    const storedDesc = screenshotStored
      ? classifyScreenshotRef(screenshotStored) === 'absolute_path'
        ? 'finalized_path'
        : classifyScreenshotRef(screenshotStored) === 'data_url'
          ? 'inline_data_url'
          : 'other'
      : 'none';
    logUi('workspace_capture_materialized', {
      traceId: saveTraceId,
      captureId,
      storedScreenshotKind: storedDesc,
      storedScreenshotChars: screenshotStored?.length ?? 0,
      preview_img_usable: Boolean(screenshotImgSrc(screenshotStored)),
    });
    if (screenshotStored) {
      lastSuccessfulScreenCaptureAt = Date.now();
      const permissionNote = document.getElementById('perm-note');
      if (permissionNote) {
        renderPermissionReady(permissionNote, 'A screenshot was captured successfully in this app session.');
      }
    }

    let savedSession: Session | null = null;
    if (targetSession) {
      const session = targetSession;
      session.captures.unshift(capture);
      session.about = payloadAbout || (session.about ?? '');
      session.projectFolder = payloadProjectFolder ?? session.projectFolder ?? null;
      session.githubRepo = payloadGithubRepo || (session.githubRepo ?? '');
      savedSession = session;
      activeSessionId = session.id;
      activeCaptureId = capture.id;
      activeAnnotationId = capture.annotations[0]?.id ?? null;
      lastSavedCapture = {
        sessionId: session.id,
        sessionTitle: session.title,
        annotationCount: annotations.length,
        totalSessionAnnotations: totalAnnotations(session),
      };
      logUi('workspace_annotations_saved_existing_session', {
        traceId: saveTraceId,
        sessionId: session.id,
        captureId,
        totalSessionAnnotations: totalAnnotations(session),
      });
    } else {
      const session: Session = {
        id: uid('session'),
        title: payloadTitle || `Session ${fmtTime(new Date().toISOString())}`,
        createdAt: new Date().toISOString(),
        status: 'draft',
        captures: [capture],
        about: payloadAbout,
        sessionNote: '',
        projectFolder: payloadProjectFolder,
        githubRepo: payloadGithubRepo,
        submissionFlow: 'direct',
        contributions: [],
        collaborationReady: false,
        lastTarget: target,
        lastExplicitSaveAt: null,
        webSessionId: null,
        webSyncedAt: null,
        webSyncStatus: 'idle',
        webSyncError: null,
      };
      sessions.unshift(session);
      savedSession = session;
      activeSessionId = session.id;
      activeCaptureId = capture.id;
      activeAnnotationId = capture.annotations[0]?.id ?? null;
      lastSavedCapture = {
        sessionId: session.id,
        sessionTitle: session.title,
        annotationCount: annotations.length,
        totalSessionAnnotations: totalAnnotations(session),
      };
      logUi('workspace_annotations_saved_new_session', {
        traceId: saveTraceId,
        sessionId: session.id,
        captureId,
        totalSessionAnnotations: totalAnnotations(session),
      });
    }

    sessions = sortedSessions();
    persistAppState();
    if (
      savedSession &&
      (savedSession.webSessionId || savedSession.submissionFlow === 'team' || savedSession.submissionFlow === 'public')
    ) {
      void syncSessionToWeb(savedSession, 'annotations_saved');
    }
    logUi('workspace_annotations_saved_persisted', {
      traceId: saveTraceId,
      sessionCount: sessions.length,
      activeSessionId,
      activeCaptureId,
      appModeAfterPersist: appMode,
      workspaceSectionAfterPersist: workspaceSection,
    });
    if (appMode === 'session') {
      logUi('workspace_annotations_saved_render_visible_session', {
        traceId: saveTraceId,
        sessionId: activeSessionId,
        workspaceSection,
      });
      renderSession();
    } else {
      logUi('workspace_annotations_saved_deferred_session_open', {
        traceId: saveTraceId,
        sessionId: activeSessionId,
        appMode,
      });
    }
  });

  await listen('enter-session-mode', async () => {
    if (!authState.authenticated) {
      appMode = 'welcome';
      render();
      return;
    }
    await enterSessionMode('notes');
  });

  await listen('go-home', () => {
    appMode = 'welcome';
    claudeConnecting = false;
    codexConnecting = false;
    render();
  });

  await listen<string | undefined>('screen-capture-permission-needed', async (event) => {
    permissionAttentionMessage = typeof event.payload === 'string' && event.payload.trim()
      ? event.payload.trim()
      : 'New Annotation is blocked because macOS has not granted Screen Recording to this exact Debugr build.';
    lastPermissionMarkup = '';
    if (!authState.authenticated) {
      appMode = 'welcome';
      render();
    } else {
      await enterSessionMode('notes');
    }
    await checkPermission();
  });

  await listen<string>('screen-capture-failed', async (event) => {
    await checkPermission();
    window.alert(
      event.payload || 'Debugr could not capture your screen. Use the permission card on the left to inspect which runtime is blocked, then try a new capture again.',
    );
  });
}

async function loadProviderConfig() {
  try {
    const cfg = await invoke<Record<string, unknown>>('get_provider_config');
    if (typeof cfg.claude_api_key === 'string' && cfg.claude_api_key) {
      claudeApiKey = cfg.claude_api_key;
      claudeConnected = true;
      claudeConnectMode = 'api_key';
      providerConnections.claude = { connected: true, method: 'api_key' };
    } else if (cfg.claude_connected === true) {
      claudeConnected = true;
      claudeConnectMode = cfg.claude_connection_method === 'api_key' ? 'api_key' : 'oauth';
      providerConnections.claude = { connected: true, method: claudeConnectMode };
    }
    if (typeof cfg.codex_api_key === 'string' && cfg.codex_api_key) {
      codexApiKey = cfg.codex_api_key;
      codexConnectMode = 'api_key';
      providerConnections.codex = { connected: true, method: 'api_key' };
    }
  } catch {
    // config doesn't exist yet — first run
  }
}

function isTransientConnectionError(message: string) {
  const text = message.toLowerCase();
  return text.includes('network check failed')
    || text.includes('unexpected response')
    || text.includes('could not re-verify')
    || text.includes('timed out')
    || text.includes('connection');
}

async function verifyProviderConnection(provider: 'claude' | 'codex') {
  try {
    if (provider === 'claude') {
      if (providerConnections.claude.method === 'api_key') {
        const key = claudeApiKey.trim();
        if (!key) return { ok: false, error: 'Claude API key missing.' };
        await invoke<string>('verify_claude_api_key', { apiKey: key });
        return { ok: true };
      }
      await invoke<string>('verify_claude_auth');
      return { ok: true };
    }
    const key = codexApiKey.trim();
    if (!key) return { ok: false, error: 'Codex API key missing.' };
    await invoke<string>('verify_codex_key', { apiKey: key });
    return { ok: true };
  } catch (err) {
    const message = String(err);
    return {
      ok: false,
      error: message,
      transient: isTransientConnectionError(message),
    };
  }
}

async function revalidateStoredProviderConnections() {
  providerRecheckError = '';
  let changed = false;
  const notices: string[] = [];

  if (isProviderConnected('claude', providerConnections.claude)) {
    const result = await verifyProviderConnection('claude');
    if (!result.ok && !result.transient) {
      claudeConnected = false;
      providerConnections.claude = { connected: false, method: null };
      changed = true;
      notices.push('Claude disconnected: saved auth is no longer valid.');
    } else if (!result.ok && result.error) {
      notices.push(`Claude re-check skipped for now: ${result.error}`);
    }
  }

  if (isProviderConnected('codex', providerConnections.codex)) {
    const result = await verifyProviderConnection('codex');
    if (!result.ok && !result.transient) {
      codexApiKey = '';
      providerConnections.codex = { connected: false, method: null };
      changed = true;
      notices.push('Codex disconnected: saved API key is no longer valid.');
    } else if (!result.ok && result.error) {
      notices.push(`Codex re-check skipped for now: ${result.error}`);
    }
  }

  providerRecheckError = notices.join(' ');
  if (changed) await saveProviderConfig();
}

async function saveProviderConfig() {
  await invoke('save_provider_config', {
    payload: {
      claude_api_key: claudeApiKey,
      codex_api_key: codexApiKey,
      claude_connected: claudeConnected,
      claude_connection_method: claudeConnected ? claudeConnectMode : null,
      codex_connection_method: codexApiKey ? codexConnectMode : null,
    },
  }).catch(() => {});
}

async function init() {
  hydrateAppState();
  queuePersistMirrors();
  await loadProviderConfig();
  // Check Cursor installation without blocking render
  invoke<boolean>('check_cursor_installed').then((installed) => {
    cursorInstalled = installed;
    providerConnections.cursor = {
      connected: installed,
      method: installed ? 'installed' : null,
    };
    persistAppState();
    if (appMode === 'welcome') render();
  }).catch(() => {});
  render();
  void revalidateStoredProviderConnections().then(() => {
    persistAppState();
    render();
  });
  await listenForAnnotations();
  void loadSessionsFromApi({ force: true });
}

void init();
