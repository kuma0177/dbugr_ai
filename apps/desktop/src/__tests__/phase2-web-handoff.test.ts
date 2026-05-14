import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const feedSource = readFileSync(resolve(testDir, '../../../web/src/app/feed/page.tsx'), 'utf8');
const publicFeedSource = readFileSync(resolve(testDir, '../../../web/src/app/public/page.tsx'), 'utf8');
const webCssSource = readFileSync(resolve(testDir, '../../../web/src/app/globals.css'), 'utf8');
const phase2Source = readFileSync(resolve(testDir, '../../../api/src/routes/phase2.ts'), 'utf8');
const apiIndexSource = readFileSync(resolve(testDir, '../../../api/src/index.ts'), 'utf8');
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
    expect(syncErrorMessage).toContain('common local API ports');
    expect(syncErrorMessage).toContain('Last advertised API was');
    expect(syncErrorMessage).toContain('apiBaseUrl()');
    expect(syncSessionToWeb).toContain('session.webSyncError = syncErrorMessage(error)');
  });

  it('discovers a moved local API before failing team or public review sync', () => {
    const discoverApiBaseUrl = functionBlock(mainSource, /async function discoverApiBaseUrl\(/);
    const fetchWithApiDiscovery = functionBlock(mainSource, /async function fetchWithApiDiscovery\(/);
    const syncSessionToWeb = functionBlock(mainSource, /async function syncSessionToWeb\(/);

    expect(apiIndexSource).toContain('api-discovery.json');
    expect(apiIndexSource).toContain('writeLocalApiDiscovery(PORT)');
    expect(rustMainSource).toContain('fn read_api_discovery');
    expect(rustMainSource).toContain('read_api_discovery,');
    expect(mainSource).toContain("invoke<string | null>('read_api_discovery')");
    expect(mainSource).toContain('api_discovery_file_loaded');
    expect(mainSource).toContain('lastApiDiscoveryAdvertisement');
    expect(discoverApiBaseUrl).toContain('API_DISCOVERY_PORTS');
    expect(discoverApiBaseUrl).toContain('probeApiBaseUrl(candidate)');
    expect(fetchWithApiDiscovery).toContain('discoverApiBaseUrl()');
    expect(fetchWithApiDiscovery).toContain('api_fetch_retrying_with_discovered_base');
    expect(syncSessionToWeb).toContain("fetchWithApiDiscovery('/phase2/desktop-sessions/sync'");
  });

  it('keeps desktop capture timestamps within the FeedbackFrame integer range', () => {
    expect(phase2Source).toContain('const SQLITE_INT_MAX = 2_147_483_647');
    expect(phase2Source).toContain('function normalizeDesktopCaptureTimestampMs');
    expect(phase2Source).toContain('raw - firstCaptureTimestampMs');
    expect(phase2Source).toContain('timestampMs: normalizeDesktopCaptureTimestampMs');
  });

  it('keeps the team review feed concise by deduping capture notes and avoiding unclear curation buttons', () => {
    const syncSessionToWebApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/desktop-sessions\/sync'/);
    expect(phase2Source).toContain('function uniqueNonEmptyText');
    expect(phase2Source).toContain('uniqueNonEmptyText([capture.note, ...annotationNotes])');
    expect(syncSessionToWebApi).toContain('syncedAnnotationCount += 1');
    expect(syncSessionToWebApi).not.toContain("sourceScope: 'owner'");
    expect(feedSource).toContain("curate(comment, 'accepted')");
    expect(feedSource).toContain("curate(comment, 'rejected')");
    expect(feedSource).not.toContain("curate(comment, 'duplicate')");
    expect(feedSource).not.toContain('>Duplicate</button>');
  });

  it('edits a user review note instead of creating multiple comments for the same user and session', () => {
    const contributionApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/sessions\/:id\/contributions'/);

    expect(contributionApi).toContain('const existingContribution = await prisma.feedbackComment.findFirst');
    expect(contributionApi).toContain("sourceScope: { in: ['team', 'public'] }");
    expect(contributionApi).toContain('tx.curationDecision.deleteMany');
    expect(contributionApi).toContain('tx.feedbackComment.update');
    expect(contributionApi).toContain('phase2.contribution_updated');
  });

  it('prefers the real user workspace over the seeded demo organization when loading web review context', () => {
    expect(phase2Source).toContain('function preferredMembership');
    expect(phase2Source).toContain("membership.organization.id !== 'org_demo'");
    expect(phase2Source).toContain('membership.organization.createdByUserId === userId');
    expect(phase2Source).toContain('const membership = preferredMembership(memberships, user.id)');
    expect(phase2Source).toContain("if (exactMembership.organization.id === 'org_demo')");
    expect(phase2Source).toContain('membership = preferredMembership(memberships, desktopLink.userId) ?? exactMembership');
    expect(phase2Source).toContain('desktopLinkOrganizationId: desktopLink.organizationId');
    expect(phase2Source).toContain('organizationId: membership.organization.id');
    expect(phase2Source).toContain('organization: membership.organization');
  });

  it('authorizes frame image previews with the same local viewer identity as the feed', () => {
    const framePreviewUrl = functionBlock(feedSource, /function framePreviewUrl\(/);
    const frameImageApi = functionBlock(phase2Source, /phase2Router\.get\('\/phase2\/frames\/:id\/image'/);

    expect(framePreviewUrl).toContain("params.set('viewerEmail'");
    expect(framePreviewUrl).toContain('viewerEmail.trim().toLowerCase()');
    expect(feedSource).toContain('const [viewerEmail, setViewerEmail] = useState');
    expect(feedSource).toContain("setViewerEmail(next?.userEmail || '')");
    expect(feedSource).toContain('framePreviewUrl(frame, viewerEmail)');
    expect(phase2Source).toContain('allowQueryEmail?: boolean');
    expect(phase2Source).toContain('req.query.viewerEmail');
    expect(frameImageApi).toContain('requestContext(req, { allowQueryEmail: true })');
  });

  it('keeps the visible Public review route usable for session owners and org admins', () => {
    const onboardingApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/onboarding'/);
    const visibilityApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/sessions\/:id\/visibility'/);
    const changeVisibility = functionBlock(feedSource, /async function changeVisibility\(/);

    expect(onboardingApi).toContain('allowPublicSharing: true');
    expect(feedSource).toContain("changeVisibility(session, 'public')");
    expect(changeVisibility).toContain("submissionFlow = visibility === 'public' ? 'public_feed'");
    expect(changeVisibility).toContain('redactionConfirmed: visibility ===');
    expect(visibilityApi).toContain('canPublishDespiteLegacyPolicy');
    expect(visibilityApi).toContain('session.createdBy === user.id');
    expect(visibilityApi).toContain("membership.role === 'owner'");
    expect(visibilityApi).toContain("membership.role === 'admin'");
    expect(visibilityApi).toContain('!organization.allowPublicSharing && !canPublishDespiteLegacyPolicy');
  });

  it('exposes a public discovery URL while requiring sign-in before public comments', () => {
    const publicLoad = functionBlock(publicFeedSource, /async function load\(/);
    const publicComment = functionBlock(publicFeedSource, /async function addPublicComment\(/);
    const feedApi = functionBlock(phase2Source, /phase2Router\.get\('\/phase2\/feed'/);
    const contributionApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/sessions\/:id\/contributions'/);

    expect(publicFeedSource).toContain("api.phase2.publicFeed()");
    expect(publicFeedSource).toContain("new URLSearchParams(window.location.search)");
    expect(publicFeedSource).toContain("params.get('sessionId')");
    expect(publicFeedSource).toContain('/public?sessionId=${selected.id}');
    expect(publicFeedSource).toContain('/onboarding?flow=sign-in');
    expect(publicFeedSource).toContain('/onboarding?flow=sign-up');
    expect(publicComment).toContain("if (!viewerEmail)");
    expect(publicComment).toContain("visibility: 'public'");
    expect(publicLoad).not.toContain('setIsOnboarded');
    expect(feedApi).toContain("where: scope === 'public' ? { visibility: 'public' } : undefined");
    expect(feedApi).toContain('creator: scrubPublicIdentity(session.creator)');
    expect(feedApi).toContain('author: scrubPublicIdentity(comment.author)');
    expect(phase2Source).toContain('function hasWebViewerIdentity');
    expect(phase2Source).toContain('function scrubPublicIdentity');
    expect(contributionApi).toContain('Sign in or sign up before adding a public review comment.');
    expect(contributionApi).toContain('contribution.auth_required');
  });

  it('keeps the review/public feed layout responsive with aligned content widths', () => {
    expect(webCssSource).toContain('grid-template-columns: 280px minmax(0, 1fr)');
    expect(webCssSource).toContain('.review-topbar,\n.review-hero,\n.review-feed-stack');
    expect(webCssSource).toContain('width: min(100%, 980px)');
    expect(webCssSource).toContain('@media (max-width: 1080px)');
    expect(webCssSource).toContain('.main:not(:has(.hv2)):not(:has(.review-shell))');
    expect(webCssSource).toContain('.review-shell {\n    grid-template-columns: 1fr;');
    expect(webCssSource).toContain('@media (max-width: 1180px)');
    expect(webCssSource).toContain('.nav-links {\n    flex: 1 1 620px;\n    justify-content: flex-end;\n    flex-wrap: wrap;');
    expect(webCssSource).toContain('.review-sidebar {\n    display: none;');
    expect(webCssSource).toContain('.review-mobile-scope-tabs {\n    width: min(100%, 980px);\n    display: grid;');
  });

  it('keeps small-screen review feed content above heavyweight sidebar navigation', () => {
    expect(feedSource).toContain('review-mobile-scope-tabs');
    expect(feedSource).toContain("aria-label=\"Notes feed scope\"");
    expect(webCssSource).toContain('.review-mobile-scope-tabs {\n  display: none;');
    expect(webCssSource).toContain('@media (max-width: 1080px)');
    expect(webCssSource).toContain('.review-sidebar {\n    display: none;');
    expect(webCssSource).toContain('.review-mobile-scope-tabs {\n    width: min(100%, 980px);\n    display: grid;');
    expect(webCssSource).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  });

  it('resets narrow-desktop nav flex sizing on mobile so links do not create huge vertical gaps', () => {
    expect(webCssSource).toContain('@media (max-width: 1180px)');
    expect(webCssSource).toContain('.nav-links {\n    flex: 1 1 620px;');
    expect(webCssSource).toContain('@media (max-width: 700px)');
    expect(webCssSource).toContain('.nav-links {\n    width: 100%;\n    display: flex;\n    flex: 0 0 auto;');
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
