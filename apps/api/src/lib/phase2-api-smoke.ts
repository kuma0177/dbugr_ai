const BASE = process.env.PHASE2_API_BASE_URL ?? 'http://127.0.0.1:3001/api';
const SMOKE_VIEWER_EMAIL = 'demo@example.com';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = await response.json().catch(() => ({}));
  const durationMs = Date.now() - startedAt;

  console.info('[phase2-smoke]', {
    path,
    method: init?.method ?? 'GET',
    status: response.status,
    durationMs,
  });

  if (!response.ok) {
    throw new Error(`Phase 2 smoke request failed for ${path}: ${JSON.stringify(json)}`);
  }

  return json.data as T;
}

async function main() {
  console.info('[phase2-smoke] starting', { baseUrl: BASE });

  const onboarding = await request<{ invites: Array<{ email: string; acceptUrl?: string }> }>('/phase2/onboarding', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Demo User',
      organizationName: 'Demo Organization',
      role: 'Founder',
      teamName: 'Product',
      inviteEmails: ['phase2-reviewer@example.com'],
      defaultVisibility: 'org',
    }),
  });

  const inviteUrl = onboarding.invites[0]?.acceptUrl;
  if (!inviteUrl) {
    throw new Error('Phase 2 onboarding did not return a one-time invite link.');
  }
  const inviteToken = new URL(inviteUrl, 'http://localhost:3000').searchParams.get('invite');
  if (!inviteToken) {
    throw new Error('Phase 2 invite link is missing its invite token.');
  }
  await request('/phase2/invites/accept', {
    method: 'POST',
    body: JSON.stringify({
      token: inviteToken,
      email: 'phase2-reviewer@example.com',
      name: 'Phase 2 Reviewer',
    }),
  });

  await request('/phase2/bootstrap');
  const desktopLink = await request<{ code: string; status: string }>('/phase2/desktop-link', {
    method: 'POST',
    body: JSON.stringify({ appUrl: 'http://localhost:3000' }),
  });
  const redeemedLink = await request<{ desktopLinkToken: string }>('/phase2/desktop-link/redeem', {
    method: 'POST',
    body: JSON.stringify({ code: desktopLink.code, desktopDeviceName: 'Phase 2 smoke Mac' }),
  });
  if (!redeemedLink.desktopLinkToken) {
    throw new Error('Phase 2 desktop link redeem did not return a desktop token.');
  }

  async function syncDesktopFlow(flow: 'direct' | 'team' | 'public') {
    const synced = await request<{
      session: { id: string };
      mapping: {
        desktopFlow: string;
        visibility: string;
        submissionFlow: string;
        reviewStatus: string;
      };
      nextAction: string;
      syncedFrameCount: number;
      syncedAnnotationCount: number;
    }>('/phase2/desktop-sessions/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${redeemedLink.desktopLinkToken}` },
      body: JSON.stringify({
        localSessionId: `phase2-smoke-${flow}`,
        title: `Phase 2 smoke ${flow}`,
        about: 'Smoke test desktop bridge session.',
        projectFolder: '/tmp/debugr-smoke',
        submissionFlow: flow,
        providerTarget: 'codex',
        captures: [
          {
            id: `capture-${flow}`,
            title: 'Smoke capture',
            note: 'Captured from the Mac app smoke test.',
            previewDataUrl: 'desktop-capture://smoke-preview',
            timestampMs: 1000,
            annotations: [
              {
                id: `annotation-${flow}`,
                text: `Smoke ${flow} annotation should sync to the web feed.`,
                type: 'note',
                x: 120,
                y: 80,
              },
            ],
          },
        ],
      }),
    });

    const expected = flow === 'direct'
      ? { visibility: 'private', submissionFlow: 'direct', nextAction: 'local_ai_handoff' }
      : flow === 'team'
        ? { visibility: 'org', submissionFlow: 'internal_review', nextAction: 'open_team_review' }
        : { visibility: 'public', submissionFlow: 'public_feed', nextAction: 'open_public_curation' };

    if (
      synced.mapping.visibility !== expected.visibility ||
      synced.mapping.submissionFlow !== expected.submissionFlow ||
      synced.nextAction !== expected.nextAction ||
      synced.syncedFrameCount !== 1 ||
      synced.syncedAnnotationCount !== 1
    ) {
      throw new Error(`Desktop bridge mapping failed for ${flow}: ${JSON.stringify(synced)}`);
    }

    return synced;
  }

  await syncDesktopFlow('direct');
  const teamSync = await syncDesktopFlow('team');
  const publicSync = await syncDesktopFlow('public');

  const feed = await request<{ sessions: Array<{ id: string; comments?: Array<{ id: string }> }> }>('/phase2/feed?scope=organization');
  if (!feed.sessions.some((item) => item.id === teamSync.session.id)) {
    throw new Error('Team desktop sync did not publish the session to the organization feed.');
  }

  const publicFeed = await request<{ sessions: Array<{ id: string; creator?: { email?: string | null } }> }>('/phase2/feed?scope=public');
  const publicSession = publicFeed.sessions.find((item) => item.id === publicSync.session.id);
  if (!publicSession) {
    throw new Error('Public desktop sync did not publish the session to the public feed.');
  }
  if (publicSession.creator?.email) {
    throw new Error('Anonymous public feed exposed the public session creator email.');
  }

  const session = feed.sessions.find((item) => item.id === teamSync.session.id);

  if (!session) {
    throw new Error('Phase 2 smoke needs the team-synced session to be organization-visible.');
  }

  const contribution = await request<{ id: string }>(`/phase2/sessions/${session.id}/contributions`, {
    method: 'POST',
    headers: { 'x-dbugr-user-email': SMOKE_VIEWER_EMAIL },
    body: JSON.stringify({
      targetType: 'session',
      contributionType: 'suggested_edit',
      body: 'Smoke test contribution: keep accepted feedback in the final AI prompt.',
      visibility: 'org',
    }),
  });

  await request(`/phase2/contributions/${contribution.id}/curation`, {
    method: 'POST',
    headers: { 'x-dbugr-user-email': SMOKE_VIEWER_EMAIL },
    body: JSON.stringify({
      decision: 'accepted',
      reason: 'Smoke test verifies accepted feedback enters preflight.',
    }),
  });

  const summary = await request<{ finalPromptDraft: string }>(`/phase2/sessions/${session.id}/preflight`, {
    method: 'POST',
    headers: { 'x-dbugr-user-email': SMOKE_VIEWER_EMAIL },
    body: JSON.stringify({ providerTarget: 'claude' }),
  });

  if (!summary.finalPromptDraft.includes('Must consider:')) {
    throw new Error('Phase 2 preflight prompt is missing the Must consider section.');
  }

  await request(`/phase2/sessions/${session.id}/visibility`, {
    method: 'POST',
    headers: { 'x-dbugr-user-email': SMOKE_VIEWER_EMAIL },
    body: JSON.stringify({ visibility: 'org', submissionFlow: 'internal_review' }),
  });

  await request(`/phase2/sessions/${session.id}/submissions`, {
    method: 'POST',
    headers: { 'x-dbugr-user-email': SMOKE_VIEWER_EMAIL },
    body: JSON.stringify({
      providerTarget: 'claude',
      finalPrompt: summary.finalPromptDraft,
      credentialScope: 'personal',
    }),
  });

  console.info('[phase2-smoke] passed', {
    sessionId: session.id,
    contributionId: contribution.id,
    promptChars: summary.finalPromptDraft.length,
  });
}

void main().catch((error) => {
  console.error('[phase2-smoke] failed', error);
  process.exitCode = 1;
});

export {};
