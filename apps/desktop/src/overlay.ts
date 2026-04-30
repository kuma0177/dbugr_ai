import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
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

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ANNOTATIONS = 5;
const MIN_REGION = 36;
const TAGS = ['Bug', 'UX', 'Blocking', 'Question'];

// ── State ────────────────────────────────────────────────────────────────────

let annotations: Annotation[] = [];
let activeTool: 'select' | 'pin' | 'region' | 'arrow' | 'blur' = 'pin';
let selectedId: string | null = null;
let sessionMode: 'append' | 'new' = 'append';
let targetSessionId: string | null = null;
let localFolder: string | null = null;
let githubRepo = '';

// region-drag state
let dragging = false;
let dragStart: { x: number; y: number } | null = null;

// annotation drag/resize state
let moveState: {
  id: string; mode: 'move' | 'resize';
  handle?: string;
  ptId: number;
  sx: number; sy: number;
  initial: { left: number; top: number; width: number; height: number };
} | null = null;

// ── DOM Scaffold ─────────────────────────────────────────────────────────────

const root = document.getElementById('overlay-root')!;

root.innerHTML = `
  <div id="screenshot-bg"></div>
  <div id="dim-layer"></div>

  <!-- Top-center toast -->
  <div class="toast" id="toast">
    <kbd>⌘</kbd><kbd>⌥</kbd><kbd>A</kbd>
    <span id="toast-text">Click anywhere to add an annotation. Right-drag to draw a region.</span>
  </div>

  <!-- Top-right: session + counter -->
  <div class="session-switcher" id="session-switcher">
    <button class="session-switch active" data-mode="append" id="btn-append">Add to session ▾</button>
    <button class="session-switch" data-mode="new">New session</button>
    <button class="session-switch" data-mode="repo" id="btn-repo">Project</button>
  </div>
  <div class="session-picker-dropdown" id="session-picker-dropdown" style="display:none;"></div>
  <div class="repo-input-row" id="repo-input-row" style="display:none;">
    <button class="folder-pick-btn" id="folder-pick-btn">📁 Choose folder…</button>
    <div class="folder-path" id="folder-path" style="display:none;"></div>
    <div class="github-row">
      <span class="github-label">GitHub repo (optional)</span>
      <input class="repo-input" id="repo-input" placeholder="owner/repo" value="" />
    </div>
  </div>
  <div class="ann-counter" id="ann-counter"></div>

  <!-- SVG connectors -->
  <svg class="ann-connector" id="connectors" xmlns="http://www.w3.org/2000/svg"></svg>

  <!-- Note inspector (right side) -->
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

  <!-- Bottom toolbar — matches handoff design (light, frosted glass) -->
  <div class="toolbar" id="toolbar">
    <button class="tool-btn active" id="tool-pin" title="Pin (click to annotate)">
      ●<div class="tool-label">Pin</div>
    </button>
    <button class="tool-btn" id="tool-region" title="Region (drag to draw)">
      ⬚<div class="tool-label">Region</div>
    </button>
    <button class="tool-btn" id="tool-select" title="Select">
      ↖<div class="tool-label">Select</div>
    </button>
    <div class="toolbar-divider"></div>
    <button class="tool-btn cancel" id="tool-cancel">Esc</button>
    <button class="tool-btn save-btn" id="tool-save">Save →</button>
  </div>

  <div class="build-stamp">${__DEBUGR_BUILD_STAMP__}</div>
`;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const screenshotBg   = document.getElementById('screenshot-bg')!;
const toastTextEl    = document.getElementById('toast-text')!;
const notePanelEl    = document.getElementById('note-panel') as HTMLDivElement;
const noteTitleEl    = document.getElementById('note-title')!;
const noteSubtitleEl = document.getElementById('note-subtitle')!;
const noteBodyEl     = document.getElementById('note-body') as HTMLDivElement;
const counterEl      = document.getElementById('ann-counter')!;
const connectorsEl   = document.getElementById('connectors')!;
const selRectEl      = document.getElementById('sel-rect') as HTMLDivElement;
const sessionSwitcherEl = document.getElementById('session-switcher')!;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function updateCounter() {
  const n = annotations.length;
  counterEl.classList.toggle('visible', n > 0);
  if (n > 0) counterEl.textContent = `${n} / ${MAX_ANNOTATIONS} annotations`;
  setToast(n > 0
    ? `${n} annotation${n > 1 ? 's' : ''} added — click Save when done.`
    : `Click anywhere to add an annotation. Right-drag to draw a region.`);
}

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(t: typeof activeTool) {
  activeTool = t;
  (['pin', 'region', 'select'] as const).forEach(id => {
    document.getElementById(`tool-${id}`)?.classList.toggle('active', id === t);
  });
  root.style.cursor = t === 'pin' ? 'crosshair' : t === 'region' ? 'cell' : 'default';
}

document.getElementById('tool-pin')?.addEventListener('click',    e => { e.stopPropagation(); setTool('pin'); });
document.getElementById('tool-region')?.addEventListener('click', e => { e.stopPropagation(); setTool('region'); });
document.getElementById('tool-select')?.addEventListener('click', e => { e.stopPropagation(); setTool('select'); });

const repoInputRowEl = document.getElementById('repo-input-row')!;
const repoInputEl    = document.getElementById('repo-input') as HTMLInputElement;
const folderPickBtn  = document.getElementById('folder-pick-btn') as HTMLButtonElement;
const folderPathEl   = document.getElementById('folder-path')!;

repoInputEl.value = githubRepo;
repoInputEl.addEventListener('input', e => { e.stopPropagation(); githubRepo = repoInputEl.value; });
repoInputEl.addEventListener('click', e => e.stopPropagation());
repoInputEl.addEventListener('keydown', e => e.stopPropagation());

folderPickBtn.addEventListener('click', async e => {
  e.stopPropagation();
  const path = await invoke<string | null>('pick_folder');
  if (path) {
    localFolder = path;
    const short = path.replace(/\/$/, '').split('/').slice(-2).join('/');
    folderPathEl.textContent = '📁 ' + short;
    folderPathEl.style.display = 'block';
    folderPickBtn.textContent = 'Change folder…';
    // Update "Project" tab label to show folder name
    const repoBtn = document.getElementById('btn-repo');
    if (repoBtn) repoBtn.textContent = short.split('/').pop() || 'Project';
  }
});

const sessionPickerEl = document.getElementById('session-picker-dropdown')!;

sessionSwitcherEl.querySelectorAll<HTMLButtonElement>('.session-switch').forEach(btn => {
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const mode = btn.dataset.mode;
    sessionSwitcherEl.querySelectorAll('.session-switch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    repoInputRowEl.style.display = mode === 'repo' ? 'flex' : 'none';
    if (mode === 'repo') { repoInputEl.value = repoName; repoInputEl.focus(); }

    if (mode === 'append') {
      // Toggle dropdown
      if (sessionPickerEl.style.display !== 'none') {
        sessionPickerEl.style.display = 'none';
        return;
      }
      sessionPickerEl.innerHTML = '<div class="session-picker-loading">Loading…</div>';
      sessionPickerEl.style.display = 'block';
      await emit('request-sessions');
    } else {
      sessionPickerEl.style.display = 'none';
      sessionMode = mode === 'new' ? 'new' : 'append';
    }
  });
});

// Close picker when clicking outside
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (!t.closest('#session-picker-dropdown') && !t.closest('#btn-append')) {
    sessionPickerEl.style.display = 'none';
  }
});

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
  await emit('annotations-saved', { annotations, sessionMode, targetSessionId, localFolder, githubRepo });
  await invoke('show_session_window');
  await invoke('hide_overlay');
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
  pin.addEventListener('click', e => { e.stopPropagation(); selectAnnotation(ann); });
  root.appendChild(pin);

  const hl = document.createElement('div');
  hl.className = 'ann-highlight';
  hl.id = `hl_${ann.id}`;
  hl.style.cssText = `left:${ann.x - 60}px;top:${ann.y - 30}px;width:120px;height:60px;pointer-events:none;`;
  root.appendChild(hl);
  syncSel();
}

// ── Render region ─────────────────────────────────────────────────────────────

function renderRegion(ann: Annotation) {
  const b = boxOf(ann);

  const hl = document.createElement('div');
  hl.className = 'ann-highlight ann-region';
  hl.id = `hl_${ann.id}`;
  hl.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;`;

  // resize handles
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
    const target = e.target as HTMLElement;
    if (target.closest('.ann-handle')) return;
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
  pin.addEventListener('click', e => { e.stopPropagation(); selectAnnotation(ann); });
  root.appendChild(pin);
  syncSel();
}

function handleOffset(name: string, w: number, h: number): [number, number] {
  const cx = w / 2, cy = h / 2;
  return (
    name === 'nw' ? [0, 0] : name === 'n' ? [cx, 0] : name === 'ne' ? [w, 0] :
    name === 'e'  ? [w, cy] : name === 'se' ? [w, h] : name === 's'  ? [cx, h] :
    name === 'sw' ? [0, h]  : /* w */ [0, cy]
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
  noteSubtitleEl.textContent = ann.kind === 'region' ? 'Region — resize by dragging edges' : 'Pin annotation';
  noteBodyEl.innerHTML = `
    <div class="note-label">Notes</div>
    <textarea id="note-ta" placeholder="What should Claude know about this area?">${ann.text}</textarea>
    <div class="note-label">Tags</div>
    <div class="chips">
      ${TAGS.map(t => `<button class="chip${ann.tags.includes(t) ? ' active' : ''}" data-tag="${t}">${t}</button>`).join('')}
    </div>
    <button class="save-ann-btn" id="save-ann">Save annotation  ⌘↵</button>
  `;

  const ta = noteBodyEl.querySelector<HTMLTextAreaElement>('#note-ta')!;
  ta.addEventListener('input', () => { ann.text = ta.value; });
  ta.addEventListener('click', e => e.stopPropagation());
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      setToast(`Annotation ${ann.number} saved.`);
    }
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
    e.stopPropagation();
    const btn = noteBodyEl.querySelector<HTMLButtonElement>('#save-ann')!;
    btn.textContent = '✓ Saved';
    btn.style.background = '#16a34a';
    setTimeout(() => {
      deselectAnnotation();
      setToast(`Annotation ${ann.number} saved — add more or click Save when done.`);
    }, 400);
  });

  notePanelEl.style.display = 'block';
  requestAnimationFrame(() => drawConnector(ann));
  ta.focus();
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
  const target = e.target as HTMLElement;
  if (target.closest('.toolbar, .note-panel, .session-switcher, .ann-pin, .ann-highlight')) return;

  // Left-click: pin or select
  if (e.button === 0) {
    if (activeTool === 'pin') {
      placePin(e.clientX, e.clientY);
    } else if (activeTool === 'select') {
      deselectAnnotation();
    } else if (activeTool === 'region') {
      // start rubber-band drag
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      selRectEl.style.display = 'block';
      updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
    }
    return;
  }

  // Right-click: always start region drag
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

// ── Reset on each new invocation ──────────────────────────────────────────────

void listen('overlay-will-show', () => {
  applyDockOffset();
  resetState();
});

/** Push the toolbar above the macOS Dock (and any bottom system UI).
 *
 *  window.screen.height      = full logical screen height
 *  window.screen.availTop    = top inset (menu bar, ~25 px on macOS)
 *  window.screen.availHeight = usable height (excludes menu bar + dock)
 *
 *  dock_height = screen.height - availTop - availHeight
 */
function applyDockOffset() {
  const dockH = Math.max(
    0,
    window.screen.height - window.screen.availTop - window.screen.availHeight,
  );
  // Add 12 px breathing room above the dock edge
  document.documentElement.style.setProperty('--dock-offset', `${dockH + 12}px`);
}

function resetState() {
  root.querySelectorAll('.ann-pin, .ann-highlight').forEach(el => el.remove());
  connectorsEl.innerHTML = '';
  annotations = [];
  selectedId = null;
  targetSessionId = null;
  localFolder = null;
  githubRepo = '';
  dragging = false; dragStart = null; moveState = null;
  selRectEl.style.display = 'none';
  sessionPickerEl.style.display = 'none';
  repoInputRowEl.style.display = 'none';
  folderPathEl.style.display = 'none';
  folderPickBtn.textContent = '📁 Choose folder…';
  repoInputEl.value = '';
  screenshotBg.style.backgroundImage = '';
  notePanelEl.style.display = 'none';
  const appendBtn = document.getElementById('btn-append');
  if (appendBtn) appendBtn.textContent = 'Add to session ▾';
  const repoBtn = document.getElementById('btn-repo');
  if (repoBtn) repoBtn.textContent = 'Project';
  sessionSwitcherEl.querySelectorAll('.session-switch').forEach((b, i) => b.classList.toggle('active', i === 0));
  sessionMode = 'append';
  updateCounter();
  setTool('pin');
}

// ── Session list from main window ─────────────────────────────────────────────

void listen<Array<{ id: string; title: string; createdAt: string }>>('sessions-list', event => {
  const list = event.payload;
  if (!sessionPickerEl || sessionPickerEl.style.display === 'none') return;

  if (list.length === 0) {
    sessionPickerEl.innerHTML = '<div class="session-picker-empty">No sessions yet — use "New session"</div>';
    return;
  }

  sessionPickerEl.innerHTML = list.map(s => `
    <button class="session-picker-item${targetSessionId === s.id ? ' active' : ''}" data-id="${s.id}">
      ${s.title}
    </button>
  `).join('');

  sessionPickerEl.querySelectorAll<HTMLButtonElement>('.session-picker-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      targetSessionId = btn.dataset.id ?? null;
      sessionMode = 'append';
      sessionPickerEl.style.display = 'none';
      const appendBtn = document.getElementById('btn-append');
      if (appendBtn) {
        const title = list.find(s => s.id === targetSessionId)?.title ?? 'Add to session';
        appendBtn.textContent = (title.length > 22 ? title.slice(0, 22) + '…' : title) + ' ▾';
      }
    });
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

applyDockOffset();
setTool('pin');
updateCounter();

// Re-apply whenever the screen layout changes (e.g. dock auto-hide, display change)
window.addEventListener('resize', applyDockOffset);
