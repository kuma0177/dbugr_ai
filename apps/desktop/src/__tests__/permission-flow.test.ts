import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const overlaySource = readFileSync(resolve(testDir, '../overlay.ts'), 'utf8');
const rustMainSource = readFileSync(resolve(testDir, '../../src-tauri/src/main.rs'), 'utf8');
const screenCaptureKitSource = readFileSync(resolve(testDir, '../../src-tauri/src/macos_screencapturekit.m'), 'utf8');

function sourceBlock(startPattern: RegExp, nextPattern: RegExp) {
  const start = mainSource.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const remaining = mainSource.slice(start);
  const next = remaining.slice(1).search(nextPattern);
  expect(next).toBeGreaterThanOrEqual(0);
  return remaining.slice(0, next + 1);
}

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

function overlayFunctionBlock(startPattern: RegExp) {
  const start = overlaySource.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = overlaySource.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < overlaySource.length; index += 1) {
    const char = overlaySource[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return overlaySource.slice(start, index + 1);
  }

  throw new Error('Could not parse overlay function block');
}

function rustFunctionBlock(functionName: string) {
  const start = rustMainSource.search(new RegExp(`fn ${functionName}\\b`));
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = rustMainSource.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < rustMainSource.length; index += 1) {
    const char = rustMainSource[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return rustMainSource.slice(start, index + 1);
  }

  throw new Error(`Could not parse Rust function block for ${functionName}`);
}

function stripBlockComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('macOS screen-recording permission flow', () => {
  it('does not request Screen Recording permission when the desktop shell boots', () => {
    const initBlock = functionBlock(/async function init\(\)/);

    expect(initBlock).not.toContain('request_screen_capture_permission');
    expect(initBlock).not.toContain('requestScreenRecordingPermission');
  });

  it('does not summon the Apple permission modal from the session settings helper', () => {
    const permissionHelperBlock = sourceBlock(/function bindPermissionNoteActions/, /function captureNeedsLegacyScreenshotLabel/);

    expect(permissionHelperBlock).toContain('open_screen_capture_settings');
    expect(permissionHelperBlock).toContain('win.hide');
    expect(permissionHelperBlock).not.toContain('request_screen_capture_permission');
    expect(permissionHelperBlock).not.toContain('requestScreenRecordingPermission');
  });

  it('does not run macOS plugin permission checks while rendering the source chooser', () => {
    const loadSourcesBlock = overlayFunctionBlock(/async function loadCaptureSources\(\)/);

    expect(loadSourcesBlock).toContain('list_capture_sources');
    expect(loadSourcesBlock).toContain('get_screen_capture_permission');
    expect(loadSourcesBlock).toContain('get_screen_capture_diagnostics');
    expect(loadSourcesBlock).not.toContain('checkScreenRecordingPermission');
    expect(loadSourcesBlock).not.toContain('requestScreenRecordingPermission');
  });

  it('does not request Screen Recording permission while listing capture sources', () => {
    const start = screenCaptureKitSource.search(/bool debugr_list_capture_sources_json/);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = screenCaptureKitSource.slice(start + 1).search(/bool debugr_capture_display_full_png/);
    expect(next).toBeGreaterThanOrEqual(0);
    const listSourcesBlock = stripBlockComments(screenCaptureKitSource.slice(start, start + next + 1));

    expect(listSourcesBlock).not.toContain('CGPreflightScreenCaptureAccess');
    expect(listSourcesBlock).not.toContain('CGRequestScreenCaptureAccess');
    expect(listSourcesBlock).not.toMatch(/if\s*\(\s*!\s*CGPreflightScreenCaptureAccess\(\)\s*\)\s*\{[\s\S]*?return false;/);
    expect(listSourcesBlock).toContain('SCShareableContent');
  });

  it('does not run a real capture probe before listing capture sources', () => {
    const listSourcesBlock = rustFunctionBlock('list_capture_sources_sync');

    expect(listSourcesBlock).toContain('CGPreflightScreenCaptureAccess');
    expect(listSourcesBlock).toContain('ERR_SCREEN_RECORDING_NOT_GRANTED');
    expect(listSourcesBlock).not.toContain('can_capture_screen_now');
    expect(listSourcesBlock).not.toContain('capture_native_png_bytes');
  });

  it('uses native capture for the automatic current-screen annotation flow', () => {
    const currentScreenCommandBlock = rustFunctionBlock('capture_current_screen_snapshot');

    expect(currentScreenCommandBlock).toContain('capture_native_png_bytes');
    expect(currentScreenCommandBlock).toContain('mode=native');
    expect(currentScreenCommandBlock).not.toContain('take_silent_screenshot');
    expect(currentScreenCommandBlock).not.toContain('screencapture');
  });

  it('restores the overlay before enabling current-screen annotation controls', () => {
    const currentScreenBlock = overlayFunctionBlock(/async function beginCurrentScreenCapture\(\)/);
    const readyControlsBlock = overlayFunctionBlock(/function ensureAnnotatingControlsReady/);

    expect(currentScreenBlock).not.toContain("invoke<string>('capture_current_screen_snapshot')");
    expect(currentScreenBlock).toContain('transparent_live_overlay=true');
    expect(currentScreenBlock).toContain('already_in_progress=true');
    expect(currentScreenBlock).toContain("applySourceFrameDisplay('')");
    expect(currentScreenBlock).toContain('await resumeOverlayVisible()');
    expect(currentScreenBlock.indexOf('await resumeOverlayVisible()')).toBeLessThan(currentScreenBlock.indexOf("showStep('annotating')"));
    expect(currentScreenBlock).toContain("ensureAnnotatingControlsReady('transparent_live_overlay')");

    expect(readyControlsBlock).toContain("toolbarEl.style.display = 'flex'");
    expect(readyControlsBlock).toContain("root.style.pointerEvents = 'auto'");
    expect(readyControlsBlock).toContain("root.classList.add('cursor-annotating')");
    expect(readyControlsBlock).toContain('overlay.annotating_controls.ready');
  });

  it('hides the main Debugr window before automatic current-screen capture', () => {
    const currentScreenCommandBlock = rustFunctionBlock('capture_current_screen_snapshot');

    expect(currentScreenCommandBlock).toContain('get_webview_window("main")');
    expect(currentScreenCommandBlock).toContain('main.hide()');
    expect(currentScreenCommandBlock).toContain('main.hide_for_capture');
  });

  it('keeps screenshot capture out of the live overlay toolbar', () => {
    const currentScreenBlock = overlayFunctionBlock(/async function beginCurrentScreenCapture\(\)/);
    const overlayMarkup = overlaySource.slice(
      overlaySource.indexOf('<!-- Bottom toolbar -->'),
      overlaySource.indexOf('<!-- Note inspector:'),
    );

    expect(currentScreenBlock).not.toContain('capture_screen_region_snapshot');
    expect(overlayMarkup).toContain('tool-region');
    expect(overlayMarkup).not.toContain('tool-pin');
    expect(overlayMarkup).not.toContain('tool-shot');
    expect(overlaySource).not.toContain('attachScreenshotEvidence');
    expect(rustMainSource).not.toContain('capture_screen_region_snapshot');
  });

  it('keeps passive permission checks from running screenshot probes', () => {
    const permissionBlock = rustFunctionBlock('get_screen_capture_permission');
    const diagnosticsBlock = rustFunctionBlock('get_screen_capture_diagnostics');

    expect(permissionBlock).toContain('CGPreflightScreenCaptureAccess');
    expect(permissionBlock).not.toContain('can_capture_screen_now');
    expect(permissionBlock).not.toContain('capture_native_png_bytes');
    expect(permissionBlock).toContain('probe=skipped');

    expect(diagnosticsBlock).toContain('CGPreflightScreenCaptureAccess');
    expect(diagnosticsBlock).not.toContain('can_capture_screen_now');
    expect(diagnosticsBlock).not.toContain('capture_native_png_bytes');
    expect(diagnosticsBlock).toContain('probe=skipped');
  });
});
