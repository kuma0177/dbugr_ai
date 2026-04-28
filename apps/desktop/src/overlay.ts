import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import './overlay.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: string;
  number: number;
  x: number;
  y: number;
  text: string;
  tags: string[];
  timestamp: string;
}

// ── State ────────────────────────────────────────────────────────────────────

const TAGS = ['Bug', 'UX', 'Blocking', 'Question'];
let annotations: Annotation[] = [];
let activeTool: 'select' | 'pin' | 'text' | 'arrow' | 'blur' = 'pin';
let currentNoteCardEl: HTMLDivElement | null = null;

// ── Root element ─────────────────────────────────────────────────────────────

const root = document.getElementById('overlay-root')!;

// ── Scaffold ─────────────────────────────────────────────────────────────────

root.innerHTML = `
  <!-- Screenshot background -->
  <div id="screenshot-bg"></div>

  <!-- Dim layer -->
  <div id="dim-layer"></div>

  <!-- Top toast -->
  <div class="toast" id="toast">
    <kbd>⌘</kbd><kbd>⌥</kbd><kbd>A</kbd>
    <span>Annotation mode — click anywhere to add a note.</span>
  </div>

  <!-- Annotation count badge -->
  <div class="ann-counter" id="ann-counter"></div>

  <!-- SVG connector layer -->
  <svg class="ann-connector" id="connectors" xmlns="http://www.w3.org/2000/svg"></svg>

  <!-- Loading indicator (shown while screenshot loads) -->
  <div id="loading-overlay" style="
    position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    z-index:500;background:#0a0f1a;color:rgba(255,255,255,0.5);font-size:14px;
    font-family:inherit;gap:12px;
  ">
    <div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.2);
      border-top-color:rgba(255,255,255,0.7);border-radius:50%;
      animation:spin 0.6s linear infinite;"></div>
    Capturing screen…
  </div>

  <!-- Floating toolbar -->
  <div class="toolbar" id="toolbar" style="display:none;">
    <button class="tool-btn" id="tool-select">↖<div class="tool-label">Select</div></button>
    <button class="tool-btn active" id="tool-pin">●<div class="tool-label">Pin</div></button>
    <button class="tool-btn" id="tool-text">T<div class="tool-label">Text</div></button>
    <button class="tool-btn" id="tool-arrow">↗<div class="tool-label">Arrow</div></button>
    <button class="tool-btn" id="tool-blur">▧<div class="tool-label">Blur</div></button>
    <div class="toolbar-divider"></div>
    <button class="tool-btn cancel" id="tool-cancel">Esc</button>
    <button class="tool-btn save-btn" id="tool-save">Save</button>
  </div>
`;

const screenshotBg  = document.getElementById('screenshot-bg')!;
const loadingEl     = document.getElementById('loading-overlay')!;
const toolbarEl     = document.getElementById('toolbar')!;
const counterEl     = document.getElementById('ann-counter')!;
const toastEl       = document.getElementById('toast')!;
const connectorsEl  = document.getElementById('connectors')!;

// ── Listen for screenshot from backend ───────────────────────────────────────

void listen<string>('set-screenshot', (event) => {
  const dataUrl = event.payload;
  if (dataUrl) {
    screenshotBg.style.backgroundImage = `url("${dataUrl}")`;
  } else {
    // No screenshot — show dark background with grid pattern
    screenshotBg.style.background =
      'radial-gradient(circle at 50% 40%, #1e2a3a 0%, #0a0f1a 100%)';
  }
  loadingEl.style.display = 'none';
  toolbarEl.style.display = 'flex';
  toastEl.style.display = 'flex';
});

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(tool: typeof activeTool) {
  activeTool = tool;
  ['select', 'pin', 'text', 'arrow', 'blur'].forEach((t) => {
    document.getElementById(`tool-${t}`)?.classList.toggle('active', t === tool);
  });
  root.style.cursor = (tool === 'pin' || tool === 'text') ? 'crosshair' : 'default';
}

document.getElementById('tool-select')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('select'); });
document.getElementById('tool-pin')?.addEventListener('click',    (e) => { e.stopPropagation(); setTool('pin'); });
document.getElementById('tool-text')?.addEventListener('click',   (e) => { e.stopPropagation(); setTool('text'); });
document.getElementById('tool-arrow')?.addEventListener('click',  (e) => { e.stopPropagation(); setTool('arrow'); });
document.getElementById('tool-blur')?.addEventListener('click',   (e) => { e.stopPropagation(); setTool('blur'); });

// ── Cancel / Escape ───────────────────────────────────────────────────────────

async function cancelOverlay() {
  await invoke('hide_overlay');
  setTimeout(resetState, 350);
}

document.getElementById('tool-cancel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  void cancelOverlay();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void cancelOverlay();
});

// ── Save all annotations ──────────────────────────────────────────────────────

async function saveAllAnnotations() {
  if (annotations.length === 0) { void cancelOverlay(); return; }
  await emit('annotations-saved', { annotations });
  await invoke('show_session_window');
  await invoke('hide_overlay');
  setTimeout(resetState, 400);
}

document.getElementById('tool-save')?.addEventListener('click', (e) => {
  e.stopPropagation();
  void saveAllAnnotations();
});

// ── Click to annotate ─────────────────────────────────────────────────────────

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('.toolbar') || target.closest('.note-card') || target.closest('.ann-pin')) return;
  if (loadingEl.style.display !== 'none') return; // still loading
  if (activeTool === 'pin' || activeTool === 'text' || activeTool === 'select') {
    placeAnnotation(e.clientX, e.clientY);
  }
});

function placeAnnotation(x: number, y: number) {
  dismissCurrentCard();
  const number = annotations.length + 1;
  const ann: Annotation = {
    id: `ann_${Date.now()}`, number, x, y,
    text: '', tags: [],
    timestamp: new Date().toISOString(),
  };
  annotations.push(ann);
  renderAnnotationPin(ann);
  showNoteCard(ann);
  updateCounter();
}

// ── Render pin + highlight ────────────────────────────────────────────────────

function renderAnnotationPin(ann: Annotation) {
  const hlW = 120, hlH = 60;

  const hl = document.createElement('div');
  hl.className = 'ann-highlight';
  hl.id = `hl_${ann.id}`;
  hl.style.cssText = `left:${ann.x - hlW/2}px;top:${ann.y - hlH/2}px;width:${hlW}px;height:${hlH}px;z-index:252;`;
  root.appendChild(hl);

  const pin = document.createElement('div');
  pin.className = 'ann-pin';
  pin.id = `pin_${ann.id}`;
  pin.style.cssText = `left:${ann.x}px;top:${ann.y - hlH/2 - 18}px;z-index:302;`;
  pin.textContent = String(ann.number);
  pin.addEventListener('click', (e) => { e.stopPropagation(); showNoteCard(ann); });
  root.appendChild(pin);
}

// ── Connector line ────────────────────────────────────────────────────────────

function drawConnector(ann: Annotation, cardEl: HTMLDivElement) {
  connectorsEl.querySelector(`#line_${ann.id}`)?.remove();
  const pinEl = document.getElementById(`pin_${ann.id}`);
  if (!pinEl) return;
  const pr = pinEl.getBoundingClientRect();
  const cr = cardEl.getBoundingClientRect();
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.id = `line_${ann.id}`;
  line.setAttribute('x1', String(pr.left + pr.width / 2));
  line.setAttribute('y1', String(pr.top + pr.height / 2));
  line.setAttribute('x2', String(cr.left));
  line.setAttribute('y2', String(cr.top + 20));
  line.setAttribute('stroke', '#0f6dfd');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '5,4');
  line.setAttribute('opacity', '0.7');
  connectorsEl.appendChild(line);
}

// ── Note card ─────────────────────────────────────────────────────────────────

function showNoteCard(ann: Annotation) {
  dismissCurrentCard();
  const card = document.createElement('div');
  card.className = 'note-card';
  card.id = `card_${ann.id}`;

  const cardW = 260, margin = 24;
  let cx = ann.x + 60, cy = ann.y - 80;
  if (cx + cardW > window.innerWidth - margin) cx = ann.x - cardW - 60;
  if (cy < margin) cy = margin;
  if (cy + 230 > window.innerHeight - 100) cy = window.innerHeight - 330;
  card.style.cssText = `left:${cx}px;top:${cy}px;z-index:312;`;

  card.innerHTML = `
    <div class="note-card-head">
      <strong>Annotation ${ann.number}</strong>
      <span>Screen capture</span>
    </div>
    <textarea placeholder="What should Claude / Codex know about this?">${ann.text}</textarea>
    <div class="chips">
      ${TAGS.map(tag => `<button class="chip${ann.tags.includes(tag) ? ' active' : ''}" data-tag="${tag}">${tag}</button>`).join('')}
    </div>
    <button class="save-ann-btn">Save annotation  ⌘↵</button>
  `;

  const ta = card.querySelector('textarea')!;
  ta.addEventListener('input', () => { ann.text = ta.value; });
  ta.addEventListener('click', (e) => e.stopPropagation());
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') dismissCurrentCard();
  });

  card.querySelectorAll<HTMLButtonElement>('.chip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = btn.dataset.tag!;
      if (ann.tags.includes(tag)) { ann.tags = ann.tags.filter(t => t !== tag); btn.classList.remove('active'); }
      else { ann.tags.push(tag); btn.classList.add('active'); }
    });
  });

  card.querySelector('.save-ann-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissCurrentCard();
  });

  root.appendChild(card);
  currentNoteCardEl = card;
  requestAnimationFrame(() => drawConnector(ann, card));
  ta.focus();
}

function dismissCurrentCard() {
  currentNoteCardEl?.remove();
  currentNoteCardEl = null;
  connectorsEl.innerHTML = '';
}

// ── Counter badge ─────────────────────────────────────────────────────────────

function updateCounter() {
  const n = annotations.length;
  counterEl.classList.toggle('visible', n > 0);
  if (n > 0) counterEl.textContent = `${n} annotation${n === 1 ? '' : 's'}`;
  toastEl.querySelector('span')!.textContent = n > 0
    ? `${n} annotation${n === 1 ? '' : 's'} added — click to add more, or press Save.`
    : 'Annotation mode — click anywhere to add a note.';
}

// ── Reset for next invocation ─────────────────────────────────────────────────

function resetState() {
  root.querySelectorAll('.ann-pin, .ann-highlight, .note-card').forEach(el => el.remove());
  connectorsEl.innerHTML = '';
  currentNoteCardEl = null;
  annotations = [];
  updateCounter();
  // Reset loading state
  screenshotBg.style.backgroundImage = '';
  screenshotBg.style.background = '';
  loadingEl.style.display = 'flex';
  toolbarEl.style.display = 'none';
}

// ── Init ──────────────────────────────────────────────────────────────────────

setTool('pin');
