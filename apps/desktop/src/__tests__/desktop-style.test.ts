import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const desktopCssSource = readFileSync(resolve(testDir, '../index.css'), 'utf8');

describe('desktop visual tokens', () => {
  it('keeps welcome setup rows aligned with provider block surfaces', () => {
    expect(desktopCssSource).toContain('--color-powder: #f5f3f1;');
    expect(desktopCssSource).toContain('--surface-soft: var(--color-powder);');
    expect(desktopCssSource).toContain('.onboarding-item {\n  display: flex;');
    expect(desktopCssSource).toContain('.wc-provider-block {\n  border: 1px solid var(--border);');
    expect(desktopCssSource).toContain('background: var(--bg);');
    expect(desktopCssSource).toContain('border: 1px solid var(--border);');
    expect(desktopCssSource).not.toContain('#b1b0b0');
  });
});
