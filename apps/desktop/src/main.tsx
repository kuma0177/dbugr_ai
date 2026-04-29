import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import './index.css';

const brandIconUrl = new URL('./assets/brand-icon.png', import.meta.url).href;

// ── Types ────────────────────────────────────────────────────────────────────

type Target = 'claude' | 'codex';
type AppMode = 'welcome' | 'session';
type RightPanel = 'none' | 'share' | 'feedback';

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
interface CaptureCard { id: string; title: string; preview: string; screenshotUrl?: string; annotations: Annotation[]; timestamp: string; }
interface Session { id: string; title: string; captures: CaptureCard[]; createdAt: string; status: 'draft' | 'sent' | 'responded'; }
interface AgentFeedback { title: string; summary: string; rootCause?: string; suggestedFix?: string; codeSnippet?: string; nextSteps: string[]; }

const API = 'http://127.0.0.1:3001/api';
const MAX_ANNOTATIONS = 5;

// ── State ────────────────────────────────────────────────────────────────────

let appMode: AppMode = 'welcome';
let rightPanel: RightPanel = 'none';
let sessions: Session[] = [];
let activeSessionId: string | null = null;
let activeCaptureId: string | null = null;
let target: Target = 'codex';
let contextToggles = { consoleLogs: true, networkLogs: true, environmentInfo: true };
let feedback: AgentFeedback | null = null;
let isSending = false;

const win = getCurrentWindow();

// ── Seed data (so the app looks great immediately) ────────────────────────────

const seedSessions: Session[] = [
  {
    id: 'session_demo_1',
    title: 'Onboarding flow bug',
    status: 'responded',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    captures: [
      {
        id: 'cap_1', title: 'Setup skip crash',
        preview: 'The onboarding flow is breaking for users who skip setup.',
        annotations: [
          { id: 'a1', number: 1, x: 120, y: 200, text: 'The onboarding flow is breaking for users who skip setup.', tags: ['Bug', 'Blocking'], timestamp: new Date(Date.now() - 5 * 60_000).toISOString() },
        ],
        timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      {
        id: 'cap_2', title: 'Missing preferences',
        preview: 'Console shows undefined error in UserSettings.tsx',
        annotations: [
          { id: 'a2', number: 1, x: 340, y: 180, text: 'Console shows undefined error in UserSettings.tsx', tags: ['Bug'], timestamp: new Date(Date.now() - 3 * 60_000).toISOString() },
        ],
        timestamp: new Date(Date.now() - 3 * 60_000).toISOString(),
      },
      {
        id: 'cap_3', title: 'Broken CTA state',
        preview: 'Confusing fallback state when no workspace exists',
        annotations: [
          { id: 'a3', number: 1, x: 200, y: 300, text: 'Confusing fallback state when no workspace exists', tags: ['UX'], timestamp: new Date(Date.now() - 1 * 60_000).toISOString() },
        ],
        timestamp: new Date(Date.now() - 1 * 60_000).toISOString(),
      },
    ],
  },
  {
    id: 'session_demo_2',
    title: 'API error on save',
    status: 'draft',
    createdAt: new Date(Date.now() - 70 * 60_000).toISOString(),
    captures: [
      {
        id: 'cap_4', title: 'Save fails silently',
        preview: 'No error shown when POST /api/save returns 500',
        annotations: [],
        timestamp: new Date(Date.now() - 70 * 60_000).toISOString(),
      },
    ],
  },
  {
    id: 'session_demo_3',
    title: 'Settings confusion',
    status: 'draft',
    createdAt: new Date(Date.now() - 28 * 3600_000).toISOString(),
    captures: [
      {
        id: 'cap_5', title: 'Unclear toggle labels',
        preview: 'Users don\'t understand what "sync" means in preferences',
        annotations: [],
        timestamp: new Date(Date.now() - 28 * 3600_000).toISOString(),
      },
      {
        id: 'cap_6', title: 'Missing help text',
        preview: 'No tooltip on the notification toggle',
        annotations: [],
        timestamp: new Date(Date.now() - 27 * 3600_000).toISOString(),
      },
    ],
  },
];

sessions = seedSessions;
activeSessionId = 'session_demo_1';
activeCaptureId = 'cap_1';

// ── DOM root ──────────────────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>('#app')!;

// ── Helpers ───────────────────────────────────────────────────────────────────

function activeSession(): Session | undefined { return sessions.find(s => s.id === activeSessionId); }
function activeCapture(): CaptureCard | undefined { return activeSession()?.captures.find(c => c.id === activeCaptureId); }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function groupSessions() {
  const now = new Date();
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const d = new Date(s.createdAt);
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const label = sameDay ? 'Today' : d.toDateString() === yest.toDateString() ? 'Yesterday' : d.toLocaleDateString();
    groups.set(label, [...(groups.get(label) || []), s]);
  }
  return groups;
}

// ── Enter session mode (resize window) ───────────────────────────────────────

function sessionWindowSize(): [number, number] {
  // Target ~80% of screen width / 78% height, clamped to sensible min/max.
  // window.screen gives the logical pixel dimensions of the current display.
  const w = Math.round(Math.max(720, Math.min(1280, window.screen.width  * 0.80)));
  const h = Math.round(Math.max(560, Math.min( 860, window.screen.height * 0.78)));
  return [w, h];
}

async function enterSessionMode() {
  appMode = 'session';
  const [w, h] = sessionWindowSize();
  await win.setSize(new LogicalSize(w, h));
  await win.setResizable(true);
  await win.center();
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (appMode === 'welcome') renderWelcome();
  else renderSession();
}

// ── Welcome screen ────────────────────────────────────────────────────────────

function renderWelcome() {
  const recentSessions = [...sessions].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 4);
  app.innerHTML = `
    <div class="welcome-shell">
      <div class="welcome-card">
        <img class="app-icon" src="${brandIconUrl}" alt="Debugr logo" />
        <h1>Debugr is ready</h1>
        <p>Press the shortcut anytime to annotate your current screen and send to Claude or Codex.</p>
        <div class="shortcut-row">
          <span class="shortcut-label">Global shortcut</span>
          <kbd>⌘</kbd><kbd>⌥</kbd><kbd>A</kbd>
        </div>
        <button class="btn-primary" id="start-bg-btn">Start background mode</button>
        <div class="recent-sessions">
          <div class="recent-sessions-head">
            <span>Recent sessions</span>
            <button class="recent-sessions-link" id="open-sessions-btn">Open all</button>
          </div>
          <div class="recent-session-list">
            ${recentSessions.map(session => `
              <button class="recent-session-item" data-session-id="${session.id}">
                <strong>${session.title}</strong>
                <span>${session.captures.length} capture${session.captures.length === 1 ? '' : 's'} · ${fmtTime(session.createdAt)}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <p class="welcome-footer">Debugr stays in your menu bar — use ⌘⌥A from any app.</p>
      </div>
    </div>
  `;

  document.getElementById('start-bg-btn')!.addEventListener('click', async () => {
    // Register shortcut then hide
    try { await invoke('register_global_shortcut'); } catch { /* ignore if already registered */ }
    await invoke('hide_main_window');
  });

  document.getElementById('open-sessions-btn')?.addEventListener('click', async () => {
    appMode = 'session';
    rightPanel = 'none';
    await win.setSize(new LogicalSize(1060, 700));
    await win.setResizable(true);
    await win.center();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('.recent-session-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sessionId = btn.dataset.sessionId;
      if (!sessionId) return;
      activeSessionId = sessionId;
      activeCaptureId = sessions.find(s => s.id === sessionId)?.captures[0]?.id ?? null;
      appMode = 'session';
      rightPanel = 'none';
      await win.setSize(new LogicalSize(...sessionWindowSize()));
      await win.setResizable(true);
      await win.center();
      render();
    });
  });
}

// ── Session app ───────────────────────────────────────────────────────────────

function renderSession() {
  const session = activeSession();
  const totalAnnotations = session?.captures.reduce((n, c) => n + c.annotations.length, 0) ?? 0;

  app.innerHTML = `
    <div class="app-shell visible">

      <!-- Topbar -->
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
          <button class="btn-new-capture" id="new-ann-btn">+ New Capture</button>
        </div>
      </div>

      <!-- Body -->
      <div class="app-body">

        <!-- Sidebar -->
        <aside class="sidebar">
          <div class="sidebar-label">Sessions</div>
          <div id="session-list"></div>
          <button class="view-all-link" id="view-all-sessions-btn">View all sessions →</button>
          <div class="perm-note" id="perm-note">Checking permissions…</div>
        </aside>

        <!-- Main pane -->
        <main class="main-pane">
          ${session ? `
            <div class="session-header">
              <div class="session-title-row">
                <div class="session-title">${session.title}</div>
                ${session.status === 'responded'
                  ? '<div class="session-badge responded">✓ Responded</div>'
                  : '<div></div>'}
              </div>
              <div class="session-meta" id="session-meta">
                Today, ${fmtTime(session.createdAt)} · acme/project · ${totalAnnotations} annotation${totalAnnotations === 1 ? '' : 's'}
              </div>
            </div>

            <div class="capture-list" id="capture-list"></div>

            <div class="saved-bar">
              ✓ Session saved locally and ready to share
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <div class="empty-title">No session selected</div>
              <div class="empty-copy">Select a session from the sidebar or press ⌘⌥A to start a new annotation.</div>
            </div>
          `}
        </main>

        <!-- Right panel -->
        <div class="right-panel ${rightPanel !== 'none' ? 'visible' : ''}" id="right-panel"></div>
      </div>
    </div>
  `;

  renderSessionList();
  if (session) renderCaptureList(session);
  if (rightPanel === 'share') renderSharePanel();
  if (rightPanel === 'feedback') renderFeedbackPanel();
  checkPermission();
  bindSessionActions();
}

// ── Session sidebar ───────────────────────────────────────────────────────────

function renderSessionList() {
  const listEl = document.getElementById('session-list')!;
  const groups = groupSessions();
  listEl.innerHTML = '';
  groups.forEach((group, label) => {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'session-group-label';
    groupLabel.textContent = label;
    listEl.appendChild(groupLabel);
    group.forEach(s => {
      const btn = document.createElement('button');
      btn.className = `session-item${s.id === activeSessionId ? ' active' : ''}`;
      btn.innerHTML = `<strong>${s.title}</strong><span>${fmtTime(s.createdAt)}</span>`;
      btn.addEventListener('click', () => {
        activeSessionId = s.id;
        activeCaptureId = s.captures[0]?.id ?? null;
        rightPanel = 'none';
        renderSession();
      });
      listEl.appendChild(btn);
    });
  });
}

// ── Capture cards ─────────────────────────────────────────────────────────────

function renderCaptureList(session: Session) {
  const listEl = document.getElementById('capture-list')!;
  listEl.innerHTML = '';
  session.captures.forEach(cap => {
    const card = document.createElement('div');
    card.className = `capture-card${cap.id === activeCaptureId ? ' active' : ''}`;
    card.innerHTML = `
      <div class="capture-thumb">
        ${cap.screenshotUrl ? `<img src="${cap.screenshotUrl}" alt="" />` : '📷'}
      </div>
      <div class="capture-body">
        <div class="capture-title">${cap.title}</div>
        <div class="capture-preview">${cap.preview || 'No description'}</div>
        <div class="capture-time">${fmtTime(cap.timestamp)}</div>
      </div>
      <button class="capture-menu" title="More options">···</button>
    `;
    card.addEventListener('click', () => {
      activeCaptureId = cap.id;
      if (rightPanel !== 'feedback') rightPanel = 'share';
      renderSession();
    });
    card.querySelector('.capture-menu')!.addEventListener('click', e => e.stopPropagation());
    listEl.appendChild(card);
  });
}

// ── Share panel ───────────────────────────────────────────────────────────────

function renderSharePanel() {
  const panelEl = document.getElementById('right-panel')!;
  const session = activeSession()!;
  const totalCaps = session.captures.length;
  const totalAnns = session.captures.reduce((n, c) => n + c.annotations.length, 0);

  panelEl.innerHTML = `
    <div class="right-panel-head">
      <div class="right-panel-title">Send session</div>
      <div class="right-panel-sub">${totalCaps} capture${totalCaps === 1 ? '' : 's'} · ${totalAnns} annotation${totalAnns === 1 ? '' : 's'} · acme/project</div>
    </div>
    <div class="right-panel-body">

      <!-- Session preview -->
      <div class="share-session-preview">
        <div class="share-thumb"></div>
        <div>
          <div class="share-session-name">${session.title}</div>
          <div class="share-session-meta">${totalCaps} captures · Today, ${fmtTime(session.createdAt)}</div>
        </div>
      </div>

      <!-- Destination -->
      <div class="field-label">Send to</div>
      <div class="target-grid">
        <button class="target-card${target === 'claude' ? ' active' : ''}" id="target-claude">
          <strong>✺ Claude</strong><span>AI assistant</span>
        </button>
        <button class="target-card${target === 'codex' ? ' active' : ''}" id="target-codex">
          <strong>⬡ Codex</strong><span>Code agent</span>
        </button>
      </div>

      <!-- Context -->
      <div class="field-label">Include context</div>
      <div class="context-list">
        <label><input type="checkbox" id="ctx-console" ${contextToggles.consoleLogs ? 'checked' : ''} /> Console logs</label>
        <label><input type="checkbox" id="ctx-network" ${contextToggles.networkLogs ? 'checked' : ''} /> Network logs</label>
        <label><input type="checkbox" id="ctx-env" ${contextToggles.environmentInfo ? 'checked' : ''} /> Environment info</label>
        <label><input type="checkbox" checked disabled /> App & window metadata</label>
        <label><input type="checkbox" checked disabled /> GitHub repo metadata</label>
      </div>

      <!-- Send button -->
      <button class="send-btn" id="send-btn" ${isSending ? 'disabled' : ''}>
        ${isSending
          ? '<div class="loading-spinner"></div> Sending…'
          : `Send to ${target === 'claude' ? 'Claude' : 'Codex'}  ⌘↵`}
      </button>
    </div>
  `;

  // Target selection
  document.getElementById('target-claude')!.addEventListener('click', () => { target = 'claude'; renderSharePanel(); });
  document.getElementById('target-codex')!.addEventListener('click', () => { target = 'codex'; renderSharePanel(); });

  // Checkboxes
  document.getElementById('ctx-console')!.addEventListener('change', e => { contextToggles.consoleLogs = (e.target as HTMLInputElement).checked; });
  document.getElementById('ctx-network')!.addEventListener('change', e => { contextToggles.networkLogs = (e.target as HTMLInputElement).checked; });
  document.getElementById('ctx-env')!.addEventListener('change', e => { contextToggles.environmentInfo = (e.target as HTMLInputElement).checked; });

  // Send
  document.getElementById('send-btn')!.addEventListener('click', () => void sendSession());
}

// ── Feedback panel ────────────────────────────────────────────────────────────

function renderFeedbackPanel() {
  const panelEl = document.getElementById('right-panel')!;
  const session = activeSession()!;

  const isLoading = !feedback;
  const targetLabel = target === 'claude' ? 'Claude' : 'Codex';
  const msgRoleClass = target === 'claude' ? 'claude' : 'codex';

  panelEl.innerHTML = `
    <div class="right-panel-head">
      <div class="right-panel-title">${session.title}</div>
      <div class="right-panel-sub">${session.status === 'responded' ? '✓ Responded' : 'Waiting for response…'}</div>
    </div>

    <!-- Tabs -->
    <div class="conv-tabs">
      <button class="conv-tab active">Conversation</button>
      <button class="conv-tab">Details</button>
    </div>

    <!-- User message -->
    <div class="message">
      <div class="msg-role user">You — Today, ${fmtTime(session.createdAt)}</div>
      <div class="msg-body">
        You sent this session to ${targetLabel}.
        <span style="color:var(--muted);font-size:11px;display:block;margin-top:4px;">
          ${session.captures.length} captures · ${session.captures.reduce((n, c) => n + c.annotations.length, 0)} annotations
        </span>
      </div>
    </div>

    ${isLoading ? `
    <div class="message">
      <div class="msg-role ${msgRoleClass}">${targetLabel}</div>
      <div class="msg-body" style="display:flex;align-items:center;gap:10px;color:var(--muted);">
        <div class="loading-spinner" style="border-color:rgba(100,116,139,0.25);border-top-color:var(--muted);"></div>
        ${targetLabel} is analyzing your capture…
      </div>
    </div>
    ` : `
    <div class="message">
      <div class="msg-role ${msgRoleClass}" style="margin-bottom:8px;">${targetLabel} · Today, ${fmtTime(new Date().toISOString())}</div>
      <div class="msg-body">
        <strong>${feedback!.title}</strong>
        <p style="margin:6px 0 0;">${feedback!.summary}</p>
        ${feedback!.rootCause ? `
          <p style="margin:10px 0 4px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);">Root cause</p>
          <p style="margin:0;">${feedback!.rootCause}</p>
        ` : ''}
        ${feedback!.suggestedFix ? `
          <p style="margin:10px 0 4px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);">Suggested fix</p>
          <p style="margin:0;">${feedback!.suggestedFix}</p>
        ` : ''}
        ${feedback!.codeSnippet ? `<pre><code>${feedback!.codeSnippet}</code></pre>` : ''}
        <div class="msg-actions" style="margin-top:12px;">
          <button class="msg-action-btn">Copy fix</button>
          <button class="msg-action-btn">Open PR</button>
          <button class="msg-action-btn">Follow-up</button>
        </div>
      </div>
    </div>
    `}

    <div class="reply-bar">
      <input class="reply-input" placeholder="Reply to ${targetLabel}…" />
    </div>
  `;
}

// ── Send session ──────────────────────────────────────────────────────────────

async function sendSession() {
  const session = activeSession();
  if (!session) return;

  isSending = true;
  rightPanel = 'feedback';
  feedback = null;
  renderSession();

  try {
    // Try real API
    const res = await fetch(`${API}/feedback-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: session.title,
        userIntent: JSON.stringify({
          captures: session.captures,
          target,
          contextToggles,
        }),
        visibility: 'private',
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const sessionId = json.data?.id;
      if (sessionId) {
        const sendRes = await fetch(`${API}/feedback-sessions/${sessionId}/send-to-claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        if (sendRes.ok) {
          const sendJson = await sendRes.json();
          const af = sendJson.data?.agent_feedback;
          if (af) {
            feedback = {
              title: af.title || 'Analysis complete',
              summary: af.summary || sendJson.data.message,
              rootCause: af.root_cause,
              suggestedFix: af.suggested_fix,
              codeSnippet: af.code_snippet,
              nextSteps: af.next_steps || [],
            };
            session.status = 'responded';
          }
        }
      }
    }
  } catch {
    // Offline / API unavailable — use demo response
  }

  // Fallback demo response
  if (!feedback) {
    await new Promise(r => setTimeout(r, 1800));
    feedback = {
      title: 'Root cause identified',
      summary: 'The crash happens when onboarding setup is skipped. The preferences object is accessed before initialization, causing a runtime error in UserSettings.tsx.',
      rootCause: 'The optional setup step is skipping initialization of user preferences. This causes undefined values in UserSettings.tsx.',
      suggestedFix: 'Guard the preferences object before rendering the setup-dependent component.',
      codeSnippet: `if (!prefs) {\n  return &lt;SetupWizard /&gt;\n}`,
      nextSteps: [
        'Add null guard in UserSettings.tsx line 42',
        'Add integration test for skipped onboarding',
        'Update docs to clarify optional setup path',
      ],
    };
    session.status = 'responded';
  }

  isSending = false;
  renderSession();
}

// ── Bind session-level actions ─────────────────────────────────────────────────

function bindSessionActions() {
  document.getElementById('new-ann-btn')?.addEventListener('click', async () => {
    await invoke('show_overlay');
  });

  document.getElementById('view-all-sessions-btn')?.addEventListener('click', async () => {
    appMode = 'session';
    rightPanel = 'none';
    activeSessionId = sessions[0]?.id ?? null;
    activeCaptureId = activeSession()?.captures[0]?.id ?? null;
    await win.setSize(new LogicalSize(1060, 700));
    await win.setResizable(true);
    await win.center();
    render();
  });
}

// ── Permission check ──────────────────────────────────────────────────────────

async function checkPermission() {
  const noteEl = document.getElementById('perm-note');
  if (!noteEl) return;
  try {
    const granted = await invoke<boolean>('get_screen_capture_permission');
    noteEl.textContent = granted ? '● Screen capture enabled' : '⚠ Screen capture blocked';
    noteEl.className = `perm-note ${granted ? 'ok' : 'warn'}`;
    if (!granted) {
      noteEl.style.cursor = 'pointer';
      noteEl.addEventListener('click', () => invoke('open_screen_capture_settings'));
    }
  } catch {
    noteEl.style.display = 'none';
  }
}

// ── Load sessions from API (if server is running) ─────────────────────────────

async function loadSessionsFromApi() {
  try {
    const res = await fetch(`${API}/feedback-sessions`);
    if (!res.ok) return;
    const json = await res.json() as { data: Array<{ id: string; title: string; createdAt: string; status: string }> };
    if (!Array.isArray(json.data) || json.data.length === 0) return;
    const apiSessions: Session[] = json.data.slice(0, 8).map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      status: (s.status as Session['status']) || 'draft',
      captures: [],
    }));
    // Merge: keep seed sessions, prepend API sessions
    const existingIds = new Set(sessions.map(s => s.id));
    const newOnes = apiSessions.filter(s => !existingIds.has(s.id));
    if (newOnes.length > 0) {
      sessions = [...newOnes, ...sessions];
      if (appMode === 'session') render();
    }
  } catch { /* API not running — use seed data */ }
}

// ── Listen for events from overlay ───────────────────────────────────────────

async function listenForAnnotations() {
  await listen<{ annotations: Array<{ id: string; number: number; x: number; y: number; width?: number; height?: number; kind?: 'pin' | 'region'; text: string; tags: string[]; timestamp: string }> }>(
    'annotations-saved',
    async (event) => {
      // Create a new capture from the overlay annotations
      const anns = event.payload.annotations;
      const sessionMode = (event.payload as { sessionMode?: 'append' | 'new' }).sessionMode ?? 'append';
      if (anns.length === 0) return;

      const normalized = anns.slice(0, MAX_ANNOTATIONS);
      const newCapture: CaptureCard = {
        id: `cap_${Date.now()}`,
        title: normalized[0].text.slice(0, 40) || `Capture ${new Date().toLocaleTimeString()}`,
        preview: normalized.map(a => a.text).filter(Boolean).join(' · ') || 'No description',
        annotations: normalized,
        timestamp: new Date().toISOString(),
      };

      // Add to active session or create new one
      if (sessionMode === 'append' && activeSessionId) {
        const sess = sessions.find(s => s.id === activeSessionId);
        if (sess) {
          const used = sess.captures.reduce((n, c) => n + c.annotations.length, 0);
          const remaining = MAX_ANNOTATIONS - used;
          if (remaining <= 0) {
            console.warn(`Session ${sess.id} already has ${MAX_ANNOTATIONS} annotations. Starting a new session instead.`);
            const overflowSession: Session = {
              id: `session_${Date.now()}`,
              title: `Session ${new Date().toLocaleTimeString()}`,
              status: 'draft',
              createdAt: new Date().toISOString(),
              captures: [newCapture],
            };
            sessions.unshift(overflowSession);
            activeSessionId = overflowSession.id;
            activeCaptureId = newCapture.id;
          } else {
            newCapture.annotations = normalized.slice(0, remaining);
            newCapture.preview = newCapture.annotations.map(a => a.text).filter(Boolean).join(' · ') || 'No description';
            newCapture.title = newCapture.annotations[0]?.text.slice(0, 40) || newCapture.title;
            sess.captures.push(newCapture);
            activeCaptureId = newCapture.id;
          }
        } else {
          const newSession: Session = {
            id: `session_${Date.now()}`,
            title: `Session ${new Date().toLocaleTimeString()}`,
            status: 'draft',
            createdAt: new Date().toISOString(),
            captures: [newCapture],
          };
          sessions.unshift(newSession);
          activeSessionId = newSession.id;
          activeCaptureId = newCapture.id;
        }
      } else {
        const newSession: Session = {
          id: `session_${Date.now()}`,
          title: sessionMode === 'new' ? `New session ${new Date().toLocaleTimeString()}` : `Session ${new Date().toLocaleTimeString()}`,
          status: 'draft',
          createdAt: new Date().toISOString(),
          captures: [newCapture],
        };
        sessions.unshift(newSession);
        activeSessionId = newSession.id;
        activeCaptureId = newCapture.id;
      }

      // Show session window (already triggered from overlay, but ensure mode)
      appMode = 'session';
      rightPanel = 'share';
      await win.setSize(new LogicalSize(...sessionWindowSize()));
      await win.setResizable(true);
      await win.center();
      render();
    }
  );

  // Listen for tray "Sessions" action
  await listen('enter-session-mode', async () => {
    appMode = 'session';
    await win.setSize(new LogicalSize(1060, 700));
    await win.setResizable(true);
    await win.center();
    render();
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  render();
  await listenForAnnotations();
  void loadSessionsFromApi();
}

void init();
