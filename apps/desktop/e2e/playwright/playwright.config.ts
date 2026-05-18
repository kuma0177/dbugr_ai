import { defineConfig, devices } from '@playwright/test';

/**
 * Dbugr Playwright E2E config.
 *
 * Runs against the Vite dev server (http://localhost:5173).
 * Tauri invoke() calls are intercepted by a window.__TAURI_MOCK__ shim
 * injected in each spec's beforeEach.
 *
 * Run:  npx playwright test --config e2e/playwright/playwright.config.ts
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,   // run specs sequentially — they share Vite state
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start Vite dev server before the tests
  webServer: {
    command: 'pnpm vite --port 5173 --host 127.0.0.1',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
