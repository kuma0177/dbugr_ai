import './index.css';
import { invoke } from '@tauri-apps/api/core';

type Target = 'claude' | 'codex';
type PermissionState = 'checking' | 'granted' | 'needs-access';
type ViewMode = 'capture' | 'review' | 'saved' | 'feedback';
type ContextToggleKey = 'consoleLogs' | 'networkLogs' | 'environmentInfo';

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
}

interface AudioNotePayload {
  mimeType: string;
  dataUrl: string;
  durationSec: number;
  createdAt: string;
}

interface CapturePayload {
  mode: 'native-capture';
  captureTitle: string;
  handoffTarget: Target;
  screenshotDataUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  capturedAt: string;
  sessionNote?: string;
  audioNote?: AudioNotePayload;
  contextOptions?: ContextToggles;
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

interface ContextToggles {
  consoleLogs: boolean;
  networkLogs: boolean;
  environmentInfo: boolean;
}

const API_BASE = 'http://127.0.0.1:3001/api';
const DEFAULT_TITLE = 'Onboarding flow bug';
const RECENT_KEY = 'debugr_native_recent_sessions';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app root');

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="brand-lockup">
          <div class="brand-mark">D</div>
          <div>
            <div class="brand-name">Debugr</div>
            <div class="brand-subtitle">Capture. Share. Improve.</div>
          </div>
        </div>
        <button id="new-capture-btn" class="primary-action">+ New Capture</button>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-label">Sessions</div>
        <div id="session-list" class="session-list"></div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-label">System</div>
        <div id="permission-card" class="sidebar-note"></div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <div id="topbar-step" class="topbar-step">Step 2</div>
          <h1 id="topbar-title" class="topbar-title">App opens and you can start recording</h1>
          <p id="topbar-copy" class="topbar-copy">Open a browser or point to any area on your screen, then capture one image.</p>
        </div>
        <div id="status-pill" class="status-pill">Ready</div>
      </header>

      <section class="main-grid">
        <div class="canvas-card">
          <div class="canvas-head">
            <div>
              <div class="panel-title">Capture surface</div>
              <div class="panel-copy">Take a screenshot, crop with box selections, and keep the capture in one saved session.</div>
            </div>
            <div class="capture-tools">
              <button id="capture-btn" class="primary-action primary-action-small">Start Capture</button>
              <button id="import-image-btn" class="secondary-action">Import Image</button>
              <input id="image-file-input" type="file" accept="image/*" hidden />
            </div>
          </div>

          <div id="annotation-toolbar" class="annotation-toolbar annotation-toolbar-hidden">
            <div class="annotation-pill">Box Select</div>
            <div class="annotation-copy">Drag directly on the screenshot to mark the exact area you want Claude or Codex to inspect.</div>
          </div>

          <div id="capture-stage" class="capture-stage capture-empty">
            <canvas id="capture-canvas" class="capture-canvas" aria-label="Screenshot annotation canvas"></canvas>
            <div id="annotation-hint" class="annotation-hint annotation-hint-hidden">
              <div class="annotation-hint-title">Drag to create a capture area</div>
              <div class="annotation-hint-copy">After you release, add notes in the right panel or the annotations list below.</div>
            </div>
            <div id="capture-placeholder" class="capture-placeholder">
              <div class="capture-placeholder-title">Nothing captured yet</div>
              <div class="capture-placeholder-copy">Use <strong>Start Capture</strong> for a native one-shot screenshot or <strong>Import Image</strong> if the screenshot already exists.</div>
            </div>
          </div>

          <div class="capture-footer">
            <div id="capture-meta" class="capture-meta">No screenshot loaded yet.</div>
            <div class="capture-footer-actions">
              <button id="retake-btn" class="ghost-action">Retake</button>
              <button id="save-capture-btn" class="primary-action primary-action-small">Save Capture</button>
            </div>
          </div>
        </div>

        <div class="detail-card">
          <div class="detail-card-head">
            <div id="detail-step" class="detail-step-label">Capture Preview</div>
            <div id="detail-step-copy" class="detail-step-copy">Review, title, annotate, and save the session.</div>
          </div>
          <div id="detail-panel" class="detail-panel"></div>
        </div>
      </section>

      <section class="bottom-grid">
        <div class="stack-card">
          <div class="stack-label">Annotations</div>
          <div id="annotation-list" class="annotation-list"></div>
        </div>

        <div class="stack-card">
          <div class="stack-label">Activity</div>
          <div id="logs" class="logs"></div>
        </div>
      </section>
    </main>
  </div>
`;

const sessionListEl = document.querySelector<HTMLDivElement>('#session-list')!;
const permissionCardEl = document.querySelector<HTMLDivElement>('#permission-card')!;
const topbarStepEl = document.querySelector<HTMLDivElement>('#topbar-step')!;
const topbarTitleEl = document.querySelector<HTMLHeadingElement>('#topbar-title')!;
const topbarCopyEl = document.querySelector<HTMLParagraphElement>('#topbar-copy')!;
const statusPillEl = document.querySelector<HTMLDivElement>('#status-pill')!;
const captureBtn = document.querySelector<HTMLButtonElement>('#capture-btn')!;
const importImageBtn = document.querySelector<HTMLButtonElement>('#import-image-btn')!;
const imageFileInput = document.querySelector<HTMLInputElement>('#image-file-input')!;
const newCaptureBtn = document.querySelector<HTMLButtonElement>('#new-capture-btn')!;
const retakeBtn = document.querySelector<HTMLButtonElement>('#retake-btn')!;
const saveCaptureBtn = document.querySelector<HTMLButtonElement>('#save-capture-btn')!;
const captureMetaEl = document.querySelector<HTMLDivElement>('#capture-meta')!;
const annotationToolbarEl = document.querySelector<HTMLDivElement>('#annotation-toolbar')!;
const captureStageEl = document.querySelector<HTMLDivElement>('#capture-stage')!;
const capturePlaceholderEl = document.querySelector<HTMLDivElement>('#capture-placeholder')!;
const annotationHintEl = document.querySelector<HTMLDivElement>('#annotation-hint')!;
const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!;
const detailStepEl = document.querySelector<HTMLDivElement>('#detail-step')!;
const detailStepCopyEl = document.querySelector<HTMLDivElement>('#detail-step-copy')!;
const detailPanelEl = document.querySelector<HTMLDivElement>('#detail-panel')!;
const annotationListEl = document.querySelector<HTMLDivElement>('#annotation-list')!;
const logsEl = document.querySelector<HTMLDivElement>('#logs')!;

const ctx = canvas.getContext('2d')!;

let permissionState: PermissionState = 'checking';
let viewMode: ViewMode = 'capture';
let screenshotImage: HTMLImageElement | null = null;
let screenshotDataUrl = '';
let naturalWidth = 0;
let naturalHeight = 0;
let boxes: CaptureBox[] = [];
let selectedBoxId: string | null = null;
let draftBox: CaptureBox | null = null;
let drawing = false;
let startPoint: { x: number; y: number } | null = null;
let sessions: FeedbackSessionSummary[] = [];
let handoffContext: HandoffContext | null = null;
let target: Target = 'claude';
let currentSessionId: string | null = null;
let currentSessionCreatedAt: string | null = null;
let captureConfirmed = false;
let submissionResult: SubmissionResult | null = null;
let sessionTitle = DEFAULT_TITLE;
let sessionNote = '';
let audioNote: AudioNotePayload | null = null;
let contextToggles: ContextToggles = {
  consoleLogs: true,
  networkLogs: false,
  environmentInfo: true,
};
let audioPreviewUrl: string | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recorderStream: MediaStream | null = null;
let recorderChunks: Blob[] = [];
let recordingStartedAt = 0;
let isRecordingAudio = false;

function nowStamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function appendLog(message: string, details?: unknown) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const body = details === undefined ? message : `${message} ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  line.textContent = `[${nowStamp()}] ${body}`;
  logsEl.prepend(line);
}

function getTargetLabel(nextTarget: Target) {
  return nextTarget === 'codex' ? 'Codex' : 'Claude';
}

function setStatus(message: string) {
  statusPillEl.textContent = message;
  appendLog(message);
}

function setStepContent() {
  if (viewMode === 'capture') {
    topbarStepEl.textContent = 'Step 2';
    topbarTitleEl.textContent = 'App opens and you can start recording';
    topbarCopyEl.textContent = 'Open a browser or point to any area on your screen, then capture one image.';
    detailStepEl.textContent = 'Capture Preview';
    detailStepCopyEl.textContent = 'Start with one screenshot. Add notes, voice context, and box selections before saving.';
    return;
  }

  if (viewMode === 'review') {
    topbarStepEl.textContent = 'Step 3';
    topbarTitleEl.textContent = 'You confirm the screen or view to be captured';
    topbarCopyEl.textContent = 'Review the screenshot, add notes if needed, and save the capture as a session.';
    detailStepEl.textContent = 'Save to Session';
    detailStepCopyEl.textContent = 'Title the issue, add optional notes or voice context, then save the capture.';
    return;
  }

  if (viewMode === 'saved') {
    topbarStepEl.textContent = 'Step 4 / 5';
    topbarTitleEl.textContent = 'Debugr collects context and saves the session';
    topbarCopyEl.textContent = 'Your screenshot, selections, notes, and voice memo are now packaged and ready to send.';
    detailStepEl.textContent = 'Share Feedback';
    detailStepCopyEl.textContent = 'Choose Claude or Codex and send the saved session with context.';
    return;
  }

  topbarStepEl.textContent = 'Step 6';
  topbarTitleEl.textContent = 'Get feedback from Claude or Codex';
  topbarCopyEl.textContent = 'Review the AI response, suggested fix, and next steps for the saved capture.';
  detailStepEl.textContent = 'Conversation';
  detailStepCopyEl.textContent = 'The latest handoff response stays attached to the session.';
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function revokeAudioPreviewUrl() {
  if (audioPreviewUrl) {
    URL.revokeObjectURL(audioPreviewUrl);
    audioPreviewUrl = null;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function setPrimaryBoxNote(box: CaptureBox, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    box.notes = [];
    return;
  }
  const existing = box.notes[0];
  if (existing) {
    box.notes = [{ ...existing, text: trimmed }];
    return;
  }
  box.notes = [{ id: `note_${Date.now()}`, text: trimmed, createdAt: new Date().toISOString() }];
}

function getPrimaryBoxNote(box: CaptureBox) {
  return box.notes[0]?.text ?? '';
}

function buildCapturePayload(): CapturePayload {
  return {
    mode: 'native-capture',
    captureTitle: sessionTitle.trim() || DEFAULT_TITLE,
    handoffTarget: target,
    screenshotDataUrl,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    capturedAt: currentSessionCreatedAt || new Date().toISOString(),
    sessionNote: sessionNote.trim() || undefined,
    audioNote: audioNote || undefined,
    contextOptions: contextToggles,
    boxes: boxes.map((box) => ({
      ...box,
      screenshot: screenshotDataUrl,
    })),
  };
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
  captureStageEl.classList.remove('capture-empty');
  capturePlaceholderEl.style.display = 'none';
}

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (screenshotImage) {
    ctx.drawImage(screenshotImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#162237';
    ctx.fillRect(0, 0, canvas.width || 1200, canvas.height || 760);
  }

  boxes.forEach((box, index) => {
    const isSelected = selectedBoxId === box.id;
    ctx.strokeStyle = isSelected ? '#1d9bf0' : '#3b82f6';
    ctx.lineWidth = isSelected ? 4 : 3;
    ctx.fillStyle = isSelected ? 'rgba(29, 155, 240, 0.14)' : 'rgba(59, 130, 246, 0.12)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const label = `${index + 1}`;
    ctx.font = 'bold 15px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const labelWidth = ctx.measureText(label).width + 14;
    const labelX = box.x;
    const labelY = Math.max(10, box.y - 24);
    ctx.fillStyle = isSelected ? '#1d9bf0' : '#3b82f6';
    ctx.fillRect(labelX, labelY, labelWidth, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, labelX + 7, labelY + 14);
  });

  if (draftBox) {
    ctx.strokeStyle = '#1d9bf0';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(draftBox.x, draftBox.y, draftBox.width, draftBox.height);
    ctx.setLineDash([]);
  }
}

function clearCaptureState() {
  screenshotImage = null;
  screenshotDataUrl = '';
  naturalWidth = 0;
  naturalHeight = 0;
  boxes = [];
  selectedBoxId = null;
  draftBox = null;
  drawing = false;
  startPoint = null;
  captureConfirmed = false;
  submissionResult = null;
  currentSessionId = null;
  currentSessionCreatedAt = null;
  sessionTitle = DEFAULT_TITLE;
  sessionNote = '';
  target = 'claude';
  contextToggles = {
    consoleLogs: true,
    networkLogs: false,
    environmentInfo: true,
  };
  audioNote = null;
  revokeAudioPreviewUrl();
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.aspectRatio = '';
  captureStageEl.classList.add('capture-empty');
  capturePlaceholderEl.style.display = 'grid';
  annotationToolbarEl.classList.add('annotation-toolbar-hidden');
  annotationHintEl.classList.add('annotation-hint-hidden');
  viewMode = 'capture';
  setStepContent();
  renderCanvas();
  renderDetailPanel();
  renderAnnotationList();
  updateCaptureMeta();
}

function updateCaptureMeta() {
  if (!screenshotDataUrl || !screenshotImage) {
    captureMetaEl.textContent = 'No screenshot loaded yet.';
    return;
  }
  const noteCount = boxes.reduce((count, box) => count + box.notes.length, 0);
  const audioState = audioNote ? ` · voice ${formatDuration(audioNote.durationSec)}` : '';
  captureMetaEl.textContent = `${boxes.length} selection${boxes.length === 1 ? '' : 's'} · ${noteCount} note${noteCount === 1 ? '' : 's'}${audioState}`;
}

function renderSessionList() {
  sessionListEl.innerHTML = '';

  if (sessions.length === 0) {
    sessionListEl.innerHTML = '<div class="session-empty">No saved sessions yet.</div>';
    return;
  }

  const groups = new Map<string, FeedbackSessionSummary[]>();
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const getGroupLabel = (createdAt: string) => {
    const date = new Date(createdAt);
    const sameDay = date.toDateString() === now.toDateString();
    const prevDay = date.toDateString() === yesterday.toDateString();
    if (sameDay) return 'Today';
    if (prevDay) return 'Yesterday';
    return date.toLocaleDateString();
  };

  sessions.forEach((session) => {
    const label = getGroupLabel(session.createdAt);
    groups.set(label, [...(groups.get(label) || []), session]);
  });

  groups.forEach((groupSessions, label) => {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'session-group-label';
    groupLabel.textContent = label;
    sessionListEl.appendChild(groupLabel);

    groupSessions.forEach((session) => {
      const item = document.createElement('button');
      const isCurrent = currentSessionId === session.id;
      item.className = `session-item${isCurrent ? ' session-item-active' : ''}`;
      item.innerHTML = `
        <strong>${session.title}</strong>
        <span>${new Date(session.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      `;
      item.addEventListener('click', () => {
        window.location.href = `http://127.0.0.1:3000/sessions/${session.id}/summary`;
      });
      sessionListEl.appendChild(item);
    });
  });
}

function renderPermissionCard() {
  if (permissionState === 'checking') {
    permissionCardEl.innerHTML = '<div class="small-copy">Checking screen access…</div>';
    return;
  }

  if (permissionState === 'granted') {
    permissionCardEl.innerHTML = `
      <div class="permission-good">Screen capture is enabled.</div>
      <div class="small-copy">Use Start Capture for a native one-shot screenshot.</div>
    `;
    return;
  }

  permissionCardEl.innerHTML = `
    <div class="small-copy">Enable Screen & System Audio Recording for Debugr before using native capture.</div>
    <div class="inline-actions">
      <button id="grant-permission-btn" class="mini-primary">Grant</button>
      <button id="open-permission-settings-btn" class="mini-secondary">Settings</button>
    </div>
  `;

  permissionCardEl.querySelector<HTMLButtonElement>('#grant-permission-btn')?.addEventListener('click', () => {
    void ensureScreenCapturePermission(true);
  });
  permissionCardEl.querySelector<HTMLButtonElement>('#open-permission-settings-btn')?.addEventListener('click', () => {
    void openPermissionSettings();
  });
}

function renderAnnotationList() {
  annotationListEl.innerHTML = '';

  if (!screenshotDataUrl || !screenshotImage) {
    annotationListEl.innerHTML = '<div class="empty-block">Take or import a screenshot first, then drag to create a capture area.</div>';
    return;
  }

  if (boxes.length === 0) {
    annotationListEl.innerHTML = '<div class="empty-block">No selections yet. Drag on the screenshot to create the first one.</div>';
    return;
  }

  boxes.forEach((box, index) => {
    const card = document.createElement('div');
    card.className = `annotation-card${selectedBoxId === box.id ? ' annotation-card-active' : ''}`;

    const head = document.createElement('div');
    head.className = 'annotation-card-head';
    head.innerHTML = `
      <div>
        <div class="annotation-card-title">Selection ${index + 1}</div>
        <div class="annotation-card-meta">${Math.round(box.x)}, ${Math.round(box.y)} · ${Math.round(box.width)}×${Math.round(box.height)}</div>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'annotation-card-actions';

    const selectBtn = document.createElement('button');
    selectBtn.className = 'mini-secondary';
    selectBtn.textContent = selectedBoxId === box.id ? 'Selected' : 'Select';
    selectBtn.addEventListener('click', () => {
      selectedBoxId = box.id;
      renderCanvas();
      renderAnnotationList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mini-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      boxes = boxes.filter((current) => current.id !== box.id);
      if (selectedBoxId === box.id) {
        selectedBoxId = boxes[0]?.id ?? null;
      }
      captureConfirmed = false;
      renderCanvas();
      renderAnnotationList();
      renderDetailPanel();
      updateCaptureMeta();
    });

    actions.append(selectBtn, deleteBtn);
    head.appendChild(actions);

    const textarea = document.createElement('textarea');
    textarea.className = 'annotation-note-input';
    textarea.placeholder = 'Describe what is wrong in this selected area.';
    textarea.value = getPrimaryBoxNote(box);
    textarea.addEventListener('input', () => {
      setPrimaryBoxNote(box, textarea.value);
      captureConfirmed = false;
      renderDetailPanel();
      updateCaptureMeta();
    });
    textarea.addEventListener('focus', () => {
      selectedBoxId = box.id;
      renderCanvas();
      renderAnnotationList();
    });

    card.append(head, textarea);
    annotationListEl.appendChild(card);
  });
}

function renderFeedbackConversation(result: SubmissionResult) {
  const label = getTargetLabel(result.target);
  const feedback = result.agentFeedback;
  const isPending = result.taskId === 'pending';

  if (isPending) {
    return `
      <div class="conversation">
        <div class="message message-user">
          <div class="message-role">You</div>
          <div class="message-body">Sending this session to ${label}...</div>
        </div>
        <div class="message message-agent message-loading">
          <div class="message-role">${label}</div>
          <div class="message-body">
            <div class="loading-spinner"></div>
            <p>${label} is analyzing your capture...</p>
          </div>
        </div>
      </div>
    `;
  }

  const nextSteps = feedback?.next_steps?.length
    ? `<ul class="feedback-list">${feedback.next_steps.map((step) => `<li>${step}</li>`).join('')}</ul>`
    : '';

  return `
    <div class="conversation">
      <div class="message message-user">
        <div class="message-role">You</div>
        <div class="message-body">You sent this session to ${label}. The screenshot, notes, and context are attached.</div>
      </div>
      <div class="message message-agent">
        <div class="message-role">${label}</div>
        <div class="message-body">
          <strong>${feedback?.title || `${label} reviewed the capture`}</strong>
          <p>${feedback?.summary || result.message}</p>
          ${nextSteps}
          <div class="message-meta">Task ${result.taskId} · Session ${result.feedbackId}</div>
        </div>
      </div>
    </div>
  `;
}

function renderAudioSection() {
  if (isRecordingAudio) {
    return `
      <div class="voice-card voice-card-live">
        <div class="voice-live-dot"></div>
        Recording voice note now.
      </div>
      <div class="inline-actions">
        <button id="stop-audio-btn" class="mini-primary">Stop recording</button>
      </div>
    `;
  }

  if (audioNote && audioPreviewUrl) {
    return `
      <div class="voice-card">Voice note attached · ${formatDuration(audioNote.durationSec)}</div>
      <audio class="audio-player" controls src="${audioPreviewUrl}"></audio>
      <div class="inline-actions">
        <button id="record-audio-btn" class="mini-secondary">Replace</button>
        <button id="remove-audio-btn" class="mini-danger">Remove</button>
      </div>
    `;
  }

  return `
    <div class="small-copy">Optional voice note for verbal context.</div>
    <div class="inline-actions">
      <button id="record-audio-btn" class="mini-secondary">Record voice note</button>
    </div>
  `;
}

function renderDetailPanel() {
  setStepContent();

  if (viewMode === 'feedback' && submissionResult) {
    detailPanelEl.innerHTML = `
      <div class="feedback-head">
        <div class="feedback-session-title">${sessionTitle}</div>
        <div class="feedback-subtitle">${currentSessionCreatedAt ? new Date(currentSessionCreatedAt).toLocaleString() : 'Just now'}</div>
      </div>
      ${renderFeedbackConversation(submissionResult)}
      <div class="detail-actions">
        <button id="reply-open-summary-btn" class="primary-action primary-action-small">Open Summary</button>
        <button id="reply-new-capture-btn" class="secondary-action">New Capture</button>
      </div>
    `;

    detailPanelEl.querySelector<HTMLButtonElement>('#reply-open-summary-btn')?.addEventListener('click', () => {
      if (!submissionResult) return;
      window.location.href = `http://127.0.0.1:3000/sessions/${submissionResult.sessionId}/summary?submitted=1&target=${submissionResult.target}`;
    });
    detailPanelEl.querySelector<HTMLButtonElement>('#reply-new-capture-btn')?.addEventListener('click', () => {
      clearCaptureState();
      setStatus('Ready for a new capture.');
    });
    return;
  }

  if (viewMode === 'saved') {
    const repoLabel = handoffContext?.repoName || handoffContext?.repoUrl || 'No linked repo configured';
    detailPanelEl.innerHTML = `
      <div class="saved-panel">
        <div class="saved-summary">
          <div class="saved-thumb">${boxes.length} capture${boxes.length === 1 ? '' : 's'}</div>
          <div>
            <div class="saved-title">${sessionTitle}</div>
            <div class="saved-meta">${currentSessionCreatedAt ? `1 capture · ${new Date(currentSessionCreatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved just now'} · ${repoLabel}</div>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Send to</label>
          <div class="target-grid">
            <button id="target-claude-btn" class="target-card${target === 'claude' ? ' target-card-active' : ''}">
              <strong>Claude</strong>
              <span>AI assistant</span>
            </button>
            <button id="target-codex-btn" class="target-card${target === 'codex' ? ' target-card-active' : ''}">
              <strong>Codex</strong>
              <span>Code agent</span>
            </button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Include context</label>
          <div class="context-list">
            <label><input id="context-console" type="checkbox" ${contextToggles.consoleLogs ? 'checked' : ''} /> Console logs</label>
            <label><input id="context-network" type="checkbox" ${contextToggles.networkLogs ? 'checked' : ''} /> Network logs</label>
            <label><input id="context-env" type="checkbox" ${contextToggles.environmentInfo ? 'checked' : ''} /> Environment info</label>
          </div>
        </div>

        <div class="detail-actions">
          <button id="send-to-target-btn" class="primary-action primary-action-wide">Send to ${getTargetLabel(target)}</button>
        </div>
      </div>
    `;

    detailPanelEl.querySelector<HTMLButtonElement>('#target-claude-btn')?.addEventListener('click', () => {
      target = 'claude';
      void loadHandoffContext(target).finally(() => {
        renderDetailPanel();
      });
    });
    detailPanelEl.querySelector<HTMLButtonElement>('#target-codex-btn')?.addEventListener('click', () => {
      target = 'codex';
      void loadHandoffContext(target).finally(() => {
        renderDetailPanel();
      });
    });
    detailPanelEl.querySelector<HTMLButtonElement>('#send-to-target-btn')?.addEventListener('click', () => {
      void sendSavedSession();
    });
    detailPanelEl.querySelector<HTMLInputElement>('#context-console')?.addEventListener('change', (event) => {
      contextToggles.consoleLogs = (event.currentTarget as HTMLInputElement).checked;
    });
    detailPanelEl.querySelector<HTMLInputElement>('#context-network')?.addEventListener('change', (event) => {
      contextToggles.networkLogs = (event.currentTarget as HTMLInputElement).checked;
    });
    detailPanelEl.querySelector<HTMLInputElement>('#context-env')?.addEventListener('change', (event) => {
      contextToggles.environmentInfo = (event.currentTarget as HTMLInputElement).checked;
    });
    return;
  }

  const saveDisabled = !screenshotDataUrl;
  const hasSelections = boxes.length > 0;

  detailPanelEl.innerHTML = `
    <div class="preview-shell">
      <div class="preview-mini">
        ${screenshotDataUrl ? `<img src="${screenshotDataUrl}" alt="Capture preview" class="preview-mini-image" />` : '<div class="preview-mini-empty">1280 × 720</div>'}
      </div>

      <div class="field-group">
        <label class="field-label" for="detail-session-title">Save to session</label>
        <input id="detail-session-title" class="text-input" type="text" value="${sessionTitle.replace(/"/g, '&quot;')}" />
      </div>

      <div class="field-group">
        <label class="field-label" for="detail-session-note">Add notes (optional)</label>
        <textarea id="detail-session-note" class="text-area" placeholder="What's happening here?">${sessionNote}</textarea>
      </div>

      <div class="field-group">
        <label class="field-label">Voice note</label>
        ${renderAudioSection()}
      </div>

      <div class="field-group">
        <label class="field-label">Capture state</label>
        <div class="capture-checklist">
          <div>${screenshotDataUrl ? '✓ Screenshot loaded' : '• Waiting for screenshot'}</div>
          <div>${hasSelections ? `✓ ${boxes.length} selection${boxes.length === 1 ? '' : 's'} added` : '• No selections yet'}</div>
          <div>${sessionNote.trim() ? '✓ Typed note added' : '• No typed note yet'}</div>
          <div>${audioNote ? `✓ Voice note ${formatDuration(audioNote.durationSec)}` : '• No voice note yet'}</div>
        </div>
      </div>

      <div class="detail-actions">
        <button id="detail-retake-btn" class="secondary-action">Retake</button>
        <button id="detail-save-btn" class="primary-action primary-action-small" ${saveDisabled ? 'disabled' : ''}>Save Capture</button>
      </div>
    </div>
  `;

  const titleInput = detailPanelEl.querySelector<HTMLInputElement>('#detail-session-title');
  const noteInput = detailPanelEl.querySelector<HTMLTextAreaElement>('#detail-session-note');
  titleInput?.addEventListener('input', () => {
    sessionTitle = titleInput.value;
  });
  noteInput?.addEventListener('input', () => {
    sessionNote = noteInput.value;
  });
  detailPanelEl.querySelector<HTMLButtonElement>('#detail-retake-btn')?.addEventListener('click', () => {
    clearCaptureState();
    setStatus('Capture cleared. Start another one when ready.');
  });
  detailPanelEl.querySelector<HTMLButtonElement>('#detail-save-btn')?.addEventListener('click', () => {
    void saveCaptureSession();
  });

  detailPanelEl.querySelector<HTMLButtonElement>('#record-audio-btn')?.addEventListener('click', () => {
    void startAudioRecording();
  });
  detailPanelEl.querySelector<HTMLButtonElement>('#remove-audio-btn')?.addEventListener('click', () => {
    removeAudioNote();
  });
  detailPanelEl.querySelector<HTMLButtonElement>('#stop-audio-btn')?.addEventListener('click', () => {
    void stopAudioRecording();
  });
}

async function refreshPermissionState() {
  permissionState = 'checking';
  renderPermissionCard();
  const granted = await invoke<boolean>('get_screen_capture_permission');
  permissionState = granted ? 'granted' : 'needs-access';
  renderPermissionCard();
  return granted;
}

async function openPermissionSettings() {
  try {
    await invoke('open_screen_capture_settings');
    setStatus('System Settings opened. Enable Debugr in Screen & System Audio Recording, then reopen the app.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not open System Settings.');
  }
}

async function ensureScreenCapturePermission(announceWhenGranted = false) {
  const alreadyGranted = await refreshPermissionState();
  if (alreadyGranted) {
    if (announceWhenGranted) {
      setStatus('Screen capture is already enabled.');
    }
    return true;
  }

  const granted = await invoke<boolean>('request_screen_capture_permission');
  permissionState = granted ? 'granted' : 'needs-access';
  renderPermissionCard();

  if (granted) {
    setStatus('Screen capture permission granted. If macOS requests a relaunch, reopen the app before capturing.');
    return true;
  }

  setStatus('Screen capture is still blocked. Open System Settings and enable Debugr, then relaunch the app.');
  return false;
}

async function startAudioRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setStatus('Voice notes are not supported in this app environment.');
    return;
  }

  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorderChunks = [];
    recordingStartedAt = Date.now();
    revokeAudioPreviewUrl();

    const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    mediaRecorder = preferredType ? new MediaRecorder(recorderStream, { mimeType: preferredType }) : new MediaRecorder(recorderStream);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recorderChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', async () => {
      const durationSec = Math.max(1, (Date.now() - recordingStartedAt) / 1000);
      const blob = new Blob(recorderChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
      const dataUrl = await blobToDataUrl(blob);
      revokeAudioPreviewUrl();
      audioPreviewUrl = URL.createObjectURL(blob);
      audioNote = { mimeType: blob.type || 'audio/webm', dataUrl, durationSec, createdAt: new Date().toISOString() };
      recorderStream?.getTracks().forEach((track) => track.stop());
      recorderStream = null;
      mediaRecorder = null;
      isRecordingAudio = false;
      captureConfirmed = false;
      renderDetailPanel();
      updateCaptureMeta();
      setStatus('Voice note attached to this capture.');
    });

    mediaRecorder.start();
    isRecordingAudio = true;
    renderDetailPanel();
    setStatus('Recording voice note...');
  } catch (error) {
    recorderStream?.getTracks().forEach((track) => track.stop());
    recorderStream = null;
    mediaRecorder = null;
    isRecordingAudio = false;
    renderDetailPanel();
    setStatus(error instanceof Error ? error.message : 'Could not access the microphone.');
  }
}

async function stopAudioRecording() {
  if (!mediaRecorder || !isRecordingAudio) return;
  isRecordingAudio = false;
  mediaRecorder.stop();
  renderDetailPanel();
  setStatus('Finishing voice note...');
}

function removeAudioNote() {
  audioNote = null;
  revokeAudioPreviewUrl();
  captureConfirmed = false;
  renderDetailPanel();
  updateCaptureMeta();
  setStatus('Voice note removed.');
}

async function createSession(title: string) {
  const res = await fetch(`${API_BASE}/projects/proj_demo/feedback-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, visibility: 'private' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Failed to create session');
  return json.data as { id: string; title: string; createdAt: string };
}

async function patchSession(id: string, payload: CapturePayload) {
  const patchRes = await fetch(`${API_BASE}/feedback-sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: sessionTitle.trim() || DEFAULT_TITLE, userIntent: JSON.stringify(payload) }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(err || 'Failed to save capture details');
  }
}

async function loadSessions() {
  try {
    const res = await fetch(`${API_BASE}/feedback-sessions`);
    if (!res.ok) throw new Error('Failed to load sessions');
    const json = (await res.json()) as { data: FeedbackSessionSummary[] };
    sessions = Array.isArray(json.data) ? json.data.slice(0, 8) : [];
    renderSessionList();
  } catch (error) {
    sessionListEl.innerHTML = '<div class="session-empty">Could not load sessions.</div>';
    appendLog('Session list load failed', error instanceof Error ? error.message : error);
  }
}

async function loadHandoffContext(nextTarget: Target) {
  const res = await fetch(`${API_BASE}/system/handoff-context?target=${nextTarget}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Failed to load handoff context');
  handoffContext = json.data as HandoffContext;
}

async function saveCaptureSession() {
  if (!screenshotDataUrl || !screenshotImage) {
    setStatus('Take or import a screenshot before saving.');
    return;
  }
  if (isRecordingAudio) {
    setStatus('Stop the voice note recording before saving.');
    return;
  }

  sessionTitle = sessionTitle.trim() || DEFAULT_TITLE;
  currentSessionCreatedAt = new Date().toISOString();
  const payload = buildCapturePayload();

  try {
    if (!currentSessionId) {
      const session = await createSession(sessionTitle);
      currentSessionId = session.id;
      currentSessionCreatedAt = session.createdAt;
    }

    await patchSession(currentSessionId, payload);
    await loadSessions();
    viewMode = 'saved';
    captureConfirmed = true;
    renderDetailPanel();
    renderSessionList();
    setStatus('Capture saved. Choose Claude or Codex for the handoff.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not save this capture.');
  }
}

async function sendSavedSession() {
  if (!currentSessionId) {
    setStatus('Save the capture first.');
    return;
  }

  if (handoffContext?.ready === false) {
    setStatus(handoffContext.warning || 'Linked repo context is not ready.');
    return;
  }

  try {
    const payload = buildCapturePayload();
    await patchSession(currentSessionId, payload);

    // Show loading state immediately
    viewMode = 'feedback';
    submissionResult = {
      sessionId: currentSessionId,
      taskId: 'pending',
      feedbackId: 'pending',
      target,
      message: `Sending to ${getTargetLabel(target)}...`,
    };
    renderDetailPanel();
    setStatus(`Sending to ${getTargetLabel(target)}...`);

    // Send and wait for real feedback
    const sendRes = await fetch(`${API_BASE}/feedback-sessions/${currentSessionId}/send-to-claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    if (!sendRes.ok) {
      const err = await sendRes.text();
      throw new Error(err || 'Failed to send session');
    }

    const json = await sendRes.json();
    submissionResult = {
      sessionId: currentSessionId,
      taskId: json.data.task_id,
      feedbackId: json.data.feedback_id,
      target,
      message: json.data.message,
      agentFeedback: json.data.agent_feedback as AgentFeedback | undefined,
    };

    renderDetailPanel();
    setStatus(`✓ Feedback received from ${getTargetLabel(target)}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to send session.');
    submissionResult = null;
    renderDetailPanel();
  }
}

async function loadScreenshot(dataUrl: string, sourceLabel: string) {
  screenshotDataUrl = dataUrl;
  boxes = [];
  selectedBoxId = null;
  draftBox = null;
  captureConfirmed = false;
  submissionResult = null;
  currentSessionId = null;
  currentSessionCreatedAt = new Date().toISOString();

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The selected image could not be loaded.'));
    image.src = dataUrl;
  });

  screenshotImage = image;
  naturalWidth = image.naturalWidth || 1440;
  naturalHeight = image.naturalHeight || 900;
  resizeCanvasToImage();
  annotationToolbarEl.classList.remove('annotation-toolbar-hidden');
  annotationHintEl.classList.remove('annotation-hint-hidden');
  viewMode = 'review';
  setStepContent();
  renderCanvas();
  renderDetailPanel();
  renderAnnotationList();
  updateCaptureMeta();
  setStatus(`${sourceLabel} ready. Review the capture, add notes, and save the session.`);
}

async function importImageFile(file: File) {
  const dataUrl = await blobToDataUrl(file);
  await loadScreenshot(dataUrl, `Imported ${file.name}`);
}

async function startScreenCapture() {
  try {
    const granted = await ensureScreenCapturePermission();
    if (!granted) return;
    captureBtn.disabled = true;
    importImageBtn.disabled = true;
    setStatus('Opening the macOS screenshot tool...');
    const dataUrl = await invoke<string>('capture_interactive_screenshot');
    await loadScreenshot(dataUrl, 'Screenshot');
  } catch (error) {
    setStatus('Screenshot capture did not complete. If focus gets awkward, use Import Image and continue.');
  } finally {
    captureBtn.disabled = false;
    importImageBtn.disabled = false;
  }
}

canvas.addEventListener('pointerdown', (event) => {
  if (!screenshotImage) {
    setStatus('Start by loading a screenshot.');
    return;
  }
  drawing = true;
  const point = canvasPointFromEvent(event);
  startPoint = point;
  draftBox = { id: `box_${Date.now()}`, x: point.x, y: point.y, width: 0, height: 0, notes: [] };
  canvas.setPointerCapture(event.pointerId);
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
  if (draftBox && draftBox.width >= 12 && draftBox.height >= 12) {
    boxes.push(draftBox);
    selectedBoxId = draftBox.id;
    draftBox = null;
    captureConfirmed = false;
    annotationHintEl.classList.add('annotation-hint-hidden');
    renderCanvas();
    renderAnnotationList();
    renderDetailPanel();
    updateCaptureMeta();
    setStatus('Selection added. Add notes, then save the capture.');
  } else {
    draftBox = null;
    renderCanvas();
  }
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', () => {
  drawing = false;
  startPoint = null;
  draftBox = null;
  renderCanvas();
});

captureBtn.addEventListener('click', () => {
  void startScreenCapture();
});

newCaptureBtn.addEventListener('click', () => {
  clearCaptureState();
  setStatus('Ready for a new capture.');
});

retakeBtn.addEventListener('click', () => {
  clearCaptureState();
  setStatus('Capture cleared. Start again when ready.');
});

saveCaptureBtn.addEventListener('click', () => {
  void saveCaptureSession();
});

importImageBtn.addEventListener('click', () => {
  imageFileInput.click();
});

imageFileInput.addEventListener('change', () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  void importImageFile(file)
    .catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not import that image.');
    })
    .finally(() => {
      imageFileInput.value = '';
    });
});

void (async () => {
  renderCanvas();
  renderPermissionCard();
  renderSessionList();
  renderAnnotationList();
  renderDetailPanel();
  setStepContent();
  updateCaptureMeta();
  await refreshPermissionState();
  await loadSessions();
  await loadHandoffContext(target);

  // Register global shortcut
  try {
    await invoke('register_global_shortcut');
    appendLog('✓ Global shortcut ⌘⌥A registered');
  } catch (error) {
    appendLog('⚠ Global shortcut registration failed', error);
  }

  appendLog('Desktop session app ready');
})();
