/* FeedbackAgent annotation bookmarklet — injected into any page */
(function () {
  'use strict';

  // Toggle off if already active
  if (window.__FA_ACTIVE) {
    var old = document.getElementById('__fa_root');
    var oldStyle = document.getElementById('__fa_style');
    if (old) old.remove();
    if (oldStyle) oldStyle.remove();
    window.__FA_ACTIVE = false;
    return;
  }
  window.__FA_ACTIVE = true;

  var API = 'http://localhost:3001/api';
  var PROJ = 'proj_demo';
  var FA_ORIGIN = 'http://localhost:3000';
  var presetFromWindow = window.__FA_PRESET || null;
  var scriptUrl = new URL((document.currentScript && document.currentScript.src) || (FA_ORIGIN + '/inject.js'));
  var presetSessionId = (presetFromWindow && presetFromWindow.sessionId) || scriptUrl.searchParams.get('sessionId');
  var presetTitle = (presetFromWindow && presetFromWindow.title) || scriptUrl.searchParams.get('title');
  var selectedTarget = ((presetFromWindow && presetFromWindow.target) || scriptUrl.searchParams.get('target')) === 'codex' ? 'codex' : 'claude';

  if (window.__FA_PRESET) {
    try {
      delete window.__FA_PRESET;
    } catch {}
  }

  var sessionId = null;
  var boxes = [];
  var drawing = false;
  var drawStart = null;
  var speechRecognition = null;
  var voiceTranscript = '';
  var voiceTimer = 0;
  var voiceTimerInterval = null;
  var isRecordingVoice = false;

  /* ── Styles ── */
  var style = document.createElement('style');
  style.id = '__fa_style';
  style.textContent = [
    '#__fa_root,#__fa_root *{box-sizing:border-box;font-family:system-ui,sans-serif;line-height:normal;}',
    '#__fa_toolbar{position:fixed;top:0;left:0;right:0;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:8px 14px;background:#1e293b;border-bottom:2px solid #6366f1;box-shadow:0 2px 12px rgba(0,0,0,.4);}',
    '#__fa_overlay{position:fixed;top:44px;left:0;right:0;bottom:0;z-index:2147483644;cursor:crosshair;}',
    '.fa-box{position:fixed;border:2px solid #6366f1;background:rgba(99,102,241,.1);cursor:pointer;z-index:2147483644;}',
    '.fa-box:hover{background:rgba(99,102,241,.18);}',
    '.fa-target{padding:7px 14px;border-radius:999px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-size:12px;font-weight:800;cursor:pointer;}',
    '.fa-target.active{background:#312e81;border-color:#6366f1;color:#eef2ff;}',
    '.fa-label{position:absolute;top:-24px;left:-1px;background:#6366f1;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px 4px 0 0;white-space:nowrap;pointer-events:none;}',
    '.fa-preview{position:fixed;border:2px dashed #fbbf24;background:rgba(251,191,36,.08);pointer-events:none;z-index:2147483645;}',
    '#__fa_modal_back{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;}',
    '#__fa_modal{background:#fff;border-radius:14px;padding:24px;width:440px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,.45);}',
  ].join('');
  document.head.appendChild(style);

  /* ── Root ── */
  var root = document.createElement('div');
  root.id = '__fa_root';
  document.body.appendChild(root);

  /* ── Toolbar ── */
  var toolbar = document.createElement('div');
  toolbar.id = '__fa_toolbar';
  toolbar.innerHTML =
    '<span style="color:#818cf8;font-weight:800;font-size:14px;letter-spacing:-.3px;flex-shrink:0;">⬡ FeedbackAgent</span>' +
    '<span id="__fa_title_pill" style="color:#64748b;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
    '<span style="color:#94a3b8;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Send to</span>' +
    '<button id="__fa_target_claude" class="fa-target">Claude</button>' +
    '<button id="__fa_target_codex" class="fa-target">Codex</button>' +
    '<span id="__fa_count" style="color:#94a3b8;font-size:12px;font-weight:600;background:#0f172a;padding:4px 12px;border-radius:20px;border:1px solid #334155;flex-shrink:0;">0/5 boxes</span>' +
    '<button id="__fa_submit" style="padding:7px 18px;background:#059669;color:#fff;border:none;border-radius:7px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0;">✓ Submit</button>' +
    '<button id="__fa_close" style="padding:7px 12px;background:#334155;color:#94a3b8;border:none;border-radius:7px;font-size:13px;cursor:pointer;flex-shrink:0;">✕</button>';
  root.appendChild(toolbar);

  function syncTargetButtons() {
    var claude = document.getElementById('__fa_target_claude');
    var codex = document.getElementById('__fa_target_codex');
    if (!claude || !codex) return;
    claude.classList.toggle('active', selectedTarget === 'claude');
    codex.classList.toggle('active', selectedTarget === 'codex');
  }

  document.getElementById('__fa_target_claude').addEventListener('click', function () {
    selectedTarget = 'claude';
    syncTargetButtons();
  });
  document.getElementById('__fa_target_codex').addEventListener('click', function () {
    selectedTarget = 'codex';
    syncTargetButtons();
  });
  syncTargetButtons();

  /* ── Transparent click-through overlay ── */
  var overlay = document.createElement('div');
  overlay.id = '__fa_overlay';
  root.appendChild(overlay);

  /* ── Preview box ── */
  var preview = document.createElement('div');
  preview.className = 'fa-preview';
  preview.style.display = 'none';
  root.appendChild(preview);

  /* ── Count helper ── */
  function updateCount() {
    document.getElementById('__fa_count').textContent = boxes.length + '/5 boxes';
    var btn = document.getElementById('__fa_submit');
    btn.style.background = boxes.length > 0 ? '#059669' : '#334155';
    btn.style.cursor = boxes.length > 0 ? 'pointer' : 'not-allowed';
  }

  /* ── Render a saved box ── */
  function renderBox(box) {
    var el = document.createElement('div');
    el.className = 'fa-box';
    el.id = '__fa_b_' + box.id;
    el.style.cssText = 'left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.width + 'px;height:' + box.height + 'px;';
    var idx = boxes.indexOf(box) + 1;
    var labelText = '#' + idx + (box.notes.length === 0 ? ' · click to add note' : ' · ' + box.notes.length + ' note' + (box.notes.length > 1 ? 's' : ''));
    el.innerHTML = '<div class="fa-label">' + labelText + '</div>';
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    el.addEventListener('click', function () { openModal(box.id); });
    root.appendChild(el);
  }

  function refreshLabel(box) {
    var el = document.getElementById('__fa_b_' + box.id);
    if (!el) return;
    var idx = boxes.indexOf(box) + 1;
    el.querySelector('.fa-label').textContent = '#' + idx + ' · ' + box.notes.length + ' note' + (box.notes.length > 1 ? 's' : '');
  }

  /* ── Draw events ── */
  overlay.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drawing = true;
    drawStart = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener('mousemove', function (e) {
    if (!drawing || !drawStart) return;
    var x = Math.min(drawStart.x, e.clientX);
    var y = Math.min(drawStart.y, e.clientY);
    var w = Math.abs(e.clientX - drawStart.x);
    var h = Math.abs(e.clientY - drawStart.y);
    preview.style.display = 'block';
    preview.style.left = x + 'px'; preview.style.top = y + 'px';
    preview.style.width = w + 'px'; preview.style.height = h + 'px';
  });

  document.addEventListener('mouseup', function (e) {
    if (!drawing || !drawStart) return;
    drawing = false;
    preview.style.display = 'none';
    var x = Math.min(drawStart.x, e.clientX);
    var y = Math.min(drawStart.y, e.clientY);
    var w = Math.abs(e.clientX - drawStart.x);
    var h = Math.abs(e.clientY - drawStart.y);
    drawStart = null;
    if (w < 20 || h < 20) return;
    if (boxes.length >= 5) { alert('FeedbackAgent: max 5 boxes per session'); return; }
    var box = { id: 'box_' + Date.now(), x: x, y: y, width: w, height: h, notes: [] };
    boxes.push(box);
    renderBox(box);
    updateCount();
    openModal(box.id);
  });

  /* ── Note modal ── */
  function openModal(boxId) {
    var box = boxes.find(function (b) { return b.id === boxId; });
    if (!box) return;
    var idx = boxes.indexOf(box) + 1;

    var existing = box.notes.map(function (n) {
      return '<div style="font-size:12px;color:#374151;margin-bottom:4px;display:flex;gap:6px;"><span>' + (n.type === 'voice' ? '🎤' : '📝') + '</span><span>' + escHtml(n.content) + '</span></div>';
    }).join('');

    var backdrop = document.createElement('div');
    backdrop.id = '__fa_modal_back';
    backdrop.innerHTML =
      '<div id="__fa_modal">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div>' +
            '<div style="font-size:11px;color:#9ca3af;font-weight:600;margin-bottom:2px;">BOX #' + idx + '</div>' +
            '<div style="font-size:16px;font-weight:700;color:#111;">Add a note</div>' +
          '</div>' +
          '<button id="__fa_mc" style="background:none;border:none;cursor:pointer;font-size:20px;color:#9ca3af;padding:0;">✕</button>' +
        '</div>' +
        (existing ? '<div style="margin-bottom:12px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">' + existing + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
          '<button id="__fa_tab_text" style="flex:1;padding:9px 10px;border-radius:10px;border:1px solid #dbe4f0;background:#312e81;color:#eef2ff;font-weight:700;cursor:pointer;">Text</button>' +
          '<button id="__fa_tab_voice" style="flex:1;padding:9px 10px;border-radius:10px;border:1px solid #dbe4f0;background:#fff;color:#475569;font-weight:700;cursor:pointer;">Voice</button>' +
        '</div>' +
        '<div id="__fa_text_wrap">' +
        '<textarea id="__fa_note_text" placeholder="Describe the issue you\'re seeing…" style="width:100%;height:90px;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;resize:none;outline:none;line-height:1.5;color:#111;"></textarea>' +
        '<div id="__fa_text_count" style="font-size:11px;color:#9ca3af;text-align:right;margin:4px 0 12px;">0/1000</div>' +
        '</div>' +
        '<div id="__fa_voice_wrap" style="display:none;margin-bottom:12px;">' +
          '<div style="padding:12px;border-radius:10px;border:1px solid #dbe4f0;background:#f8fafc;">' +
            '<div id="__fa_voice_transcript" style="min-height:70px;color:#475569;font-size:14px;line-height:1.6;margin-bottom:10px;"><span style="color:#94a3b8;font-style:italic;">Start recording to capture a transcribed voice note.</span></div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
              '<div id="__fa_voice_timer" style="font-size:12px;color:#94a3b8;font-weight:700;">0s / 30s</div>' +
              '<button id="__fa_voice_toggle" style="padding:9px 14px;border-radius:10px;border:none;background:#0f172a;color:#f8fafc;font-weight:700;cursor:pointer;">Start Voice Note</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button id="__fa_mn" style="flex:1;padding:10px;border:1.5px solid #e5e7eb;background:#fff;border-radius:8px;cursor:pointer;font-weight:600;color:#374151;font-size:14px;">Cancel</button>' +
          '<button id="__fa_ms" style="flex:2;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;">Save Note ✓</button>' +
        '</div>' +
      '</div>';

    root.appendChild(backdrop);

    var ta = backdrop.querySelector('#__fa_note_text');
    var counter = backdrop.querySelector('#__fa_text_count');
    var textWrap = backdrop.querySelector('#__fa_text_wrap');
    var voiceWrap = backdrop.querySelector('#__fa_voice_wrap');
    var textTab = backdrop.querySelector('#__fa_tab_text');
    var voiceTab = backdrop.querySelector('#__fa_tab_voice');
    var voiceTranscriptEl = backdrop.querySelector('#__fa_voice_transcript');
    var voiceToggle = backdrop.querySelector('#__fa_voice_toggle');
    var voiceTimerEl = backdrop.querySelector('#__fa_voice_timer');
    var activeNoteMode = 'text';

    voiceTranscript = '';
    voiceTimer = 0;
    stopVoiceRecognition(true);

    ta.addEventListener('input', function () {
      ta.value = ta.value.slice(0, 1000);
      counter.textContent = ta.value.length + '/1000';
    });
    ta.focus();

    function setNoteMode(nextMode) {
      activeNoteMode = nextMode;
      textWrap.style.display = nextMode === 'text' ? 'block' : 'none';
      voiceWrap.style.display = nextMode === 'voice' ? 'block' : 'none';
      textTab.style.background = nextMode === 'text' ? '#312e81' : '#fff';
      textTab.style.color = nextMode === 'text' ? '#eef2ff' : '#475569';
      voiceTab.style.background = nextMode === 'voice' ? '#312e81' : '#fff';
      voiceTab.style.color = nextMode === 'voice' ? '#eef2ff' : '#475569';
    }

    textTab.addEventListener('click', function () { setNoteMode('text'); });
    voiceTab.addEventListener('click', function () { setNoteMode('voice'); });

    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('#__fa_mc').addEventListener('click', function () { stopVoiceRecognition(true); backdrop.remove(); });
    backdrop.querySelector('#__fa_mn').addEventListener('click', function () { stopVoiceRecognition(true); backdrop.remove(); });

    voiceToggle.addEventListener('click', function () {
      if (isRecordingVoice) {
        stopVoiceRecognition(false);
        return;
      }
      startVoiceRecognition(voiceTranscriptEl, voiceToggle, voiceTimerEl);
    });

    backdrop.querySelector('#__fa_ms').addEventListener('click', function () {
      if (activeNoteMode === 'text') {
        var text = ta.value.trim();
        if (!text) { ta.style.border = '1.5px solid #ef4444'; ta.focus(); return; }
        box.notes.push({ id: 'note_' + Date.now(), type: 'text', content: text, timestamp: Date.now() });
      } else {
        if (isRecordingVoice) {
          alert('Stop the voice note first, then save it.');
          return;
        }
        if (!voiceTranscript.trim()) {
          alert('Record a voice note or switch back to text.');
          return;
        }
        box.notes.push({
          id: 'note_' + Date.now(),
          type: 'voice',
          content: voiceTranscript.trim(),
          duration: voiceTimer,
          timestamp: Date.now()
        });
      }
      refreshLabel(box);
      stopVoiceRecognition(true);
      backdrop.remove();
    });
  }

  function startVoiceRecognition(transcriptEl, toggleEl, timerEl) {
    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert('Voice transcription is not available in this browser. Try Chrome or use a text note.');
      return;
    }

    stopVoiceRecognition(true);
    voiceTranscript = '';
    voiceTimer = 0;
    transcriptEl.innerHTML = '<span style="color:#94a3b8;font-style:italic;">Listening... speak now</span>';
    timerEl.textContent = '0s / 30s';

    var recognizer = new SpeechRecognitionCtor();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';

    recognizer.onresult = function (event) {
      var combined = '';
      for (var i = event.resultIndex; i < event.results.length; i += 1) {
        combined += event.results[i][0].transcript;
      }
      voiceTranscript = combined.trim();
      transcriptEl.textContent = voiceTranscript || 'Listening... speak now';
    };

    recognizer.onerror = function (event) {
      if (event.error !== 'aborted') {
        transcriptEl.textContent = 'Voice capture had a problem. You can try again or use a text note.';
      }
      stopVoiceRecognition(true);
    };

    recognizer.onend = function () {
      if (isRecordingVoice) stopVoiceRecognition(false);
    };

    speechRecognition = recognizer;
    isRecordingVoice = true;
    toggleEl.textContent = 'Stop Voice Note';
    toggleEl.style.background = '#7f1d1d';

    voiceTimerInterval = window.setInterval(function () {
      voiceTimer += 1;
      timerEl.textContent = voiceTimer + 's / 30s';
      if (voiceTimer >= 30) stopVoiceRecognition(false);
    }, 1000);

    recognizer.start();
  }

  function stopVoiceRecognition(resetTranscript) {
    if (speechRecognition) {
      speechRecognition.onend = null;
      speechRecognition.stop();
      speechRecognition = null;
    }
    if (voiceTimerInterval) {
      window.clearInterval(voiceTimerInterval);
      voiceTimerInterval = null;
    }
    isRecordingVoice = false;
    if (resetTranscript) {
      voiceTranscript = '';
      voiceTimer = 0;
    }
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Submit ── */
  document.getElementById('__fa_submit').addEventListener('click', async function () {
    if (boxes.length === 0) { alert('FeedbackAgent: add at least one annotation box first'); return; }
    if (!sessionId) { alert('FeedbackAgent: session not ready yet, try again in a second'); return; }

    var btn = document.getElementById('__fa_submit');
    btn.textContent = '⏳ Saving…';
    btn.disabled = true;

    var annotationData = JSON.stringify({
      boxes: boxes,
      pageUrl: window.location.href,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      handoffTarget: selectedTarget,
    });

    try {
      await fetch(API + '/feedback-sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: annotationData }),
      });
      window.location.href = FA_ORIGIN + '/sessions/' + sessionId + '/summary?autoSend=1&target=' + encodeURIComponent(selectedTarget);
    } catch (err) {
      alert('FeedbackAgent: failed to save — ' + err.message);
      btn.textContent = '✓ Submit';
      btn.disabled = false;
    }
  });

  /* ── Close ── */
  document.getElementById('__fa_close').addEventListener('click', function () {
    root.remove(); style.remove(); window.__FA_ACTIVE = false;
  });

  /* ── Create session via API ── */
  if (presetSessionId) {
    sessionId = presetSessionId;
    var presetPill = document.getElementById('__fa_title_pill');
    if (presetPill) presetPill.textContent = '→ "' + (presetTitle || 'Debug session') + '"';
  } else {
    var title = prompt('FeedbackAgent — what are you annotating?\n(Enter a short title for this session)');
    if (!title || !title.trim()) {
      root.remove(); style.remove(); window.__FA_ACTIVE = false;
      return;
    }

    fetch(API + '/projects/' + PROJ + '/feedback-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), visibility: 'private' }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        sessionId = res.data.id;
        var pill = document.getElementById('__fa_title_pill');
        if (pill) pill.textContent = '→ "' + res.data.title + '"';
      })
      .catch(function () {
        alert('FeedbackAgent: cannot reach API at localhost:3001. Is it running?');
        root.remove(); style.remove(); window.__FA_ACTIVE = false;
      });
  }
})();
