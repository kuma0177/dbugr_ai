import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');

function functionBlock(startPattern: RegExp) {
  const start = mainSource.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = mainSource.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < mainSource.length; index += 1) {
    const char = mainSource[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return mainSource.slice(start, index + 1);
  }

  throw new Error('Could not parse function block');
}

describe('annotation session picker', () => {
  it('uses the same active workspace sessions as the sidebar, not only sessions with captures', () => {
    const pickerSourceBlock = functionBlock(/function sessionsForAnnotationPicker\(/);
    const persistBlock = functionBlock(/function queuePersistMirrors\(/);
    const listenBlock = functionBlock(/async function listenForAnnotations\(/);

    expect(pickerSourceBlock).toContain('return sortedSessions()');
    expect(pickerSourceBlock).not.toContain('captures.length > 0');
    expect(pickerSourceBlock).not.toContain('totalAnnotations(session) > 0');

    expect(persistBlock).toContain('sessionsForAnnotationPicker()');
    expect(persistBlock).toContain('buildPickerSessionCache(pickerSourceSessions)');
    expect(listenBlock).toContain('sessionsForAnnotationPicker()');
    expect(listenBlock).toContain("source: 'workspace_sessions'");
    expect(listenBlock).toContain('loadSessionsFromApi({ force: true })');
  });
});
