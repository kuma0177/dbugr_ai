import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const feedSource = readFileSync(resolve(testDir, '../../../web/src/app/feed/page.tsx'), 'utf8');
const phase2Source = readFileSync(resolve(testDir, '../../../api/src/routes/phase2.ts'), 'utf8');
const rustMainSource = readFileSync(resolve(testDir, '../../src-tauri/src/main.rs'), 'utf8');

function functionBlock(source: string, startPattern: RegExp) {
  const start = source.search(startPattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', start);
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

describe('phase 2 team/public web handoff', () => {
  it('makes the Start collaboration button await web sync before opening the review feed', () => {
    const renderWorkspacePanel = functionBlock(mainSource, /function renderWorkspacePanel\(/);

    expect(renderWorkspacePanel).toContain("id=\"flow-next-btn\"");
    expect(renderWorkspacePanel).toContain("syncSessionToWeb(session, 'submission_flow_selected')");
    expect(renderWorkspacePanel).toContain("syncSessionToWeb(session, 'start_collaboration')");
    expect(renderWorkspacePanel).toContain('const previousFlow = session.submissionFlow');
    expect(renderWorkspacePanel).toContain('session.submissionFlow = previousFlow');
    expect(renderWorkspacePanel).toContain('openWebReviewForSession(session)');
    expect(renderWorkspacePanel).toContain("session.submissionFlow === 'direct'");
    expect(renderWorkspacePanel).toContain('flowGateError');
    expect(renderWorkspacePanel).toContain('Finish in web review');
    expect(renderWorkspacePanel).not.toContain('Seed the review queue');
  });

  it('shows a specific recovery message when desktop web sync cannot reach the API', () => {
    const syncErrorStart = mainSource.indexOf('function syncErrorMessage');
    const syncErrorEnd = mainSource.indexOf('function apiBaseUrl', syncErrorStart);
    expect(syncErrorStart).toBeGreaterThanOrEqual(0);
    expect(syncErrorEnd).toBeGreaterThan(syncErrorStart);
    const syncErrorMessage = mainSource.slice(syncErrorStart, syncErrorEnd);
    const syncSessionToWeb = functionBlock(mainSource, /async function syncSessionToWeb\(/);

    expect(syncErrorMessage).toContain('Load failed');
    expect(syncErrorMessage).toContain('Could not reach the Dbugr web API');
    expect(syncErrorMessage).toContain('apiBaseUrl()');
    expect(syncSessionToWeb).toContain('session.webSyncError = syncErrorMessage(error)');
  });

  it('handles dbugr://handoff links by fetching the frozen web prompt and launching the provider locally', () => {
    const deepLinkHandler = functionBlock(mainSource, /async function handleDesktopDeepLink\(/);
    const handoffHandler = functionBlock(mainSource, /async function handleDesktopSubmissionHandoff\(/);

    expect(deepLinkHandler).toContain("parsed.hostname === 'handoff'");
    expect(handoffHandler).toContain('/phase2/desktop-submissions/');
    expect(handoffHandler).toContain('launchPromptHandoff');
    expect(handoffHandler).toContain("updateDesktopSubmissionStatus(submissionId, 'sent')");
  });

  it('launches local AI CLIs through a native temp-file handoff instead of inline shell-quoting the prompt', () => {
    const launchPromptStart = mainSource.indexOf('async function launchPromptHandoff');
    const launchPromptEnd = mainSource.indexOf('async function handleDesktopSubmissionHandoff', launchPromptStart);
    expect(launchPromptStart).toBeGreaterThanOrEqual(0);
    expect(launchPromptEnd).toBeGreaterThan(launchPromptStart);
    const launchPromptHandoff = mainSource.slice(launchPromptStart, launchPromptEnd);
    const nativeHandoff = functionBlock(rustMainSource, /fn open_ai_cli_in_terminal\(/);

    expect(launchPromptHandoff).toContain("invoke('open_ai_cli_in_terminal'");
    expect(launchPromptHandoff).toContain('prompt: options.prompt');
    expect(launchPromptHandoff).toContain('apiKey:');
    expect(launchPromptHandoff).not.toContain('buildCliCommand');
    expect(mainSource).not.toContain('function buildCliCommand');
    expect(nativeHandoff).toContain('prompt_path');
    expect(nativeHandoff).toContain('/bin/zsh');
    expect(nativeHandoff).toContain('/Applications/Codex.app/Contents/Resources');
    expect(nativeHandoff).toContain('command -v {cli_name}');
    expect(nativeHandoff).toContain('cli_status=$?');
    expect(nativeHandoff).toContain('"$(cat "$PROMPT_FILE")"');
    expect(nativeHandoff).not.toContain('do script');
    expect(nativeHandoff).not.toContain('\nstatus=$?');
  });

  it('has an API handoff endpoint for the desktop to load and acknowledge web submissions', () => {
    expect(phase2Source).toContain("phase2Router.get('/phase2/desktop-submissions/:id'");
    expect(phase2Source).toContain("phase2Router.post('/phase2/desktop-submissions/:id/status'");
    expect(phase2Source).toContain('finalPrompt: submission.finalPrompt');
    expect(phase2Source).toContain('canManageSession');
  });

  it('opens the Mac app after the web feed freezes a reviewed prompt', () => {
    const submitToAI = functionBlock(feedSource, /async function submitToAI\(/);

    expect(submitToAI).toContain("new URL('dbugr://handoff')");
    expect(submitToAI).toContain("handoffUrl.searchParams.set('submissionId', result.id)");
    expect(submitToAI).toContain("handoffUrl.searchParams.set('api', apiBaseUrl())");
    expect(submitToAI).toContain('window.location.href = handoffUrl.toString()');
  });
});
