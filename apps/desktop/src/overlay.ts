import { invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import './overlay.css';

declare const __DEBUGR_BUILD_STAMP__: string;

// ── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: string;
  number: number;
  x: number; y: number;
  width?: number; height?: number;
  kind: 'pin' | 'region';
  text: string;
  tags: string[];
  timestamp: string;
}
interface PickerSession {
  id: string;
  title: string;
  createdAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ANNOTATIONS = 5;
const MIN_REGION = 36;
const TAGS = ['Bug', 'UX', 'Blocking', 'Question'];
const SESSION_CACHE_KEY = 'debugr-session-cache';
const MAIN_WEBVIEW_LABEL = 'main';
const FINISH_TOOL_LABEL = 'Finish → workspace';

// ── State ────────────────────────────────────────────────────────────────────

type OverlayStep = 'picking' | 'setup' | 'annotating';

let step: OverlayStep = 'picking';
let annotations: Annotation[] = [];
let activeTool: 'select' | 'pin' | 'region' = 'region';
let selectedId: string | null = null;

// session context chosen during picking/setup
let targetSessionId: string | null = null;   // null → create new
let newSessionName = '';
let newSessionAbout = '';
let localFolder: string | null = null;
let githubRepo = '';

// region-drag state
let dragging = false;
let dragStart: { x: number; y: number } | null = null;

// annotation move/resize state
let moveState: {
  id: string; mode: 'move' | 'resize'; handle?: string;
  ptId: number; sx: number; sy: number;
  initial: { left: number; top: number; width: number; height: number };
} | null = null;

// ── DOM Scaffold ─────────────────────────────────────────────────────────────

const root = document.getElementById('overlay-root')!;

root.innerHTML = `
  <div id="screenshot-bg"></div>
  <div id="dim-layer"></div>

  <!-- Step 1: session picker -->
  <div class="step-card" id="step-picker">
    <div class="step-card-title">Where should this go?</div>
    <div class="step-card-sub">Choose an existing session or start a new one.</div>
    <div class="picker-list" id="picker-list">
      <div class="picker-loading">Loading sessions…</div>
    </div>
    <div class="picker-actions">
      <button class="picker-cancel-btn" id="picker-cancel">Cancel</button>
      <button class="picker-new-btn" id="picker-new">+ New session</button>
    </div>
  </div>

  <!-- Step 2: new session setup -->
  <div class="step-card" id="step-setup" style="display:none;">
    <button class="step-back" id="setup-back">← Back</button>
    <div class="step-card-title">New session</div>
    <div class="step-card-sub">Give this session enough context so Claude or Codex knows what kind of annotations to expect.</div>

    <label class="setup-label">Session name</label>
    <input class="setup-input" id="setup-name" placeholder="e.g. Login page crash" maxlength="60" />
    <div class="setup-help">Use a short, clear title. It becomes the label for this session in the list and in the handoff.</div>

    <label class="setup-label" style="margin-top:14px;">About this session</label>
    <textarea class="setup-textarea" id="setup-about" maxlength="200" placeholder="What is this session about? What kind of annotations will you add?"></textarea>
    <div class="setup-meta-row">
      <div class="setup-help">Tell Claude or Codex what to look for so the screenshots are read with the right intent.</div>
      <div class="setup-count" id="setup-about-count">0 / 200</div>
    </div>

    <label class="setup-label" style="margin-top:14px;">Project folder <span class="setup-optional">(recommended)</span></label>
    <button class="folder-pick-btn" id="setup-folder-btn">📁 Choose folder…</button>
    <div class="folder-path" id="setup-folder-path" style="display:none;"></div>
    <div class="setup-help">Pick the folder when this issue belongs to local code. That gives the handoff a real filesystem anchor.</div>

    <label class="setup-label" style="margin-top:10px;">GitHub repo <span class="setup-optional">(optional)</span></label>
    <input class="setup-input" id="setup-github" placeholder="owner/repo" />
    <div class="setup-help">Add the repo when the work maps cleanly to GitHub. It helps Debugr reference the right project on the way out.</div>

    <button class="setup-start-btn" id="setup-start" disabled>Start annotating →</button>
  </div>

  <!-- Step 3: annotation mode -->
  <div id="annotation-ui" style="display:none;">
    <!-- Status stack: toast + session row (layout avoids overlap) -->
    <div class="annotate-header-stack" id="annotate-header">
      <div class="annotate-header-row">
        <div class="toast-center-slot">
          <div class="toast" id="toast">
            <div class="toast-inline">
              <div class="toast-shortcuts">
                <kbd>⌃</kbd><kbd>⌘</kbd><kbd>Z</kbd>
              </div>
              <span id="toast-text" class="toast-text">Click anywhere to add an annotation. Right-drag to draw a region.</span>
            </div>
          </div>
        </div>
        <div class="session-mode-bar" id="session-banner" role="toolbar" aria-label="Session target">
          <button type="button" class="session-mode-btn" id="session-mode-append" aria-pressed="false">Append session</button>
          <button type="button" class="session-mode-btn" id="session-mode-new" aria-pressed="false">New session</button>
        </div>
      </div>
    </div>

    <!-- SVG connectors -->
    <svg class="ann-connector" id="connectors" xmlns="http://www.w3.org/2000/svg"></svg>

    <!-- Note inspector -->
    <div class="note-panel" id="note-panel" style="display:none;">
      <div class="note-panel-header">
        <div class="note-panel-title">
          <strong id="note-title">Annotation</strong>
          <span id="note-subtitle">Add notes and tags</span>
        </div>
        <button class="note-panel-close" id="note-close" title="Close">×</button>
      </div>
      <div class="note-panel-body" id="note-body">
        <div class="note-panel-empty">Select an annotation to edit it.</div>
      </div>
    </div>

    <!-- Drag-select rubber band -->
    <div class="selection-rect" id="sel-rect" style="display:none;"></div>

    <!-- Bottom toolbar -->
    <div class="toolbar" id="toolbar">
      <button class="tool-btn" id="tool-pin" title="Pin">
        ●<div class="tool-label">Pin</div>
      </button>
      <button class="tool-btn" id="tool-region" title="Region">
        ▢<div class="tool-label">Region</div>
      </button>
      <button class="tool-btn" id="tool-select" title="Select">
        ↖<div class="tool-label">Select</div>
      </button>
      <div class="toolbar-divider"></div>
      <button class="tool-btn cancel" id="tool-cancel">Esc</button>
      <button class="tool-btn save-btn" id="tool-save">${FINISH_TOOL_LABEL}</button>
    </div>
  </div>

  <div class="build-stamp">${__DEBUGR_BUILD_STAMP__}</div>
`;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const screenshotBg   = document.getElementById('screenshot-bg')!;
const pickerListEl   = document.getElementById('picker-list')!;
const stepPickerEl   = document.getElementById('step-picker')!;
const stepSetupEl    = document.getElementById('step-setup')!;
const annotationUiEl = document.getElementById('annotation-ui')!;
const sessionBannerEl = document.getElementById('session-banner')!;
const sessionModeAppendBtn = document.getElementById('session-mode-append') as HTMLButtonElement;
const sessionModeNewBtn = document.getElementById('session-mode-new') as HTMLButtonElement;
const toastEl = document.getElementById('toast')!;
const toastTextEl    = document.getElementById('toast-text')!;
const notePanelEl    = document.getElementById('note-panel') as HTMLDivElement;
const noteTitleEl    = document.getElementById('note-title')!;
const noteSubtitleEl = document.getElementById('note-subtitle')!;
const noteBodyEl     = document.getElementById('note-body') as HTMLDivElement;
const connectorsEl   = document.getElementById('connectors')!;
const selRectEl      = document.getElementById('sel-rect') as HTMLDivElement;
const setupNameEl    = document.getElementById('setup-name') as HTMLInputElement;
const setupAboutEl   = document.getElementById('setup-about') as HTMLTextAreaElement;
const setupAboutCount = document.getElementById('setup-about-count')!;
const setupGithubEl  = document.getElementById('setup-github') as HTMLInputElement;
const setupFolderBtn = document.getElementById('setup-folder-btn') as HTMLButtonElement;
const setupFolderPath = document.getElementById('setup-folder-path')!;
const setupStartBtn = document.getElementById('setup-start') as HTMLButtonElement;
const toolSaveBtn = document.getElementById('tool-save') as HTMLButtonElement;

// ── Step transitions ──────────────────────────────────────────────────────────

function showStep(s: OverlayStep) {
  step = s;
  stepPickerEl.style.display   = s === 'picking'    ? 'flex' : 'none';
  stepSetupEl.style.display    = s === 'setup'      ? 'flex' : 'none';
  annotationUiEl.style.display = s === 'annotating' ? 'block' : 'none';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }

function clampBox(b: { left: number; top: number; width: number; height: number }) {
  const w = clamp(b.width, MIN_REGION, window.innerWidth - 8);
  const h = clamp(b.height, MIN_REGION, window.innerHeight - 8);
  return {
    left: clamp(b.left, 4, window.innerWidth - w - 4),
    top:  clamp(b.top,  4, window.innerHeight - h - 4),
    width: w, height: h,
  };
}

function boxOf(ann: Annotation) {
  const w = Math.max(ann.width ?? 120, MIN_REGION);
  const h = Math.max(ann.height ?? 60, MIN_REGION);
  return ann.kind === 'region'
    ? { left: ann.x - w / 2, top: ann.y - h / 2, width: w, height: h }
    : { left: ann.x - 60,   top: ann.y - 30,     width: 120, height: 60 };
}

function setToast(msg: string) { toastTextEl.textContent = msg; }

function updateAnnotatingHints() {
  if (step !== 'annotating') {
    toastEl.removeAttribute('title');
    return;
  }
  toastEl.title =
    'Nothing sent to AI from here — Finish opens Debugr, then Submit for Claude / Codex / Cursor.';
}

function updateCounter() {
  const n = annotations.length;
  setToast(n > 0
    ? `${n} annotation${n > 1 ? 's' : ''} — save each note, then tap Finish below.`
    : 'Click anywhere to add an annotation. Right-drag to draw a region.');
  updateAnnotatingHints();
}

function confirmDiscardAnnotations(): boolean {
  if (annotations.length === 0) return true;
  const n = annotations.length;
  return confirm(`Discard ${n} annotation${n === 1 ? '' : 's'} on screen and continue?`);
}

function resetAnnotationCanvas() {
  clearAnnotationDOM();
  connectorsEl.innerHTML = '';
  annotations = [];
  selectedId = null;
  notePanelEl.style.display = 'none';
}

function updateSessionModeChrome() {
  const append = targetSessionId !== null;
  sessionModeAppendBtn.classList.toggle('active', append);
  sessionModeNewBtn.classList.toggle('active', !append);
  sessionModeAppendBtn.setAttribute('aria-pressed', append ? 'true' : 'false');
  sessionModeNewBtn.setAttribute('aria-pressed', append ? 'false' : 'true');
  sessionBannerEl.style.display = 'flex';
}

function readCachedPickerSessions(): PickerSession[] {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PickerSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setPickerLoading() {
  const cached = readCachedPickerSessions();
  if (cached.length > 0) {
    renderPickerSessions(cached);
  } else {
    pickerListEl.innerHTML = '<div class="picker-loading">Loading sessions…</div>';
  }
}

function clearAnnotationDOM() {
  root.querySelectorAll('.ann-pin, .ann-highlight, .ann-delete').forEach(el => el.remove());
}

function rerenderAnnotations() {
  clearAnnotationDOM();
  connectorsEl.innerHTML = '';
  annotations.forEach((ann, index) => {
    ann.number = index + 1;
    if (ann.kind === 'pin') renderPin(ann);
    else renderRegion(ann);
  });
  if (selectedId) {
    const selected = annotations.find(a => a.id === selectedId);
    if (selected) {
      showNotePanel(selected);
    } else {
      deselectAnnotation();
    }
  }
  updateCounter();
}

function deleteAnnotation(id: string) {
  const idx = annotations.findIndex(a => a.id === id);
  if (idx === -1) return;
  const wasSelected = selectedId === id;
  annotations.splice(idx, 1);
  if (wasSelected) {
    selectedId = null;
    notePanelEl.style.display = 'none';
    connectorsEl.innerHTML = '';
  }
  rerenderAnnotations();
  setToast('Annotation deleted.');
}

// ── Step 1: Picker ────────────────────────────────────────────────────────────

function renderPickerSessions(list: Array<{ id: string; title: string; createdAt: string }>) {
  if (list.length === 0) {
    pickerListEl.innerHTML = '<div class="picker-empty">No past sessions yet. Start a new one to create your first list item.</div>';
    return;
  }
  pickerListEl.innerHTML = list.map(s => `
    <button class="picker-session-item" data-id="${s.id}">
      <span class="picker-session-title">${s.title}</span>
      <span class="picker-session-time">${relativeTime(s.createdAt)}</span>
    </button>
  `).join('');
  pickerListEl.querySelectorAll<HTMLButtonElement>('.picker-session-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      targetSessionId = btn.dataset.id ?? null;
      newSessionName = btn.querySelector('.picker-session-title')?.textContent ?? '';
      enterAnnotating();
    });
  });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

document.getElementById('picker-new')!.addEventListener('click', e => {
  e.stopPropagation();
  targetSessionId = null;
  setupNameEl.value = '';
  setupAboutEl.value = '';
  setupGithubEl.value = '';
  setupFolderPath.style.display = 'none';
  setupFolderBtn.textContent = '📁 Choose folder…';
  localFolder = null;
  githubRepo = '';
  updateSetupState();
  showStep('setup');
  setTimeout(() => setupNameEl.focus(), 50);
});

document.getElementById('picker-cancel')!.addEventListener('click', e => {
  e.stopPropagation(); void cancelOverlay();
});

sessionModeAppendBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!confirmDiscardAnnotations()) return;
  resetAnnotationCanvas();
  targetSessionId = null;
  newSessionName = '';
  newSessionAbout = '';
  localFolder = null;
  githubRepo = '';
  sessionBannerEl.style.display = 'none';
  showStep('picking');
  setPickerLoading();
  void emit('request-sessions');
});

sessionModeNewBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!confirmDiscardAnnotations()) return;
  resetAnnotationCanvas();
  targetSessionId = null;
  setupNameEl.value = '';
  setupAboutEl.value = '';
  setupGithubEl.value = '';
  setupFolderPath.style.display = 'none';
  setupFolderBtn.textContent = '📁 Choose folder…';
  localFolder = null;
  githubRepo = '';
  updateSetupState();
  sessionBannerEl.style.display = 'none';
  showStep('setup');
  setTimeout(() => setupNameEl.focus(), 50);
});

// ── Step 2: New session setup ─────────────────────────────────────────────────

document.getElementById('setup-back')!.addEventListener('click', e => {
  e.stopPropagation(); showStep('picking');
});

setupFolderBtn.addEventListener('click', async e => {
  e.stopPropagation();
  const path = await invoke<string | null>('pick_folder');
  if (path) {
    localFolder = path;
    const short = path.replace(/\/$/, '').split('/').slice(-2).join('/');
    setupFolderPath.textContent = '📁 ' + short;
    setupFolderPath.style.display = 'block';
    setupFolderBtn.textContent = 'Change folder…';
  }
});

setupNameEl.addEventListener('click', e => e.stopPropagation());
setupNameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') enterAnnotating(); });
setupNameEl.addEventListener('input', e => { e.stopPropagation(); updateSetupState(); });
setupAboutEl.addEventListener('click', e => e.stopPropagation());
setupAboutEl.addEventListener('input', e => {
  e.stopPropagation();
  updateSetupState();
});
setupGithubEl.addEventListener('click', e => e.stopPropagation());
setupGithubEl.addEventListener('keydown', e => e.stopPropagation());
setupGithubEl.addEventListener('input', e => {
  e.stopPropagation();
  githubRepo = setupGithubEl.value;
  updateSetupState();
});

document.getElementById('setup-start')!.addEventListener('click', e => {
  e.stopPropagation();
  enterAnnotating();
});

function updateSetupState() {
  newSessionName = setupNameEl.value.trim();
  newSessionAbout = setupAboutEl.value.trim();
  githubRepo = setupGithubEl.value.trim();
  setupAboutCount.textContent = `${newSessionAbout.length} / 200`;
  setupStartBtn.disabled = !newSessionName || !newSessionAbout;
}

function enterAnnotating() {
  if (!targetSessionId) {
    updateSetupState();
    if (!newSessionName || !newSessionAbout) {
      setToast('Add a title and about note before starting.');
      setupNameEl.focus();
      return;
    }
  } else {
    newSessionAbout = '';
  }

  showStep('annotating');
  setTool('region', false);
  updateSessionModeChrome();
  updateCounter();
}

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(t: typeof activeTool, markActive = true) {
  activeTool = t;
  (['pin', 'region', 'select'] as const).forEach(id => {
    document.getElementById(`tool-${id}`)?.classList.toggle('active', markActive && id === t);
  });
  root.style.cursor = t === 'pin' ? 'crosshair' : t === 'region' ? 'cell' : 'default';
}

document.getElementById('tool-pin')?.addEventListener('click',    e => { e.stopPropagation(); setTool('pin'); });
document.getElementById('tool-region')?.addEventListener('click', e => { e.stopPropagation(); setTool('region'); });
document.getElementById('tool-select')?.addEventListener('click', e => { e.stopPropagation(); setTool('select'); });

// ── Cancel / Escape ───────────────────────────────────────────────────────────

async function cancelOverlay() {
  await invoke('hide_overlay');
  setTimeout(resetState, 300);
}

document.getElementById('tool-cancel')?.addEventListener('click', e => {
  e.stopPropagation(); void cancelOverlay();
});
document.getElementById('note-close')?.addEventListener('click', e => {
  e.stopPropagation(); deselectAnnotation();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') void cancelOverlay();
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void saveAll();
});

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveAll() {
  if (annotations.length === 0) { void cancelOverlay(); return; }
  const prevLabel = toolSaveBtn.textContent || FINISH_TOOL_LABEL;
  toolSaveBtn.disabled = true;
  toolSaveBtn.textContent = 'Opening…';
  try {
    console.log('[Debugr] Emitting annotations-saved event...', {
      annotationCount: annotations.length,
      targetSessionId,
      newSessionName,
    });

    // Emit event to main window to save annotations
    await emitTo(MAIN_WEBVIEW_LABEL, 'annotations-saved', {
      annotations,
      targetSessionId,
      newSessionName,
      newSessionAbout,
      localFolder,
      githubRepo,
    });
    console.log('[Debugr] Event emitted successfully');

    // Small delay to ensure event listener processes the event
    await new Promise(resolve => setTimeout(resolve, 100));

    // Hide overlay first (it's on top of the main window)
    console.log('[Debugr] Hiding overlay...');
    await invoke('hide_overlay');
    console.log('[Debugr] Overlay hidden');

    // Then show and focus the main window
    console.log('[Debugr] Showing session window...');
    await invoke('show_session_window');
    console.log('[Debugr] Session window shown and focused');
  } catch (err) {
    console.error('[Debugr] Error in saveAll():', err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    setToast(`Error: ${errorMsg}`);
    updateAnnotatingHints();
    toolSaveBtn.disabled = false;
    toolSaveBtn.textContent = prevLabel;
    return;
  }
  setTimeout(resetState, 400);
}

document.getElementById('tool-save')?.addEventListener('click', e => {
  e.stopPropagation(); void saveAll();
});

// ── Place annotation ──────────────────────────────────────────────────────────

function placePin(x: number, y: number) {
  if (annotations.length >= MAX_ANNOTATIONS) {
    setToast(`Maximum ${MAX_ANNOTATIONS} annotations per session.`);
    return;
  }
  const ann: Annotation = {
    id: `ann_${Date.now()}`,
    number: annotations.length + 1,
    x, y, kind: 'pin',
    text: '', tags: [],
    timestamp: new Date().toISOString(),
  };
  annotations.push(ann);
  renderPin(ann);
  selectAnnotation(ann);
  updateCounter();
}

function placeRegion(x: number, y: number, w: number, h: number) {
  if (annotations.length >= MAX_ANNOTATIONS) {
    setToast(`Maximum ${MAX_ANNOTATIONS} annotations per session.`);
    return;
  }
  const box = clampBox({ left: x, top: y, width: w, height: h });
  const ann: Annotation = {
    id: `ann_${Date.now()}`,
    number: annotations.length + 1,
    x: box.left + box.width / 2,
    y: box.top  + box.height / 2,
    width: box.width, height: box.height,
    kind: 'region', text: '', tags: [],
    timestamp: new Date().toISOString(),
  };
  annotations.push(ann);
  renderRegion(ann);
  selectAnnotation(ann);
  updateCounter();
}

// ── Render pin ────────────────────────────────────────────────────────────────

function renderPin(ann: Annotation) {
  const pin = document.createElement('div');
  pin.className = 'ann-pin';
  pin.id = `pin_${ann.id}`;
  pin.style.cssText = `left:${ann.x}px;top:${ann.y}px;`;
  pin.textContent = String(ann.number);
  pin.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const box = boxOf(ann);
    moveState = {
      id: ann.id,
      mode: 'move',
      ptId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      initial: box,
    };
    pin.setPointerCapture(e.pointerId);
  });
  pin.addEventListener('click', e => { e.stopPropagation(); selectAnnotation(ann); });
  root.appendChild(pin);

  const hl = document.createElement('div');
  hl.className = 'ann-highlight';
  hl.id = `hl_${ann.id}`;
  hl.style.cssText = `left:${ann.x - 60}px;top:${ann.y - 30}px;width:120px;height:60px;pointer-events:none;`;
  root.appendChild(hl);

  const del = document.createElement('button');
  del.className = 'ann-delete';
  del.type = 'button';
  del.dataset.annId = ann.id;
  del.textContent = '×';
  del.title = 'Delete annotation';
  del.addEventListener('pointerdown', e => {
    e.stopPropagation();
    e.preventDefault();
  });
  del.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    deleteAnnotation(ann.id);
  });
  del.style.left = `${ann.x + 20}px`;
  del.style.top = `${ann.y - 18}px`;
  root.appendChild(del);
  syncSel();
}

// ── Render region ─────────────────────────────────────────────────────────────

function renderRegion(ann: Annotation) {
  const b = boxOf(ann);

  const hl = document.createElement('div');
  hl.className = 'ann-highlight ann-region';
  hl.id = `hl_${ann.id}`;
  hl.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;`;

  (['nw','n','ne','e','se','s','sw','w'] as const).forEach(name => {
    const hnd = document.createElement('div');
    hnd.className = `ann-handle ${name}`;
    hnd.id = `h_${ann.id}_${name}`;
    const [hx, hy] = handleOffset(name, b.width, b.height);
    hnd.style.left = `${hx}px`;
    hnd.style.top  = `${hy}px`;
    hnd.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const box = boxOf(ann);
      moveState = { id: ann.id, mode: 'resize', handle: name,
        ptId: e.pointerId, sx: e.clientX, sy: e.clientY, initial: box };
      hnd.setPointerCapture(e.pointerId);
    });
    hl.appendChild(hnd);
  });

  hl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ann-handle')) return;
    e.stopPropagation();
    const box = boxOf(ann);
    moveState = { id: ann.id, mode: 'move',
      ptId: e.pointerId, sx: e.clientX, sy: e.clientY, initial: box };
    hl.setPointerCapture(e.pointerId);
  });
  hl.addEventListener('click', e => { e.stopPropagation(); selectAnnotation(ann); });
  root.appendChild(hl);

  const pin = document.createElement('div');
  pin.className = 'ann-pin';
  pin.id = `pin_${ann.id}`;
  pin.style.cssText = `left:${b.left + b.width / 2}px;top:${b.top + b.height / 2}px;`;
  pin.textContent = String(ann.number);
  pin.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const box = boxOf(ann);
    moveState = {
      id: ann.id,
      mode: 'move',
      ptId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      initial: box,
    };
    pin.setPointerCapture(e.pointerId);
  });
  pin.addEventListener('click', e => { e.stopPropagation(); selectAnnotation(ann); });
  root.appendChild(pin);

  const del = document.createElement('button');
  del.className = 'ann-delete';
  del.type = 'button';
  del.dataset.annId = ann.id;
  del.textContent = '×';
  del.title = 'Delete annotation';
  del.addEventListener('pointerdown', e => {
    e.stopPropagation();
    e.preventDefault();
  });
  del.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    deleteAnnotation(ann.id);
  });
  del.style.left = `${b.left + b.width - 10}px`;
  del.style.top = `${b.top - 10}px`;
  root.appendChild(del);
  syncSel();
}

function handleOffset(name: string, w: number, h: number): [number, number] {
  const cx = w / 2, cy = h / 2;
  return (
    name === 'nw' ? [0, 0] : name === 'n' ? [cx, 0] : name === 'ne' ? [w, 0] :
    name === 'e'  ? [w, cy] : name === 'se' ? [w, h] : name === 's'  ? [cx, h] :
    name === 'sw' ? [0, h]  : [0, cy]
  );
}

function updateRegionDOM(ann: Annotation) {
  const b = clampBox(boxOf(ann));
  ann.x = b.left + b.width / 2;
  ann.y = b.top  + b.height / 2;
  ann.width = b.width; ann.height = b.height;

  const hl = document.getElementById(`hl_${ann.id}`) as HTMLDivElement | null;
  if (hl) {
    hl.style.left = `${b.left}px`; hl.style.top = `${b.top}px`;
    hl.style.width = `${b.width}px`; hl.style.height = `${b.height}px`;
  }
  const pin = document.getElementById(`pin_${ann.id}`) as HTMLDivElement | null;
  if (pin) {
    pin.style.left = `${b.left + b.width / 2}px`;
    pin.style.top  = `${b.top  + b.height / 2}px`;
  }
  (['nw','n','ne','e','se','s','sw','w'] as const).forEach(name => {
    const h = document.getElementById(`h_${ann.id}_${name}`) as HTMLDivElement | null;
    if (!h) return;
    const [hx, hy] = handleOffset(name, b.width, b.height);
    h.style.left = `${hx}px`; h.style.top = `${hy}px`;
  });
  const deleteBtn = [...root.querySelectorAll<HTMLButtonElement>('.ann-delete')].find(btn => btn.dataset.annId === ann.id);
  if (deleteBtn) {
    if (ann.kind === 'pin') {
      deleteBtn.style.left = `${ann.x + 20}px`;
      deleteBtn.style.top = `${ann.y - 18}px`;
    } else {
      deleteBtn.style.left = `${b.left + b.width - 10}px`;
      deleteBtn.style.top = `${b.top - 10}px`;
    }
  }
  syncSel();
  if (selectedId === ann.id) drawConnector(ann);
}

// ── Selection ─────────────────────────────────────────────────────────────────

function syncSel() {
  root.querySelectorAll<HTMLElement>('.ann-pin, .ann-highlight').forEach(el => {
    const rawId = el.id.replace(/^(pin_|hl_)/, '');
    el.classList.toggle('active', rawId === selectedId);
  });
}

function selectAnnotation(ann: Annotation) {
  selectedId = ann.id;
  syncSel();
  showNotePanel(ann);
}

function deselectAnnotation() {
  selectedId = null;
  syncSel();
  connectorsEl.innerHTML = '';
  notePanelEl.style.display = 'none';
}

// ── Note panel ────────────────────────────────────────────────────────────────

function showNotePanel(ann: Annotation) {
  noteTitleEl.textContent = `Annotation ${ann.number}`;
  noteSubtitleEl.textContent = ann.kind === 'region'
    ? 'Drag handles to resize. Save note closes this panel — Finish opens Debugr.'
    : 'Save note closes this panel — Finish opens Debugr.';
  noteBodyEl.innerHTML = `
    <div class="note-label">Notes</div>
    <textarea id="note-ta" placeholder="What should Claude know about this area?">${ann.text}</textarea>
    <div class="note-label">Tags</div>
    <div class="chips">
      ${TAGS.map(t => `<button class="chip${ann.tags.includes(t) ? ' active' : ''}" data-tag="${t}">${t}</button>`).join('')}
    </div>
    <button class="save-ann-btn" id="save-ann">Save note  ⌘↵</button>
  `;

  const ta = noteBodyEl.querySelector<HTMLTextAreaElement>('#note-ta')!;
  ta.addEventListener('input', () => { ann.text = ta.value; });
  ta.addEventListener('click', e => e.stopPropagation());
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveAnnotation(ann);
  });

  noteBodyEl.querySelectorAll<HTMLButtonElement>('.chip').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tag = btn.dataset.tag!;
      if (ann.tags.includes(tag)) { ann.tags = ann.tags.filter(t => t !== tag); btn.classList.remove('active'); }
      else { ann.tags.push(tag); btn.classList.add('active'); }
    });
  });

  noteBodyEl.querySelector('#save-ann')?.addEventListener('click', e => {
    e.stopPropagation(); saveAnnotation(ann);
  });

  notePanelEl.style.display = 'block';
  requestAnimationFrame(() => drawConnector(ann));
  ta.focus();
}

function saveAnnotation(ann: Annotation) {
  const btn = noteBodyEl.querySelector<HTMLButtonElement>('#save-ann')!;
  const defaultLabel = 'Save note  ⌘↵';
  btn.textContent = '✓ Saved';
  btn.style.background = '#16a34a';
  setTimeout(() => {
    btn.textContent = defaultLabel;
    btn.style.background = '';
    deselectAnnotation();
    setToast(`Annotation ${ann.number} saved — add more or tap Finish when done.`);
    updateAnnotatingHints();
  }, 400);
}

// ── Connector line ────────────────────────────────────────────────────────────

function drawConnector(ann: Annotation) {
  connectorsEl.querySelector(`#ln_${ann.id}`)?.remove();
  const pinEl = document.getElementById(`pin_${ann.id}`);
  if (!pinEl || notePanelEl.style.display === 'none') return;
  const pr = pinEl.getBoundingClientRect();
  const cr = notePanelEl.getBoundingClientRect();
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.id = `ln_${ann.id}`;
  line.setAttribute('x1', String(pr.left + pr.width / 2));
  line.setAttribute('y1', String(pr.top  + pr.height / 2));
  line.setAttribute('x2', String(cr.left));
  line.setAttribute('y2', String(cr.top + 28));
  line.setAttribute('stroke', '#0f6dfd');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '5,4');
  line.setAttribute('opacity', '0.6');
  connectorsEl.appendChild(line);
}

// ── Pointer events on canvas ──────────────────────────────────────────────────

root.addEventListener('contextmenu', e => e.preventDefault());

root.addEventListener('pointerdown', e => {
  if (step !== 'annotating') return;
  const target = e.target as HTMLElement;
  if (target.closest('.toolbar, .note-panel, .session-mode-bar, .ann-pin, .ann-highlight, .ann-delete, .step-card')) return;

  if (e.button === 0) {
    if (activeTool === 'pin') {
      placePin(e.clientX, e.clientY);
    } else if (activeTool === 'select') {
      deselectAnnotation();
    } else if (activeTool === 'region') {
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      selRectEl.style.display = 'block';
      updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
    }
    return;
  }

  if (e.button === 2) {
    e.preventDefault();
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    selRectEl.style.display = 'block';
    updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
  }
});

window.addEventListener('pointermove', e => {
  if (dragging && dragStart) {
    updateSelRect(dragStart.x, dragStart.y, e.clientX, e.clientY);
  }
  if (moveState) {
    const ann = annotations.find(a => a.id === moveState!.id);
    if (!ann) return;
    const dx = e.clientX - moveState.sx;
    const dy = e.clientY - moveState.sy;
    const b  = moveState.initial;
    if (moveState.mode === 'move') {
      ann.x = (b.left + dx) + (ann.width ?? 120) / 2;
      ann.y = (b.top  + dy) + (ann.height ?? 60) / 2;
    } else {
      const nb = resizeBox(b, dx, dy, moveState.handle!);
      ann.x = nb.left + nb.width  / 2;
      ann.y = nb.top  + nb.height / 2;
      ann.width  = nb.width;
      ann.height = nb.height;
    }
    updateRegionDOM(ann);
  }
});

window.addEventListener('pointerup', e => {
  if (moveState && e.pointerId === moveState.ptId) {
    const ann = annotations.find(a => a.id === moveState!.id);
    if (ann) updateRegionDOM(ann);
    moveState = null;
  }
  if (!dragging || !dragStart) return;
  if (e.button !== 0 && e.button !== 2) return;
  const endX = e.clientX, endY = e.clientY;
  const w = Math.abs(endX - dragStart.x);
  const h = Math.abs(endY - dragStart.y);
  const x = Math.min(dragStart.x, endX);
  const y = Math.min(dragStart.y, endY);
  selRectEl.style.display = 'none';
  dragging = false; dragStart = null;
  if (w > 12 && h > 12) placeRegion(x, y, w, h);
});

function updateSelRect(x1: number, y1: number, x2: number, y2: number) {
  selRectEl.style.left   = `${Math.min(x1, x2)}px`;
  selRectEl.style.top    = `${Math.min(y1, y2)}px`;
  selRectEl.style.width  = `${Math.abs(x2 - x1)}px`;
  selRectEl.style.height = `${Math.abs(y2 - y1)}px`;
}

function resizeBox(b: { left: number; top: number; width: number; height: number },
                   dx: number, dy: number, handle: string) {
  let { left, top, width, height } = b;
  if (handle.includes('w')) { left += dx; width -= dx; }
  if (handle.includes('e')) { width  += dx; }
  if (handle.includes('n')) { top   += dy; height -= dy; }
  if (handle.includes('s')) { height += dy; }
  if (width  < MIN_REGION) { if (handle.includes('w')) left = b.left + (b.width - MIN_REGION); width  = MIN_REGION; }
  if (height < MIN_REGION) { if (handle.includes('n')) top  = b.top  + (b.height - MIN_REGION); height = MIN_REGION; }
  return clampBox({ left, top, width, height });
}

// ── Screenshot from backend ───────────────────────────────────────────────────

void listen<string>('set-screenshot', event => {
  if (event.payload) {
    screenshotBg.style.backgroundImage = `url("${event.payload}")`;
  }
});

// ── Sessions list from main window ────────────────────────────────────────────

void listen<Array<PickerSession>>('sessions-list', event => {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(event.payload));
  } catch {
    // Ignore cache write failures.
  }
  renderPickerSessions(event.payload);
});

// ── Reset on each new invocation ──────────────────────────────────────────────

void listen('overlay-will-show', () => {
  applyDockOffset();
  resetState();
  // Request sessions for picker
  void emit('request-sessions');
  window.setTimeout(() => void emit('request-sessions'), 300);
});

function applyDockOffset() {
  const dockH = Math.max(
    0,
    window.screen.height - window.screen.availTop - window.screen.availHeight,
  );
  document.documentElement.style.setProperty('--dock-offset', `${dockH + 12}px`);
}

function resetState() {
  root.querySelectorAll('.ann-pin, .ann-highlight').forEach(el => el.remove());
  connectorsEl.innerHTML = '';
  annotations = [];
  selectedId = null;
  targetSessionId = null;
  newSessionName = '';
  newSessionAbout = '';
  localFolder = null;
  githubRepo = '';
  dragging = false; dragStart = null; moveState = null;
  selRectEl.style.display = 'none';
  screenshotBg.style.backgroundImage = '';
  notePanelEl.style.display = 'none';
  sessionBannerEl.style.display = 'none';
  toastEl.removeAttribute('title');
  toolSaveBtn.disabled = false;
  toolSaveBtn.textContent = FINISH_TOOL_LABEL;
  setPickerLoading();
  setupNameEl.value = '';
  setupAboutEl.value = '';
  setupGithubEl.value = '';
  setupFolderPath.textContent = '';
  setupFolderPath.style.display = 'none';
  setupFolderBtn.textContent = '📁 Choose folder…';
  setupAboutCount.textContent = '0 / 200';
  setupStartBtn.disabled = true;
  showStep('picking');
}

// ── Init ──────────────────────────────────────────────────────────────────────

applyDockOffset();
showStep('picking');
setPickerLoading();
updateSetupState();
void emit('request-sessions');
window.addEventListener('resize', applyDockOffset);
