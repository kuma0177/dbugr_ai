import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(testDir, '../main.tsx'), 'utf8');
const coreSource = readFileSync(resolve(testDir, '../core.ts'), 'utf8');
const feedSource = readFileSync(resolve(testDir, '../../../web/src/app/feed/page.tsx'), 'utf8');
const publicFeedSource = readFileSync(resolve(testDir, '../../../web/src/app/public/page.tsx'), 'utf8');
const webCssSource = readFileSync(resolve(testDir, '../../../web/src/app/globals.css'), 'utf8');
const phase2Source = readFileSync(resolve(testDir, '../../../api/src/routes/phase2.ts'), 'utf8');
const apiIndexSource = readFileSync(resolve(testDir, '../../../api/src/index.ts'), 'utf8');
const rustMainSource = readFileSync(resolve(testDir, '../../src-tauri/src/main.rs'), 'utf8');
const dbSchemaSource = readFileSync(resolve(testDir, '../../../../packages/db/prisma/schema.prisma'), 'utf8');

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
    expect(renderWorkspacePanel).toContain("syncSessionToWeb(session, 'start_collaboration')");
    expect(renderWorkspacePanel).toContain('session.submissionFlow = flow');
    expect(renderWorkspacePanel).toContain("session.collaborationReady = false");
    expect(renderWorkspacePanel).toContain('openWebReviewForSession(session)');
    expect(renderWorkspacePanel).toContain("session.submissionFlow === 'direct'");
    expect(renderWorkspacePanel).toContain('flowGateError');
    expect(renderWorkspacePanel).toContain('Finish in web review');
    expect(renderWorkspacePanel).not.toContain('Seed the review queue');
  });

  it('allows team or public flow selection locally even when web sync is unavailable', () => {
    const renderWorkspacePanel = functionBlock(mainSource, /function renderWorkspacePanel\(/);
    const flowClickStart = renderWorkspacePanel.indexOf("document.querySelectorAll<HTMLButtonElement>('[data-flow]')");
    const flowNextStart = renderWorkspacePanel.indexOf("document.getElementById('flow-next-btn')");
    const flowClickBlock = renderWorkspacePanel.slice(flowClickStart, flowNextStart);

    expect(flowClickBlock).toContain('session.submissionFlow = flow');
    expect(flowClickBlock).toContain('persistAppState()');
    expect(flowClickBlock).not.toContain('syncSessionToWeb');
    expect(flowClickBlock).not.toContain('session.submissionFlow = previousFlow');
  });

  it('shows production-safe recovery copy when hosted web sync cannot reach the API', () => {
    const syncErrorStart = mainSource.indexOf('function syncErrorMessage');
    const syncErrorEnd = mainSource.indexOf('function apiBaseUrl', syncErrorStart);
    expect(syncErrorStart).toBeGreaterThanOrEqual(0);
    expect(syncErrorEnd).toBeGreaterThan(syncErrorStart);
    const syncErrorMessage = mainSource.slice(syncErrorStart, syncErrorEnd);
    const syncSessionToWeb = functionBlock(mainSource, /async function syncSessionToWeb\(/);

    expect(syncErrorMessage).toContain('Load failed');
    expect(syncErrorMessage).toContain('Could not reach Dbugr web services');
    expect(syncErrorMessage).toContain('Check your internet connection');
    expect(syncErrorMessage).toContain('relink this Mac from Dbugr web onboarding');
    expect(syncErrorMessage).toContain('ENABLE_LOCAL_API_DISCOVERY');
    expect(syncErrorMessage).toContain('isLocalApiBaseUrl(apiBaseUrl())');
    expect(syncErrorMessage).toContain('Could not reach the Dbugr web API');
    expect(syncErrorMessage).toContain('common local API ports');
    expect(syncErrorMessage).toContain('Last advertised API was');
    expect(syncErrorMessage).toContain('apiBaseUrl()');
    expect(syncSessionToWeb).toContain('session.webSyncError = syncErrorMessage(error)');
  });

  it('uses hosted API URLs in production and gates local API discovery to dev builds', () => {
    const discoverApiBaseUrl = functionBlock(mainSource, /async function discoverApiBaseUrl\(/);
    const apiBaseUrl = functionBlock(mainSource, /function apiBaseUrl\(/);
    const usableApiBaseUrl = functionBlock(mainSource, /function usableApiBaseUrl\(/);
    const fetchWithApiDiscovery = functionBlock(mainSource, /async function fetchWithApiDiscovery\(/);
    const syncSessionToWeb = functionBlock(mainSource, /async function syncSessionToWeb\(/);
    const createDesktopLink = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/desktop-link'/);

    expect(apiIndexSource).toContain('api-discovery.json');
    expect(apiIndexSource).toContain('writeLocalApiDiscovery(PORT)');
    expect(rustMainSource).toContain('fn read_api_discovery');
    expect(rustMainSource).toContain('read_api_discovery,');
    expect(mainSource).toContain("invoke<string | null>('read_api_discovery')");
    expect(mainSource).toContain('api_discovery_file_loaded');
    expect(mainSource).toContain('lastApiDiscoveryAdvertisement');
    expect(mainSource).toContain('BUILD_API_URL');
    expect(mainSource).toContain('LOCAL_DEV_API');
    expect(mainSource).toContain('ENABLE_LOCAL_API_DISCOVERY');
    expect(apiBaseUrl.indexOf('readDesktopLinkProfile()?.apiBaseUrl')).toBeLessThan(apiBaseUrl.indexOf("localStorage.getItem(API_BASE_URL_KEY)"));
    expect(apiBaseUrl).toContain('apiBaseUrlFromWebAppUrl()');
    expect(usableApiBaseUrl).toContain('!ENABLE_LOCAL_API_DISCOVERY && isLocalApiBaseUrl(normalized)');
    expect(discoverApiBaseUrl).toContain('if (!ENABLE_LOCAL_API_DISCOVERY && isLocalApiBaseUrl(normalized)) return');
    expect(discoverApiBaseUrl).toContain('if (ENABLE_LOCAL_API_DISCOVERY)');
    expect(discoverApiBaseUrl).toContain('API_DISCOVERY_PORTS');
    expect(discoverApiBaseUrl).toContain('probeApiBaseUrl(candidate)');
    expect(fetchWithApiDiscovery).toContain('discoverApiBaseUrl()');
    expect(fetchWithApiDiscovery).toContain('api_fetch_retrying_with_discovered_base');
    expect(syncSessionToWeb).toContain("fetchWithApiDiscovery('/phase2/desktop-sessions/sync'");
    expect(phase2Source).toContain('function getDesktopLinkApiBaseUrl');
    expect(phase2Source).toContain("req.headers['x-forwarded-host']");
    expect(createDesktopLink).toContain('const apiUrl = getDesktopLinkApiBaseUrl(req)');
    expect(createDesktopLink).not.toContain("process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3001}/api`");
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

  it('imports web profile company and role when redeeming a desktop link', () => {
    const onboardingApi = functionBlock(phase2Source, /phase2Router\.post\('\/phase2\/onboarding'/);
    const redeemHandler = functionBlock(mainSource, /async function handleDesktopDeepLink\(/);

    expect(dbSchemaSource).toContain('profileRole String?');
    expect(onboardingApi).toContain('profileRole: parsed.data.role?.trim() || null');
    expect(onboardingApi).toContain('profileRole: parsed.data.role');
    expect(redeemHandler).toContain('profile.userProfileRole || authState.role');
    expect(redeemHandler).toContain('company: profile.organizationName || authState.company');
    expect(redeemHandler).not.toContain('role: profile.organizationName');
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

  it('makes Cursor handoff visible and fails loudly when copy or launch fails', () => {
    const launchPromptStart = mainSource.indexOf('async function launchPromptHandoff');
    const launchPromptEnd = mainSource.indexOf('async function handleDesktopSubmissionHandoff', launchPromptStart);
    const launchPromptHandoff = mainSource.slice(launchPromptStart, launchPromptEnd);
    const sendSession = functionBlock(mainSource, /async function sendSession\(/);
    const nativeClipboard = functionBlock(rustMainSource, /fn copy_to_clipboard\(/);
    const nativeCursor = functionBlock(rustMainSource, /fn open_in_cursor\(/);

    expect(launchPromptHandoff.indexOf("invoke('copy_to_clipboard'")).toBeLessThan(launchPromptHandoff.indexOf("invoke('open_in_cursor'"));
    expect(launchPromptHandoff).not.toContain("copy_to_clipboard', { text: options.prompt }).catch");
    expect(sendSession).toContain("target === 'cursor'");
    expect(sendSession).toContain("workspaceSection = 'insights'");
    expect(sendSession).toContain('Cursor handoff ready');
    expect(sendSession).toContain('promptText: prompt');
    expect(sendSession).toContain('No CLI window opens for Cursor');
    expect(sendSession).toContain('Cursor handoff failed');
    expect(nativeClipboard).toContain('pbcopy exited with status');
    expect(nativeCursor).toContain('String::from_utf8_lossy(&output.stderr)');
  });

  it('copies the Cursor prompt from Insights actions and shows an inline confirmation', () => {
    const renderWorkspacePanel = functionBlock(mainSource, /function renderWorkspacePanel\(/);
    const feedbackPromptText = functionBlock(mainSource, /function feedbackPromptText\(/);
    const showInsightsToast = functionBlock(mainSource, /function showInsightsToast\(/);

    expect(coreSource).toContain('promptText?: string;');
    expect(renderWorkspacePanel).toContain('id="insights-action-toast"');
    expect(renderWorkspacePanel).toContain("document.getElementById('copy-insights-summary')");
    expect(renderWorkspacePanel).toContain("invoke('copy_to_clipboard', { text: feedbackPromptText(currentFeedback, activeSession()) })");
    expect(renderWorkspacePanel).toContain("document.getElementById('open-in-cursor-btn')");
    expect(renderWorkspacePanel).toContain("invoke('open_in_cursor'");
    expect(renderWorkspacePanel).toContain("showInsightsToast('Prompt copied. Paste it into Cursor chat.')");
    expect(feedbackPromptText).toContain('item.promptText');
    expect(feedbackPromptText).toContain('currentPromptPreview(session)?.prompt');
    expect(showInsightsToast).toContain('insights-action-toast visible');
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
