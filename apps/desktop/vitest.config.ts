import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/__tests__/**/*.test.ts', 'e2e/**/*.spec.ts'],
    exclude: ['e2e/playwright/**'],
    coverage: {
      provider: 'v8',
      include: ['src/core.ts'],
    },
  },
});
