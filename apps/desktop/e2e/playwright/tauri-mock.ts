/**
 * Tauri invoke() mock for Playwright E2E tests.
 *
 * The Vite dev server runs the frontend without Tauri, so window.__TAURI_INTERNALS__
 * is absent and all invoke() calls would throw.  Inject this shim in every spec
 * before navigating to get predictable, controllable results.
 */

import { type Page } from '@playwright/test';

export interface InvokeOverrides {
  [command: string]: unknown | ((args: Record<string, unknown>) => unknown);
}

export async function injectTauriMock(page: Page, overrides: InvokeOverrides = {}): Promise<void> {
  await page.addInitScript((overridesJson: string) => {
    const overrides = JSON.parse(overridesJson) as Record<string, unknown>;

    // Tauri v2 reads from window.__TAURI_INTERNALS__
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd in overrides) {
          const val = overrides[cmd];
          return typeof val === 'function' ? (val as (a: typeof args) => unknown)(args) : val;
        }
        // Defaults that keep the app from crashing
        switch (cmd) {
          case 'get_screen_capture_permission': return true;
          case 'request_screen_capture_permission': return true;
          case 'save_sessions_to_disk': return null;
          case 'hide_main_window': return null;
          case 'show_session_window': return null;
          default: return null;
        }
      },
      // minimal stubs so the window API doesn't crash
      transformCallback: (cb: unknown) => cb,
    };
  }, JSON.stringify(overrides));
}
