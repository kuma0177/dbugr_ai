import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const overlaySource = readFileSync(resolve(testDir, '../overlay.ts'), 'utf8');

function functionBlock(startPattern: RegExp, source = mainSource) {
  const start = source.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const signatureEnd = source.indexOf('\n', start);
  const openBrace = source.lastIndexOf('{', signatureEnd);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
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

  it('logs picker row clicks through the permission and annotation transition path', () => {
    const renderPickerBlock = functionBlock(/function renderPickerSessions\(/, overlaySource);
    const permissionBlock = functionBlock(/async function ensureScreenRecordingPermissionBeforeAnnotating\(/, overlaySource);
    const enterAnnotatingBlock = functionBlock(/async function enterAnnotating\(/, overlaySource);
    const listenerBlock = functionBlock(/async function initializeEventListeners\(/, overlaySource);

    expect(renderPickerBlock).toContain('picker.render');
    expect(renderPickerBlock).toContain('picker.session.pointerdown');
    expect(renderPickerBlock).toContain('picker.session.click');
    expect(renderPickerBlock).toContain('picker.session.blocked_full');
    expect(permissionBlock).toContain('permission.annotation_gate.start');
    expect(permissionBlock).toContain('permission.annotation_gate.reuse_inflight');
    expect(enterAnnotatingBlock).toContain('enter_annotating.start');
    expect(enterAnnotatingBlock).toContain('enter_annotating.begin_capture');
    expect(listenerBlock).toContain('picker.sessions_list.received');
    expect(listenerBlock).toContain('overlay.launch.received');
  });
});
