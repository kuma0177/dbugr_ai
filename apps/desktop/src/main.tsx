import './index.css';
import { invoke } from '@tauri-apps/api/core';

type Target = 'claude' | 'codex';
type PermissionState = 'checking' | 'granted' | 'needs-access';

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
const DEFAULT_TITLE = 'Capture issue for agent handoff';
const RECENT_KEY = 'debugr_native_recent_sessions';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app root');

app.innerHTML = `
  <div class="shell">
    <aside class="rail">
      <div class="brand-card">
        <div class="brand-row">
          <div class="brand-mark" aria-hidden="true">D</div>
          <div>
            <div class="brand-name">DEBUGR.AI</div>
            <div class="brand-subtitle">Native feedback composer</div>
          </div>
        </div>
        <h1 class="hero-title">Capture once. Annotate clearly. Send a real handoff.</h1>
        <p class="hero-copy">
          Native screenshot capture, visual markups, typed notes, and voice notes in one place. No browser recorder,
          no tab juggling.
        </p>
      </div>

      <div class="rail-card">
        <div class="card-kicker">Capture</div>
        <div class="tool-row">
          <button id="capture-btn" class="primary-btn">Take screenshot</button>
          <button id="import-image-btn" class="secondary-btn">Import image</button>
          <button id="reset-capture-btn" class="ghost-btn">Reset</button>
        </div>
        <input id="image-file-input" type="file" accept="image/*" hidden />
        <div id="capture-state" class="inline-status">No screenshot loaded yet.</div>
      </div>

      <div class="rail-card">
        <div class="card-kicker">Send</div>
        <div class="field">
          <label for="session-title">Session title</label>
          <input id="session-title" type="text" value="${DEFAULT_TITLE}" />
        </div>
        <div class="field">
          <label for="handoff-target">Send to</label>
          <select id="handoff-target">
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </div>
        <button id="submit-btn" class="primary-btn primary-btn-wide">Submit to agent</button>
        <div id="status" class="status-banner">Ready. Add a screenshot, notes, or voice memo to begin.</div>
      </div>

      <div class="rail-card">
        <div class="card-kicker">Permissions</div>
        <div id="permission-card"></div>
      </div>

      <div class="rail-card">
        <div class="card-kicker">Recent sessions</div>
        <div id="recent-sessions" class="recent"></div>
      </div>
    </aside>

    <main class="workspace">
      <section class="surface-card">
        <div class="surface-head">
          <div>
            <div class="surface-title">Screenshot surface</div>
            <div class="surface-copy">Take one screenshot at a time. If macOS focus gets awkward, import the image instead and keep going.</div>
          </div>
          <div id="annotation-mode-badge" class="mode-pill">Waiting for image</div>
        </div>

        <div id="annotation-toolbar" class="annotation-toolbar annotation-toolbar-hidden">
          <div class="tool-pill tool-pill-active">Box select</div>
          <div class="annotation-toolbar-copy">Click and drag on the image to mark the exact area. Add the explanation in the annotation list below.</div>
        </div>

        <div id="capture-stage" class="capture-stage capture-empty">
          <canvas id="capture-canvas" class="capture-canvas" aria-label="Screenshot annotation canvas"></canvas>
          <div id="annotation-hint" class="annotation-hint annotation-hint-hidden">
            <div class="annotation-hint-title">Drag to create a box</div>
            <div class="annotation-hint-copy">After the box appears, write a note in the annotations panel so Claude or Codex knows what matters.</div>
          </div>
          <div id="capture-placeholder" class="capture-placeholder">
            <div class="capture-placeholder-title">No image loaded</div>
            <div class="capture-placeholder-copy">
              Use <strong>Take screenshot</strong> for a native one-shot capture, or <strong>Import image</strong> if the screenshot already exists.
            </div>
          </div>
        </div>
      </section>

      <section class="composer-grid">
        <div class="workspace-card">
          <div class="card-kicker">Session notes</div>
          <textarea id="session-note" class="note-textarea" placeholder="Describe the issue, expected behavior, and anything the agent should pay attention to."></textarea>
        </div>

        <div class="workspace-card">
          <div class="card-kicker">Voice note</div>
          <div id="voice-note-card"></div>
        </div>

        <div class="workspace-card workspace-card-wide">
          <div class="card-kicker">Annotations</div>
          <div id="annotation-list" class="annotation-list"></div>
        </div>

        <div class="workspace-card">
          <div class="card-kicker">Confirm handoff</div>
          <div id="confirmation-card"></div>
        </div>

        <div class="workspace-card">
          <div class="card-kicker">Agent feedback</div>
          <div id="agent-feedback-card"></div>
        </div>

        <div class="workspace-card workspace-card-wide">
          <div class="card-kicker">Activity</div>
          <div id="logs" class="logs"></div>
        </div>
      </section>
    </main>
  </div>
`;

const sessionTitleInput = document.querySelector<HTMLInputElement>('#session-title')!;
const handoffTargetSelect = document.querySelector<HTMLSelectElement>('#handoff-target')!;
const captureBtn = document.querySelector<HTMLButtonElement>('#capture-btn')!;
const importImageBtn = document.querySelector<HTMLButtonElement>('#import-image-btn')!;
const resetCaptureBtn = document.querySelector<HTMLButtonElement>('#reset-capture-btn')!;
const imageFileInput = document.querySelector<HTMLInputElement>('#image-file-input')!;
const submitBtn = document.querySelector<HTMLButtonElement>('#submit-btn')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const captureStateEl = document.querySelector<HTMLDivElement>('#capture-state')!;
const logsEl = document.querySelector<HTMLDivElement>('#logs')!;
const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!;
const stageEl = document.querySelector<HTMLDivElement>('#capture-stage')!;
const placeholderEl = document.querySelector<HTMLDivElement>('#capture-placeholder')!;
const annotationListEl = document.querySelector<HTMLDivElement>('#annotation-list')!;
const recentSessionsEl = document.querySelector<HTMLDivElement>('#recent-sessions')!;
const confirmationCardEl = document.querySelector<HTMLDivElement>('#confirmation-card')!;
const agentFeedbackCardEl = document.querySelector<HTMLDivElement>('#agent-feedback-card')!;
const permissionCardEl = document.querySelector<HTMLDivElement>('#permission-card')!;
const annotationToolbarEl = document.querySelector<HTMLDivElement>('#annotation-toolbar')!;
const annotationHintEl = document.querySelector<HTMLDivElement>('#annotation-hint')!;
const annotationModeBadgeEl = document.querySelector<HTMLDivElement>('#annotation-mode-badge')!;
const sessionNoteTextarea = document.querySelector<HTMLTextAreaElement>('#session-note')!;
const voiceNoteCardEl = document.querySelector<HTMLDivElement>('#voice-note-card')!;

const ctx = canvas.getContext('2d')!;

let screenshotImage: HTMLImageElement | null = null;
let screenshotDataUrl = '';
let naturalWidth = 0;
let naturalHeight = 0;
let drawing = false;
let startPoint: { x: number; y: number } | null = null;
let draftBox: CaptureBox | null = null;
let boxes: CaptureBox[] = [];
let selectedBoxId: string | null = null;
let handoffContext: HandoffContext | null = null;
let captureConfirmed = false;
let submissionResult: SubmissionResult | null = null;
let permissionState: PermissionState = 'checking';
let audioNote: AudioNotePayload | null = null;
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

function setStatus(message: string) {
  statusEl.textContent = message;
  appendLog(message);
}

function getTargetLabel(target: Target) {
  return target === 'codex' ? 'Codex' : 'Claude Code';
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

function hasSubmissionContent() {
  const hasBoxes = boxes.length > 0;
  const hasBoxNotes = boxes.some((box) => box.notes.length > 0);
  const hasSessionNote = sessionNoteTextarea.value.trim().length > 0;
  const hasAudio = !!audioNote;
  return hasBoxes || hasBoxNotes || hasSessionNote || hasAudio;
}

function updateCaptureMeta() {
  if (!screenshotImage || !screenshotDataUrl) {
    captureStateEl.textContent = 'No screenshot loaded yet.';
    annotationModeBadgeEl.textContent = 'Waiting for image';
    return;
  }
  const noteCount = boxes.reduce((count, box) => count + box.notes.length, 0);
  const audioState = audioNote ? ` + voice note ${formatDuration(audioNote.durationSec)}` : '';
  captureStateEl.textContent = `${boxes.length} box${boxes.length === 1 ? '' : 'es'} · ${noteCount} note${noteCount === 1 ? '' : 's'}${audioState}`;
  annotationModeBadgeEl.textContent = selectedBoxId ? 'Editing selection' : 'Box annotation mode';
}

function clearCaptureState() {
  screenshotImage = null;
  screenshotDataUrl = '';
  naturalWidth = 0;
  naturalHeight = 0;
  drawing = false;
  startPoint = null;
  draftBox = null;
  boxes = [];
  selectedBoxId = null;
  captureConfirmed = false;
  submissionResult = null;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.aspectRatio = '';
  stageEl.classList.add('capture-empty');
  placeholderEl.style.display = 'grid';
  annotationToolbarEl.classList.add('annotation-toolbar-hidden');
  annotationHintEl.classList.add('annotation-hint-hidden');
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  renderAgentFeedbackCard();
  updateCaptureMeta();
}

function resetComposer() {
  clearCaptureState();
  sessionNoteTextarea.value = '';
  audioNote = null;
  revokeAudioPreviewUrl();
  renderVoiceNoteCard();
}

function renderPermissionCard() {
  if (permissionState === 'checking') {
    permissionCardEl.innerHTML = '<div class="subtle-copy">Checking screen capture access…</div>';
    return;
  }

  if (permissionState === 'granted') {
    permissionCardEl.innerHTML = `
      <div class="success-card">
        Screen capture access is enabled.
      </div>
      <div class="subtle-copy">Debugr can take a one-shot screenshot and bring it back into the composer automatically.</div>
    `;
    return;
  }

  permissionCardEl.innerHTML = `
    <div class="subtle-copy">Debugr needs access to Screen & System Audio Recording before native screenshots will work.</div>
    <div class="tool-row">
      <button id="grant-permission-btn" class="primary-btn primary-btn-small">Grant permission</button>
      <button id="open-permission-settings-btn" class="secondary-btn">Open settings</button>
    </div>
  `;

  permissionCardEl.querySelector<HTMLButtonElement>('#grant-permission-btn')?.addEventListener('click', () => {
    void ensureScreenCapturePermission(true);
  });
  permissionCardEl.querySelector<HTMLButtonElement>('#open-permission-settings-btn')?.addEventListener('click', () => {
    void openPermissionSettings();
  });
}

function renderVoiceNoteCard() {
  if (isRecordingAudio) {
    voiceNoteCardEl.innerHTML = `
      <div class="voice-state voice-state-live">
        <div class="voice-live-dot"></div>
        Recording now. When you're done, stop and keep the clip with this screenshot.
      </div>
      <div class="tool-row">
        <button id="stop-audio-btn" class="primary-btn primary-btn-small">Stop recording</button>
      </div>
    `;
    voiceNoteCardEl.querySelector<HTMLButtonElement>('#stop-audio-btn')?.addEventListener('click', () => {
      void stopAudioRecording();
    });
    return;
  }

  if (audioNote && audioPreviewUrl) {
    voiceNoteCardEl.innerHTML = `
      <div class="voice-state">
        Voice note attached · ${formatDuration(audioNote.durationSec)}
      </div>
      <audio class="audio-player" controls src="${audioPreviewUrl}"></audio>
      <div class="tool-row">
        <button id="record-audio-btn" class="secondary-btn">Replace voice note</button>
        <button id="remove-audio-btn" class="ghost-btn">Remove</button>
      </div>
    `;
  } else {
    voiceNoteCardEl.innerHTML = `
      <div class="subtle-copy">Record a short voice note if speaking is faster than typing. This gets bundled into the handoff payload.</div>
      <div class="tool-row">
        <button id="record-audio-btn" class="secondary-btn">Record voice note</button>
      </div>
    `;
  }

  voiceNoteCardEl.querySelector<HTMLButtonElement>('#record-audio-btn')?.addEventListener('click', () => {
    void startAudioRecording();
  });
  voiceNoteCardEl.querySelector<HTMLButtonElement>('#remove-audio-btn')?.addEventListener('click', () => {
    removeAudioNote();
  });
}

function renderConfirmationCard() {
  const target = handoffTargetSelect.value as Target;
  const targetLabel = getTargetLabel(target);
  const repoLabel = handoffContext?.repoName || handoffContext?.repoUrl || 'No linked repo configured';
  const hasTextNote = sessionNoteTextarea.value.trim().length > 0;
  const hasVoiceNote = !!audioNote;

  if (!screenshotImage || !screenshotDataUrl) {
    confirmationCardEl.innerHTML = `
      <div class="subtle-copy">Once the screenshot is loaded, confirm that this capture belongs to your active ${targetLabel} work and linked GitHub repo before sending it.</div>
      <ol class="ordered-list">
        <li>Take or import a screenshot.</li>
        <li>Add box selections, typed notes, voice notes, or any combination.</li>
        <li>Confirm the capture is in scope for ${repoLabel}.</li>
      </ol>
    `;
    return;
  }

  const warning = handoffContext?.warning
    ? `<div class="warning-card">${handoffContext.warning}</div>`
    : '';
  const confirmed = captureConfirmed
    ? `<div class="success-card" style="margin-top: 12px;">Confirmed. This screenshot is ready for ${targetLabel} and ${repoLabel}.</div>`
    : '';

  confirmationCardEl.innerHTML = `
    <div class="subtle-copy">Review the handoff package before sending it to ${targetLabel}.</div>
    <div class="fact-list">
      <div><strong>Linked repo</strong><span>${repoLabel}${handoffContext?.repoBranch ? ` · ${handoffContext.repoBranch}` : ''}</span></div>
      <div><strong>Selections</strong><span>${boxes.length} box${boxes.length === 1 ? '' : 'es'}</span></div>
      <div><strong>Typed notes</strong><span>${hasTextNote ? 'Included' : 'Not added yet'}</span></div>
      <div><strong>Voice note</strong><span>${hasVoiceNote ? `Included · ${formatDuration(audioNote?.durationSec ?? 0)}` : 'Not added yet'}</span></div>
    </div>
    ${warning}
    ${confirmed}
    <div class="tool-row" style="margin-top: 14px;">
      <button id="confirm-capture-btn" class="primary-btn primary-btn-small"${handoffContext?.ready === false ? ' disabled' : ''}>Confirm handoff</button>
      <button id="capture-again-btn" class="ghost-btn">Replace screenshot</button>
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
      boxes: boxes.length,
    });
    renderConfirmationCard();
    setStatus(`Handoff confirmed for ${targetLabel}. Submit when you're ready.`);
  });

  confirmationCardEl.querySelector<HTMLButtonElement>('#capture-again-btn')?.addEventListener('click', () => {
    clearCaptureState();
    setStatus('Screenshot cleared. Take or import the next one.');
  });
}

function renderAgentFeedbackCard() {
  if (!submissionResult) {
    agentFeedbackCardEl.innerHTML = `
      <div class="subtle-copy">Claude or Codex will acknowledge the handoff here after you submit the capture package.</div>
    `;
    return;
  }

  const currentSubmission = submissionResult;
  const feedback = currentSubmission.agentFeedback;
  const targetLabel = getTargetLabel(currentSubmission.target);
  const nextSteps = feedback?.next_steps?.length
    ? `<ol class="ordered-list">${feedback.next_steps.map((step) => `<li>${step}</li>`).join('')}</ol>`
    : '';

  agentFeedbackCardEl.innerHTML = `
    <div class="success-card">${targetLabel} accepted the handoff.</div>
    <div class="subtle-copy" style="margin-top: 12px;">${feedback?.title || `${targetLabel} acknowledged the capture package`}</div>
    <p class="body-copy">${feedback?.summary || currentSubmission.message}</p>
    <div class="fact-list compact-facts">
      <div><strong>Task</strong><span>${currentSubmission.taskId}</span></div>
      <div><strong>Session</strong><span>${currentSubmission.feedbackId}</span></div>
    </div>
    ${nextSteps}
    <div class="tool-row" style="margin-top: 14px;">
      <button id="open-summary-btn" class="primary-btn primary-btn-small">Open summary</button>
      <button id="new-capture-btn" class="ghost-btn">Start over</button>
    </div>
  `;

  agentFeedbackCardEl.querySelector<HTMLButtonElement>('#open-summary-btn')?.addEventListener('click', () => {
    window.location.href = `http://127.0.0.1:3000/sessions/${currentSubmission.sessionId}/summary?submitted=1&target=${currentSubmission.target}`;
  });
  agentFeedbackCardEl.querySelector<HTMLButtonElement>('#new-capture-btn')?.addEventListener('click', () => {
    resetComposer();
    setStatus('Ready for another handoff package.');
  });
}

function renderAnnotationList() {
  annotationListEl.innerHTML = '';

  if (!screenshotImage || !screenshotDataUrl) {
    annotationListEl.innerHTML = '<div class="empty-card">Load a screenshot first, then drag on the image to create a visual selection.</div>';
    return;
  }

  if (boxes.length === 0) {
    annotationListEl.innerHTML = '<div class="empty-card">No selections yet. Drag on the screenshot to create the first box.</div>';
    return;
  }

  boxes.forEach((box, index) => {
    const item = document.createElement('div');
    item.className = `annotation-item${selectedBoxId === box.id ? ' annotation-item-selected' : ''}`;

    const header = document.createElement('div');
    header.className = 'annotation-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'annotation-title';
    title.textContent = `Selection ${index + 1}`;
    const meta = document.createElement('div');
    meta.className = 'annotation-meta';
    meta.textContent = `${Math.round(box.x)}, ${Math.round(box.y)} · ${Math.round(box.width)}×${Math.round(box.height)}`;
    titleWrap.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'annotation-actions';
    const focusButton = document.createElement('button');
    focusButton.className = 'chip-btn';
    focusButton.textContent = selectedBoxId === box.id ? 'Selected' : 'Select';
    focusButton.addEventListener('click', (event) => {
      event.stopPropagation();
      selectedBoxId = box.id;
      renderCanvas();
      renderAnnotationList();
      updateCaptureMeta();
    });
    const deleteButton = document.createElement('button');
    deleteButton.className = 'chip-btn chip-btn-danger';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      boxes = boxes.filter((current) => current.id !== box.id);
      if (selectedBoxId === box.id) {
        selectedBoxId = boxes[0]?.id ?? null;
      }
      captureConfirmed = false;
      appendLog('Annotation deleted', { boxId: box.id });
      renderCanvas();
      renderAnnotationList();
      renderConfirmationCard();
      updateCaptureMeta();
    });
    actions.append(focusButton, deleteButton);

    header.append(titleWrap, actions);

    const textarea = document.createElement('textarea');
    textarea.className = 'annotation-textarea';
    textarea.placeholder = 'What should the agent notice in this selected area?';
    textarea.value = getPrimaryBoxNote(box);
    textarea.addEventListener('focus', () => {
      selectedBoxId = box.id;
      renderCanvas();
      updateCaptureMeta();
    });
    textarea.addEventListener('input', () => {
      setPrimaryBoxNote(box, textarea.value);
      captureConfirmed = false;
      renderConfirmationCard();
      updateCaptureMeta();
    });

    item.append(header, textarea);
    annotationListEl.appendChild(item);
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
      recentSessionsEl.innerHTML = '<div class="empty-card">No sessions yet.</div>';
      return;
    }

    sessions.forEach((session) => {
      const button = document.createElement('button');
      button.className = 'recent-item';
      button.innerHTML = `<strong>${session.title}</strong><span>${session.status} · ${new Date(session.createdAt).toLocaleDateString()}</span>`;
      button.addEventListener('click', () => {
        window.location.href = `http://127.0.0.1:3000/sessions/${session.id}/summary`;
      });
      recentSessionsEl.appendChild(button);
    });
  } catch (error) {
    recentSessionsEl.innerHTML = '<div class="empty-card">Could not load recent sessions.</div>';
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
    ctx.fillStyle = '#152033';
    ctx.fillRect(0, 0, canvas.width || 1280, canvas.height || 720);
  }

  boxes.forEach((box, index) => {
    const isSelected = selectedBoxId === box.id;
    ctx.strokeStyle = isSelected ? '#1d9bf0' : '#4f8cff';
    ctx.lineWidth = isSelected ? 5 : 3;
    ctx.fillStyle = isSelected ? 'rgba(29, 155, 240, 0.16)' : 'rgba(79, 140, 255, 0.12)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const label = `${index + 1}`;
    ctx.font = 'bold 16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const labelWidth = ctx.measureText(label).width + 16;
    const labelX = box.x;
    const labelY = Math.max(10, box.y - 26);
    ctx.fillStyle = isSelected ? '#1d9bf0' : '#4f8cff';
    ctx.fillRect(labelX, labelY, labelWidth, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, labelX + 8, labelY + 16);
  });

  if (draftBox) {
    ctx.strokeStyle = '#1d9bf0';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(draftBox.x, draftBox.y, draftBox.width, draftBox.height);
    ctx.setLineDash([]);
  }
}

function commitDraftBox() {
  if (!draftBox || draftBox.width < 12 || draftBox.height < 12) {
    draftBox = null;
    renderCanvas();
    return;
  }

  boxes.push(draftBox);
  selectedBoxId = draftBox.id;
  captureConfirmed = false;
  appendLog('Annotation box created', { boxId: draftBox.id, width: draftBox.width, height: draftBox.height });
  draftBox = null;
  annotationHintEl.classList.add('annotation-hint-hidden');
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  updateCaptureMeta();
  setStatus('Selection created. Add a note in the annotation card or keep going with session notes and voice notes.');
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
    appendLog('Opened macOS screen capture settings');
    setStatus('System Settings opened. Enable debugr.ai under Screen & System Audio Recording, then reopen the app.');
  } catch (error) {
    appendLog('Open settings failed', error instanceof Error ? error.message : error);
    setStatus(error instanceof Error ? error.message : 'Could not open System Settings.');
  }
}

async function ensureScreenCapturePermission(announceWhenGranted = false) {
  const alreadyGranted = await refreshPermissionState();
  if (alreadyGranted) {
    if (announceWhenGranted) {
      setStatus('Screen capture permission is already enabled.');
    }
    return true;
  }

  const granted = await invoke<boolean>('request_screen_capture_permission');
  permissionState = granted ? 'granted' : 'needs-access';
  renderPermissionCard();

  if (granted) {
    setStatus('Screen capture permission granted. If macOS asks for a relaunch, reopen the app before capturing.');
    appendLog('Screen capture permission granted');
    return true;
  }

  setStatus('Screen capture is still blocked. Open System Settings, enable debugr.ai, then fully reopen the app.');
  appendLog('Screen capture permission denied or still blocked');
  return false;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
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
      if (event.data.size > 0) {
        recorderChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', async () => {
      const durationSec = Math.max(1, (Date.now() - recordingStartedAt) / 1000);
      const blob = new Blob(recorderChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
      const dataUrl = await blobToDataUrl(blob);
      revokeAudioPreviewUrl();
      audioPreviewUrl = URL.createObjectURL(blob);
      audioNote = {
        mimeType: blob.type || 'audio/webm',
        dataUrl,
        durationSec,
        createdAt: new Date().toISOString(),
      };
      recorderStream?.getTracks().forEach((track) => track.stop());
      recorderStream = null;
      mediaRecorder = null;
      isRecordingAudio = false;
      captureConfirmed = false;
      renderVoiceNoteCard();
      renderConfirmationCard();
      updateCaptureMeta();
      setStatus('Voice note attached to this capture package.');
      appendLog('Voice note recorded', { durationSec });
    });

    mediaRecorder.start();
    isRecordingAudio = true;
    renderVoiceNoteCard();
    setStatus('Recording voice note...');
    appendLog('Voice note recording started');
  } catch (error) {
    recorderStream?.getTracks().forEach((track) => track.stop());
    recorderStream = null;
    mediaRecorder = null;
    isRecordingAudio = false;
    renderVoiceNoteCard();
    appendLog('Voice note start failed', error instanceof Error ? error.message : error);
    setStatus(error instanceof Error ? error.message : 'Could not access the microphone.');
  }
}

async function stopAudioRecording() {
  if (!mediaRecorder || !isRecordingAudio) return;
  isRecordingAudio = false;
  mediaRecorder.stop();
  renderVoiceNoteCard();
  setStatus('Finishing voice note...');
}

function removeAudioNote() {
  audioNote = null;
  revokeAudioPreviewUrl();
  captureConfirmed = false;
  renderVoiceNoteCard();
  renderConfirmationCard();
  updateCaptureMeta();
  setStatus('Voice note removed.');
}

async function loadScreenshot(dataUrl: string, sourceLabel: string) {
  clearCaptureState();
  screenshotDataUrl = dataUrl;

  const image = new Image();
  screenshotImage = image;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The selected image could not be loaded.'));
    image.src = dataUrl;
  });

  naturalWidth = image.naturalWidth || 1440;
  naturalHeight = image.naturalHeight || 900;
  resizeCanvasToImage();
  annotationToolbarEl.classList.remove('annotation-toolbar-hidden');
  annotationHintEl.classList.remove('annotation-hint-hidden');
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  updateCaptureMeta();
  appendLog('Screenshot loaded', { source: sourceLabel, width: naturalWidth, height: naturalHeight });
  setStatus(`${sourceLabel} ready. Drag on the image to create selections, or add typed and voice notes before sending.`);
}

async function importImageFile(file: File) {
  const dataUrl = await blobToDataUrl(file);
  await loadScreenshot(dataUrl, `Imported ${file.name}`);
}

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
  const target = handoffTargetSelect.value as Target;
  const sessionNote = sessionNoteTextarea.value.trim();

  if (!title) {
    setStatus('Add a session title before submitting.');
    return;
  }
  if (isRecordingAudio) {
    setStatus('Stop the voice note recording before submitting.');
    return;
  }
  if (!screenshotDataUrl || !screenshotImage) {
    setStatus('Take or import a screenshot before submitting.');
    return;
  }
  if (!hasSubmissionContent()) {
    setStatus('Add at least one annotation, typed note, or voice note before submitting.');
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
  importImageBtn.disabled = true;
  setStatus('Creating session and packaging the capture for the agent...');

  try {
    const session = await createSession(title);
    const payload: CapturePayload = {
      mode: 'native-capture',
      captureTitle: title,
      handoffTarget: target,
      screenshotDataUrl,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      capturedAt: new Date().toISOString(),
      sessionNote: sessionNote || undefined,
      audioNote: audioNote || undefined,
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
      throw new Error(err || 'Failed to save capture details');
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

    appendLog('Session submitted', {
      sessionId: session.id,
      taskId: json.data.task_id,
      target,
      boxes: boxes.length,
      hasSessionNote: !!sessionNote,
      hasAudioNote: !!audioNote,
    });
    setStatus(`Feedback received from ${getTargetLabel(target)}. Review the response or open the session summary.`);
    renderAgentFeedbackCard();
  } catch (error) {
    appendLog('Submit failed', error instanceof Error ? error.message : error);
    setStatus(error instanceof Error ? error.message : 'Failed to submit capture');
  } finally {
    submitBtn.disabled = false;
    captureBtn.disabled = false;
    importImageBtn.disabled = false;
  }
}

async function startScreenCapture() {
  try {
    const granted = await ensureScreenCapturePermission();
    if (!granted) return;
    captureBtn.disabled = true;
    importImageBtn.disabled = true;
    setStatus('Opening the macOS screenshot tool...');
    appendLog('Starting native screenshot capture');
    const dataUrl = await invoke<string>('capture_interactive_screenshot');
    await loadScreenshot(dataUrl, 'Screenshot');
  } catch (error) {
    appendLog('Capture failed', error instanceof Error ? error.message : error);
    setStatus('Screenshot capture did not complete. If the app loses focus, use Import image and continue from there.');
  } finally {
    captureBtn.disabled = false;
    importImageBtn.disabled = false;
  }
}

canvas.addEventListener('pointerdown', (event) => {
  if (!screenshotImage) {
    setStatus('Load a screenshot before creating a selection.');
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
  appendLog('Selection started', { x: Math.round(point.x), y: Math.round(point.y) });
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
  commitDraftBox();
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

importImageBtn.addEventListener('click', () => {
  imageFileInput.click();
});

imageFileInput.addEventListener('change', () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  void importImageFile(file)
    .catch((error) => {
      appendLog('Image import failed', error instanceof Error ? error.message : error);
      setStatus(error instanceof Error ? error.message : 'Could not import the selected image.');
    })
    .finally(() => {
      imageFileInput.value = '';
    });
});

resetCaptureBtn.addEventListener('click', () => {
  clearCaptureState();
  setStatus('Capture cleared. Take a new screenshot or import another image.');
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

sessionNoteTextarea.addEventListener('input', () => {
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
  renderPermissionCard();
  renderVoiceNoteCard();
  renderCanvas();
  renderAnnotationList();
  renderConfirmationCard();
  renderAgentFeedbackCard();
  updateCaptureMeta();
  await refreshPermissionState();
  await loadRecentSessions();
  await loadHandoffContext(handoffTargetSelect.value as Target);
  appendLog('Desktop capture app ready');
})();
