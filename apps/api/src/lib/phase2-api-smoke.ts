const BASE = process.env.PHASE2_API_BASE_URL ?? 'http://127.0.0.1:3001/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
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

  await request('/phase2/onboarding', {
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

  await request('/phase2/bootstrap');
  const feed = await request<{ sessions: Array<{ id: string; comments?: Array<{ id: string }> }> }>('/phase2/feed?scope=organization');
  const session = feed.sessions[0];

  if (!session) {
    throw new Error('Phase 2 smoke needs at least one organization-visible session. Run pnpm db:setup.');
  }

  const contribution = await request<{ id: string }>(`/phase2/sessions/${session.id}/contributions`, {
    method: 'POST',
    body: JSON.stringify({
      targetType: 'session',
      contributionType: 'suggested_edit',
      body: 'Smoke test contribution: keep accepted feedback in the final AI prompt.',
      visibility: 'org',
    }),
  });

  await request(`/phase2/contributions/${contribution.id}/curation`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'accepted',
      reason: 'Smoke test verifies accepted feedback enters preflight.',
    }),
  });

  const summary = await request<{ finalPromptDraft: string }>(`/phase2/sessions/${session.id}/preflight`, {
    method: 'POST',
    body: JSON.stringify({ providerTarget: 'claude' }),
  });

  if (!summary.finalPromptDraft.includes('Must consider:')) {
    throw new Error('Phase 2 preflight prompt is missing the Must consider section.');
  }

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
