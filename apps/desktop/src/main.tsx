import { invoke } from '@tauri-apps/api/core';
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
  buildSessionPrompt,
  buildCombinedPrompt,
} from './core';

const brandIconUrl = new URL('./assets/brand-icon.png', import.meta.url).href;

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
}

const API = 'http://127.0.0.1:3001/api';
const APP_STATE_KEY = 'debugr-desktop-v2-state';
const MAX_ANNOTATIONS = 5;

let appMode: AppMode = 'welcome';
let sessions: Session[] = [];
let activeSessionId: string | null = null;
let activeCaptureId: string | null = null;
let workspaceSection: WorkspaceSection = 'notes';
let target: Target = 'claude';
let feedback: AgentFeedback | null = null;
let isSending = false;
let isAuthenticating = false;
let contextToggles = { consoleLogs: true, networkLogs: true, environmentInfo: true };
let lastSavedCapture: { sessionTitle: string; annotationCount: number } | null = null;
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

function activeSession() {
  return sessions.find((session) => session.id === activeSessionId);
}

function activeCapture() {
  return activeSession()?.captures.find((capture) => capture.id === activeCaptureId);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Local wrappers so module-level `sessions` state is used transparently
function sortedSessions() { return sortedSessionsUtil(sessions); }

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
  };
  try {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload));
  } catch {
    // ignore persistence errors
  }
  // Mirror sessions to disk so the local MCP server can read them.
  // Fire-and-forget — never block the UI on this.
  invoke('save_sessions_to_disk', { payload: { sessions } }).catch(() => {
    // silently ignore — disk write is best-effort
  });
}

function hydrateAppState() {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (Array.isArray(parsed.sessions)) {
      sessions = parsed.sessions.map((session) => ({
        id: session.id ?? uid('session'),
        title: session.title || 'Untitled session',
        createdAt: session.createdAt || new Date().toISOString(),
        status: session.status === 'responded' || session.status === 'sent' ? session.status : 'draft',
        captures: Array.isArray(session.captures) ? session.captures : [],
        about: session.about ?? '',
        sessionNote: session.sessionNote ?? '',
        projectFolder: session.projectFolder ?? null,
        githubRepo: session.githubRepo ?? '',
        submissionFlow: session.submissionFlow === 'team' || session.submissionFlow === 'public' ? session.submissionFlow : 'direct',
        contributions: Array.isArray(session.contributions) ? session.contributions : [],
        collaborationReady: Boolean(session.collaborationReady),
        lastTarget: session.lastTarget === 'codex' || session.lastTarget === 'cursor' ? session.lastTarget : 'claude',
        lastExplicitSaveAt: session.lastExplicitSaveAt ?? null,
      }));
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
  const width = Math.round(Math.max(1180, Math.min(1680, window.screen.availWidth * 0.94)));
  const height = Math.round(Math.max(860, Math.min(1080, window.screen.availHeight * 0.92)));
  return [width, height];
}

async function fitWindowToContent() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const card = document.querySelector<HTMLElement>('.welcome-card');
  if (!card) return;
  const maxHeight = Math.round(window.screen.availHeight * 0.9);
  const height = Math.min(card.scrollHeight + 48, maxHeight);
  await win.setSize(new LogicalSize(Math.min(980, Math.max(460, card.scrollWidth + 48)), height));
}

async function fitWelcomeWindow() {
  const [width, height] = welcomeWindowSize();
  await win.setSize(new LogicalSize(width, height));
  await win.setResizable(true);
  await win.center();
}

async function enterSessionMode(section: WorkspaceSection = 'notes') {
  appMode = 'session';
  workspaceSection = section;
  const [width, height] = sessionWindowSize();
  await win.setSize(new LogicalSize(width, height));
  await win.setResizable(true);
  await win.center();
  render();
}

function connectedProviderCount() {
  return (['claude', 'codex', 'cursor'] as Target[]).filter((provider) => isProviderConnected(provider, providerConnections[provider])).length;
}

function mockContributionBody(flow: SubmissionFlow, session: Session, index: number) {
  const capture = session.captures[index % Math.max(1, session.captures.length)];
  const annotation = capture?.annotations[index % Math.max(1, capture.annotations.length)];
  const note = annotation?.text || session.sessionNote || session.about || 'The onboarding flow needs a closer look.';
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
  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card welcome-journey-card">
        <div class="welcome-hero">
          <img class="app-icon" src="${brandIconUrl}" alt="Debugr logo" />
          <div class="welcome-hero-copy">
            <h1>Debugr V2</h1>
            <p>A desktop-first capture flow for sign-in, MCP setup, session notes, review, and AI submission.</p>
          </div>
        </div>

        <div class="welcome-grid">
          <section class="welcome-panel">
            <div class="panel-kicker">Launch & sign in</div>
            <h2>${authState.authenticated ? `Welcome back, ${escapeHtml(authState.name)}` : 'Continue with Google'}</h2>
            <p class="panel-copy">
              ${authState.authenticated
                ? 'Your desktop profile is local to this build right now, but the rest of the journey is wired so we can validate the full app behavior end to end.'
                : 'Sign in first so Debugr can attach captures, session notes, and downstream AI responses to your profile.'}
            </p>
            <button class="btn-primary" id="google-auth-btn" ${authState.authenticated || isAuthenticating ? 'disabled' : ''}>
              ${isAuthenticating ? 'Signing in…' : authState.authenticated ? 'Google connected' : 'Continue with Google'}
            </button>
            <div class="onboarding-list">
              <div class="onboarding-item ${authState.authenticated ? 'done' : ''}">
                <span class="onboarding-dot"></span>
                <div>
                  <strong>Authentication</strong>
                  <span>${authState.authenticated ? escapeHtml(authState.email) : 'Sign in to unlock the rest of the journey.'}</span>
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
                  <strong>Claude</strong>
                  <span class="provider-pill ${claudeConnected ? 'connected' : ''}">${claudeConnected ? '● Connected' : '○ Not connected'}</span>
                </div>
                ${claudeConnected ? `<button class="wc-disconnect-btn" id="wc-disconnect-claude">Disconnect</button>` : ''}
              </div>
              ${claudeConnected ? `
                <p class="wc-hint wc-connected-hint">${escapeHtml(providerConnectionReadyCopy('claude', claudeConnectMode))}</p>
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
                    <div class="wc-waiting"><div class="connect-spinner"></div>Waiting for you to finish in the browser…</div>
                    ${connectVerifyError ? `<div class="wc-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
                    <button class="wc-done-btn" id="wc-claude-done">✓ Done — verify my login</button>
                  ` : `
                    <p class="wc-hint">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</p>
                    <button class="wc-connect-btn" id="wc-connect-claude">Connect Claude →</button>
                  `}
                </div>
              `}
            </div>

            ${/* ── Codex ── */ ''}
            <div class="wc-provider-block">
              <div class="wc-provider-header">
                <div class="wc-provider-name">
                  <strong>Codex</strong>
                  <span class="provider-pill ${codexApiKey ? 'connected' : ''}">${codexApiKey ? '● Connected' : '○ Not connected'}</span>
                </div>
                ${codexApiKey ? `<button class="wc-disconnect-btn" id="wc-disconnect-codex">Disconnect</button>` : ''}
              </div>
              ${codexApiKey ? `
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
                  <strong>Cursor</strong>
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
            <div class="panel-kicker">Recent sessions</div>
            <h2>Pick up where you left off</h2>
            <p class="panel-copy">Session title, context, captures, and review state stay local so the next launch feels continuous.</p>
            <div class="recent-session-list">
              ${recentSessions.length === 0
                ? '<div class="recent-session-empty">No saved sessions yet. Your first capture will show up here.</div>'
                : recentSessions.map((session) => `
                    <button class="recent-session-tile" data-session-id="${session.id}">
                      <strong>${escapeHtml(session.title)}</strong>
                      <span>${flowLabel(session.submissionFlow)} · ${totalAnnotations(session)} annotations · ${fmtDate(session.createdAt)}</span>
                    </button>
                  `).join('')}
            </div>
            <button class="btn-primary" id="open-workspace-btn" ${authState.profileInitialized ? '' : 'disabled'}>Open workspace</button>
          </section>
        </div>
      </div>
    </div>
  `;

  document.getElementById('google-auth-btn')?.addEventListener('click', async () => {
    isAuthenticating = true;
    renderWelcome();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    authState.authenticated = true;
    authState.profileInitialized = false;
    isAuthenticating = false;
    persistAppState();
    renderWelcome();
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
    void enterSessionMode('notes');
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
      `echo "=== Connecting Debugr to Claude ==="`,
      `echo ""`,
      `echo "Complete the Claude CLI login flow, then come back to Debugr and click Done."`,
      `echo ""`,
      `claude /login`,
    ].join(' && ');
    await invoke('open_command_in_terminal', {
      cwd: process.env['HOME'] || '~',
      command: script,
      title: 'Connect Debugr to Claude',
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
      const sessionId = button.dataset.sessionId;
      if (!sessionId) return;
      activeSessionId = sessionId;
      activeCaptureId = sessions.find((session) => session.id === sessionId)?.captures[0]?.id ?? null;
      feedback = null;
      void enterSessionMode('notes');
    });
  });

  void fitWelcomeWindow();
}


function renderConfirmation() {
  const info = lastSavedCapture;
  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card confirmation-card">
        <div class="confirm-check">✓</div>
        <h1>Capture saved</h1>
        <p class="confirm-sub">
          ${info
            ? `<strong>${escapeHtml(info.sessionTitle)}</strong> · ${info.annotationCount} annotation${info.annotationCount === 1 ? '' : 's'}`
            : 'Your annotation was added to the active session.'}
        </p>
        <div class="confirm-summary">
          <div><strong>Next:</strong> in the Debugr workspace, open <strong>Submit</strong> and choose Claude, Codex, or Cursor — captures are not sent from the overlay itself.</div>
        </div>
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirm-more-btn">+ Add more annotations</button>
          <button class="btn-primary" id="confirm-open-btn">Open workspace →</button>
        </div>
        <button class="confirm-view-session" id="confirm-review-btn">Go straight to review</button>
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
  app.innerHTML = `
    <div class="app-shell visible">
      <div class="topbar">
        <div class="topbar-left">
          <div class="traffic-lights">
            <div class="traffic-light red"></div>
            <div class="traffic-light yellow"></div>
            <div class="traffic-light green"></div>
          </div>
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
          <button class="push-pending-btn" id="push-pending-btn" title="Find all unsent sessions and open them in your chosen AI CLI">
            <span class="push-pending-icon">↗</span>
            Push pending to ${providerLabel(target)}
          </button>
          <div class="perm-note" id="perm-note">Checking permissions…</div>
        </aside>

        <main class="main-pane">
          ${session ? `
            <div class="session-header session-header-rich">
              <div class="session-title-row">
                <div>
                  <div class="session-title">${escapeHtml(session.title)}</div>
                  <div class="session-meta">${fmtDate(session.createdAt)} · ${fmtTime(session.createdAt)} · ${flowLabel(session.submissionFlow)} · ${buildStatusCopy(session)}</div>
                </div>
                <div class="session-header-actions">
                  <button type="button" class="mini-action" id="save-session-btn">Save session</button>
                  <div class="session-badge responded">${escapeHtml(session.status === 'responded' ? 'Responded' : session.status === 'sent' ? 'Submitted' : 'Draft')}</div>
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
                    <span class="field-label-inline">About <span id="about-count">${(session.about ?? '').length}</span>/200</span>
                    <textarea class="field-textarea" id="session-about-input" maxlength="200" placeholder="What is this session about, and what kind of annotations are being collected?">${escapeHtml(session.about ?? '')}</textarea>
                    <span class="field-helper">Use this to give the AI the frame before it reads individual annotations.</span>
                  </label>
                  <label class="field-block">
                    <span class="field-label-inline">Session note</span>
                    <textarea class="field-textarea compact" id="session-note-input" placeholder="Add session-level notes, expected behavior, or reproduction detail.">${escapeHtml(session.sessionNote ?? '')}</textarea>
                    <span class="field-helper">This is the human note that should travel with the whole session, not just a single screenshot.</span>
                    ${totalAnnotations(session) > 1 && !(session.sessionNote ?? '').trim()
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
                    <div class="summary-chip subtle" id="session-folder-chip">${session.projectFolder ? 'Local folder linked' : 'No folder linked yet'}</div>
                    <div class="summary-chip subtle" id="session-repo-chip">${session.githubRepo ? 'GitHub repo linked' : 'GitHub optional'}</div>
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
                    <div class="capture-preview-title">${escapeHtml(capture?.title ?? session.captures[0].title)}</div>
                    <div class="capture-preview-copy">${escapeHtml(capture?.preview ?? session.captures[0].preview)}</div>
                  </div>
                  <div class="capture-list" id="capture-list"></div>
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
  if (session?.captures.length) renderCaptureList(session);
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
      const button = document.createElement('button');
      button.className = `session-item ${session.id === activeSessionId ? 'active' : ''}`;
      button.innerHTML = `
        <strong>${escapeHtml(session.title)}</strong>
        <span>${flowLabel(session.submissionFlow)} · ${fmtTime(session.createdAt)}</span>
      `;
      button.addEventListener('click', () => {
        activeSessionId = session.id;
        activeCaptureId = session.captures[0]?.id ?? null;
        feedback = session.status === 'responded' ? feedback : null;
        persistAppState();
        renderSession();
      });
      list.appendChild(button);
    });
  });
}

function renderCaptureList(session: Session) {
  const list = document.getElementById('capture-list');
  if (!list) return;
  list.innerHTML = '';
  session.captures.forEach((capture) => {
    const button = document.createElement('button');
    button.className = `capture-card ${capture.id === activeCaptureId ? 'active' : ''}`;
    button.innerHTML = `
      <div class="capture-thumb">${capture.screenshotUrl ? `<img src="${capture.screenshotUrl}" alt="" />` : '📷'}</div>
      <div class="capture-body">
        <div class="capture-title">${escapeHtml(capture.title)}</div>
        <div class="capture-preview">${escapeHtml(capture.preview)}</div>
        <div class="capture-time">${fmtTime(capture.timestamp)} · ${capture.annotations.length} annotations</div>
      </div>
    `;
    button.addEventListener('click', () => {
      activeCaptureId = capture.id;
      renderSession();
    });
    list.appendChild(button);
  });
}

function renderWorkspacePanel() {
  const panel = document.getElementById('right-panel');
  const session = activeSession();
  if (!panel || !session) return;

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
            <li>Use the 200-character about field to name the problem space.</li>
            <li>Add a session note for reproduction detail or expected behavior.</li>
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
          <button class="flow-card ${session.submissionFlow === item.flow ? 'active' : ''}" data-flow="${item.flow}">
            <strong>${item.title}</strong>
            <span>${item.copy}</span>
          </button>
        `).join('')}
        <div class="journey-card">
          <strong>Current path</strong>
          <p>${flowLabel(session.submissionFlow)} keeps the session in <strong>${session.submissionFlow === 'direct' ? 'solo mode' : session.submissionFlow === 'team' ? 'team review' : 'community curation'}</strong> until you submit it.</p>
        </div>
        <button class="send-btn" id="flow-next-btn">${session.submissionFlow === 'direct' ? 'Skip to submit →' : 'Start collaboration →'}</button>
      </div>
    `;
    document.querySelectorAll<HTMLButtonElement>('[data-flow]').forEach((button) => {
      button.addEventListener('click', () => {
        const flow = button.dataset.flow as SubmissionFlow | undefined;
        if (!flow) return;
        session.submissionFlow = flow;
        session.collaborationReady = flow === 'direct';
        if (flow === 'direct') session.contributions = [];
        persistAppState();
        renderSession();
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

    // ── Connect card for Claude ─────────────────────────────────────────────
    const claudeConnectCard = isClaudeReady ? '' : `
      <div class="connect-card">
        <div class="connect-card-title">Connect Claude</div>
        ${claudeConnecting ? `
          <div class="connect-card-body">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</div>
          <div class="connect-waiting"><div class="connect-spinner"></div>Waiting for browser login…</div>
          ${connectVerifyError ? `<div class="connect-verify-error">${escapeHtml(connectVerifyError)}</div>` : ''}
          <button class="connect-done-btn" id="claude-done-btn">✓ Done — verify my login</button>
        ` : `
          <div class="connect-card-body">${escapeHtml(providerConnectionPendingCopy('claude', 'oauth'))}</div>
          <button class="connect-primary-btn" id="connect-claude-btn">Connect Claude →</button>
        `}
      </div>
    `;

    // ── Connect card for Codex ──────────────────────────────────────────────
    const codexConnectCard = isCodexReady ? '' : `
      <div class="connect-card">
        <div class="connect-card-title">Connect Codex</div>
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
      <div class="right-panel-head">
        <div class="right-panel-title">Send session</div>
        <div class="right-panel-sub">${annCount} capture${session.captures.length !== 1 ? 's' : ''} · ${annCount} annotation${annCount !== 1 ? 's' : ''}</div>
      </div>
      <div class="right-panel-body stacked-panel">
        ${submitGateError ? `<div class="submit-gate-error" role="alert">${escapeHtml(submitGateError)}</div>` : ''}

        <div class="field-label">SEND TO</div>
        <div class="target-grid">
          ${(['claude', 'codex', 'cursor'] as Target[]).map((provider) => {
            const connected = provider === 'claude' ? isClaudeReady : provider === 'codex' ? isCodexReady : isCursorReady;
            return `
              <button class="target-card ${target === provider ? 'active' : ''}" data-target="${provider}">
                <strong>${providerLabel(provider)}</strong>
                <span class="target-status ${connected ? 'connected' : 'not-connected'}">
                  ${connected ? '● Ready' : '○ Not connected'}
                </span>
              </button>
            `;
          }).join('')}
        </div>

        ${isReady ? `
          <div class="save-banner">✓ ${escapeHtml(providerConnectionReadyCopy(target, providerConnections[target].method))}</div>
          <button class="send-btn" id="send-btn" ${isSending ? 'disabled' : ''}>
            ${isSending ? 'Opening…' : `Send to ${providerLabel(target)} ⌘↵`}
          </button>
          <div class="send-tip">${target === 'cursor'
            ? 'Debugr will open Cursor with your project folder and the session prompt ready to paste.'
            : 'Tip: set a project folder so the agent can navigate your code.'}</div>
          ${session.projectFolder
            ? `<div class="context-folder">📁 ${escapeHtml(session.projectFolder)}</div>`
            : `<button class="link-btn" id="add-folder-btn">+ Add project folder</button>`}
          ${target === 'claude' ? `<button class="disconnect-btn" id="disconnect-claude-btn">Disconnect Claude</button>` : ''}
          ${target === 'codex' ? `<button class="disconnect-btn" id="disconnect-codex-btn">Disconnect Codex</button>` : ''}
        ` : (target === 'claude' ? claudeConnectCard : codexConnectCard)}
      </div>
    `;

    // Provider selection
    document.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const newTarget = button.dataset.target as Target | undefined;
        if (!newTarget) return;
        target = newTarget;
        claudeConnecting = false;
        codexConnecting = false;
        persistAppState();
        renderSession();
      });
    });

    // Send
    document.getElementById('send-btn')?.addEventListener('click', () => void sendSession());

    // Add folder
    document.getElementById('add-folder-btn')?.addEventListener('click', async () => {
      const folder = await invoke<string | null>('pick_folder');
      if (folder) { session.projectFolder = folder; persistAppState(); renderSession(); }
    });

    // ── Claude connect (Submit tab) ─────────────────────────────────────────
    document.getElementById('connect-claude-btn')?.addEventListener('click', async () => {
      claudeConnecting = true;
      connectVerifyError = '';
      renderSession();
      // Also try Terminal for the CLI auth step
      const script = [
        `echo "=== Connecting Debugr to Claude ==="`,
        `echo ""`,
        `echo "Complete the Claude CLI login flow, then come back to Debugr and click Done."`,
        `echo ""`,
        `claude /login`,
      ].join(' && ');
      await invoke('open_command_in_terminal', {
        cwd: process.env['HOME'] || '~',
        command: script,
        title: 'Connect Debugr to Claude',
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
      await saveProviderConfig();
      renderSession();
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    document.getElementById('disconnect-claude-btn')?.addEventListener('click', async () => {
      claudeApiKey = '';
      claudeConnected = false;
      claudeConnectMode = 'oauth';
      providerConnections.claude = { connected: false, method: null };
      await saveProviderConfig();
      renderSession();
    });
    document.getElementById('disconnect-codex-btn')?.addEventListener('click', async () => {
      codexApiKey = '';
      codexConnecting = false;
      providerConnections.codex = { connected: false, method: null };
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
    appMode = 'welcome';
    claudeConnecting = false;
    await win.setResizable(true);
    render();
  });
  document.getElementById('new-ann-btn')?.addEventListener('click', async () => {
    await invoke('show_overlay');
  });
  document.getElementById('view-all-sessions-btn')?.addEventListener('click', () => {
    void loadSessionsFromApi();
  });
  document.getElementById('push-pending-btn')?.addEventListener('click', () => {
    void pushPendingSessions();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section as WorkspaceSection | undefined;
      if (!section) return;
      workspaceSection = section;
      if (section === 'submit') submitGateError = '';
      renderSession();
    });
  });
  if (!session) return;

  document.getElementById('save-session-btn')?.addEventListener('click', () => {
    session.lastExplicitSaveAt = new Date().toISOString();
    persistAppState();
    renderSession();
  });
  const titleInput = document.getElementById('session-title-input') as HTMLInputElement | null;
  const aboutInput = document.getElementById('session-about-input') as HTMLTextAreaElement | null;
  const noteInput = document.getElementById('session-note-input') as HTMLTextAreaElement | null;
  const folderInput = document.getElementById('session-folder-input') as HTMLInputElement | null;
  const repoInput = document.getElementById('session-repo-input') as HTMLInputElement | null;

  titleInput?.addEventListener('input', () => {
    session.title = titleInput.value || 'Untitled session';
    persistAppState();
    renderSession();
  });
  aboutInput?.addEventListener('input', () => {
    session.about = aboutInput.value.slice(0, 200);
    const count = document.getElementById('about-count');
    if (count) count.textContent = String(session.about.length);
    persistAppState();
  });
  noteInput?.addEventListener('input', () => {
    session.sessionNote = noteInput.value;
    submitGateError = '';
    persistAppState();
  });
  folderInput?.addEventListener('input', () => {
    session.projectFolder = folderInput.value.trim() || null;
    syncRepoContextChips(session);
    persistAppState();
  });
  repoInput?.addEventListener('input', () => {
    session.githubRepo = normalizeGithubRepoInput(repoInput.value);
    syncRepoContextChips(session);
    persistAppState();
  });
}

function normalizeGithubRepoInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const fromUrl = trimmed.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
  if (!fromUrl) return trimmed;
  return fromUrl[1]?.replace(/\.git$/i, '') ?? trimmed;
}

function syncRepoContextChips(session: Session) {
  const folderChip = document.getElementById('session-folder-chip');
  if (folderChip) folderChip.textContent = session.projectFolder ? 'Local folder linked' : 'No folder linked yet';
  const repoChip = document.getElementById('session-repo-chip');
  if (repoChip) repoChip.textContent = session.githubRepo?.trim() ? 'GitHub repo linked' : 'GitHub optional';
}

async function checkPermission() {
  const note = document.getElementById('perm-note');
  if (!note) return;
  try {
    const granted = await invoke<boolean>('get_screen_capture_permission');
    if (granted) {
      note.innerHTML = `
        <strong>Screen capture ready</strong>
        <span>Debugr can capture your screen and create new annotations.</span>
      `;
      note.className = 'perm-note ok';
      return;
    }
    note.innerHTML = `
      <strong>Screen capture blocked</strong>
      <span>Debugr still needs macOS Screen &amp; System Audio Recording access. Open the Screen Recording panel, enable Debugr, then quit and reopen the app if macOS asks.</span>
      <button type="button" class="perm-note-action" id="open-screen-settings-btn">Open Screen Recording settings</button>
    `;
    note.className = 'perm-note warn';
    document.getElementById('open-screen-settings-btn')?.addEventListener('click', () => {
      void invoke('open_screen_capture_settings');
    });
    return;
  } catch {
    note.innerHTML = `
      <strong>Screen capture status unavailable</strong>
      <span>Debugr could not check macOS screen-recording permissions right now. Try reopening the app, then open System Settings if capture still fails.</span>
    `;
    note.className = 'perm-note warn';
  }
}

async function loadSessionsFromApi() {
  try {
    const response = await fetch(`${API}/feedback-sessions`);
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
      const existing = byId.get(remote.id);
      if (existing) {
        existing.title = remote.title || existing.title;
        existing.createdAt = remote.createdAt || existing.createdAt;
        existing.status = remote.status === 'responded' || remote.status === 'sent' ? remote.status : existing.status;
        existing.about = remote.about ?? existing.about;
        existing.projectFolder = remote.projectFolder ?? remote.project_folder ?? existing.projectFolder ?? null;
        existing.githubRepo = remote.githubRepo ?? remote.github_repo ?? existing.githubRepo ?? '';
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
        projectFolder: remote.projectFolder ?? remote.project_folder ?? null,
        githubRepo: remote.githubRepo ?? remote.github_repo ?? '',
        submissionFlow: 'direct',
        contributions: [],
        collaborationReady: false,
        lastTarget: 'claude',
        lastExplicitSaveAt: null,
      });
    }
    sessions = sortedSessions();
    activeSessionId ??= sessions[0]?.id ?? null;
    activeCaptureId = activeSession()?.captures[0]?.id ?? activeCaptureId;
    persistAppState();
    render();
  } catch {
    render();
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
      const orig = btn.textContent ?? '';
      btn.textContent = 'No pending sessions';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = `Opening ${pending.length} session${pending.length > 1 ? 's' : ''}…`; }

  // Save sessions + screenshots to disk before the CLI reads them
  await invoke('save_sessions_to_disk', { payload: { sessions } }).catch(() => {});
  const allCaptures = pending.flatMap((s) => s.captures);
  const screenshotPaths = await saveScreenshots(allCaptures);

  try {
    const prompt = buildCombinedPrompt(pending, screenshotPaths);
    const cwd = pending.find((s) => s.projectFolder?.trim())?.projectFolder?.trim() || '';
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
      ? 'Go to Submit tab → Connect Codex to enter your API key'
      : 'Go to Submit tab → Connect Claude to log in';
    if (btn) {
      btn.title = hint;
      btn.textContent = `CLI error — see terminal`;
      setTimeout(() => {
        btn.disabled = false;
        btn.title = '';
        btn.innerHTML = `<span class="push-pending-icon">↗</span> Push pending to ${providerLabel(target)}`;
      }, 4000);
      return;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<span class="push-pending-icon">↗</span> Push pending to ${providerLabel(target)}`;
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
    capturesToSave
      .filter((c) => c.screenshotUrl?.startsWith('data:image/'))
      .map(async (c) => {
        try {
          const path = await invoke<string>('save_screenshot', {
            captureId: c.id,
            dataUrl: c.screenshotUrl,
          });
          paths.set(c.id, path);
        } catch {
          // screenshot save failed — prompt will just omit the path
        }
      }),
  );
  return paths;
}

/** Build the shell command string for launching the AI CLI with auth guidance. */
function buildCliCommand(cliName: 'claude' | 'codex', prompt: string): string {
  const escaped = prompt.replace(/'/g, "'\\''");
  if (cliName === 'codex' && codexApiKey) {
    // Prepend the stored API key so the user never has to touch env vars
    const escapedKey = codexApiKey.replace(/'/g, "'\\''");
    return `OPENAI_API_KEY='${escapedKey}' codex '${escaped}'`;
  }
  return `${cliName} '${escaped}'`;
}

async function sendSession() {
  const session = activeSession();
  if (!session) return;

  submitGateError = '';
  isSending = true;
  session.status = 'sent';
  session.lastTarget = target;
  persistAppState();
  renderSession();

  // Save screenshots to disk so the CLI can view them
  const screenshotPaths = await saveScreenshots(session.captures);
  const prompt = buildSessionPrompt(session, screenshotPaths);
  const cwd = session.projectFolder?.trim() || (await invoke<string>('pick_folder').catch(() => '')) || '';
  const title = `Debugr → ${providerLabel(target)}: ${session.title}`;

  try {
    if (target === 'cursor') {
      await invoke('open_in_cursor', { projectFolder: cwd || null });
      feedback = {
        title: 'Cursor opened',
        summary: 'Your project has been opened in Cursor. The session prompt has been copied to your clipboard — paste it into the Cursor agent chat.',
        nextSteps: ['Paste the session prompt into Cursor chat', 'The agent will analyse the annotated areas'],
      };
      await invoke('copy_to_clipboard', { text: prompt }).catch(() => {});
    } else {
      const cliName = target === 'codex' ? 'codex' : 'claude';
      const command = buildCliCommand(cliName, prompt);
      await invoke('open_command_in_terminal', { cwd: cwd || process.env['HOME'] || '~', command, title });
      feedback = {
        title: `${providerLabel(target)} is running in Terminal`,
        summary: `A Terminal window has opened with your session context. ${screenshotPaths.size > 0 ? `${screenshotPaths.size} screenshot(s) saved locally and referenced in the prompt.` : ''} ${providerLabel(target)} CLI is now analysing your annotations.`.trim(),
        nextSteps: [
          'Check the Terminal window that just opened',
          screenshotPaths.size > 0 ? `${providerLabel(target)} will read the screenshot(s) from disk` : `${providerLabel(target)} will respond with its analysis there`,
          'Copy any suggested fixes back to your editor',
        ],
      };
    }
  } catch (err) {
    feedback = {
      title: 'Could not launch CLI',
      summary: `Failed to open ${providerLabel(target)}: ${err instanceof Error ? err.message : String(err)}. Make sure the CLI is installed and on your PATH.`,
      nextSteps: [
        target === 'codex'
          ? 'Make sure Codex CLI is installed on this Mac'
          : 'Make sure Claude CLI is installed on this Mac',
        target === 'codex'
          ? 'Go to the Submit tab → Connect Codex to enter your API key'
          : 'Go to the Submit tab → Connect Claude to log in',
        'Try sending again after reconnecting',
      ],
    };
  }

  session.status = 'responded';
  isSending = false;
  persistAppState();
  renderSession();
}

async function listenForAnnotations() {
  await listen('request-sessions', async () => {
    await emit('sessions-list', sortedSessions().map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
    })));
    await loadSessionsFromApi();
    await emit('sessions-list', sortedSessions().map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
    })));
  });

  await listen<{
    annotations: Annotation[];
    targetSessionId?: string | null;
    newSessionName?: string;
    newSessionAbout?: string;
    localFolder?: string | null;
    githubRepo?: string;
  }>('annotations-saved', async (event) => {
    const annotations = (event.payload.annotations ?? []).slice(0, MAX_ANNOTATIONS);
    if (annotations.length === 0) return;

    const capture: CaptureCard = {
      id: uid('capture'),
      title: annotations[0]?.text?.slice(0, 40) || `Capture ${fmtTime(new Date().toISOString())}`,
      preview: annotations.map((annotation) => annotation.text).filter(Boolean).join(' · ') || 'No annotation notes yet',
      annotations,
      timestamp: new Date().toISOString(),
    };

    const targetSessionId = event.payload.targetSessionId ?? null;
    if (targetSessionId && sessions.find((session) => session.id === targetSessionId)) {
      const session = sessions.find((item) => item.id === targetSessionId)!;
      session.captures.unshift(capture);
      session.about = event.payload.newSessionAbout ?? session.about ?? '';
      session.projectFolder = event.payload.localFolder ?? session.projectFolder ?? null;
      session.githubRepo = event.payload.githubRepo ?? session.githubRepo ?? '';
      activeSessionId = session.id;
      activeCaptureId = capture.id;
      lastSavedCapture = {
        sessionTitle: session.title,
        annotationCount: annotations.length,
      };
    } else {
      const session: Session = {
        id: uid('session'),
        title: event.payload.newSessionName || `Session ${fmtTime(new Date().toISOString())}`,
        createdAt: new Date().toISOString(),
        status: 'draft',
        captures: [capture],
        about: event.payload.newSessionAbout ?? '',
        sessionNote: '',
        projectFolder: event.payload.localFolder ?? null,
        githubRepo: event.payload.githubRepo ?? '',
        submissionFlow: 'direct',
        contributions: [],
        collaborationReady: false,
        lastTarget: target,
        lastExplicitSaveAt: null,
      };
      sessions.unshift(session);
      activeSessionId = session.id;
      activeCaptureId = capture.id;
      lastSavedCapture = {
        sessionTitle: session.title,
        annotationCount: annotations.length,
      };
    }

    sessions = sortedSessions();
    persistAppState();
    // Go straight to the submit screen so the user can immediately send to Claude / Codex
    await enterSessionMode('submit');
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

  await listen('screen-capture-permission-needed', async () => {
    if (!authState.authenticated) {
      appMode = 'welcome';
      render();
    } else {
      await enterSessionMode('notes');
    }
    await checkPermission();
    const shouldOpenSettings = window.confirm(
      'Debugr needs macOS Screen & System Audio Recording permission before it can start annotating.\n\nOpen System Settings to the Screen Recording panel now?',
    );
    if (shouldOpenSettings) {
      await invoke('open_screen_capture_settings').catch(() => {});
    }
  });

  await listen<string>('screen-capture-failed', async () => {
    await checkPermission();
    window.alert(
      'Debugr could not capture your screen in this run. Please click "Open Screen Recording settings", then ensure the active Debugr app entry is enabled. If it is already enabled, toggle it off/on and relaunch Debugr once.',
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
  await listenForAnnotations();
  void loadSessionsFromApi();
}

void init();
