const API_BASE = 'http://localhost:3001/api';
const INJECT_URL = 'http://localhost:3000/inject.js';
const POLL_ALARM = 'feedbackagent-poll';
const POLL_INTERVAL_MINUTES = 0.5;

function normalize(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchOverlayCommand(tabUrl) {
  const url = `${API_BASE}/overlay/next?url=${encodeURIComponent(normalize(tabUrl))}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const json = await response.json();
  return json.data || null;
}

async function markConsumed(command) {
  await fetch(`${API_BASE}/overlay/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: command.sessionId, url: command.url }),
  });
}

async function injectOverlay(tabId, command) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (preset, injectUrl) => {
      window.__FA_PRESET = preset;

      if (window.__FA_ACTIVE) {
        return;
      }

      const response = await fetch(`${injectUrl}?v=${Date.now()}`);
      const source = await response.text();
      // The injected script owns its own lifecycle and guards.
      (0, eval)(source);
    },
    args: [
      {
        sessionId: command.sessionId,
        title: command.title,
        target: command.target,
      },
      INJECT_URL,
    ],
  });
}

async function pollActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id || !activeTab.url) return;
  if (!/^https?:\/\//.test(activeTab.url)) return;

  try {
    const command = await fetchOverlayCommand(activeTab.url);
    if (!command) return;
    await injectOverlay(activeTab.id, command);
    await markConsumed(command);
  } catch (error) {
    console.warn('FeedbackAgent auto overlay poll failed', error);
  }
}

function ensureAlarm() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_INTERVAL_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void pollActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void pollActiveTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  void pollActiveTab();
});

chrome.tabs.onActivated.addListener(() => {
  void pollActiveTab();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  void pollActiveTab();
});
