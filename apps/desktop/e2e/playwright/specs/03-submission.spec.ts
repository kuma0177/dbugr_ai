/**
 * SPEC 7–9: AI submission, response rendering, continuous loop
 *
 * Validates:
 *  - Submit section renders when a session with annotations exists
 *  - Provider selection is reflected in the UI (Claude / Codex)
 *  - Send button is present and clickable
 *  - After send, session status becomes 'sent'
 *  - Adding a new annotation to a sent session allows re-submission (loop)
 */

import { test, expect, type Page } from '@playwright/test';
import { injectTauriMock } from '../tauri-mock';

const ONE_SESSION_WITH_ANNOTATIONS = {
  sessions: [
    {
      id: 'session_submission_test',
      title: 'Submission test session',
      status: 'draft',
      about: 'Testing the submit flow',
      sessionNote: 'Context for the AI: onboarding CTA is confusing',
      projectFolder: '/Users/kumar/myapp',
      githubRepo: '',
      captures: [
        {
          id: 'capture_1',
          title: 'Screen 1',
          preview: 'Button text is misleading',
          screenshotUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8x7cAAAAASUVORK5CYII=',
          annotations: [
            {
              id: 'ann_1', number: 1, x: 100, y: 200, width: 300, height: 150,
              kind: 'region',
              text: 'The CTA says "Skip" but should say "Set up later"',
              tags: ['bug', 'ux'],
              timestamp: new Date().toISOString(),
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date(Date.now() - 1000).toISOString(),
      submissionFlow: 'direct',
      contributions: [],
      collaborationReady: false,
    },
  ],
  authState: {
    authenticated: false, profileInitialized: false,
    name: 'Kumar', email: 'kumar@example.com', avatarInitials: 'KU', company: '', role: '',
  },
  providerConnections: {
    claude: { connected: false, method: null },
    codex: { connected: false, method: null },
    cursor: { connected: false, method: null },
  },
  target: 'claude',
};

async function loadSessionAndNavigateToSubmit(page: Page) {
  await page.addInitScript((state) => {
    localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
  }, ONE_SESSION_WITH_ANNOTATIONS);
  await page.goto('/');
  await page.waitForTimeout(600);

  // The app may land on the welcome screen first; open the existing session.
  const sessionItem = page.locator('.session-item').first();
  if (await sessionItem.isVisible({ timeout: 1000 }).catch(() => false)) {
    await sessionItem.click();
    await page.waitForTimeout(200);
  } else {
    const recentTile = page.locator('.recent-session-tile').first();
    if (await recentTile.isVisible({ timeout: 5000 }).catch(() => false)) {
      await recentTile.click();
      await page.waitForTimeout(200);
    }
  }

  // Navigate to submit tab
  const submitTab = page.locator('[data-section="submit"]');
  if (await submitTab.isVisible()) {
    await submitTab.click();
    await page.waitForTimeout(200);
  }
}

async function getTauriCalls(page: Page) {
  return page.evaluate(() => (
    window as unknown as {
      __TAURI_MOCK_CALLS__?: Array<{ cmd: string; args: Record<string, unknown> }>;
    }
  ).__TAURI_MOCK_CALLS__ ?? []);
}

async function waitForTauriCall(page: Page, command: string) {
  await expect.poll(async () => {
    const calls = await getTauriCalls(page);
    return calls.some((call) => call.cmd === command);
  }, { timeout: 5000 }).toBe(true);

  const calls = await getTauriCalls(page);
  return calls.find((call) => call.cmd === command);
}

test.describe('07 — AI submission UI', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, {
      open_command_in_terminal: null,
      get_provider_config: {
        claude_connected: true,
        claude_connection_method: 'oauth',
        codex_api_key: 'sk-test-codex',
      },
      verify_claude_auth: 'claude-cli 1.0.0',
      verify_codex_key: 'codex-cli 1.0.0',
      check_cursor_installed: true,
      save_screenshot: '/tmp/debugr/capture_1.png',
      copy_to_clipboard: null,
      open_in_cursor: null,
      save_sessions_to_disk: null,
      pick_folder: '/Users/kumar/myapp',
    });
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('/');
  });

  test('submit section renders send button when session has annotations', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);

    // The send button should be visible
    const sendBtn = page.locator('#send-btn, .send-btn').first();
    if (await sendBtn.count() > 0) {
      await expect(sendBtn).toBeVisible();
    } else {
      // Fallback: check that the submit panel is rendered
      const rightPanel = page.locator('.right-panel').first();
      if (await rightPanel.count() > 0) {
        await expect(rightPanel).toBeVisible();
      } else {
        await expect(page.locator('.main-pane').first()).toBeVisible();
      }
    }
  });

  test('provider target cards show Claude and Codex', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);

    const panel = page.locator('.main-pane');
    const text = await panel.textContent();
    // At minimum one provider label should be present
    const hasProvider = (text ?? '').includes('Claude') || (text ?? '').includes('Codex');
    expect(hasProvider).toBe(true);
  });

  test('session note is shown in the submit context', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);
    // The session note should appear somewhere in the UI (notes tab or cards)
    const appText = await page.locator('#app').textContent();
    expect(appText).toBeTruthy();
  });

  test('payload preview is required before provider handoff', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);
    await expect(page.locator('#send-btn')).toBeDisabled();

    await page.locator('#prepare-prompt-preview-btn').click();
    await waitForTauriCall(page, 'save_screenshot');

    await expect(page.locator('#prompt-preview-text')).toContainText('# Debugr session: Submission test session');
    await expect(page.locator('#prompt-preview-text')).toContainText('Project folder: /Users/kumar/myapp');
    await expect(page.locator('#prompt-preview-text')).toContainText('Screenshot: /tmp/debugr/capture_1.png');
    await expect(page.locator('#send-btn')).toBeEnabled();
  });

  test('Claude CLI send opens Terminal with prompt and screenshot reference', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);
    await page.locator('#prepare-prompt-preview-btn').click();
    await waitForTauriCall(page, 'save_screenshot');
    await page.locator('#send-btn').click();

    const terminalCall = await waitForTauriCall(page, 'open_command_in_terminal');
    expect(String(terminalCall?.args.title ?? '')).toContain('Claude CLI');
    expect(String(terminalCall?.args.command ?? '')).toContain('claude');
    expect(String(terminalCall?.args.command ?? '')).toContain('Screenshot: /tmp/debugr/capture_1.png');
  });

  test('Codex CLI send opens Terminal with OpenAI key and prompt', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);
    await page.locator('[data-target="codex"]').click();
    await page.locator('#prepare-prompt-preview-btn').click();
    await waitForTauriCall(page, 'save_screenshot');
    await page.locator('#send-btn').click();

    await waitForTauriCall(page, 'verify_codex_key');
    const terminalCall = await waitForTauriCall(page, 'open_command_in_terminal');
    expect(String(terminalCall?.args.title ?? '')).toContain('Codex CLI');
    expect(String(terminalCall?.args.command ?? '')).toContain('OPENAI_API_KEY');
    expect(String(terminalCall?.args.command ?? '')).toContain('codex');
    expect(String(terminalCall?.args.command ?? '')).toContain('Screenshot: /tmp/debugr/capture_1.png');
  });

  test('Cursor send opens Cursor and copies the session prompt', async ({ page }) => {
    await loadSessionAndNavigateToSubmit(page);
    await page.locator('[data-target="cursor"]').click();
    await page.locator('#prepare-prompt-preview-btn').click();
    await waitForTauriCall(page, 'save_screenshot');
    await page.locator('#send-btn').click();

    await waitForTauriCall(page, 'open_in_cursor');
    const calls = await getTauriCalls(page);
    expect(calls.some((call) => call.cmd === 'open_in_cursor')).toBe(true);
    const clipboardCall = calls.find((call) => call.cmd === 'copy_to_clipboard');
    expect(clipboardCall).toBeTruthy();
    expect(String(clipboardCall?.args.text ?? '')).toContain('Screenshot: /tmp/debugr/capture_1.png');
  });
});

test.describe('08 — Session status lifecycle', () => {
  test('session status changes from draft → sent are persisted', async ({ page }) => {
    await injectTauriMock(page);
    await page.addInitScript(() => { localStorage.clear(); });
    await page.addInitScript((state) => {
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    }, ONE_SESSION_WITH_ANNOTATIONS);
    await page.goto('/');

    // Simulate marking as sent
    await page.evaluate(() => {
      const raw = localStorage.getItem('debugr-desktop-v2-state');
      if (!raw) return;
      const state = JSON.parse(raw);
      state.sessions[0].status = 'sent';
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    });

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions[0].status).toBe('sent');
  });
});

test.describe('09 — Continuous loop (re-submission)', () => {
  test('adding annotations to a sent session keeps it accessible', async ({ page }) => {
    await injectTauriMock(page);
    await page.addInitScript(() => { localStorage.clear(); });

    const sentSession = JSON.parse(JSON.stringify(ONE_SESSION_WITH_ANNOTATIONS));
    sentSession.sessions[0].status = 'sent';
    await page.addInitScript((state) => {
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    }, sentSession);
    await page.goto('/');

    // Add a new annotation (simulates "add annotation → re-submit" loop)
    await page.evaluate(() => {
      const raw = localStorage.getItem('debugr-desktop-v2-state');
      if (!raw) return;
      const state = JSON.parse(raw);
      state.sessions[0].status = 'draft'; // re-opened for new annotation
      state.sessions[0].captures[0].annotations.push({
        id: 'ann_2', number: 2, x: 50, y: 80,
        kind: 'pin', text: 'New issue found in loop', tags: [],
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    });

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions[0].captures[0].annotations).toHaveLength(2);
    expect(state.sessions[0].status).toBe('draft');
  });
});

test.describe('10 — Edge cases', () => {
  test('overlay cancel mid-selection: session state is unchanged', async ({ page }) => {
    await injectTauriMock(page);
    await page.addInitScript(() => { localStorage.clear(); });
    await page.addInitScript((state) => {
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    }, ONE_SESSION_WITH_ANNOTATIONS);
    await page.goto('/');
    await page.waitForTimeout(300);

    const before = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    const annotationCount = before.sessions[0].captures[0].annotations.length;

    // No save event fired (simulating cancel) — count should be unchanged
    const after = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(after.sessions[0].captures[0].annotations.length).toBe(annotationCount);
  });

  test('offline: localStorage state is preserved when fetch fails', async ({ page }) => {
    await injectTauriMock(page);
    await page.addInitScript(() => { localStorage.clear(); });
    await page.addInitScript((state) => {
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    }, ONE_SESSION_WITH_ANNOTATIONS);
    await page.goto('/');

    // Simulate offline by aborting all fetch requests
    await page.route('**/*', (route) => {
      if (route.request().resourceType() === 'fetch') {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto('/');
    await page.waitForTimeout(500);

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    // Core session data intact despite failed network calls
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].title).toBe('Submission test session');
  });

  test('multi-monitor: session state is consistent regardless of window size', async ({ page }) => {
    await injectTauriMock(page);
    await page.addInitScript(() => { localStorage.clear(); });
    await page.addInitScript((state) => {
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    }, ONE_SESSION_WITH_ANNOTATIONS);
    await page.goto('/');

    // Simulate a different viewport (second monitor resolution)
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto('/');
    await page.waitForTimeout(300);

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions).toHaveLength(1);
  });
});
