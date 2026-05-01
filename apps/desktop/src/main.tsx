import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen, emit } from '@tauri-apps/api/event';
import './index.css';

const brandIconUrl = new URL('./assets/brand-icon.png', import.meta.url).href;

type Target = 'claude' | 'codex' | 'cursor';
type AppMode = 'welcome' | 'session' | 'confirmation';
type BridgeMethod = 'mcp' | 'script';
type WorkspaceSection = 'notes' | 'flow' | 'collab' | 'review' | 'submit' | 'insights';
type SubmissionFlow = 'direct' | 'team' | 'public';

interface Annotation {
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

interface CaptureCard {
  id: string;
  title: string;
  preview: string;
  screenshotUrl?: string;
  annotations: Annotation[];
  timestamp: string;
}

interface Contribution {
  id: string;
  source: 'team' | 'community';
  author: string;
  type: 'annotation' | 'comment' | 'session_note';
  body: string;
  accepted: boolean;
  timestamp: string;
}

interface Session {
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
  /** Last time user clicked Save session (explicit checkpoint). */
  lastExplicitSaveAt?: string | null;
}

interface AgentFeedback {
  title: string;
  summary: string;
  rootCause?: string;
  suggestedFix?: string;
  codeSnippet?: string;
  nextSteps: string[];
}

interface BridgeCommand {
  label: string;
  cwd: string;
  command: string;
  description: string;
}

interface BridgeSetup {
  target: Target;
  repoRoot: string;
  commands: Record<BridgeMethod, BridgeCommand>;
}

interface ProviderConnection {
  connected: boolean;
  method: BridgeMethod | null;
  lastConnectedAt?: string;
}

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
  providerConnections: Record<Target, ProviderConnection>;
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
let bridgeSetup: BridgeSetup | null = null;
let bridgeSetupRequested = false;
let connectingTarget: Target | null = null;
let bridgeLaunchMessage = '';
let contextToggles = { consoleLogs: true, networkLogs: true, environmentInfo: true };
let lastSavedCapture: { sessionTitle: string; annotationCount: number } | null = null;
/** Inline validation when Send is blocked (e.g. missing session note). */
let submitGateError = '';
let authState: AuthState = {
  authenticated: false,
  profileInitialized: false,
  name: 'Kumar',
  email: 'kumar@example.com',
  avatarInitials: 'KU',
  company: '',
  role: '',
};
let providerConnections: Record<Target, ProviderConnection> = {
  claude: { connected: false, method: null },
  codex: { connected: false, method: null },
  cursor: { connected: false, method: null },
};

const win = getCurrentWindow();
const app = document.querySelector<HTMLDivElement>('#app')!;

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function escapeHtml(value: string | undefined | null) {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

function providerLabel(value: Target) {
  if (value === 'codex') return 'Codex';
  if (value === 'cursor') return 'Cursor';
  return 'Claude';
}

function providerSubtitle(value: Target) {
  if (value === 'codex') return 'GPT-4.1 or local CLI';
  if (value === 'cursor') return 'Cursor background agent';
  return 'Anthropic Claude';
}

function flowLabel(flow: SubmissionFlow) {
  if (flow === 'team') return 'Team review';
  if (flow === 'public') return 'Public feed';
  return 'Direct to AI';
}

function sectionLabel(section: WorkspaceSection) {
  if (section === 'notes') return 'Annotate & note';
  if (section === 'flow') return 'Choose flow';
  if (section === 'collab') return 'Collaborate';
  if (section === 'review') return 'Review & curate';
  if (section === 'submit') return 'Submit';
  return 'Insights';
}

function sortedSessions() {
  return [...sessions].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

function totalAnnotations(session: Session) {
  return session.captures.reduce((count, capture) => count + capture.annotations.length, 0);
}

function acceptedContributions(session: Session) {
  return session.contributions.filter((item) => item.accepted);
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
        claude: parsed.providerConnections.claude ?? providerConnections.claude,
        codex: parsed.providerConnections.codex ?? providerConnections.codex,
        cursor: parsed.providerConnections.cursor ?? providerConnections.cursor,
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
  return Object.values(providerConnections).filter((provider) => provider.connected).length;
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
    if (connectingTarget) renderConnectionSetup();
    else renderWelcome();
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
            <div class="panel-kicker">Connect AI platforms</div>
            <h2>MCP destinations</h2>
            <p class="panel-copy">Launch the bridge you want for each AI surface. These buttons open the real helper in Terminal.</p>
            <p class="panel-copy panel-copy-muted">No cloud MCP tokens are stored in the app — the bridge runs locally on your machine.</p>
            <div class="provider-list">
              ${(['claude', 'codex', 'cursor'] as Target[]).map((provider) => `
                <div class="provider-card">
                  <div>
                    <strong>${providerLabel(provider)}</strong>
                    <span>${providerSubtitle(provider)}</span>
                  </div>
                  <div class="provider-card-actions">
                    <span class="provider-pill ${providerConnections[provider].connected ? 'connected' : ''}">
                      ${providerConnections[provider].connected ? `Connected${providerConnections[provider].method ? ` via ${providerConnections[provider].method.toUpperCase()}` : ''}` : 'Not connected'}
                    </span>
                    <button class="mini-action" data-connect-provider="${provider}">
                      ${providerConnections[provider].connected ? 'Reconnect' : 'Connect'}
                    </button>
                  </div>
                </div>
              `).join('')}
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

  document.querySelectorAll<HTMLButtonElement>('[data-connect-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      const provider = button.dataset.connectProvider as Target | undefined;
      if (!provider) return;
      connectingTarget = provider;
      bridgeLaunchMessage = '';
      bridgeSetup = null;
      bridgeSetupRequested = false;
      render();
    });
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

function renderConnectionSetup() {
  const provider = connectingTarget ?? target;
  if (!bridgeSetupRequested) {
    bridgeSetupRequested = true;
    void loadBridgeSetup(provider).then((setup) => {
      bridgeSetup = setup;
      render();
    });
  }

  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card confirmation-card">
        <div class="confirm-check connect-accent">⚡</div>
        <h1>Connect ${providerLabel(provider)}</h1>
        <p class="confirm-sub">Choose how Debugr should launch the local bridge for ${providerLabel(provider)}.</p>

        ${bridgeLaunchMessage ? `<div class="launch-message">${escapeHtml(bridgeLaunchMessage)}</div>` : ''}

        <div class="connect-options">
          ${(['mcp', 'script'] as BridgeMethod[]).map((method) => `
            <button class="connect-option" data-bridge-method="${method}">
              <div class="connect-option-icon">${method === 'mcp' ? '🔌' : '⚙️'}</div>
              <div class="connect-option-body">
                <div class="connect-option-title">${method === 'mcp' ? 'MCP server' : 'Background script'}</div>
                <div class="connect-option-desc">
                  ${bridgeSetup?.commands[method]?.description ?? 'Loading bridge details…'}
                </div>
                ${bridgeSetup?.commands[method]
                  ? `<div class="connect-command">${escapeHtml(`${bridgeSetup.commands[method].cwd} · ${bridgeSetup.commands[method].command}`)}</div>`
                  : ''}
              </div>
              ${method === 'mcp' ? '<span class="connect-option-badge">Recommended</span>' : ''}
            </button>
          `).join('')}
        </div>

        <div class="connect-help">
          Debugr opens the actual helper in Terminal. Keep that helper running while the AI client reads context from this app.
        </div>

        <button class="btn-secondary" id="connect-back-btn">← Back</button>
      </div>
    </div>
  `;

  document.getElementById('connect-back-btn')?.addEventListener('click', () => {
    connectingTarget = null;
    bridgeLaunchMessage = '';
    bridgeSetup = null;
    bridgeSetupRequested = false;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-bridge-method]').forEach((button) => {
    button.addEventListener('click', async () => {
      const method = button.dataset.bridgeMethod as BridgeMethod | undefined;
      if (!method || !provider) return;
      await launchBridge(provider, method);
    });
  });

  void fitWindowToContent();
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
  app.innerHTML = `
    <div class="app-shell visible">
      <div class="topbar">
        <div class="traffic-lights">
          <div class="traffic-light red"></div>
          <div class="traffic-light yellow"></div>
          <div class="traffic-light green"></div>
        </div>
        <div class="topbar-title">
          <img class="topbar-brand-icon" src="${brandIconUrl}" alt="" />
          <span>Debugr</span>
        </div>
        <div class="topbar-actions">
          <button class="mini-action" id="back-home-btn">Home</button>
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
          <div class="sidebar-label">Sessions</div>
          <div id="session-list"></div>
          <button class="view-all-link" id="view-all-sessions-btn">Refresh sessions ↻</button>
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
                    <div class="summary-chip subtle">${session.projectFolder ? 'Local folder linked' : 'No folder linked yet'}</div>
                    <div class="summary-chip subtle">${session.githubRepo ? 'GitHub repo linked' : 'GitHub optional'}</div>
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
    const connected = providerConnections[target].connected;
    panel.innerHTML = `
      <div class="right-panel-head">
        <div class="right-panel-title">Submit to AI</div>
        <div class="right-panel-sub">Choose the destination and the final context packet.</div>
      </div>
      <div class="right-panel-body stacked-panel">
        ${submitGateError ? `<div class="submit-gate-error" role="alert">${escapeHtml(submitGateError)}</div>` : ''}
        <div class="field-label">Destination</div>
        <div class="target-grid target-grid-wide">
          ${(['claude', 'codex', 'cursor'] as Target[]).map((provider) => `
            <button class="target-card ${target === provider ? 'active' : ''}" data-target="${provider}">
              <strong>${providerLabel(provider)}</strong>
              <span>${providerSubtitle(provider)}</span>
            </button>
          `).join('')}
        </div>

        <div class="journey-card">
          <strong>Submission flow</strong>
          <p>${flowLabel(session.submissionFlow)} · ${session.submissionFlow === 'direct' ? 'The AI will read your session as-is.' : `${acceptedContributions(session).length} curated contribution${acceptedContributions(session).length === 1 ? '' : 's'} will be attached.`}</p>
        </div>

        <div class="field-label">Include context</div>
        <div class="context-list">
          <label><input type="checkbox" id="ctx-console" ${contextToggles.consoleLogs ? 'checked' : ''} /> Console logs</label>
          <label><input type="checkbox" id="ctx-network" ${contextToggles.networkLogs ? 'checked' : ''} /> Network logs</label>
          <label><input type="checkbox" id="ctx-env" ${contextToggles.environmentInfo ? 'checked' : ''} /> Environment info</label>
          <label><input type="checkbox" checked disabled /> Session about + notes</label>
          <label><input type="checkbox" checked disabled /> Captures + accepted review items</label>
        </div>

        ${connected
          ? `<button class="send-btn" id="send-btn" ${isSending ? 'disabled' : ''}>${isSending ? 'Sending…' : `Send to ${providerLabel(target)} →`}</button>`
          : `<button class="send-btn" id="connect-provider-btn">Connect ${providerLabel(target)} first</button>`}
      </div>
    `;
    document.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextTarget = button.dataset.target as Target | undefined;
        if (!nextTarget) return;
        target = nextTarget;
        persistAppState();
        renderSession();
      });
    });
    document.getElementById('ctx-console')?.addEventListener('change', (event) => {
      contextToggles.consoleLogs = (event.target as HTMLInputElement).checked;
    });
    document.getElementById('ctx-network')?.addEventListener('change', (event) => {
      contextToggles.networkLogs = (event.target as HTMLInputElement).checked;
    });
    document.getElementById('ctx-env')?.addEventListener('change', (event) => {
      contextToggles.environmentInfo = (event.target as HTMLInputElement).checked;
    });
    document.getElementById('connect-provider-btn')?.addEventListener('click', () => {
      connectingTarget = target;
      bridgeLaunchMessage = '';
      bridgeSetup = null;
      bridgeSetupRequested = false;
      render();
    });
    document.getElementById('send-btn')?.addEventListener('click', () => void sendSession());
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

  if (feedback) {
    document.getElementById('copy-insights-summary')?.addEventListener('click', async () => {
      const text = [
        feedback.title,
        feedback.summary,
        feedback.rootCause ? `Root cause:\n${feedback.rootCause}` : '',
        feedback.suggestedFix ? `Suggested fix:\n${feedback.suggestedFix}` : '',
        (feedback.nextSteps ?? []).length > 0
          ? `Next steps:\n${(feedback.nextSteps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`
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
      if (!feedback.codeSnippet) return;
      try {
        await navigator.clipboard.writeText(feedback.codeSnippet);
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
    connectingTarget = null;
    bridgeLaunchMessage = '';
    await win.setResizable(true);
    render();
  });
  document.getElementById('new-ann-btn')?.addEventListener('click', async () => {
    await invoke('show_overlay');
  });
  document.getElementById('view-all-sessions-btn')?.addEventListener('click', () => {
    void loadSessionsFromApi();
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
    session.projectFolder = folderInput.value || null;
    persistAppState();
  });
  repoInput?.addEventListener('input', () => {
    session.githubRepo = repoInput.value;
    persistAppState();
  });
}

async function checkPermission() {
  const note = document.getElementById('perm-note');
  if (!note) return;
  try {
    const granted = await invoke<boolean>('get_screen_capture_permission');
    note.textContent = granted ? '● Screen capture enabled' : '⚠ Screen capture blocked';
    note.className = `perm-note ${granted ? 'ok' : 'warn'}`;
    if (!granted) {
      note.addEventListener('click', () => void invoke('open_screen_capture_settings'), { once: true });
    }
  } catch {
    note.style.display = 'none';
  }
}

async function loadBridgeSetup(provider: Target) {
  try {
    const response = await fetch(`${API}/system/bridge-setup?target=${provider}`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.data as BridgeSetup;
  } catch {
    return null;
  }
}

async function launchBridge(provider: Target, method: BridgeMethod) {
  const setup = bridgeSetup || await loadBridgeSetup(provider);
  if (!setup) {
    bridgeLaunchMessage = 'Could not load bridge setup from the API.';
    render();
    return;
  }
  bridgeSetup = setup;
  const command = setup.commands[method];
  try {
    await invoke('open_command_in_terminal', {
      cwd: command.cwd,
      command: command.command,
      title: `${command.label} · ${providerLabel(provider)} · Debugr`,
    });
    providerConnections[provider] = {
      connected: true,
      method,
      lastConnectedAt: new Date().toISOString(),
    };
    authState.profileInitialized = authState.authenticated;
    bridgeLaunchMessage = `${command.label} launched for ${providerLabel(provider)}. Keep the Terminal helper running while Debugr hands off session context.`;
    target = provider;
    persistAppState();
  } catch (error) {
    bridgeLaunchMessage = error instanceof Error ? error.message : 'Failed to launch the helper command.';
  }
  connectingTarget = null;
  bridgeSetup = null;
  bridgeSetupRequested = false;
  render();
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

async function sendSession() {
  const session = activeSession();
  if (!session) return;

  const annCount = totalAnnotations(session);
  if (annCount > 1 && !(session.sessionNote ?? '').trim()) {
    submitGateError =
      'Add a session-level note before sending. It is required when this session has more than one annotation.';
    workspaceSection = 'submit';
    renderSession();
    return;
  }
  submitGateError = '';

  isSending = true;
  session.status = 'sent';
  session.lastTarget = target;
  workspaceSection = 'insights';
  feedback = null;
  persistAppState();
  renderSession();

  const payload = {
    projectId: 'proj_demo',
    title: session.title,
    about: session.about ?? '',
    projectFolder: session.projectFolder ?? '',
    githubRepo: session.githubRepo ?? '',
    visibility: session.submissionFlow === 'public' ? 'public' : session.submissionFlow === 'team' ? 'org' : 'private',
    userIntent: JSON.stringify({
      sessionContext: {
        about: session.about ?? '',
        sessionNote: session.sessionNote ?? '',
        projectFolder: session.projectFolder ?? '',
        githubRepo: session.githubRepo ?? '',
        submissionFlow: session.submissionFlow,
        profileCompany: authState.company ?? '',
        profileRole: authState.role ?? '',
      },
      captures: session.captures,
      curatedContributions: acceptedContributions(session),
      target,
      contextToggles,
    }),
  };

  try {
    const response = await fetch(`${API}/feedback-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const json = await response.json();
      const sessionId = json.data?.id as string | undefined;
      if (sessionId) {
        if (session.submissionFlow === 'team' || session.submissionFlow === 'public') {
          try {
            await fetch(`${API}/feedback-sessions/${sessionId}/finalize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ durationMs: 0 }),
            });
          } catch {
            /* finalize is best-effort for desktop handoff */
          }
        }
        const sendResponse = await fetch(`${API}/feedback-sessions/${sessionId}/send-to-claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        if (sendResponse.ok) {
          const sendJson = await sendResponse.json();
          const agent = sendJson.data?.agent_feedback;
          if (agent) {
            feedback = {
              title: agent.title || 'Analysis complete',
              summary: agent.summary || sendJson.data.message,
              rootCause: agent.root_cause,
              suggestedFix: agent.suggested_fix,
              codeSnippet: agent.code_snippet,
              nextSteps: agent.next_steps || [],
            };
          }
        }
      }
    }
  } catch {
    // fall back below
  }

  if (!feedback) {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    feedback = {
      title: `${providerLabel(target)} found the likely root cause`,
      summary: 'The captured flow suggests the session is missing a setup guard, so the optional path falls through before the expected state is initialized.',
      rootCause: 'The about text and annotations point to a skipped initialization branch. That leaves downstream components reading undefined data.',
      suggestedFix: 'Add a guard around the setup-dependent render path and use the session note as the reproduction breadcrumb in the resulting task.',
      codeSnippet: `const prefs = user.preferences?.setup ?? null\nif (!prefs) return <SetupWizard />`,
      nextSteps: [
        'Reproduce the issue with the onboarding skip path.',
        'Add a guard before the session-dependent component renders.',
        'Keep the session note in the final implementation task so the coding agent sees the expected behavior.',
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
    appMode = 'confirmation';
    await win.setSize(new LogicalSize(460, 420));
    await win.setResizable(false);
    await win.center();
    render();
  });

  await listen('enter-session-mode', async () => {
    if (!authState.authenticated) {
      appMode = 'welcome';
      render();
      return;
    }
    await enterSessionMode('notes');
  });
}

async function init() {
  hydrateAppState();
  render();
  await listenForAnnotations();
  void loadSessionsFromApi();
}

void init();
