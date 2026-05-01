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
    const callLog: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    const callbacks = new Map<number, (payload: unknown) => void>();
    const eventListeners = new Map<string, Map<number, (event: { event: string; id: number; payload: unknown }) => void>>();
    let nextCallbackId = 1;
    let nextEventId = 1;
    (window as unknown as Record<string, unknown>)['__TAURI_MOCK_CALLS__'] = callLog;
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        callLog.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const event = String(args.event ?? '');
          const handlerId = Number(args.handler);
          const callback = callbacks.get(handlerId);
          if (!callback) return nextEventId++;
          const listeners = eventListeners.get(event) ?? new Map<number, (event: { event: string; id: number; payload: unknown }) => void>();
          const eventId = nextEventId++;
          listeners.set(eventId, callback as (event: { event: string; id: number; payload: unknown }) => void);
          eventListeners.set(event, listeners);
          return eventId;
        }
        if (cmd === 'plugin:event|unlisten') {
          const event = String(args.event ?? '');
          const eventId = Number(args.eventId);
          eventListeners.get(event)?.delete(eventId);
          return null;
        }
        if (cmd === 'plugin:event|emit') {
          const event = String(args.event ?? '');
          const payload = args.payload;
          eventListeners.get(event)?.forEach((listener, id) => {
            listener({ event, id, payload });
          });
          return null;
        }
        if (cmd in overrides) {
          const val = overrides[cmd];
          return typeof val === 'function' ? (val as (a: typeof args) => unknown)(args) : val;
        }
        // Defaults that keep the app from crashing
        switch (cmd) {
          case 'get_screen_capture_permission': return true;
          case 'request_screen_capture_permission': return true;
          case 'get_screen_capture_diagnostics':
            return {
              preflight: true,
              probe: true,
              granted: true,
              bundle_identifier: 'com.feedbackagent.desktop',
              executable_path: '/Users/kumar/debugr/apps/desktop/src-tauri/target/debug/feedbackagent-desktop',
            };
          case 'save_sessions_to_disk': return null;
          case 'hide_main_window': return null;
          case 'show_session_window': return null;
          default: return null;
        }
      },
      // minimal stubs so the window API doesn't crash
      transformCallback: (cb: unknown) => {
        const id = nextCallbackId++;
        callbacks.set(id, cb as (payload: unknown) => void);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
    };
  }, JSON.stringify(overrides));
}
