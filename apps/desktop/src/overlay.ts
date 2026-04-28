import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import './overlay.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: string;
  number: number;
  x: number;
  y: number;
  text: string;
  tags: string[];
  appName: string;
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
  <!-- Top toast -->
  <div class="toast" id="toast">
    <kbd>⌘</kbd><kbd>⌥</kbd><kbd>A</kbd>
    <span>Annotation mode active. Click anywhere to add a note.</span>
  </div>

  <!-- Annotation count -->
  <div class="ann-counter" id="ann-counter"></div>

  <!-- SVG connector layer -->
  <svg class="ann-connector" id="connectors" xmlns="http://www.w3.org/2000/svg"></svg>

  <!-- Floating toolbar -->
  <div class="toolbar" id="toolbar">
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

const counterEl = document.getElementById('ann-counter')!;
const toastEl = document.getElementById('toast')!;
const connectorsEl = document.getElementById('connectors')!;

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(tool: typeof activeTool) {
  activeTool = tool;
  ['select', 'pin', 'text', 'arrow', 'blur'].forEach((t) => {
    const btn = document.getElementById(`tool-${t}`);
    btn?.classList.toggle('active', t === tool);
  });
  root.style.cursor = tool === 'pin' || tool === 'text' ? 'crosshair' : 'default';
}

document.getElementById('tool-select')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('select'); });
document.getElementById('tool-pin')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('pin'); });
document.getElementById('tool-text')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('text'); });
document.getElementById('tool-arrow')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('arrow'); });
document.getElementById('tool-blur')?.addEventListener('click', (e) => { e.stopPropagation(); setTool('blur'); });

// ── Cancel / Escape ───────────────────────────────────────────────────────────

async function cancelOverlay() {
  await invoke('hide_overlay');
  // Reset state for next invocation
  setTimeout(() => {
    clearAnnotationUI();
    annotations = [];
    updateCounter();
  }, 300);
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
  if (annotations.length === 0) {
    void cancelOverlay();
    return;
  }

  // Emit to main window
  await emit('annotations-saved', { annotations });

  // Show main session window
  await invoke('show_session_window');

  // Hide overlay
  await invoke('hide_overlay');

  // Reset for next use
  setTimeout(() => {
    clearAnnotationUI();
    annotations = [];
    updateCounter();
  }, 400);
}

document.getElementById('tool-save')?.addEventListener('click', (e) => {
  e.stopPropagation();
  void saveAllAnnotations();
});

// ── Click to annotate ────────────────────────────────────────────────────────

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Ignore clicks on toolbar, cards, pins
  if (target.closest('.toolbar') || target.closest('.note-card') || target.closest('.ann-pin')) return;

  if (activeTool === 'pin' || activeTool === 'text' || activeTool === 'select') {
    placeAnnotation(e.clientX, e.clientY);
  }
});

function placeAnnotation(x: number, y: number) {
  // Dismiss any open note card first
  dismissCurrentCard();

  const number = annotations.length + 1;
  const id = `ann_${Date.now()}`;

  const ann: Annotation = {
    id,
    number,
    x,
    y,
    text: '',
    tags: [],
    appName: 'Screen',
    timestamp: new Date().toISOString(),
  };

  annotations.push(ann);
  renderAnnotationPin(ann);
  showNoteCard(ann);
  updateCounter();
}

// ── Render pin + highlight ────────────────────────────────────────────────────

function renderAnnotationPin(ann: Annotation) {
  // Highlight rect (80x56 around click point)
  const hlW = 120, hlH = 60;
  const hl = document.createElement('div');
  hl.className = 'ann-highlight';
  hl.id = `hl_${ann.id}`;
  hl.style.left = `${ann.x - hlW / 2}px`;
  hl.style.top = `${ann.y - hlH / 2}px`;
  hl.style.width = `${hlW}px`;
  hl.style.height = `${hlH}px`;
  root.appendChild(hl);

  // Pin
  const pin = document.createElement('div');
  pin.className = 'ann-pin';
  pin.id = `pin_${ann.id}`;
  pin.style.left = `${ann.x}px`;
  pin.style.top = `${ann.y - hlH / 2 - 18}px`;
  pin.textContent = String(ann.number);
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    showNoteCard(ann);
  });
  root.appendChild(pin);
}

// ── Connector SVG line ───────────────────────────────────────────────────────

function drawConnector(ann: Annotation, cardEl: HTMLDivElement) {
  const oldLine = connectorsEl.querySelector(`#line_${ann.id}`);
  if (oldLine) oldLine.remove();

  const pinEl = document.getElementById(`pin_${ann.id}`);
  if (!pinEl) return;

  const pinRect = pinEl.getBoundingClientRect();
  const cardRect = cardEl.getBoundingClientRect();

  const x1 = pinRect.left + pinRect.width / 2;
  const y1 = pinRect.top + pinRect.height / 2;
  const x2 = cardRect.left;
  const y2 = cardRect.top + 20;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.id = `line_${ann.id}`;
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', '#0f6dfd');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '5,4');
  line.setAttribute('opacity', '0.7');
  connectorsEl.appendChild(line);
}

// ── Note card ────────────────────────────────────────────────────────────────

function showNoteCard(ann: Annotation) {
  dismissCurrentCard();

  const card = document.createElement('div');
  card.className = 'note-card';
  card.id = `card_${ann.id}`;

  // Position: right of pin, or left if near right edge
  const cardW = 260;
  const margin = 24;
  let cardX = ann.x + 60;
  let cardY = ann.y - 80;
  if (cardX + cardW > window.innerWidth - margin) {
    cardX = ann.x - cardW - 60;
  }
  if (cardY < margin) cardY = margin;
  if (cardY + 220 > window.innerHeight - 100) {
    cardY = window.innerHeight - 320;
  }

  card.style.left = `${cardX}px`;
  card.style.top = `${cardY}px`;

  const tagChips = TAGS.map((tag) => `
    <button class="chip${ann.tags.includes(tag) ? ' active' : ''}" data-tag="${tag}">${tag}</button>
  `).join('');

  card.innerHTML = `
    <div class="note-card-head">
      <strong>Annotation ${ann.number}</strong>
      <span>Screen capture</span>
    </div>
    <textarea placeholder="What should Claude / Codex know about this?" rows="3">${ann.text}</textarea>
    <div class="chips">${tagChips}</div>
    <button class="save-ann-btn">Save annotation  ⌘↵</button>
  `;

  // Bind textarea
  const textarea = card.querySelector('textarea')!;
  textarea.addEventListener('input', () => { ann.text = textarea.value; });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      dismissCurrentCard();
    }
  });

  // Bind tag chips
  card.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = btn.dataset.tag!;
      if (ann.tags.includes(tag)) {
        ann.tags = ann.tags.filter((t) => t !== tag);
        btn.classList.remove('active');
      } else {
        ann.tags.push(tag);
        btn.classList.add('active');
      }
    });
  });

  // Bind save button
  card.querySelector('.save-ann-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissCurrentCard();
  });

  root.appendChild(card);
  currentNoteCardEl = card;

  // Draw connector after card is in DOM
  requestAnimationFrame(() => drawConnector(ann, card));

  // Focus textarea
  textarea.focus();
}

function dismissCurrentCard() {
  if (currentNoteCardEl) {
    currentNoteCardEl.remove();
    currentNoteCardEl = null;
    // Remove all connector lines
    connectorsEl.innerHTML = '';
  }
}

// ── Counter badge ────────────────────────────────────────────────────────────

function updateCounter() {
  const count = annotations.length;
  if (count === 0) {
    counterEl.classList.remove('visible');
  } else {
    counterEl.textContent = `${count} annotation${count === 1 ? '' : 's'}`;
    counterEl.classList.add('visible');
  }

  // Update toast
  if (count > 0) {
    toastEl.querySelector('span')!.textContent =
      `${count} annotation${count === 1 ? '' : 's'} added. Click to add more or press Save.`;
  } else {
    toastEl.querySelector('span')!.textContent =
      'Annotation mode active. Click anywhere to add a note.';
  }
}

// ── Clear all annotation UI ───────────────────────────────────────────────────

function clearAnnotationUI() {
  root.querySelectorAll('.ann-pin, .ann-highlight, .note-card').forEach((el) => el.remove());
  connectorsEl.innerHTML = '';
  currentNoteCardEl = null;
}

// ── Init ─────────────────────────────────────────────────────────────────────

setTool('pin');
