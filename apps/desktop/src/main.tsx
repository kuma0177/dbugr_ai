import './index.css';
import { invoke } from '@tauri-apps/api/core';

type Target = 'claude' | 'codex';

interface BoxNote {
  id: string;
  text: string;
  createdAt: string;
}

interface CaptureBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: BoxNote[];
}

interface FeedbackSessionSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  userIntent?: string | null;
  _count?: { comments: number; tasks: number };
}

interface CapturePayload {
  mode: 'native-capture';
  captureTitle: string;
  captureUrl?: string;
  handoffTarget: Target;
  screenshotDataUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  capturedAt: string;
  boxes: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    notes: BoxNote[];
    screenshot: string;
  }>;
}

interface HandoffContext {
  target: Target;
  agentLabel: string;
  agentSessionLabel: string;
  repoUrl: string | null;
  repoName: string | null;
  repoBranch: string;
  ready: boolean;
  warning: string | null;
}

interface AgentFeedback {
  title: string;
  summary: string;
  next_steps: string[];
}

interface SubmissionResult {
  sessionId: string;
  taskId: string;
  feedbackId: string;
  target: Target;
  message: string;
  agentFeedback?: AgentFeedback;
}

const API_BASE = 'http://127.0.0.1:3001/api';
const DEFAULT_TITLE = 'Native capture session';
const DEFAULT_CAPTURE_URL = 'https://twynd.ai';
const RECENT_KEY = 'debugr_native_recent_sessions';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app root');

app.innerHTML = `
  <div class="shell capture-shell">
    <section class="panel capture-panel">
      <div class="hero">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" focusable="false">
              <path d="M7.5 5.5h9a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z" />
              <path d="M9.1 12.1l2.1-2.1c.25-.25.58-.39.94-.39h2.9" />
              <path d="M10.2 15.1h2.9c.36 0 .69-.14.94-.39l1.4-1.4" />
            </svg>
          </div>
          <div>
            <div class="eyebrow">debugr.ai</div>
            <div class="brand-subtitle">Native capture and annotation</div>
          </div>
        </div>
        <h1 class="title">Capture the screen. Mark it up. Send it on.</h1>
        <p class="subtitle">
          No bookmarklet, no webview target, no browser extension. Start a native screen capture, draw boxes on the
          frozen frame, add notes, and hand the report to Claude or Codex.
        </p>
      </div>

      <div class="card">
        <div class="card-label">Session</div>
        <div class="field">
          <label for="session-title">Session title</label>
          <input id="session-title" type="text" value="${DEFAULT_TITLE}" />
        </div>
        <div class="field">
          <label for="capture-url">Context URL</label>
          <input id="capture-url" type="url" value="${DEFAULT_CAPTURE_URL}" placeholder="https://yourapp.com/page" />
        </div>
        <div class="field">
          <label for="handoff-target">Send after submit</label>
          <select id="handoff-target">
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </div>

        <div class="button-row">
          <button id="open-url-btn" class="secondary">Open URL in browser</button>
          <button id="capture-btn" class="primary">Start screen capture</button>
          <button id="submit-btn" class="secondary">Submit to agent</button>
        </div>

        <div id="status" class="status">Ready. Capture the screen to begin annotating.</div>
      </div>

      <div class="card">
        <div class="card-label">Recent sessions</div>
        <div id="recent-sessions" class="recent"></div>
      </div>
    </section>

    <section class="workspace native-workspace">
      <div class="workspace-card capture-card">
        <div class="workspace-kicker">Capture surface</div>
        <div class="capture-toolbar">
          <div>
            <div class="capture-title">Capture a browser or any app, then annotate the frozen frame</div>
            <div class="capture-copy">
              Start by opening the page you want in a browser, or leave the URL as a pointer and capture another
              experience from the macOS picker. After the screenshot is frozen here, click and drag to create a box.
            </div>
          </div>
          <div class="capture-badge">Native window</div>
        </div>

        <div id="capture-stage" class="capture-stage capture-empty">
          <canvas id="capture-canvas" class="capture-canvas" aria-label="Native screenshot capture canvas"></canvas>
          <div id="capture-placeholder" class="capture-placeholder">
            <div class="capture-placeholder-title">Nothing captured yet</div>
            <div class="capture-placeholder-copy">
              Click <strong>Start screen capture</strong> to open the macOS picker, then annotate the frozen frame in
              this app.
            </div>
          </div>
        </div>
      </div>

      <div class="workspace-card">
        <div class="workspace-kicker">Confirm Handoff</div>
        <div id="confirmation-card"></div>
      </div>

      <div class="workspace-card">
        <div class="workspace-kicker">Agent Feedback</div>
        <div id="agent-feedback-card"></div>
      </div>

      <div class="workspace-card logs-card">
        <div class="workspace-kicker">Logs</div>
        <p>These logs cover capture start, box creation, note edits, and submit/send steps.</p>
        <div id="logs" class="logs"></div>
      </div>

      <div class="workspace-card annotations-card">
        <div class="workspace-kicker">Boxes</div>
        <div id="annotation-list" class="annotation-list"></div>
      </div>
    </section>
  </div>
`;

const sessionTitleInput = document.querySelector<HTMLInputElement>('#session-title')!;
const captureUrlInput = document.querySelector<HTMLInputElement>('#capture-url')!;
const handoffTargetSelect = document.querySelector<HTMLSelectElement>('#handoff-target')!;
const openUrlBtn = document.querySelector<HTMLButtonElement>('#open-url-btn')!;
const captureBtn = document.querySelector<HTMLButtonElement>('#capture-btn')!;
const submitBtn = document.querySelector<HTMLButtonElement>('#submit-btn')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const logsEl = document.querySelector<HTMLDivElement>('#logs')!;
const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!;
const stageEl = document.querySelector<HTMLDivElement>('#capture-stage')!;
const placeholderEl = document.querySelector<HTMLDivElement>('#capture-placeholder')!;
const annotationListEl = document.querySelector<HTMLDivElement>('#annotation-list')!;
const recentSessionsEl = document.querySelector<HTMLDivElement>('#recent-sessions')!;
const confirmationCardEl = document.querySelector<HTMLDivElement>('#confirmation-card')!;
const agentFeedbackCardEl = document.querySelector<HTMLDivElement>('#agent-feedback-card')!;

const ctx = canvas.getContext('2d')!;

let screenshotImage: HTMLImageElement | null = null;
let screenshotDataUrl = '';
let naturalWidth = 0;
let naturalHeight = 0;
let drawing = false;
let startPoint: { x: number; y: number } | null = null;
let draftBox: CaptureBox | null = null;
let boxes: CaptureBox[] = [];
let handoffContext: HandoffContext | null = null;
let captureConfirmed = false;
let submissionResult: SubmissionResult | null = null;

function nowStamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function appendLog(message: string, details?: unknown) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const body = details === undefined ? message : `${message} ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  line.textContent = `[${nowStamp()}] ${body}`;
  logsEl.prepend(line);
  console.log('[desktop]', message, details ?? '');
}

function setStatus(message: string) {
  statusEl.textContent = message;
  appendLog(message);
}

function getTargetLabel(target: Target) {
  return target === 'codex' ? 'Codex' : 'Claude Code';
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function getRecentSessionIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function setRecentSessionIds(ids: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
}

function clearCaptureState() {
  screenshotImage = null;
  screenshotDataUrl = '';
  naturalWidth = 0;
  naturalHeight = 0;
  draftBox = null;
  boxes = [];
  captureConfirmed = false;
  submissionResult = null;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.aspectRatio = '';
  stageEl.classList.add('capture-empty');
  placeholderEl.style.display = 'grid';
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  renderAgentFeedbackCard();
}

function renderConfirmationCard() {
  const target = handoffTargetSelect.value as Target;
  const targetLabel = getTargetLabel(target);
  const repoLabel = handoffContext?.repoName || handoffContext?.repoUrl || 'No linked repo configured';
  const captureLabel = normalizeUrl(captureUrlInput.value) || 'Another browser tab or app window';

  if (!screenshotImage || !screenshotDataUrl) {
    confirmationCardEl.innerHTML = `
      <p>After you freeze a screenshot, Debugr will ask you to confirm that the view belongs to your current ${targetLabel} work and linked GitHub repo.</p>
      <ol>
        <li>Open a browser page from the context URL, or keep another app ready on screen.</li>
        <li>Start screen capture and choose the exact tab, window, or display from the macOS picker.</li>
        <li>Return here to confirm the screenshot is tied to ${repoLabel} before you send it.</li>
      </ol>
    `;
    return;
  }

  const warning = handoffContext?.warning
    ? `<div class="recent-empty" style="margin-top: 14px; color: #9a3412; background: #fff7ed; border-color: #fdba74;">${handoffContext.warning}</div>`
    : '';
  const confirmationState = captureConfirmed
    ? `<div class="status" style="margin-top: 14px; background: rgba(21, 128, 61, 0.08); border-color: rgba(21, 128, 61, 0.18); color: #166534;">Confirmed. This screenshot is in scope for ${targetLabel} and ${repoLabel}.</div>`
    : '';

  confirmationCardEl.innerHTML = `
    <p>Review the screenshot context before sending feedback to ${targetLabel}.</p>
    <ol>
      <li><strong>Captured view:</strong> ${captureLabel}</li>
      <li><strong>Agent session:</strong> ${handoffContext?.agentSessionLabel || `Current ${targetLabel} work session`}</li>
      <li><strong>Linked GitHub repo:</strong> ${repoLabel}${handoffContext?.repoBranch ? ` · branch ${handoffContext.repoBranch}` : ''}</li>
    </ol>
    ${warning}
    ${confirmationState}
    <div class="button-row" style="margin-top: 16px;">
      <button id="confirm-capture-btn" class="primary"${handoffContext?.ready === false ? ' disabled' : ''}>Confirm this capture</button>
      <button id="capture-again-btn" class="secondary">Capture again</button>
    </div>
  `;

  confirmationCardEl.querySelector<HTMLButtonElement>('#confirm-capture-btn')?.addEventListener('click', () => {
    if (handoffContext?.ready === false) {
      setStatus(handoffContext.warning || 'Configure the linked GitHub repo before sending feedback.');
      return;
    }
    captureConfirmed = true;
    appendLog('Capture confirmed for handoff', {
      target,
      repo: handoffContext?.repoName || handoffContext?.repoUrl,
      captureUrl: captureLabel,
    });
    renderConfirmationCard();
    setStatus(`Capture confirmed for ${targetLabel}. Submit when you're ready to get agent feedback.`);
  });

  confirmationCardEl.querySelector<HTMLButtonElement>('#capture-again-btn')?.addEventListener('click', () => {
    clearCaptureState();
    setStatus('Ready to capture again.');
  });
}

function renderAgentFeedbackCard() {
  if (!submissionResult) {
    agentFeedbackCardEl.innerHTML = `
      <p>Once you submit, Debugr will show the immediate response from Claude or Codex here, along with the linked task and next steps.</p>
    `;
    return;
  }

  const currentSubmission = submissionResult;
  const targetLabel = getTargetLabel(currentSubmission.target);
  const feedback = currentSubmission.agentFeedback;
  const nextSteps = feedback?.next_steps?.length
    ? `<ol>${feedback.next_steps.map((step) => `<li>${step}</li>`).join('')}</ol>`
    : '';

  agentFeedbackCardEl.innerHTML = `
    <div class="status" style="margin-top: 0; background: rgba(21, 128, 61, 0.08); border-color: rgba(21, 128, 61, 0.18); color: #166534;">
      Feedback received from ${targetLabel}.
    </div>
    <div style="margin-top: 16px;">
      <div style="font-weight: 800; font-size: 1.05rem; margin-bottom: 8px;">${feedback?.title || `${targetLabel} acknowledged the handoff`}</div>
      <p style="margin: 0 0 12px; color: #475467;">${feedback?.summary || submissionResult.message}</p>
      <div class="recent-empty" style="margin-bottom: 14px;">
        Task <strong>${submissionResult.taskId}</strong> · Session <strong>${submissionResult.feedbackId}</strong>
      </div>
      ${nextSteps}
    </div>
    <div class="button-row" style="margin-top: 16px;">
      <button id="open-summary-btn" class="primary">Open session summary</button>
      <button id="new-capture-btn" class="secondary">Start another capture</button>
    </div>
  `;

  agentFeedbackCardEl.querySelector<HTMLButtonElement>('#open-summary-btn')?.addEventListener('click', () => {
    window.location.href = `http://127.0.0.1:3000/sessions/${currentSubmission.sessionId}/summary?submitted=1&target=${currentSubmission.target}`;
  });

  agentFeedbackCardEl.querySelector<HTMLButtonElement>('#new-capture-btn')?.addEventListener('click', () => {
    clearCaptureState();
    setStatus('Ready for a new capture.');
  });
}

async function loadHandoffContext(target: Target) {
  const res = await fetch(`${API_BASE}/system/handoff-context?target=${target}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Failed to load handoff context');
  handoffContext = json.data as HandoffContext;
  appendLog('Handoff context loaded', {
    target,
    repo: handoffContext.repoName || handoffContext.repoUrl,
    ready: handoffContext.ready,
  });
  renderConfirmationCard();
}

async function loadRecentSessions() {
  try {
    const res = await fetch(`${API_BASE}/feedback-sessions`);
    if (!res.ok) throw new Error('Failed to load sessions');
    const json = (await res.json()) as { data: FeedbackSessionSummary[] };
    const sessions = Array.isArray(json.data) ? json.data.slice(0, 6) : [];
    recentSessionsEl.innerHTML = '';
    if (sessions.length === 0) {
      recentSessionsEl.innerHTML = '<div class="recent-empty">No sessions yet.</div>';
      return;
    }

    sessions.forEach((session) => {
      const button = document.createElement('button');
      button.innerHTML = `<strong>${session.title}</strong><div class="recent-sub">Open summary</div>`;
      button.addEventListener('click', () => {
        window.location.href = `http://127.0.0.1:3000/sessions/${session.id}/summary`;
      });
      recentSessionsEl.appendChild(button);
    });
  } catch (error) {
    recentSessionsEl.innerHTML = '<div class="recent-empty">Could not load recent sessions.</div>';
    appendLog('Recent sessions load failed', error instanceof Error ? error.message : error);
  }
}

function canvasPointFromEvent(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function resizeCanvasToImage() {
  if (!naturalWidth || !naturalHeight) return;
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  canvas.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
  stageEl.classList.remove('capture-empty');
  placeholderEl.style.display = 'none';
}

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (screenshotImage) {
    ctx.drawImage(screenshotImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width || 1280, canvas.height || 800);
  }

  boxes.forEach((box, index) => {
    const selectedColor = box === draftBox ? '#f59e0b' : '#0f62fe';
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const label = `#${index + 1} · ${box.notes.length} note${box.notes.length === 1 ? '' : 's'}`;
    ctx.font = 'bold 18px Geist, Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(label);
    const labelWidth = metrics.width + 20;
    const labelX = box.x;
    const labelY = Math.max(12, box.y - 28);

    ctx.fillStyle = selectedColor;
    ctx.fillRect(labelX, labelY, labelWidth, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, labelX + 10, labelY + 16);
  });

  if (draftBox) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(draftBox.x, draftBox.y, draftBox.width, draftBox.height);
    ctx.setLineDash([]);
  }
}

function renderAnnotationList() {
  annotationListEl.innerHTML = '';
  if (boxes.length === 0) {
    annotationListEl.innerHTML = '<div class="recent-empty">No boxes yet. Draw one on the capture above.</div>';
    return;
  }

  boxes.forEach((box, index) => {
    const item = document.createElement('div');
    item.className = 'annotation-item';
    item.innerHTML = `
      <div class="annotation-header">
        <div>
          <div class="annotation-title">Box #${index + 1}</div>
          <div class="annotation-meta">${box.notes.length} note${box.notes.length === 1 ? '' : 's'}</div>
        </div>
        <div class="annotation-actions">
          <button data-action="edit">Edit</button>
          <button data-action="delete">Delete</button>
        </div>
      </div>
      <div class="annotation-notes">${box.notes
        .map((note) => `<div class="annotation-note">${note.text}</div>`)
        .join('')}</div>
    `;

    item.querySelector<HTMLButtonElement>('[data-action="edit"]')?.addEventListener('click', () => {
      const next = window.prompt('Edit the box note', box.notes[0]?.text ?? '');
      if (next === null) return;
      const text = next.trim();
      if (!text) {
        setStatus('Note cannot be empty.');
        return;
      }
      if (box.notes.length === 0) {
        box.notes.push({ id: `note_${Date.now()}`, text, createdAt: new Date().toISOString() });
      } else {
        box.notes[0] = { ...box.notes[0], text };
      }
      appendLog('Annotation edited', { boxId: box.id });
      renderCanvas();
      renderAnnotationList();
    });

    item.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => {
      boxes = boxes.filter((current) => current.id !== box.id);
      appendLog('Annotation deleted', { boxId: box.id });
      renderCanvas();
      renderAnnotationList();
    });

    annotationListEl.appendChild(item);
  });
}

function commitDraftBox() {
  if (!draftBox || draftBox.width < 12 || draftBox.height < 12) {
    draftBox = null;
    renderCanvas();
    return;
  }

  const noteText = window.prompt('Add a note for this area', '');
  if (noteText === null) {
    draftBox = null;
    renderCanvas();
    return;
  }

  const trimmed = noteText.trim();
  if (!trimmed) {
    setStatus('A note is required for each capture box.');
    draftBox = null;
    renderCanvas();
    return;
  }

  draftBox.notes.push({ id: `note_${Date.now()}`, text: trimmed, createdAt: new Date().toISOString() });
  boxes.push(draftBox);
  captureConfirmed = false;
  appendLog('Annotation box saved', { boxId: draftBox.id, notes: draftBox.notes.length });
  draftBox = null;
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
}

canvas.addEventListener('pointerdown', (event) => {
  if (!screenshotImage) {
    setStatus('Capture the screen first.');
    return;
  }
  drawing = true;
  const point = canvasPointFromEvent(event);
  startPoint = point;
  draftBox = {
    id: `box_${Date.now()}`,
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
    notes: [],
  };
  canvas.setPointerCapture(event.pointerId);
  appendLog('Box draw started', { x: Math.round(point.x), y: Math.round(point.y) });
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || !startPoint || !draftBox) return;
  const point = canvasPointFromEvent(event);
  draftBox = {
    ...draftBox,
    x: Math.min(startPoint.x, point.x),
    y: Math.min(startPoint.y, point.y),
    width: Math.abs(point.x - startPoint.x),
    height: Math.abs(point.y - startPoint.y),
  };
  renderCanvas();
});

canvas.addEventListener('pointerup', (event) => {
  if (!drawing) return;
  drawing = false;
  startPoint = null;
  appendLog('Box draw finished');
  commitDraftBox();
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', () => {
  drawing = false;
  startPoint = null;
  draftBox = null;
  renderCanvas();
});

async function createSession(title: string) {
  const res = await fetch(`${API_BASE}/projects/proj_demo/feedback-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, visibility: 'private' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Failed to create session');
  return json.data as { id: string; title: string };
}

async function submitCapture() {
  const title = sessionTitleInput.value.trim();
  const contextUrl = normalizeUrl(captureUrlInput.value);
  const target = handoffTargetSelect.value as Target;

  if (!title) {
    setStatus('Enter a session title first.');
    return;
  }
  if (!screenshotDataUrl || !screenshotImage) {
    setStatus('Capture the screen before submitting.');
    return;
  }
  if (boxes.length === 0) {
    setStatus('Add at least one annotation box.');
    return;
  }
  if (!captureConfirmed) {
    setStatus(`Confirm that this screenshot belongs to your ${getTargetLabel(target)} work before sending it.`);
    return;
  }

  submissionResult = null;
  renderAgentFeedbackCard();
  submitBtn.disabled = true;
  captureBtn.disabled = true;
  setStatus('Creating session and saving annotations...');

  try {
    const session = await createSession(title);
    const payload: CapturePayload = {
      mode: 'native-capture',
      captureTitle: title,
      captureUrl: contextUrl || undefined,
      handoffTarget: target,
      screenshotDataUrl,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      capturedAt: new Date().toISOString(),
      boxes: boxes.map((box) => ({
        ...box,
        screenshot: screenshotDataUrl,
      })),
    };

    const patchRes = await fetch(`${API_BASE}/feedback-sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIntent: JSON.stringify(payload) }),
    });
    if (!patchRes.ok) {
      const err = await patchRes.text();
      throw new Error(err || 'Failed to save annotations');
    }

    const sendRes = await fetch(`${API_BASE}/feedback-sessions/${session.id}/send-to-claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    if (!sendRes.ok) {
      const err = await sendRes.text();
      throw new Error(err || 'Failed to send session');
    }

    const json = await sendRes.json();
    const recent = [session.id, ...getRecentSessionIds().filter((id) => id !== session.id)].slice(0, 8);
    setRecentSessionIds(recent);
    await loadRecentSessions();
    submissionResult = {
      sessionId: session.id,
      taskId: json.data.task_id,
      feedbackId: json.data.feedback_id,
      target,
      message: json.data.message,
      agentFeedback: json.data.agent_feedback as AgentFeedback | undefined,
    };
    setStatus(`Feedback received from ${getTargetLabel(target)}. Review the response and open the session summary if needed.`);
    appendLog('Session submitted', { sessionId: session.id, taskId: json.data.task_id, target });
    renderAgentFeedbackCard();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to submit capture');
    appendLog('Submit failed', error instanceof Error ? error.message : error);
  } finally {
    submitBtn.disabled = false;
    captureBtn.disabled = false;
  }
}

async function startScreenCapture() {
  try {
    captureBtn.disabled = true;
    openUrlBtn.disabled = true;
    setStatus('Opening the macOS screenshot tool...');
    appendLog('Starting native screenshot capture');
    screenshotDataUrl = await invoke<string>('capture_interactive_screenshot');

    screenshotImage = new Image();
    screenshotImage.onload = () => {
      naturalWidth = screenshotImage?.naturalWidth || 1440;
      naturalHeight = screenshotImage?.naturalHeight || 900;
      resizeCanvasToImage();
      renderCanvas();
      renderAnnotationList();
      renderConfirmationCard();
      appendLog('Screenshot captured', { width: naturalWidth, height: naturalHeight });
      setStatus(
        `Screenshot captured. Add notes, then confirm it belongs to your ${getTargetLabel(handoffTargetSelect.value as Target)} work before sending it.`
      );
    };
    screenshotImage.onerror = () => {
      screenshotImage = null;
      screenshotDataUrl = '';
      setStatus('The screenshot was captured, but Debugr could not load it.');
      appendLog('Screenshot image load failed');
    };
    screenshotImage.src = screenshotDataUrl;
    captureConfirmed = false;
    submissionResult = null;
    renderAgentFeedbackCard();
  } catch (error) {
    appendLog('Capture failed', error instanceof Error ? error.message : error);
    setStatus(
      error instanceof Error ? error.message : 'Could not capture the screen. Check Screen Recording permission and try again.'
    );
  } finally {
    captureBtn.disabled = false;
    openUrlBtn.disabled = false;
  }
}

openUrlBtn.addEventListener('click', async () => {
  const normalized = normalizeUrl(captureUrlInput.value);
  if (!normalized) {
    setStatus('Add a browser URL first, or keep going and capture another app window.');
    return;
  }
  try {
    openUrlBtn.disabled = true;
    captureBtn.disabled = true;
    await invoke('open_external_url', { url: normalized });
    appendLog('Context URL opened in browser', normalized);
    setStatus('Context URL opened. Use the macOS screenshot tool to capture that browser tab or any other app window.');
  } catch (error) {
    appendLog('Open URL failed', error instanceof Error ? error.message : error);
    setStatus(error instanceof Error ? error.message : 'Could not open the URL in your default browser.');
  } finally {
    openUrlBtn.disabled = false;
    captureBtn.disabled = false;
  }
});

captureBtn.addEventListener('click', () => {
  void startScreenCapture();
});

submitBtn.addEventListener('click', () => {
  void submitCapture();
});

handoffTargetSelect.addEventListener('change', () => {
  captureConfirmed = false;
  submissionResult = null;
  renderAgentFeedbackCard();
  renderConfirmationCard();
  void loadHandoffContext(handoffTargetSelect.value as Target).catch((error) => {
    appendLog('Handoff context failed', error instanceof Error ? error.message : error);
    setStatus(error instanceof Error ? error.message : 'Could not load linked repo information.');
  });
});

captureUrlInput.addEventListener('input', () => {
  captureConfirmed = false;
  renderConfirmationCard();
});

window.addEventListener('error', (event) => {
  appendLog('Unhandled window error', event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  appendLog('Unhandled promise rejection', event.reason instanceof Error ? event.reason.message : event.reason);
});

const recentIds = getRecentSessionIds();
if (recentIds.length > 0) {
  appendLog('Recent session cache loaded', { count: recentIds.length });
}

void (async () => {
  await loadRecentSessions();
  await loadHandoffContext(handoffTargetSelect.value as Target);
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  renderAgentFeedbackCard();
  appendLog('Desktop capture app ready');
})();
