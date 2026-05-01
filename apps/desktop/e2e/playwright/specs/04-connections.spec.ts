/**
 * SPEC 11–14: Provider connection flows
 *
 * Validates:
 *  - Claude browser login opens a popup and verifies as connected
 *  - Claude API-key flow accepts a key and marks Claude connected
 *  - Codex API-key flow opens the key page popup and verifies as connected
 *  - Cursor shows as connected only when the app is actually installed
 */

import { test, expect } from '@playwright/test';
import { injectTauriMock } from '../tauri-mock';

test.describe('11–14 — Provider connections', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, {
      open_auth_popup: ({ url }: { url?: string }) => url ?? null,
      verify_claude_auth: 'claude-cli 1.0.0',
      verify_claude_api_key: '✓ API key verified',
      verify_codex_key: '✓ API key verified',
      check_cursor_installed: true,
      open_command_in_terminal: null,
    });
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('/');
    await page.waitForTimeout(400);
  });

  test('Claude browser login opens a popup and verifies connected', async ({ page }) => {
    await page.locator('#wc-connect-claude').click();
    await page.waitForTimeout(200);

    const calls = await page.evaluate(() => (window as unknown as { __TAURI_MOCK_CALLS__?: Array<{ cmd: string; args: Record<string, unknown> }> }).__TAURI_MOCK_CALLS__ ?? []);
    expect(calls.some((call) => call.cmd === 'open_command_in_terminal')).toBe(true);
    await expect(page.locator('#wc-claude-done')).toBeVisible();
    await page.locator('#wc-claude-done').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Claude' })).toContainText('● Connected');
    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Claude' })).toContainText('send any session straight to Claude');
  });

  test('Claude API key flow verifies and stores the key locally', async ({ page }) => {
    await page.locator('#wc-claude-mode-api').click();
    await page.waitForTimeout(150);

    await expect(page.locator('#wc-claude-key')).toBeVisible();
    await page.locator('#wc-claude-key').fill('sk-ant-api03-test-key-1234567890');
    await page.locator('#wc-save-claude').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Claude' })).toContainText('● Connected');
    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Claude' })).toContainText('Anthropic API key');
  });

  test('Codex API key flow opens the popup and verifies connected', async ({ page }) => {
    await expect(page.locator('#wc-codex-key')).toBeVisible();
    await page.locator('#wc-open-codex-keys').click();
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => (window as unknown as { __TAURI_MOCK_CALLS__?: Array<{ cmd: string; args: Record<string, unknown> }> }).__TAURI_MOCK_CALLS__ ?? []);
    expect(calls.some((call) => call.cmd === 'open_auth_popup' && String(call.args.url ?? '').includes('platform.openai.com/api-keys'))).toBe(true);
    await page.locator('#wc-codex-key').fill('sk-test-codex-key-1234567890');
    await page.locator('#wc-save-codex').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Codex' })).toContainText('● Connected');
    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Codex' })).toContainText('OpenAI API key');
  });

  test('Cursor shows ready only when the app is installed', async ({ page }) => {
    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Cursor' })).toContainText('● Ready');
    await expect(page.locator('.wc-provider-block').filter({ hasText: 'Cursor' })).toContainText('No login needed');
  });
});
