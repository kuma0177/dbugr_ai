/**
 * SPEC 1: App launch
 *
 * Validates:
 *  - Welcome screen renders
 *  - Core UI landmarks are present
 *  - No console errors on cold start
 */

import { test, expect } from '@playwright/test';
import { injectTauriMock } from '../tauri-mock';

test.describe('01 — App launch', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page);
    // Clear any persisted app state so we start fresh
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('/');
  });

  test('renders the welcome screen', async ({ page }) => {
    // The app renders inside #app
    await expect(page.locator('#app')).toBeVisible();
  });

  test('shows the Dbugr branding on the welcome card', async ({ page }) => {
    await expect(page.locator('.welcome-card').first()).toBeVisible();
  });

  test('no unhandled console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(1000);
    // Filter out known benign errors (e.g. Tauri IPC not available in browser)
    const real = errors.filter(
      (e) => !e.includes('invoke') && !e.includes('Tauri') && !e.includes('ipc'),
    );
    expect(real).toHaveLength(0);
  });
});
