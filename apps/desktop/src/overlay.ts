import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { requestScreenRecordingPermission } from 'tauri-plugin-macos-permissions-api';
import { uid } from './core';
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
  annotationCount?: number;
}

interface OverlayLaunchPayload {
  targetSessionId?: string | null;
  newSessionName?: string;
  newSessionAbout?: string;
  localFolder?: string | null;
  githubRepo?: string;
  skipPicker?: boolean;
}

interface ScreenCaptureDiagnosticsPayload {
  preflight: boolean;
  probe: boolean;
  granted: boolean;
  bundle_identifier: string;
  executable_path: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ANNOTATIONS = 5;
const MIN_REGION = 36;
const TAGS = ['Bug', 'UX', 'Blocking', 'Question'];
const SESSION_CACHE_KEY = 'debugr-session-cache';
const MAIN_WEBVIEW_LABEL = 'main';
const FINISH_TOOL_LABEL = 'Add to session';

// ── State ────────────────────────────────────────────────────────────────────

type OverlayStep = 'picking' | 'setup' | 'capture-source' | 'annotating' | 'saved';
type CaptureSourceMode = 'screen' | 'browser' | 'app';

let step: OverlayStep = 'picking';
let captureSourceMode: CaptureSourceMode = 'screen';
let annotations: Annotation[] = [];
let activeTool: 'region' = 'region';
let selectedId: string | null = null;
let screenshotCaptured = false;
let captureInProgress = false;
const debugLog: string[] = [];

function addDebugLog(msg: string) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  debugLog.push(entry);
  console.info(entry);
  localStorage.setItem('debugr-overlay-debug', JSON.stringify(debugLog.slice(-50)));
  void invoke('append_overlay_debug_log', { scope: 'overlay', message: entry }).catch(() => {});
}

/** Structured handoff logging for annotation → crop → session preview debugging. */
function logAnnotationPipeline(phase: string, detail: Record<string, string | number | boolean | null>) {
  const tail = Object.entries(detail)
    .map(([k, v]) => (v === null ? `${k}=null` : `${k}=${v}`))
    .join(' ');
  addDebugLog(`annotation.pipeline ${phase}${tail ? ` ${tail}` : ''}`);
}

function viewportLayoutSnapshot(): Record<string, number> {
  const vv = window.visualViewport;
  const out: Record<string, number> = {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
    screenX: window.screenX,
    screenY: window.screenY,
  };
  if (vv) {
    out.vvW = vv.width;
    out.vvH = vv.height;
    out.vvOffX = vv.offsetLeft;
    out.vvOffY = vv.offsetTop;
    out.vvScale = vv.scale;
  }
  return out;
}

function describeScreenshotRef(ref: string): { kind: string; len: number; head: string } {
  const len = ref.length;
  const head = ref.slice(0, Math.min(48, len)).replace(/\s+/g, ' ');
  if (!ref) return { kind: 'empty', len: 0, head: '' };
  if (ref.startsWith('data:image/png')) return { kind: 'data_png', len, head };
  if (ref.startsWith('data:image/jpeg')) return { kind: 'data_jpeg', len, head };
  if (ref.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref)) return { kind: 'abs_path', len, head };
  return { kind: 'other', len, head };
}

// session context chosen during picking/setup
let targetSessionId: string | null = null;   // null → create new
let newSessionName = '';
let newSessionAbout = '';
let localFolder: string | null = null;
let githubRepo = '';
let preparedNewSessionId: string | null = null;
let currentScreenshotDataUrl = '';
let pickerSessions: PickerSession[] = [];
let lastSavedSessionTitle = '';
let lastSavedAnnotationCount = 0;

function targetSessionAnnotationCount() {
  if (!targetSessionId) return 0;
  return pickerSessions.find((session) => session.id === targetSessionId)?.annotationCount ?? 0;
}

function remainingAnnotationSlots() {
  return Math.max(0, MAX_ANNOTATIONS - targetSessionAnnotationCount() - annotations.length);
}
/** Full-frame PNG from ScreenCaptureKit (display or window); cropping is done in this overlay. */
let sourceFrameDataUrl: string | null = null;
/** Where capture-source should return when the user taps Back. */
let pendingCaptureBackStep: OverlayStep = 'annotating';
let annotationPermissionCheckInFlight: Promise<boolean> | null = null;
let pickerLoadingToken = 0;
let pickerLoadingTimer: number | null = null;

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
  <div id="screenshot-bg"><img id="screenshot-img" alt="" crossorigin="anonymous" /></div>
  <div id="dim-layer"></div>

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

    <div class="hud-popover" id="hud-picker" style="display:none;">
      <div class="step-card step-card-hud" id="step-picker">
        <div class="step-card-title step-card-title-picker">Add to a new or existing session.</div>
        <div class="picker-hint">Click a session row to continue. Scroll for more.</div>
        <div class="picker-list" id="picker-list">
          <div class="picker-loading">${sandclockMarkup('Loading sessions…')}</div>
        </div>
        <div class="picker-actions">
          <button class="picker-cancel-btn" id="picker-cancel">Close</button>
          <button class="picker-new-btn" id="picker-new">+ New session</button>
        </div>
      </div>
    </div>

    <div class="hud-popover" id="hud-setup" style="display:none;">
      <div class="step-card step-card-hud step-card-setup" id="step-setup">
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
        <button class="folder-pick-btn" id="setup-folder-btn">Choose folder…</button>
        <div class="folder-path" id="setup-folder-path" style="display:none;"></div>
        <div class="setup-help">Pick the folder when this issue belongs to local code. That gives the handoff a real filesystem anchor.</div>

        <label class="setup-label" style="margin-top:10px;">GitHub repo <span class="setup-optional">(optional)</span></label>
        <input class="setup-input" id="setup-github" placeholder="owner/repo" />
        <div class="setup-help">Add the repo when the work maps cleanly to GitHub. It helps Debugr reference the right project on the way out.</div>

        <button class="setup-start-btn" id="setup-start" disabled>Use this session →</button>
      </div>
    </div>

    <div class="hud-popover" id="hud-capture" style="display:none;">
      <div class="step-card step-card-hud" id="step-capture">
        <div class="step-card-title">Choose screen or window</div>
        <div class="step-card-sub" id="capture-step-sub">Refresh to see the current screen, browser pages, and open app windows. Pick one, then mark the exact region you want to annotate.</div>
        <div class="capture-mode-bar" id="capture-mode-bar" role="tablist" aria-label="Capture source type">
          <button type="button" class="capture-mode-btn active" id="capture-mode-screen" data-capture-mode="screen" aria-selected="true">Current screen</button>
          <button type="button" class="capture-mode-btn" id="capture-mode-browser" data-capture-mode="browser" aria-selected="false">Browser tabs/pages</button>
          <button type="button" class="capture-mode-btn" id="capture-mode-app" data-capture-mode="app" aria-selected="false">Other apps</button>
        </div>
        <button type="button" class="picker-cancel-btn" id="capture-refresh" style="margin-top:8px;">Refresh list</button>
        <div class="capture-list" id="capture-list"><div class="picker-loading">${sandclockMarkup('Loading…')}</div></div>
        <div class="picker-actions" style="margin-top:12px;">
          <button type="button" class="picker-cancel-btn" id="capture-back">← Back</button>
        </div>
      </div>
    </div>

    <div class="hud-popover" id="hud-saved" style="display:none;">
      <div class="step-card step-card-hud" id="step-saved">
        <div class="step-card-title">Added to session</div>
        <div class="step-card-sub" id="saved-step-sub">Your annotation was saved.</div>
        <div class="picker-hint" id="saved-step-hint">Open the current session board when you are ready to submit it.</div>
        <div class="picker-actions saved-actions">
          <button class="picker-cancel-btn" id="saved-close">Close</button>
          <button class="picker-cancel-btn" id="saved-more">+ Add more</button>
          <button class="picker-new-btn" id="saved-open-session">Open session board</button>
        </div>
      </div>
    </div>

    <!-- SVG connectors -->
    <svg class="ann-connector" id="connectors" xmlns="http://www.w3.org/2000/svg"></svg>

    <!-- Drag-select rubber band -->
    <div class="selection-rect" id="sel-rect" style="display:none;"></div>

    <!-- Bottom toolbar -->
    <div class="toolbar" id="toolbar">
      <button class="tool-btn" id="tool-region" title="Region">
        ▢<div class="tool-label">Region</div>
      </button>
      <div class="toolbar-divider"></div>
      <button class="tool-btn cancel" id="tool-cancel">Esc</button>
      <button class="tool-btn save-btn" id="tool-save">${FINISH_TOOL_LABEL}</button>
    </div>
  </div>

  <!-- Note inspector: direct child of overlay-root so fixed stacking isn't trapped inside #annotation-ui -->
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

  <div class="build-stamp">${__DEBUGR_BUILD_STAMP__}</div>
`;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const screenshotBg   = document.getElementById('screenshot-bg')!;
const screenshotImgEl = document.getElementById('screenshot-img') as HTMLImageElement;
const hudCaptureEl   = document.getElementById('hud-capture')!;
const hudSavedEl     = document.getElementById('hud-saved')!;
const captureListEl  = document.getElementById('capture-list')!;
const captureTitleEl = hudCaptureEl.querySelector<HTMLElement>('.step-card-title')!;
const captureStepSubEl = document.getElementById('capture-step-sub')!;
const captureModeBarEl = document.getElementById('capture-mode-bar')!;
const captureRefreshBtn = document.getElementById('capture-refresh') as HTMLButtonElement;
const savedStepSubEl = document.getElementById('saved-step-sub')!;
const savedStepHintEl = document.getElementById('saved-step-hint')!;
const pickerListEl   = document.getElementById('picker-list')!;
const hudPickerEl    = document.getElementById('hud-picker')!;
const hudSetupEl     = document.getElementById('hud-setup')!;
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

function applySourceFrameDisplay(dataUrl: string, options: { visible?: boolean } = {}) {
  sourceFrameDataUrl = dataUrl || null;
  if (sourceFrameDataUrl) {
    const visible = options.visible ?? true;
    screenshotImgEl.src = sourceFrameDataUrl;
    screenshotImgEl.style.display = 'block';
    screenshotImgEl.classList.toggle('source-frame-hidden', !visible);
    screenshotBg.style.backgroundImage = '';
  } else {
    screenshotImgEl.removeAttribute('src');
    screenshotImgEl.style.display = 'none';
    screenshotImgEl.classList.remove('source-frame-hidden');
    screenshotBg.style.backgroundImage = '';
  }
}

function applyScreenshotDataUrl(dataUrl: string) {
  currentScreenshotDataUrl = dataUrl || '';
  if (currentScreenshotDataUrl.startsWith('data:image/')) {
    applySourceFrameDisplay(currentScreenshotDataUrl);
  } else {
    screenshotImgEl.removeAttribute('src');
    screenshotImgEl.style.display = 'none';
    screenshotBg.style.backgroundImage = currentScreenshotDataUrl
      ? `url("${currentScreenshotDataUrl}")`
      : '';
    sourceFrameDataUrl = currentScreenshotDataUrl || null;
  }
  const d = describeScreenshotRef(currentScreenshotDataUrl);
  logAnnotationPipeline('screenshot_applied_to_overlay', {
    kind: d.kind,
    len: d.len,
    has_bg: Boolean(currentScreenshotDataUrl),
  });
}

const setupFolderBtn = document.getElementById('setup-folder-btn') as HTMLButtonElement;
const setupFolderPath = document.getElementById('setup-folder-path')!;
const setupStartBtn = document.getElementById('setup-start') as HTMLButtonElement;
const toolSaveBtn = document.getElementById('tool-save') as HTMLButtonElement;
const toolbarEl = document.getElementById('toolbar') as HTMLDivElement;

function sandclockMarkup(label: string) {
  return `<span class="sandclock-inline"><span class="sandclock-spinner" aria-hidden="true">⌛</span><span>${label}</span></span>`;
}

// ── Step transitions ──────────────────────────────────────────────────────────

function showStep(s: OverlayStep) {
  step = s;
  annotationUiEl.style.display = 'block';
  hudPickerEl.style.display = s === 'picking' ? 'block' : 'none';
  hudSetupEl.style.display = s === 'setup' ? 'block' : 'none';
  hudCaptureEl.style.display = s === 'capture-source' ? 'block' : 'none';
  hudSavedEl.style.display = s === 'saved' ? 'block' : 'none';
  stepPickerEl.style.display = s === 'picking' ? 'flex' : 'none';
  stepSetupEl.style.display = s === 'setup' ? 'flex' : 'none';
  root.classList.toggle('cursor-annotating', s === 'annotating');

  // During picker/setup phases, allow clicks to pass through to apps behind overlay.
  // During annotation phase, capture mouse events for drawing annotations.
  if (s === 'picking' || s === 'setup' || s === 'capture-source' || s === 'saved') {
    // Make overlay transparent to mouse events (clicks pass through to apps)
    root.style.pointerEvents = 'none';
    // But allow interaction with picker/setup UI by setting pointer-events on interactive elements
    const interactiveEls = root.querySelectorAll('button, input, select, .step-picker, .step-setup, #hud-capture button, #hud-capture .capture-list, #hud-saved button');
    interactiveEls.forEach(el => {
      (el as HTMLElement).style.pointerEvents = 'auto';
    });
  } else if (s === 'annotating') {
    // During annotation, capture all mouse events for drawing
    root.style.pointerEvents = 'auto';
    // Picker/setup left pointer-events:auto on many buttons; strip those so subtree inherits clean state.
    [hudPickerEl, hudSetupEl, hudSavedEl].forEach(container => {
      container.querySelectorAll<HTMLElement>('button, input, select, textarea').forEach(el => {
        el.style.removeProperty('pointer-events');
      });
    });
    toolbarEl.style.display = 'flex';
    toolbarEl.style.pointerEvents = 'auto';
  }
  addDebugLog(`overlay.step.changed step=${s} root_pointer=${root.style.pointerEvents || 'default'} annotation_ui=${annotationUiEl.style.display || 'default'} toolbar=${toolbarEl.style.display || 'default'} img=${screenshotImgEl.style.display || 'default'}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }

/** Bounding rect of the letterboxed snapshot image in client coordinates (or full window). */
function snapshotImgClientRect(): DOMRect | null {
  if (!screenshotImgEl.naturalWidth || screenshotImgEl.style.display === 'none') return null;
  return screenshotImgEl.getBoundingClientRect();
}

function clampBox(b: { left: number; top: number; width: number; height: number }) {
  const ir = snapshotImgClientRect();
  if (ir && ir.width > 0 && ir.height > 0) {
    const maxW = ir.width - 4;
    const maxH = ir.height - 4;
    const w = clamp(b.width, MIN_REGION, maxW);
    const h = clamp(b.height, MIN_REGION, maxH);
    return {
      left: clamp(b.left, ir.left + 2, ir.right - w - 2),
      top: clamp(b.top, ir.top + 2, ir.bottom - h - 2),
      width: w,
      height: h,
    };
  }
  const w = clamp(b.width, MIN_REGION, window.innerWidth - 8);
  const h = clamp(b.height, MIN_REGION, window.innerHeight - 8);
  return {
    left: clamp(b.left, 4, window.innerWidth - w - 4),
    top: clamp(b.top, 4, window.innerHeight - h - 4),
    width: w,
    height: h,
  };
}

function cropImageDataUrl(
  dataUrl: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ox = clamp(Math.floor(sx), 0, Math.max(0, img.naturalWidth - 1));
      const oy = clamp(Math.floor(sy), 0, Math.max(0, img.naturalHeight - 1));
      const cw = Math.max(1, Math.min(Math.ceil(sw), img.naturalWidth - ox));
      const ch = Math.max(1, Math.min(Math.ceil(sh), img.naturalHeight - oy));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2d context unavailable'));
        return;
      }
      ctx.drawImage(img, ox, oy, cw, ch, 0, 0, cw, ch);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

/** Map client coords to natural pixels of #screenshot-img. */
function clientRectToImageRect(left: number, top: number, width: number, height: number) {
  const img = screenshotImgEl;
  if (!img.naturalWidth) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const r = img.getBoundingClientRect();
  const scaleX = img.naturalWidth / r.width;
  const scaleY = img.naturalHeight / r.height;
  const x1 = (Math.min(left, left + width) - r.left) * scaleX;
  const y1 = (Math.min(top, top + height) - r.top) * scaleY;
  const x2 = (Math.max(left, left + width) - r.left) * scaleX;
  const y2 = (Math.max(top, top + height) - r.top) * scaleY;
  let ix1 = Math.round(x1);
  let iy1 = Math.round(y1);
  let ix2 = Math.round(x2);
  let iy2 = Math.round(y2);
  ix1 = clamp(ix1, 0, img.naturalWidth - 1);
  iy1 = clamp(iy1, 0, img.naturalHeight - 1);
  ix2 = clamp(ix2, ix1 + 1, img.naturalWidth);
  iy2 = clamp(iy2, iy1 + 1, img.naturalHeight);
  return { sx: ix1, sy: iy1, sw: ix2 - ix1, sh: iy2 - iy1 };
}

async function showCaptureSourceStep() {
  if (step !== 'capture-source') {
    pendingCaptureBackStep =
      step === 'setup' ? 'setup' : step === 'picking' ? 'picking' : 'annotating';
  }
  resetCaptureSourceChrome();
  showStep('capture-source');
  setToast('Pick a display or window to snapshot.');
  await loadCaptureSources();
}

function resetCaptureSourceChrome() {
  captureTitleEl.textContent = 'Choose screen or window';
  captureStepSubEl.textContent = 'Refresh to see the current screen, browser pages, and open app windows. Pick one, then mark the exact region you want to annotate.';
  captureModeBarEl.style.display = '';
  captureRefreshBtn.style.display = '';
}

function applyAnnotationPermissionGateChrome() {
  captureTitleEl.textContent = 'Enable Screen Recording';
  captureStepSubEl.textContent = 'Dbugr needs Screen Recording permission before annotation starts, so every saved annotation has a real image preview.';
  captureModeBarEl.style.display = 'none';
  captureRefreshBtn.style.display = 'none';
}

async function beginCurrentScreenCapture() {
  if (captureInProgress) {
    addDebugLog('capture.current_screen.skip already_in_progress=true');
    return;
  }
  addDebugLog('capture.current_screen.deferred transparent_live_overlay=true');
  applySourceFrameDisplay('');
  screenshotCaptured = false;
  currentScreenshotDataUrl = '';
  await resumeOverlayVisible();
  showStep('annotating');
  setTool(activeTool, true);
  ensureAnnotatingControlsReady('transparent_live_overlay');
  setToast('Draw a region over the current screen.');
  updateCounter();
}

function ensureAnnotatingControlsReady(reason: string) {
  annotationUiEl.style.display = 'block';
  hudPickerEl.style.display = 'none';
  hudSetupEl.style.display = 'none';
  hudCaptureEl.style.display = 'none';
  hudSavedEl.style.display = 'none';
  stepPickerEl.style.display = 'none';
  stepSetupEl.style.display = 'none';
  toolbarEl.style.display = 'flex';
  toolbarEl.style.pointerEvents = 'auto';
  root.style.pointerEvents = 'auto';
  root.classList.add('cursor-annotating');
  void document.documentElement.offsetHeight;

  const imgRect = screenshotImgEl.getBoundingClientRect();
  const toolbarRect = toolbarEl.getBoundingClientRect();
  addDebugLog(
    `overlay.annotating_controls.ready reason=${reason} step=${step} tool=${activeTool} ` +
    `source_frame=${Boolean(sourceFrameDataUrl)} img_display=${screenshotImgEl.style.display || 'default'} ` +
    `img_w=${Math.round(imgRect.width)} img_h=${Math.round(imgRect.height)} ` +
    `toolbar_display=${toolbarEl.style.display || 'default'} toolbar_w=${Math.round(toolbarRect.width)} toolbar_h=${Math.round(toolbarRect.height)}`,
  );
}

function beginCaptureFlowForMode(mode: CaptureSourceMode = captureSourceMode) {
  if (mode === 'screen') {
    void beginCurrentScreenCapture();
    return;
  }
  void showCaptureSourceStep();
}

async function ensureScreenshotImgReady(): Promise<void> {
  if (!sourceFrameDataUrl || !screenshotImgEl.src) {
    throw new Error('No snapshot');
  }
  if (!screenshotImgEl.complete) {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('Snapshot failed to load'));
      };
      const cleanup = () => {
        screenshotImgEl.removeEventListener('load', onLoad);
        screenshotImgEl.removeEventListener('error', onErr);
      };
      screenshotImgEl.addEventListener('load', onLoad);
      screenshotImgEl.addEventListener('error', onErr);
    });
  }
  await screenshotImgEl.decode().catch(() => {});
}

/** macOS ScreenCaptureKit / TCC messages — user-facing copy lives in renderCaptureSourcesError. */
function isLikelyMacScreenRecordingDenied(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('tcc') ||
    (m.includes('declined') && (m.includes('capture') || m.includes('window') || m.includes('display'))) ||
    m.includes('screen recording') ||
    (m.includes('not authorized') && m.includes('capture')) ||
    (m.includes('not permitted') && m.includes('capture'))
  );
}

function wireCaptureSettingsButtons(root: ParentNode) {
  root.querySelector('#capture-open-screen-settings')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      setToast('Opening Screen Recording settings…');
      await hideOverlayForMacosPermissionUi('open_screen_capture_settings');
      await invoke('open_screen_capture_settings');
    } catch (err) {
      addDebugLog(`permission.settings.open.failed error=${String(err)}`);
      setToast('Could not open System Settings. Open Screen Recording manually from Privacy & Security.');
    }
  });
  root.querySelector('#capture-retry-after-perm')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void loadCaptureSources();
  });
}

function attachCaptureRequestAccessHandler(root: ParentNode) {
  root.querySelector('#capture-request-access')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    setToast('Asking macOS…');
    try {
      await hideOverlayForMacosPermissionUi('request_screen_capture_permission');
      await requestScreenRecordingPermission();
    } catch {
      try {
        await invoke<boolean>('request_screen_capture_permission');
      } catch (err) {
        addDebugLog(`permission.request.failed error=${String(err)}`);
        setToast(`Could not request access: ${String(err)}`);
        return;
      }
    }
  });
}

async function hideOverlayForMacosPermissionUi(reason: string): Promise<void> {
  addDebugLog(`permission.ui.hide_overlay reason=${reason}`);
  try {
    await invoke('hide_overlay');
    await new Promise(resolve => window.setTimeout(resolve, 180));
  } catch (err) {
    addDebugLog(`permission.ui.hide_overlay_failed reason=${reason} error=${String(err)}`);
  }
  // Do NOT call show_session_window here — doing so hijacks the main window to the
  // home/session page in the middle of annotation flows that hit a permission error,
  // and causes "goes to home page on starting a session" regression.
  // Users can re-access the app from the menu-bar tray after dismissing the dialog.
}

/** When macOS refuses to list capture sources — clear, non-looping recovery UI. */
function renderCaptureSourcesScreenRecordingOff(kind: 'plugin' | 'generic') {
  const lead =
    kind === 'plugin'
      ? 'Dbugr cannot read open screens or windows yet.'
      : 'macOS did not share the screen/window list with Dbugr.';
  const detail =
    kind === 'plugin'
      ? `<p class="capture-perm-detail">macOS has not released Screen Recording access to the running Dbugr process yet. If you just enabled <strong>Dbugr.ai.app</strong> in System Settings, quit Dbugr completely and reopen it once so macOS applies the change.</p>
        <p class="capture-perm-tip"><strong>Need to change the permission?</strong> Use the buttons below. Dbugr will get out of the way before macOS opens the prompt or settings screen.</p>
        <p class="capture-perm-tip"><strong>Advanced dev build note:</strong> macOS treats a local dev binary separately from the installed app. Only add the dev binary when you are intentionally running from source.</p>`
      : `<p class="capture-perm-detail">Tap <strong>Refresh list</strong> first. If the list still stays empty, quit and reopen Dbugr once so macOS refreshes the Screen Recording grant for this installed app.</p>
        <p class="capture-perm-tip">Only use <strong>Ask macOS</strong> or <strong>Open Screen Recording settings</strong> if Dbugr is missing from System Settings or the toggle is off.</p>`;
  captureListEl.innerHTML = `
      <div class="capture-perm-panel">
        <p class="capture-perm-lead">${lead}</p>
        ${detail}
        <div class="capture-perm-actions">
          <button type="button" class="capture-perm-primary" id="capture-retry-after-perm">Refresh list</button>
          <button type="button" class="capture-perm-secondary" id="capture-request-access">Ask macOS for screen capture…</button>
          <button type="button" class="capture-perm-secondary" id="capture-open-screen-settings">Open Screen Recording settings</button>
        </div>
      </div>`;
  captureListEl.querySelector('#capture-open-screen-settings')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      setToast('Opening Screen Recording settings…');
      await hideOverlayForMacosPermissionUi('open_screen_capture_settings_from_annotation_gate');
      await invoke('open_screen_capture_settings');
    } catch (err) {
      addDebugLog(`permission.settings.open.failed error=${String(err)}`);
      setToast('Could not open System Settings. Open Screen Recording manually from Privacy & Security.');
    }
  });
  attachCaptureRequestAccessHandler(captureListEl);
}

function renderAnnotationPermissionGate(reason: string) {
  showStep('capture-source');
  applyAnnotationPermissionGateChrome();
  pendingCaptureBackStep = targetSessionId ? 'picking' : 'setup';
  setToast('Screen Recording permission is required before annotating.');
  captureListEl.innerHTML = `
      <div class="capture-perm-panel">
        <p class="capture-perm-lead">Screen Recording is required before you can annotate.</p>
        <p class="capture-perm-detail">Dbugr checks this before entering annotation mode so it never saves an annotation without an image preview.</p>
        <p class="capture-perm-tip">If you already enabled it, quit Dbugr completely and reopen this same app build so macOS refreshes the permission for the running binary.</p>
        <div class="capture-perm-actions">
          <button type="button" class="capture-perm-primary" id="capture-retry-after-perm">Refresh permission</button>
          <button type="button" class="capture-perm-secondary" id="capture-request-access">Ask macOS for screen capture…</button>
          <button type="button" class="capture-perm-secondary" id="capture-open-screen-settings">Open Screen Recording settings</button>
        </div>
      </div>`;
  captureListEl.querySelector('#capture-retry-after-perm')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void enterAnnotating(`retry_after_permission_gate:${reason}`);
  });
  wireCaptureSettingsButtons(captureListEl);
  attachCaptureRequestAccessHandler(captureListEl);
}

async function ensureScreenRecordingPermissionBeforeAnnotating(reason: string): Promise<boolean> {
  if (annotationPermissionCheckInFlight) return annotationPermissionCheckInFlight;
  annotationPermissionCheckInFlight = (async () => {
    try {
      const granted = await invoke<boolean>('get_screen_capture_annotation_ready');
      addDebugLog(`permission.annotation_gate reason=${reason} granted=${granted}`);
      if (!granted) {
        renderAnnotationPermissionGate(reason);
        return false;
      }
      return true;
    } catch (err) {
      addDebugLog(`permission.annotation_gate.failed reason=${reason} error=${String(err).slice(0, 200)}`);
      renderAnnotationPermissionGate(reason);
      return false;
    } finally {
      annotationPermissionCheckInFlight = null;
    }
  })();
  return annotationPermissionCheckInFlight;
}

/** ScreenCaptureKit succeeded JSON-wise but returned zero sources — almost always TCC / wrong executable. */
function renderCaptureSourcesSckEmptyFailure(
  diagnostics: ScreenCaptureDiagnosticsPayload | null,
  pluginScreenRecording: boolean | null,
) {
  const pluginLabel =
    pluginScreenRecording === null ? 'n/a' : pluginScreenRecording ? 'true' : 'false';
  const diagHtml = diagnostics
    ? `<p class="capture-perm-diag"><strong>This process</strong><br/><code class="capture-perm-diag-path">${escapeHtml(
        diagnostics.executable_path,
      )}</code><span class="capture-perm-diag-meta">CGPreflight=${diagnostics.preflight} · probe=${diagnostics.probe} · plugin screen-recording=${pluginLabel}</span></p>`
    : '';
  captureListEl.innerHTML = `
      <div class="capture-perm-panel">
        <p class="capture-perm-lead">ScreenCaptureKit returned no displays or windows.</p>
        ${diagHtml}
        <p class="capture-perm-detail">Enabling a row in System Settings only helps if it matches <strong>this exact path</strong>. Open <strong>Activity Monitor</strong>, find Debugr, double‑click → <strong>Open Files and Ports</strong> — the path must match the binary you added with <strong>+</strong>.</p>
        <p class="capture-perm-tip">If <strong>CGPreflight</strong> is still false: quit Debugr (⌘Q), reboot once, or run the bundled <code>debugr.ai.app</code> from <code>target/release/bundle/macos/</code> (after <code>pnpm build</code>) instead of <code>target/debug</code>.</p>
        <div class="capture-perm-actions">
          <button type="button" class="capture-perm-primary" id="capture-retry-after-perm">Refresh list</button>
          <button type="button" class="capture-perm-secondary" id="capture-request-access">Ask macOS for screen capture…</button>
          <button type="button" class="capture-perm-secondary" id="capture-open-screen-settings">Open Screen Recording settings</button>
          ${
            diagnostics?.executable_path
              ? '<button type="button" class="capture-perm-secondary" id="capture-reveal-binary">Reveal binary in Finder</button>'
              : ''
          }
        </div>
      </div>`;
  wireCaptureSettingsButtons(captureListEl);
  attachCaptureRequestAccessHandler(captureListEl);
  if (diagnostics?.executable_path) {
    const p = diagnostics.executable_path;
    captureListEl.querySelector('#capture-reveal-binary')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void invoke('reveal_in_finder', { path: p }).catch(() => setToast('Could not reveal in Finder.'));
    });
  }
}

function renderCaptureSourcesError(
  err: unknown,
  systemReportsCaptureAllowed = false,
  diagnostics: ScreenCaptureDiagnosticsPayload | null = null,
  pluginScreenRecording: boolean | null = null,
) {
  const raw = err instanceof Error ? err.message : String(err);
  const safeDetail = escapeHtml(raw);

  if (raw.includes('ScreenCaptureKit returned no displays')) {
    renderCaptureSourcesSckEmptyFailure(diagnostics, pluginScreenRecording);
    return;
  }

  if (isLikelyMacScreenRecordingDenied(raw)) {
    if (pluginScreenRecording === false) {
      renderCaptureSourcesScreenRecordingOff('plugin');
      return;
    }
    if (systemReportsCaptureAllowed) {
      const diagHtml = diagnostics
        ? `<p class="capture-perm-diag"><strong>Running binary</strong><br/><code class="capture-perm-diag-path">${escapeHtml(
            diagnostics.executable_path,
          )}</code><span class="capture-perm-diag-meta">CGPreflight=${diagnostics.preflight} (ScreenCaptureKit gate) · probe=${diagnostics.probe} (CoreGraphics test) · ${escapeHtml(
            diagnostics.bundle_identifier,
          )}</span></p>`
        : '';
      const preflightFalseProbeTrue =
        Boolean(diagnostics && !diagnostics.preflight && diagnostics.probe);
      const detailHtml = preflightFalseProbeTrue
        ? `<p class="capture-perm-detail"><strong>CGPreflight</strong> is what ScreenCaptureKit checks; yours is still <strong>false</strong>, so listing screens/windows is blocked. Privacy can show toggles on before this flag updates for <code>target/debug</code> builds.</p>
           <p class="capture-perm-detail"><strong>Probe</strong> only tests a CoreGraphics display read — it can be true while CGPreflight is still catching up.</p>
           <p class="capture-perm-tip">Tap <strong>Ask macOS…</strong> (runs Apple’s request API), then <strong>Refresh</strong>. Still stuck? ⌘Q, reopen; toggle <strong>feedbackagent-desktop</strong> off/on in Screen Recording; or reboot once.</p>`
        : `<p class="capture-perm-detail">Quit Debugr completely (⌘Q), reopen, then Refresh. If CGPreflight is true but this still appears, it may be a non-permission bug — note the error text.</p>`;
      const lead = preflightFalseProbeTrue
        ? 'ScreenCaptureKit is waiting on CGPreflight for this binary.'
        : 'Screen Recording checks passed, but ScreenCaptureKit still refused.';
      const askMacosBtn = preflightFalseProbeTrue
        ? `<button type="button" class="capture-perm-secondary" id="capture-request-access">Ask macOS for screen capture…</button>`
        : '';
      captureListEl.innerHTML = `
      <div class="capture-perm-panel">
        <p class="capture-perm-lead">${lead}</p>
        ${diagHtml}
        ${detailHtml}
        <div class="capture-perm-actions">
          <button type="button" class="capture-perm-primary" id="capture-retry-after-perm">Refresh list</button>
          ${askMacosBtn}
          <button type="button" class="capture-perm-secondary" id="capture-open-screen-settings">Open Screen Recording settings</button>
        </div>
      </div>`;
      wireCaptureSettingsButtons(captureListEl);
      attachCaptureRequestAccessHandler(captureListEl);
      return;
    }

    renderCaptureSourcesScreenRecordingOff('generic');
    return;
  }

  captureListEl.innerHTML = `
    <div class="capture-error-generic">
      <p class="capture-error-line">Couldn’t load screens and windows.</p>
      <p class="capture-error-detail">${safeDetail}</p>
      <p class="capture-error-hint">If this is a permission issue on macOS, use Screen Recording in Privacy &amp; Security, then refresh.</p>
      <button type="button" class="capture-perm-secondary" id="capture-retry-generic">Try again</button>
    </div>`;
  captureListEl.querySelector('#capture-retry-generic')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void loadCaptureSources();
  });
}

async function loadCaptureSources() {
  captureListEl.innerHTML = `<div class="picker-loading">${sandclockMarkup('Loading capture sources…')}</div>`;

  try {
    const list = await invoke<CaptureSourceListPayload>('list_capture_sources');
    renderCaptureSourceList(list);
  } catch (err) {
    const errMsg = String(err);
    addDebugLog(`capture_sources.error msg=${errMsg.slice(0, 200)}`);

    // Hide the overlay only when macOS/ScreenCaptureKit likely opened a blocking
    // permission UI. Our own ERR_SCREEN_RECORDING_NOT_GRANTED sentinel is
    // preflight-only and does not open a system dialog, so keep the recovery UI
    // visible inside Debugr instead of making the app appear to disappear.
    if (isLikelyMacScreenRecordingDenied(errMsg) && !errMsg.includes('ERR_SCREEN_RECORDING_NOT_GRANTED')) {
      addDebugLog('capture_sources.permission_denied — hiding overlay for TCC dialog');
      await hideOverlayForMacosPermissionUi('load_capture_sources_permission_denied');
    }

    let systemReportsCaptureAllowed = false;
    try {
      systemReportsCaptureAllowed = await invoke<boolean>('get_screen_capture_permission');
    } catch {
      systemReportsCaptureAllowed = false;
    }
    let diagnostics: ScreenCaptureDiagnosticsPayload | null = null;
    try {
      diagnostics = await invoke<ScreenCaptureDiagnosticsPayload>('get_screen_capture_diagnostics');
    } catch {
      diagnostics = null;
    }
    renderCaptureSourcesError(err, systemReportsCaptureAllowed, diagnostics, null);
  }
}

interface CaptureSourceRow {
  kind: string;
  id: number;
  label: string;
}

interface CaptureSourceListPayload {
  displays: CaptureSourceRow[];
  windows: CaptureSourceRow[];
}

const BROWSER_APP_NAMES = new Set([
  'Safari',
  'Google Chrome',
  'Arc',
  'Brave Browser',
  'Microsoft Edge',
  'Firefox',
  'Orion',
  'Vivaldi',
]);

const HIDDEN_CAPTURE_LABEL_FRAGMENTS = [
  'cursoruiviewservice',
  'feedbackagent-desktop',
  'debugr annotation',
  'autofill (google chrome)',
  'localauthenticationremoteservice',
];

function setCaptureSourceMode(mode: CaptureSourceMode) {
  captureSourceMode = mode;
  captureModeBarEl.querySelectorAll<HTMLButtonElement>('.capture-mode-btn').forEach((btn) => {
    const active = btn.dataset.captureMode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  captureStepSubEl.textContent =
    mode === 'screen'
      ? "Capture the current screen, freeze it once, then mark the exact region you want to annotate."
      : mode === 'browser'
        ? 'Refresh to show browser windows/pages by app and page title when macOS exposes them. Pick the page, then crop the exact region.'
        : 'Refresh to show Terminal, Cursor, Figma, and other open app windows. Pick an app window, then mark the area.';
}

function parseCaptureWindowLabel(label: string): { appName: string; title: string } {
  const parts = label.split(' — ');
  if (parts.length <= 1) {
    return { appName: label.trim(), title: '' };
  }
  return {
    appName: parts[0]?.trim() || label.trim(),
    title: parts.slice(1).join(' — ').trim(),
  };
}

function shouldHideCaptureWindow(row: CaptureSourceRow): boolean {
  const text = row.label.toLowerCase();
  return HIDDEN_CAPTURE_LABEL_FRAGMENTS.some((fragment) => text.includes(fragment));
}

function isBrowserCaptureWindow(row: CaptureSourceRow): boolean {
  const { appName } = parseCaptureWindowLabel(row.label);
  return BROWSER_APP_NAMES.has(appName);
}

function dedupeCaptureRows(rows: CaptureSourceRow[]): CaptureSourceRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.kind}|${row.label.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function captureSourceRow(row: CaptureSourceRow) {
  const kind = row.kind as 'display' | 'window';
  const id = Number(row.id);
  if (!kind || !Number.isFinite(id)) return;
  captureInProgress = true;
  setToast('Capturing…');
  try {
    const dataUrl = await invoke<string>('capture_selected_source', { kind, sourceId: id });
    applySourceFrameDisplay(dataUrl);
    await screenshotImgEl.decode().catch(() => {});
    screenshotCaptured = false;
    currentScreenshotDataUrl = '';
    showStep('annotating');
    setToast('Draw a region on the snapshot. The saved image uses your crop.');
    updateCounter();
  } catch (err) {
    const msg = String(err);
    if (isLikelyMacScreenRecordingDenied(msg)) {
      setToast(
        'Screen Recording blocked capture. Enable debugr.ai (and the dev binary if needed) in Privacy → Screen Recording, then choose the source again.',
      );
    } else {
      setToast(`Capture failed: ${msg}`);
    }
  } finally {
    captureInProgress = false;
  }
}

function renderCaptureSourceList(list: CaptureSourceListPayload) {
  const displays = dedupeCaptureRows(list.displays);
  const filteredWindows = dedupeCaptureRows(list.windows.filter((row) => !shouldHideCaptureWindow(row)));
  const browserWindows = filteredWindows.filter(isBrowserCaptureWindow);
  const appWindows = filteredWindows.filter((row) => !isBrowserCaptureWindow(row));

  let visibleRows: CaptureSourceRow[] = [];
  let emptyCopy = 'No matching capture sources found.';

  if (captureSourceMode === 'screen') {
    visibleRows = displays;
    emptyCopy = 'No screens were found.';
  } else if (captureSourceMode === 'browser') {
    visibleRows = browserWindows;
    emptyCopy = 'No browser windows were found. Open the page you want, then refresh.';
  } else {
    visibleRows = appWindows;
    emptyCopy = 'No app windows were found after filtering out helper windows.';
  }

  if (visibleRows.length === 0) {
    captureListEl.innerHTML = `<div class="picker-empty">${emptyCopy}</div>`;
    return;
  }

  const rows = visibleRows.map((row, index) => {
    const parsed = row.kind === 'window' ? parseCaptureWindowLabel(row.label) : null;
    const kindLabel =
      captureSourceMode === 'screen'
        ? 'Current screen'
        : captureSourceMode === 'browser'
          ? 'Browser'
          : parsed?.appName || 'App';
    const titleLabel =
      captureSourceMode === 'screen'
        ? 'Capture the full screen you are looking at'
        : parsed?.title || row.label;
    const metaLabel =
      captureSourceMode === 'browser'
        ? (parsed?.appName || 'Browser window')
        : row.kind === 'display'
          ? row.label
          : parsed?.appName && parsed?.title
            ? `${parsed.appName} window`
            : 'Desktop window';
    return `
      <button type="button" class="capture-row capture-row-${captureSourceMode}" data-index="${index}">
        <div class="capture-row-kind">${escapeHtml(kindLabel)}</div>
        <div class="capture-row-label">${escapeHtml(titleLabel)}</div>
        <div class="capture-row-meta">${escapeHtml(metaLabel)}</div>
      </button>`;
  });

  captureListEl.innerHTML = rows.join('');
  captureListEl.querySelectorAll<HTMLButtonElement>('.capture-row').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const index = Number(btn.dataset.index);
      const row = visibleRows[index];
      if (!row) return;
      await captureSourceRow(row);
    });
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  if (step === 'saved') {
    return;
  }
  if (step === 'annotating' && n === 0 && !sourceFrameDataUrl) {
    setToast('Draw a region over the current screen.');
  } else if (targetSessionId && remainingAnnotationSlots() <= 0) {
    setToast(`"${newSessionName}" is full at ${MAX_ANNOTATIONS} annotations. Start a new session to keep going.`);
  } else if (n > 0) {
    if (targetSessionId) {
      const remaining = remainingAnnotationSlots();
      setToast(`${n} new annotation${n > 1 ? 's' : ''} for "${newSessionName}" — ${remaining} slot${remaining === 1 ? '' : 's'} left in this session.`);
    } else {
      setToast(`${n} annotation${n > 1 ? 's' : ''} — save each note, then tap Finish below.`);
    }
  } else {
    setToast('Click anywhere to add an annotation. Right-drag to draw a region.');
  }
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

function clearPickerLoadingTimer() {
  if (pickerLoadingTimer !== null) {
    window.clearTimeout(pickerLoadingTimer);
    pickerLoadingTimer = null;
  }
}

async function hydratePickerSessionsFromBackend() {
  try {
    const cached = await invoke<PickerSession[]>('load_picker_sessions_cache');
    if (!Array.isArray(cached) || cached.length === 0) return;
    try {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cached));
    } catch {
      // Ignore cache write failures.
    }
    renderPickerSessions(cached);
  } catch {
    // Ignore backend cache failures and wait for the live event path.
  }
}

function setPickerLoading() {
  pickerLoadingToken += 1;
  const token = pickerLoadingToken;
  clearPickerLoadingTimer();
  const cached = readCachedPickerSessions();
  if (cached.length > 0) {
    renderPickerSessions(cached);
  } else {
    pickerListEl.innerHTML = `<div class="picker-loading">${sandclockMarkup('Loading sessions…')}</div>`;
    void hydratePickerSessionsFromBackend();
    pickerLoadingTimer = window.setTimeout(() => {
      if (token !== pickerLoadingToken) return;
      const refreshedCached = readCachedPickerSessions();
      renderPickerSessions(refreshedCached);
    }, 1200);
  }
}

function startPreparedSession(payload: OverlayLaunchPayload) {
  targetSessionId = payload.targetSessionId ?? null;
  newSessionName = payload.newSessionName ?? '';
  newSessionAbout = payload.newSessionAbout ?? '';
  localFolder = payload.localFolder ?? null;
  githubRepo = payload.githubRepo ?? '';
  setTool('region', false);
  updateSessionModeChrome();
  void enterAnnotating('prepared_session');
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

function renderPickerSessions(list: Array<{ id: string; title: string; createdAt: string; annotationCount?: number }>) {
  clearPickerLoadingTimer();
  // Show all sessions including new ones with 0 annotations — filtering them out
  // would prevent users from adding their first annotation to a brand-new session.
  const visibleSessions = list;
  pickerSessions = visibleSessions;
  if (visibleSessions.length === 0) {
    pickerListEl.innerHTML = '<div class="picker-empty">No past sessions yet. Start a new one to create your first list item.</div>';
    return;
  }
  pickerListEl.innerHTML = visibleSessions.map(s => `
    <button class="picker-session-item" data-id="${s.id}">
      <span class="picker-session-main">
        <span class="picker-session-title">${s.title}</span>
        <span class="picker-session-sub">${typeof s.annotationCount === 'number'
          ? `${s.annotationCount}/${MAX_ANNOTATIONS} annotations saved`
          : 'Click to append annotations'}</span>
      </span>
      <span class="picker-session-meta">
        <span class="picker-session-time">${relativeTime(s.createdAt)}</span>
        <span class="picker-session-chevron">→</span>
      </span>
    </button>
  `).join('');
  pickerListEl.querySelectorAll<HTMLButtonElement>('.picker-session-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      targetSessionId = btn.dataset.id ?? null;
      newSessionName = btn.querySelector('.picker-session-title')?.textContent ?? '';
      newSessionAbout = '';
      const remaining = remainingAnnotationSlots();
      if (remaining <= 0) {
        setToast(`"${newSessionName}" already has the maximum ${MAX_ANNOTATIONS} annotations. Start a new session instead.`);
        return;
      }
      void enterAnnotating('picker_session');
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
  preparedNewSessionId = null;
  newSessionName = '';
  newSessionAbout = '';
  localFolder = null;
  githubRepo = '';
  setupNameEl.value = '';
  setupAboutEl.value = '';
  setupGithubEl.value = '';
  setupFolderPath.style.display = 'none';
  setupFolderBtn.textContent = 'Choose folder…';
  updateSetupState();
  showStep('setup');
  setTimeout(() => setupNameEl.focus(), 50);
});

document.getElementById('picker-cancel')!.addEventListener('click', e => {
  e.stopPropagation();
  void cancelOverlay();
});

sessionModeAppendBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (step === 'picking') {
    void showCaptureSourceStep();
    return;
  }
  showStep('picking');
  setPickerLoading();
  void emit('request-sessions');
});

sessionModeNewBtn.addEventListener('click', e => {
  e.stopPropagation();
  targetSessionId = null;
  preparedNewSessionId = null;
  setupNameEl.value = newSessionName;
  setupAboutEl.value = newSessionAbout;
  setupGithubEl.value = githubRepo;
  if (localFolder) {
    setupFolderPath.textContent = '📁 ' + localFolder.replace(/\/$/, '').split('/').slice(-2).join('/');
    setupFolderPath.style.display = 'block';
    setupFolderBtn.textContent = 'Change folder…';
  } else {
    setupFolderPath.textContent = '';
    setupFolderPath.style.display = 'none';
    setupFolderBtn.textContent = 'Choose folder…';
  }
  updateSetupState();
  if (step === 'setup') {
    void enterAnnotating('session_mode_new_toggle');
  } else {
    showStep('setup');
  }
  setTimeout(() => setupNameEl.focus(), 50);
});

// ── Step 2: New session setup ─────────────────────────────────────────────────

document.getElementById('setup-back')!.addEventListener('click', e => {
  e.stopPropagation();
  showStep('picking');
  setPickerLoading();
  void emit('request-sessions');
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
setupNameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') void prepareNewSessionAndEnterAnnotating(); });
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

document.getElementById('capture-refresh')!.addEventListener('click', e => {
  e.stopPropagation();
  void loadCaptureSources();
});
captureModeBarEl.querySelectorAll<HTMLButtonElement>('.capture-mode-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextMode = btn.dataset.captureMode as CaptureSourceMode | undefined;
    if (!nextMode) return;
    setCaptureSourceMode(nextMode);
    void loadCaptureSources();
  });
});

document.getElementById('capture-back')!.addEventListener('click', e => {
  e.stopPropagation();
  showStep(pendingCaptureBackStep);
  if (pendingCaptureBackStep === 'picking') {
    setPickerLoading();
    void emit('request-sessions');
  }
  updateCounter();
});

document.getElementById('setup-start')!.addEventListener('click', e => {
  e.stopPropagation();
  void prepareNewSessionAndEnterAnnotating();
});

document.getElementById('saved-close')!.addEventListener('click', e => {
  e.stopPropagation();
  void cancelOverlay();
});

document.getElementById('saved-more')!.addEventListener('click', e => {
  e.stopPropagation();
  clearCurrentDraftCaptureState();
  void enterAnnotating('saved_more');
});

document.getElementById('saved-open-session')!.addEventListener('click', async e => {
  e.stopPropagation();
  await invoke('hide_overlay');
  resetState();
  await invoke('show_session_window');
});

function updateSetupState() {
  newSessionName = setupNameEl.value.trim();
  newSessionAbout = setupAboutEl.value.trim();
  githubRepo = setupGithubEl.value.trim();
  setupAboutCount.textContent = `${newSessionAbout.length} / 200`;
  setupStartBtn.disabled = !newSessionName || !newSessionAbout;
}

function clearCurrentDraftCaptureState() {
  resetAnnotationCanvas();
  screenshotCaptured = false;
  currentScreenshotDataUrl = '';
  applySourceFrameDisplay('');
  selRectEl.style.display = 'none';
  toolSaveBtn.disabled = false;
  toolSaveBtn.textContent = FINISH_TOOL_LABEL;
}

function showSavedStep() {
  const nextLabel = 'Submit';
  savedStepSubEl.innerHTML = `<strong>${escapeHtml(lastSavedSessionTitle || 'Current session')}</strong> · added ${lastSavedAnnotationCount} annotation${lastSavedAnnotationCount === 1 ? '' : 's'}.`;
  savedStepHintEl.innerHTML = `Nothing was sent yet. Open the current session board when you are ready, then go to <strong>${escapeHtml(nextLabel)}</strong>.`;
  showStep('saved');
}

async function prepareNewSessionAndEnterAnnotating() {
  updateSetupState();
  if (!newSessionName || !newSessionAbout) {
    setToast('Add a session name and context before continuing.');
    setupNameEl.focus();
    return;
  }
  const hasPermission = await ensureScreenRecordingPermissionBeforeAnnotating('new_session_setup');
  if (!hasPermission) return;
  if (!targetSessionId) {
    preparedNewSessionId = preparedNewSessionId ?? uid('session');
    targetSessionId = preparedNewSessionId;
    const prevLabel = setupStartBtn.innerHTML;
    setupStartBtn.disabled = true;
    setupStartBtn.innerHTML = sandclockMarkup('Saving…');
    try {
      await invoke('finish_annotations', {
        payload: {
          annotations: [],
          targetSessionId,
          newSessionName,
          newSessionAbout,
          localFolder,
          githubRepo,
          screenshotUrl: '',
        },
      });
      pickerSessions = [
        {
          id: targetSessionId,
          title: newSessionName,
          createdAt: new Date().toISOString(),
          annotationCount: 0,
        },
        ...pickerSessions.filter((session) => session.id !== targetSessionId),
      ];
      try {
        localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(pickerSessions));
      } catch {
        // Ignore cache write failures.
      }
      setToast(`Created "${newSessionName}". Draw a region to add the first annotation.`);
    } catch (err) {
      preparedNewSessionId = null;
      targetSessionId = null;
      setupStartBtn.disabled = false;
      setupStartBtn.innerHTML = prevLabel;
      setToast(`Could not save session: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setupStartBtn.innerHTML = prevLabel;
    updateSetupState();
  }
  void enterAnnotating('new_session_prepared');
}

// If the user switches apps before placing any annotations, step out of the
// overlay so it behaves like a background utility instead of a modal wall.
window.addEventListener('blur', () => {
  if (dragging || captureInProgress) return;
  if (step !== 'annotating' || annotations.length > 0) return;
  void invoke('suspend_overlay').catch(() => {});
});

async function enterAnnotating(reason = 'manual') {
  const hasPermission = await ensureScreenRecordingPermissionBeforeAnnotating(reason);
  if (!hasPermission) return;
  if (targetSessionId) {
    newSessionAbout = '';
  }

  setTool('region', false);
  beginCaptureFlowForMode();
}

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(t: typeof activeTool, markActive = true) {
  activeTool = t;
  document.getElementById('tool-region')?.classList.toggle('active', markActive && t === 'region');
  root.style.cursor = 'cell';
}

document.getElementById('tool-region')?.addEventListener('click', e => { e.stopPropagation(); setTool('region'); });

// ── Cancel / Escape ───────────────────────────────────────────────────────────

async function cancelOverlay() {
  // hide_overlay used to restore + focus main; avoid racing that during screenshot capture.
  if (captureInProgress) return;
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
  if (e.key === 'Escape') {
    if (captureInProgress) return;
    void cancelOverlay();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void saveAll();
});

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveAll() {
  if (annotations.length === 0) { void cancelOverlay(); return; }
  updateSetupState();
  const firstMissingNote = annotations.find((annotation) => !annotation.text.trim());
  if (firstMissingNote) {
    selectAnnotation(firstMissingNote);
    setToast(`Add a text note for annotation ${firstMissingNote.number} before finishing.`);
    return;
  }
  if (!currentScreenshotDataUrl.startsWith('data:image/')) {
    logAnnotationPipeline('save_all_blocked_missing_screenshot', {
      annotation_count: annotations.length,
      screenshotCaptured,
      screenshot_kind: describeScreenshotRef(currentScreenshotDataUrl).kind,
    });
    setToast('Screen Recording permission is required before saving an annotation screenshot.');
    return;
  }
  if (!targetSessionId) {
    if (!newSessionName || !newSessionAbout) {
      setToast('Choose a session target before finishing.');
      showStep('setup');
      setTimeout(() => setupNameEl.focus(), 50);
      return;
    }
  } else if (targetSessionAnnotationCount() + annotations.length > MAX_ANNOTATIONS) {
    const remaining = Math.max(0, MAX_ANNOTATIONS - targetSessionAnnotationCount());
    setToast(`"${newSessionName}" only has room for ${remaining} more annotation${remaining === 1 ? '' : 's'}.`);
    return;
  }
  const prevLabel = toolSaveBtn.innerHTML || FINISH_TOOL_LABEL;
  toolSaveBtn.disabled = true;
  toolSaveBtn.innerHTML = sandclockMarkup('Opening…');
  try {
    const saveTraceId = uid('save');
    let screenshotForPayload = '';
    const beforePersist = describeScreenshotRef(currentScreenshotDataUrl);
    logAnnotationPipeline('save_all_start', {
      trace_id: saveTraceId,
      annotation_count: annotations.length,
      target_session_id: targetSessionId ?? 'new_session',
      has_new_session_name: Boolean(newSessionName),
      has_new_session_about: Boolean(newSessionAbout),
      source_frame: Boolean(sourceFrameDataUrl),
      screenshot_captured: screenshotCaptured,
    });
    logAnnotationPipeline('finish_persist_branch', {
      trace_id: saveTraceId,
      screenshotCaptured,
      current_kind: beforePersist.kind,
      current_len: beforePersist.len,
      will_try_disk_persist: currentScreenshotDataUrl.startsWith('data:image/'),
    });

    if (currentScreenshotDataUrl.startsWith('data:image/')) {
      try {
        screenshotForPayload = await invoke<string>('persist_annotation_screenshot', {
          dataUrl: currentScreenshotDataUrl,
        });
        const after = describeScreenshotRef(screenshotForPayload);
        logAnnotationPipeline('finish_persist_ok', {
          trace_id: saveTraceId,
          result_kind: after.kind,
          result_len: after.len,
        });
      } catch (persistErr) {
        console.warn('[Debugr] persist_annotation_screenshot failed; falling back to inline payload', persistErr);
        screenshotForPayload = currentScreenshotDataUrl;
        logAnnotationPipeline('finish_persist_fallback_inline', {
          trace_id: saveTraceId,
          err: String(persistErr).slice(0, 200),
          inline_len: currentScreenshotDataUrl.length,
        });
      }
    } else {
      logAnnotationPipeline('finish_skip_persist', {
        trace_id: saveTraceId,
        reason: !currentScreenshotDataUrl ? 'no_current_screenshot' : 'not_data_image_url',
      });
    }

    // Snapshot data BEFORE clearing the canvas (resetAnnotationCanvas sets annotations = [])
    const snapshot = {
      annotations: annotations.slice(),
      targetSessionId,
      newSessionName,
      newSessionAbout,
      localFolder,
      githubRepo,
      screenshotUrl: screenshotForPayload,
      saveTraceId,
    };

    const shotOut = describeScreenshotRef(snapshot.screenshotUrl);
    console.info('[debugr-ui]', JSON.stringify({
      event: 'overlay_save_all',
      annotationCount: snapshot.annotations.length,
      hasScreenshot: Boolean(snapshot.screenshotUrl),
      screenshot_kind: shotOut.kind,
      screenshot_len: shotOut.len,
      targetSessionId: snapshot.targetSessionId ?? null,
      traceId: saveTraceId,
    }));
    logAnnotationPipeline('finish_invoke_finish_annotations', {
      trace_id: saveTraceId,
      annotation_count: snapshot.annotations.length,
      screenshot_kind: shotOut.kind,
      screenshot_len: shotOut.len,
      first_ann_id: snapshot.annotations[0]?.id ?? 'none',
    });

    // Route through Rust backend — relays to main window without permission restrictions
    await invoke('finish_annotations', { payload: snapshot });
    logAnnotationPipeline('finish_rust_command_ok', {
      trace_id: saveTraceId,
      annotation_count: snapshot.annotations.length,
      screenshot_kind: shotOut.kind,
      screenshot_len: shotOut.len,
    });
    lastSavedSessionTitle = snapshot.targetSessionId ? (newSessionName || 'Current session') : (snapshot.newSessionName || 'Current session');
    lastSavedAnnotationCount = snapshot.annotations.length;
    clearCurrentDraftCaptureState();
    showSavedStep();
  } catch (err) {
    logAnnotationPipeline('save_all_failed', { error: String(err).slice(0, 400) });
    console.error('[Debugr] Error in saveAll():', err);
    setToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    updateAnnotatingHints();
    toolSaveBtn.disabled = false;
    toolSaveBtn.innerHTML = prevLabel;
  }
}

document.getElementById('tool-save')?.addEventListener('click', e => {
  e.stopPropagation(); void saveAll();
});

async function resumeOverlayVisible(): Promise<void> {
  await invoke('resume_overlay');
  // WKWebView often skips layout while the window is hidden; wait until visible before UI that must paint.
  if (document.visibilityState !== 'visible') {
    await new Promise<void>(resolve => {
      const finish = () => resolve();
      const onVis = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', onVis);
          finish();
        }
      };
      document.addEventListener('visibilitychange', onVis);
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onVis);
        finish();
      }, 300);
    });
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void document.documentElement.offsetHeight;
        resolve();
      });
    });
  });
}

// ── Place annotation ──────────────────────────────────────────────────────────

async function placeRegion(x: number, y: number, w: number, h: number) {
  if (annotations.length >= MAX_ANNOTATIONS) {
    setToast(`Maximum ${MAX_ANNOTATIONS} annotations per session.`);
    return;
  }
  if (remainingAnnotationSlots() <= 0) {
    setToast(targetSessionId
      ? `"${newSessionName}" already has the maximum ${MAX_ANNOTATIONS} annotations.`
      : `Maximum ${MAX_ANNOTATIONS} annotations per session.`);
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

  if (!screenshotCaptured) {
    captureInProgress = true;
    setToast('Preparing crop…');
    let dataUrl: string | null = null;
    try {
      if (!sourceFrameDataUrl) {
        logAnnotationPipeline('place_region_source_frame_capture_start', {
          reason: 'transparent_live_overlay_without_snapshot',
          ann_id: ann.id,
        });
        const frameDataUrl = await invoke<string>('capture_current_screen_snapshot');
        const frame = describeScreenshotRef(frameDataUrl);
        logAnnotationPipeline('place_region_source_frame_capture_ok', {
          ann_id: ann.id,
          frame_kind: frame.kind,
          frame_len: frame.len,
        });
        applySourceFrameDisplay(frameDataUrl, { visible: false });
      }
      await ensureScreenshotImgReady();
      const layout = viewportLayoutSnapshot();
      logAnnotationPipeline('place_region_capture_start', {
        ann_id: ann.id,
        raw_left: x,
        raw_top: y,
        raw_w: w,
        raw_h: h,
        ...layout,
      });
      const { sx, sy, sw, sh } = clientRectToImageRect(box.left, box.top, box.width, box.height);
      logAnnotationPipeline('place_region_crop_box', {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        img_sx: sx,
        img_sy: sy,
        img_sw: sw,
        img_sh: sh,
      });
      dataUrl = await cropImageDataUrl(sourceFrameDataUrl, sx, sy, sw, sh);
      const got = describeScreenshotRef(dataUrl);
      logAnnotationPipeline('place_region_capture_ok', { data_kind: got.kind, data_len: got.len });
    } catch (err) {
      logAnnotationPipeline('place_region_capture_failed', { error: String(err).slice(0, 300) });
      setToast(`Screen Recording permission is required before adding an annotation. (${err})`);
    } finally {
      captureInProgress = false;
    }
    if (dataUrl) {
      currentScreenshotDataUrl = dataUrl;
      screenshotCaptured = true;
    } else {
      logAnnotationPipeline('annotation_blocked_missing_screenshot', {
        ann_id: ann.id,
        ann_number: ann.number,
        screenshotCaptured,
        screenshot_kind: describeScreenshotRef(currentScreenshotDataUrl).kind,
      });
      await resumeOverlayVisible();
      updateCounter();
      return;
    }
    logAnnotationPipeline('annotation_created', {
      ann_id: ann.id,
      ann_number: ann.number,
      kind: ann.kind,
      screenshotCaptured,
      screenshot_kind: describeScreenshotRef(currentScreenshotDataUrl).kind,
    });
    annotations.push(ann);
    renderRegion(ann);
    await resumeOverlayVisible();
    selectAnnotation(ann);
    updateCounter();
    return;
  }

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
  logAnnotationPipeline('annotation_selected', {
    ann_id: ann.id,
    ann_number: ann.number,
    kind: ann.kind,
    text_len: ann.text.length,
    tag_count: ann.tags.length,
  });
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
  try {
    logAnnotationPipeline('note_panel_open', {
      ann_id: ann.id,
      ann_number: ann.number,
      kind: ann.kind,
      text_len: ann.text.length,
      tag_count: ann.tags.length,
    });
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

    const ta = noteBodyEl.querySelector<HTMLTextAreaElement>('#note-ta');
    if (!ta) {
      console.error('[Debugr] showNotePanel: #note-ta missing after innerHTML');
      return;
    }
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
    void notePanelEl.offsetHeight;
    requestAnimationFrame(() => {
      drawConnector(ann);
      try {
        ta.focus({ preventScroll: true });
      } catch {
        ta.focus();
      }
    });
  } catch (err) {
    console.error('[Debugr] showNotePanel failed:', err);
  }
}

function saveAnnotation(ann: Annotation) {
  if (!ann.text.trim()) {
    setToast(`Add a note for annotation ${ann.number} before saving.`);
    return;
  }
  logAnnotationPipeline('note_saved', {
    ann_id: ann.id,
    ann_number: ann.number,
    text_len: ann.text.trim().length,
    tag_count: ann.tags.length,
  });
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
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    selRectEl.style.display = 'block';
    updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
    // Capture pointer so pointermove/pointerup fire reliably on Tauri's
    // transparent macOS overlay window even when cursor drifts over areas
    // that would otherwise pass events through to apps underneath.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    return;
  }

  if (e.button === 2) {
    e.preventDefault();
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    selRectEl.style.display = 'block';
    updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
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
  const endX = e.clientX, endY = e.clientY;
  const w = Math.abs(endX - dragStart.x);
  const h = Math.abs(endY - dragStart.y);
  const x = Math.min(dragStart.x, endX);
  const y = Math.min(dragStart.y, endY);
  selRectEl.style.display = 'none';
  dragging = false; dragStart = null;
  if (w > 12 && h > 12) void placeRegion(x, y, w, h);
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

// ── Event listeners initialization ────────────────────────────────────────────

async function initializeEventListeners() {
  // Screenshot from backend - MUST be registered before screenshot capture starts
  await listen<string>('set-screenshot', event => {
    const len = event.payload?.length ?? 0;
    addDebugLog(`SET-SCREENSHOT EVENT: payload=${Boolean(event.payload)}, len=${len}`);
    if (event.payload) {
      addDebugLog('Applying screenshot payload to #screenshot-bg');
      logAnnotationPipeline('precapture_fullscreen_applied', {
        source: 'set_screenshot_event',
        payload_len: len,
      });
      applyScreenshotDataUrl(event.payload);
    } else {
      logAnnotationPipeline('precapture_fullscreen_missing', { source: 'set_screenshot_event' });
      addDebugLog('ERROR: set-screenshot event has no payload!');
    }
  });

  // Sessions list from main window
  await listen<Array<PickerSession>>('sessions-list', event => {
    try {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(event.payload));
    } catch {
      // Ignore cache write failures.
    }
    pickerSessions = event.payload;
    renderPickerSessions(event.payload);
  });

  // Reset on each new invocation
  await listen<OverlayLaunchPayload>('overlay-will-show', event => {
    if (captureInProgress) {
      addDebugLog('overlay-will-show ignored: annotation capture pipeline still active');
      return;
    }
    applyDockOffset();
    resetState();
    if (event.payload?.skipPicker && event.payload.targetSessionId) {
      startPreparedSession(event.payload);
      return;
    }
    targetSessionId = event.payload?.targetSessionId ?? null;
    newSessionName = event.payload?.newSessionName ?? '';
    newSessionAbout = event.payload?.newSessionAbout ?? '';
    localFolder = event.payload?.localFolder ?? null;
    githubRepo = event.payload?.githubRepo ?? '';
    setupNameEl.value = newSessionName;
    setupAboutEl.value = newSessionAbout;
    setupGithubEl.value = githubRepo;
    if (localFolder) {
      setupFolderPath.textContent = '📁 ' + localFolder.replace(/\/$/, '').split('/').slice(-2).join('/');
      setupFolderPath.style.display = 'block';
      setupFolderBtn.textContent = 'Change folder…';
    }
    updateSetupState();
    // Don't capture screenshot yet - wait for user to select session
    setCaptureSourceMode('screen');
    showStep('picking');
    setPickerLoading();
    void emit('request-sessions');
  });
}

function applyDockOffset() {
  const dockH = Math.max(0, window.screen.height - window.screen.availHeight);
  document.documentElement.style.setProperty('--dock-offset', `${dockH + 12}px`);
}

function resetState() {
  pickerLoadingToken += 1;
  clearPickerLoadingTimer();
  root.querySelectorAll('.ann-pin, .ann-highlight').forEach(el => el.remove());
  connectorsEl.innerHTML = '';
  annotations = [];
  selectedId = null;
  screenshotCaptured = false;
  captureInProgress = false;
  targetSessionId = null;
  newSessionName = '';
  newSessionAbout = '';
  localFolder = null;
  githubRepo = '';
  pickerSessions = [];
  dragging = false; dragStart = null; moveState = null;
  selRectEl.style.display = 'none';
  currentScreenshotDataUrl = '';
  screenshotBg.style.backgroundImage = '';
  applySourceFrameDisplay('');
  lastSavedSessionTitle = '';
  lastSavedAnnotationCount = 0;
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
  setupFolderBtn.textContent = 'Choose folder…';
  setupAboutCount.textContent = '0 / 200';
  setupStartBtn.disabled = true;
  setCaptureSourceMode('screen');
  showStep('annotating');
}

// ── Init ──────────────────────────────────────────────────────────────────────

applyDockOffset();
showStep('annotating');
setPickerLoading();
updateSetupState();
window.addEventListener('resize', applyDockOffset);

// Initialize event listeners (must be done before overlay is shown)
addDebugLog('Initializing event listeners');
initializeEventListeners().then(() => {
  addDebugLog('Event listeners ready');
}).catch(err => {
  addDebugLog(`Error initializing listeners: ${err}`);
});
