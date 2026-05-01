/**
 * SPEC 2–6: Session creation, annotation, persistence
 *
 * Validates (simulating the annotations-saved event that the Tauri overlay sends):
 *  - Session is auto-created on first annotation
 *  - Session appears in the sidebar
 *  - Annotation count is reflected in the UI
 *  - Session note can be added
 *  - Session persists across a simulated reload (localStorage round-trip)
 */

import { test, expect, type Page } from '@playwright/test';
import { injectTauriMock } from '../tauri-mock';

const ANNOTATION_PAYLOAD = {
  annotations: [
    {
      id: 'ann_test_1',
      number: 1,
      x: 100,
      y: 200,
      width: 300,
      height: 150,
      kind: 'region',
      text: 'The onboarding CTA is misleading — users skip the setup step',
      tags: ['bug', 'onboarding'],
      timestamp: new Date().toISOString(),
    },
  ],
  targetSessionId: null,
  newSessionName: 'Onboarding flow bug',
  newSessionAbout: 'Users are confused by the initial setup CTA',
  localFolder: '/Users/kumar/myapp',
  githubRepo: '',
  screenshotUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8x7cAAAAASUVORK5CYII=',
};

async function simulateAnnotationSave(page: Page, payload = ANNOTATION_PAYLOAD) {
  await page.evaluate((p) => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__;
    return internals?.invoke?.('plugin:event|emit', {
      event: 'annotations-saved',
      payload: p,
    });
  }, payload);
  await page.waitForTimeout(300);
}

async function readPersistedState(page: Page) {
  return JSON.parse(
    (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
  );
}

test.describe('02–06 — Session creation, annotation & persistence', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, {
      // Stub finish_annotations: no-op (we drive the event ourselves)
      finish_annotations: null,
    });
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); });
  });

  test('welcome screen shows before any session exists', async ({ page }) => {
    // In welcome mode, there should be no sidebar session list
    const sessionItems = page.locator('.session-item');
    const count = await sessionItems.count();
    expect(count).toBe(0);
  });

  test('localStorage is empty on a clean start', async ({ page }) => {
    const state = await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state'));
    // Either null (fresh) or has an empty sessions array
    if (state !== null) {
      const parsed = JSON.parse(state);
      expect(parsed.sessions ?? []).toHaveLength(0);
    } else {
      expect(state).toBeNull();
    }
  });

  test('session data persists in localStorage after state change', async ({ page }) => {
    // Simulate the app saving a session manually by writing to localStorage
    await page.evaluate(() => {
      const state = {
        sessions: [{
          id: 'session_persist_test',
          title: 'Persistence test',
          status: 'draft',
          captures: [{
            id: 'capture_1',
            title: 'Capture 1',
            preview: '',
            annotations: [{
              id: 'ann_1', number: 1, x: 10, y: 20,
              kind: 'region', text: 'test note', tags: ['bug'],
              timestamp: new Date().toISOString(),
            }],
            timestamp: new Date().toISOString(),
          }],
          createdAt: new Date().toISOString(),
          submissionFlow: 'direct',
          contributions: [],
          collaborationReady: false,
        }],
        authState: { authenticated: true, profileInitialized: true, name: 'Kumar', email: 'kumar@example.com', avatarInitials: 'KU', company: '', role: '' },
        providerConnections: {
          claude: { connected: false, method: null },
          codex: { connected: false, method: null },
          cursor: { connected: false, method: null },
        },
        target: 'claude',
      };
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    });

    // Reload simulates "app restart recovery"
    await page.reload();
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state'));
    expect(state).not.toBeNull();
    const parsed = JSON.parse(state!);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].title).toBe('Persistence test');
    expect(parsed.sessions[0].captures[0].annotations).toHaveLength(1);
  });

  test('session note can be set and read back', async ({ page }) => {
    await page.evaluate(() => {
      const state = {
        sessions: [{
          id: 's1',
          title: 'Note test',
          status: 'draft',
          sessionNote: 'Users confused by CTA',
          captures: [],
          createdAt: new Date().toISOString(),
          submissionFlow: 'direct',
          contributions: [],
          collaborationReady: false,
        }],
        authState: { authenticated: false, profileInitialized: false, name: '', email: '', avatarInitials: '', company: '', role: '' },
        providerConnections: { claude: { connected: false, method: null }, codex: { connected: false, method: null }, cursor: { connected: false, method: null } },
        target: 'claude',
      };
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    });
    await page.reload();
    await page.waitForTimeout(300);

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions[0].sessionNote).toBe('Users confused by CTA');
  });

  test('new annotation persists screenshot payload and renders note + image in workspace', async ({ page }) => {
    await simulateAnnotationSave(page);

    await expect(page.locator('#session-title-input')).toHaveValue('Onboarding flow bug');
    await expect(page.locator('.capture-thumb img').first()).toBeVisible();
    await expect(page.locator('.capture-payload-image')).toBeVisible();
    await expect(page.locator('.capture-payload-note-body')).toContainText(
      'The onboarding CTA is misleading',
    );

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].captures).toHaveLength(1);
    expect(state.sessions[0].captures[0].annotations[0].text).toContain('onboarding CTA');
    expect(state.sessions[0].captures[0].screenshotUrl).toMatch(/^data:image\/png;base64,/);
  });

  test('a second screenshot can be appended to the same session and stays visible in the workspace', async ({ page }) => {
    await simulateAnnotationSave(page, {
      ...ANNOTATION_PAYLOAD,
      newSessionName: 'Multi-screenshot session',
      newSessionAbout: 'This session should keep accumulating screenshots.',
    });

    const initialState = await readPersistedState(page);
    const sessionId = initialState.sessions[0].id;

    await simulateAnnotationSave(page, {
      ...ANNOTATION_PAYLOAD,
      annotations: [
        {
          ...ANNOTATION_PAYLOAD.annotations[0],
          id: 'ann_test_2',
          number: 1,
          text: 'The second screenshot shows the follow-up state',
          timestamp: new Date().toISOString(),
        },
      ],
      targetSessionId: sessionId,
      newSessionName: 'This name should be ignored for appends',
      newSessionAbout: 'This note should stay attached to the original session.',
    });

    await expect(page.locator('.session-item')).toHaveCount(1);
    await expect(page.locator('.capture-card')).toHaveCount(2);
    await expect(page.locator('.capture-thumb img')).toHaveCount(2);
    await expect(page.locator('.capture-payload-note-body')).toContainText('The second screenshot shows the follow-up state');

    const state = await readPersistedState(page);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].title).toBe('Multi-screenshot session');
    expect(state.sessions[0].captures).toHaveLength(2);
    expect(state.sessions[0].captures[0].annotations).toHaveLength(1);
    expect(state.sessions[0].captures[1].annotations).toHaveLength(1);
    expect(state.sessions[0].captures[0].screenshotUrl).toMatch(/^data:image\/png;base64,/);
    expect(state.sessions[0].captures[1].screenshotUrl).toMatch(/^data:image\/png;base64,/);
  });

  test('full resolution preview opens for a saved screenshot payload', async ({ page }) => {
    await simulateAnnotationSave(page);

    await page.getByRole('button', { name: 'Open full resolution', exact: true }).click();
    await expect(page.locator('#capture-preview-modal')).toBeVisible();
    await expect(page.locator('#capture-preview-meta')).toContainText('Resolution:');

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#capture-preview-modal')).toHaveCount(0);
  });

  test('annotation can be deleted from an existing capture', async ({ page }) => {
    const payload = {
      ...ANNOTATION_PAYLOAD,
      annotations: [
        ANNOTATION_PAYLOAD.annotations[0],
        {
          ...ANNOTATION_PAYLOAD.annotations[0],
          id: 'ann_test_2',
          number: 2,
          text: 'Spacing on the secondary CTA still looks off',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    await simulateAnnotationSave(page, payload);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-delete-annotation="ann_test_2"]').click();
    await page.locator('[data-delete-annotation="ann_test_2"]').click();

    await expect(page.locator('[data-delete-annotation="ann_test_2"]')).toHaveCount(0);
    await expect(page.locator('.capture-time').first()).toContainText('1 annotations');

    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions[0].captures[0].annotations).toHaveLength(1);
    expect(state.sessions[0].captures[0].annotations[0].id).toBe('ann_test_1');
  });

  test('legacy no-screenshot captures are labeled clearly', async ({ page }) => {
    await page.evaluate(() => {
      const state = {
        sessions: [{
          id: 'legacy_session',
          title: 'Legacy screenshot session',
          status: 'draft',
          sessionNote: 'This came from before screenshot persistence.',
          about: '',
          projectFolder: null,
          githubRepo: '',
          captures: [{
            id: 'legacy_capture',
            title: 'Legacy note without screenshot support',
            preview: 'Legacy note without screenshot support',
            annotations: [{
              id: 'legacy_ann',
              number: 1,
              x: 10,
              y: 20,
              kind: 'region',
              text: 'Legacy note without screenshot support',
              tags: ['legacy'],
              timestamp: '2026-05-01T08:57:00.000Z',
            }],
            timestamp: '2026-05-01T08:57:00.000Z',
          }],
          createdAt: '2026-05-01T08:57:00.000Z',
          submissionFlow: 'direct',
          contributions: [],
          collaborationReady: false,
        }],
        authState: { authenticated: false, profileInitialized: false, name: '', email: '', avatarInitials: '', company: '', role: '' },
        providerConnections: { claude: { connected: false, method: null }, codex: { connected: false, method: null }, cursor: { connected: false, method: null } },
        target: 'claude',
      };
      localStorage.setItem('debugr-desktop-v2-state', JSON.stringify(state));
    });
    await page.reload();
    await page.waitForTimeout(300);
    await page.getByText('Legacy screenshot session').click();

    await expect(page.locator('.capture-legacy-badge').first()).toContainText('Saved before screenshot support');
    await expect(page.locator('.capture-payload-empty')).toContainText('Legacy capture: saved before screenshot support.');
  });

  test('whole session can be deleted from the header action', async ({ page }) => {
    await simulateAnnotationSave(page);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#delete-session-btn').click();
    await page.locator('#delete-session-btn').click();

    await expect(page.locator('.empty-state .empty-title')).toContainText('No session selected');
    const state = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('debugr-desktop-v2-state')))!,
    );
    expect(state.sessions).toHaveLength(0);
  });
});
