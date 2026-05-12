import type {
  FeedbackSession,
  FeedbackComment,
  ImprovementTask,
  Organization,
  OrganizationMembership,
  WorkspaceSummary,
  AdminOverview,
  PlatformAdminOverview,
  Invite,
  AIReviewSummary,
  CurationDecision,
  Submission,
  CreateFeedbackSessionRequest,
  CreateCommentRequest,
  CreateTaskRequest,
  DesktopSessionSyncRequest,
  DesktopSessionSyncResponse,
  DesktopSubmissionHandoff,
} from '@feedbackagent/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api';

export function apiBaseUrl() {
  return BASE;
}

export function apiAssetUrl(path: string) {
  return `${BASE}${path}`;
}

function formatApiError(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;

  if (typeof error === 'object') {
    const maybe = error as {
      message?: unknown;
      formErrors?: unknown;
      fieldErrors?: unknown;
    };

    if (typeof maybe.message === 'string' && maybe.message.trim()) {
      return maybe.message;
    }

    if (Array.isArray(maybe.formErrors)) {
      const first = maybe.formErrors.find((entry) => typeof entry === 'string' && entry.trim());
      if (typeof first === 'string') return first;
    }

    if (maybe.fieldErrors && typeof maybe.fieldErrors === 'object') {
      for (const value of Object.values(maybe.fieldErrors)) {
        if (Array.isArray(value)) {
          const first = value.find((entry) => typeof entry === 'string' && entry.trim());
          if (typeof first === 'string') return first;
        }
      }
    }
  }

  return null;
}

function phase2AuthHeaders() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('dbugr_phase2_onboarding');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { userEmail?: string };
    return parsed.userEmail ? { 'x-dbugr-user-email': parsed.userEmail } : {};
  } catch {
    return {};
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(phase2AuthHeaders())) {
    headers.set(key, value);
  }
  const method = init?.method ?? 'GET';
  const startedAt = performance.now();
  console.info('[phase2-web] api.request.started', { method, path });
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  const raw = await res.text();
  let json: { error?: string; data?: T } | null = null;

  try {
    json = raw ? JSON.parse(raw) as { error?: string; data?: T } : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = formatApiError(json?.error) ?? raw ?? 'Request failed';
    console.warn('[phase2-web] api.request.failed', {
      method,
      path,
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
      message,
    });
    throw new Error(message);
  }

  if (!json) {
    console.warn('[phase2-web] api.request.empty_response', {
      method,
      path,
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error('The server returned an empty response.');
  }

  console.info('[phase2-web] api.request.completed', {
    method,
    path,
    status: res.status,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return json.data as T;
}

export const api = {
  phase2: {
    requestEmailCode: (body: { email: string }) => apiFetch<{
      delivered: boolean;
      provider: 'resend' | 'preview';
      accountExists: boolean;
      expiresInMinutes: number;
      previewCode: string | null;
    }>('/phase2/auth/email-code/request', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    verifyEmailCode: (body: { email: string; code: string }) => apiFetch<{
      verified: boolean;
      user: { id: string; name: string; email: string };
      created: boolean;
      welcomeEmailSent: boolean;
      workspace?: WorkspaceSummary | null;
    }>('/phase2/auth/email-code/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ensureIdentity: (body: { email: string; name?: string; authProvider: 'email' | 'google' }) => apiFetch<{
      user: { id: string; name: string; email: string };
      created: boolean;
      welcomeEmailSent: boolean;
      workspace?: WorkspaceSummary | null;
    }>('/phase2/auth/identity/ensure', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    bootstrap: () => apiFetch<{
      user: { id: string; name: string; email: string };
      organization: Organization;
      membership: OrganizationMembership;
      members: OrganizationMembership[];
      invites: Invite[];
      policies: Record<string, unknown>;
    }>('/phase2/bootstrap'),
    adminOverview: () => apiFetch<AdminOverview>('/phase2/admin/overview'),
    platformAdminOverview: (params?: { q?: string; organizationId?: string }) => {
      const search = new URLSearchParams();
      if (params?.q) search.set('q', params.q);
      if (params?.organizationId) search.set('organizationId', params.organizationId);
      return apiFetch<PlatformAdminOverview>(`/phase2/platform-admin/overview${search.size ? `?${search.toString()}` : ''}`);
    },
    updateAdminMember: (membershipId: string, body: { role?: string; status?: string; teamId?: string | null }) =>
      apiFetch<{ member: OrganizationMembership }>(`/phase2/admin/members/${membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    removeAdminMember: (membershipId: string) =>
      apiFetch<{ member: OrganizationMembership }>(`/phase2/admin/members/${membershipId}`, {
        method: 'DELETE',
      }),
    createAdminInvite: (body: { email: string; role?: string; teamId?: string | null }) =>
      apiFetch<{ invite: Invite & { acceptUrl?: string } }>('/phase2/admin/invites', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    revokeAdminInvite: (inviteId: string) =>
      apiFetch<{ invite: Invite }>(`/phase2/admin/invites/${inviteId}`, {
        method: 'DELETE',
      }),
    deleteAdminAudit: (auditLogId: string) =>
      apiFetch<{ deleted: boolean; auditLogId: string }>(`/phase2/admin/audit/${auditLogId}`, {
        method: 'DELETE',
      }),
    onboarding: (body: {
      email?: string;
      name: string;
      authProvider?: 'email' | 'google';
      organizationName: string;
      organizationLogoUrl?: string;
      role?: string;
      teamName?: string;
      inviteEmails: string[];
      defaultVisibility: 'private' | 'org' | 'public';
    }) => apiFetch<{
      organization: Organization;
      membership: OrganizationMembership;
      invites: Array<Invite & { acceptUrl?: string }>;
    }>('/phase2/onboarding', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    acceptInvite: (body: { token: string; email: string; name: string }) => apiFetch<{
      organization: Organization;
      membership: OrganizationMembership;
      invite: Invite;
    }>('/phase2/invites/accept', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    createDesktopLink: (body: { appUrl?: string }) => apiFetch<{
      linkId: string;
      code: string;
      deepLinkUrl: string;
      expiresAt: string;
      status: 'pending' | 'redeemed' | 'expired';
    }>('/phase2/desktop-link', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    redeemDesktopLink: (body: { code: string; desktopDeviceId?: string; desktopDeviceName?: string }) =>
      apiFetch<{
        desktopLinkToken: string;
        desktopLink: { id: string; status: string; redeemedAt?: string | null };
      }>('/phase2/desktop-link/redeem', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    feed: (scope: 'private' | 'organization' | 'public') =>
      apiFetch<{ scope: string; sessions: FeedbackSession[] }>(`/phase2/feed?scope=${scope}`),
    syncDesktopSession: (body: DesktopSessionSyncRequest) =>
      apiFetch<DesktopSessionSyncResponse>('/phase2/desktop-sessions/sync', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    contribute: (sessionId: string, body: {
      targetType: 'session' | 'capture' | 'annotation';
      contributionType: 'comment' | 'suggested_edit' | 'question' | 'risk' | 'requirement';
      body: string;
      suggestedText?: string;
      visibility: 'private' | 'org' | 'public';
    }) => apiFetch<FeedbackComment>(`/phase2/sessions/${sessionId}/contributions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    curate: (contributionId: string, body: {
      decision: 'accepted' | 'rejected' | 'edited' | 'duplicate' | 'needs_clarification';
      editedText?: string;
      reason?: string;
    }) => apiFetch<CurationDecision>(`/phase2/contributions/${contributionId}/curation`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    preflight: (sessionId: string, providerTarget: 'claude' | 'codex' | 'cursor') =>
      apiFetch<AIReviewSummary>(`/phase2/sessions/${sessionId}/preflight`, {
        method: 'POST',
        body: JSON.stringify({ providerTarget }),
      }),
    visibility: (sessionId: string, body: {
      visibility: 'private' | 'org' | 'public';
      submissionFlow?: 'direct' | 'internal_review' | 'public_feed';
      redactionConfirmed?: boolean;
    }) => apiFetch<FeedbackSession>(`/phase2/sessions/${sessionId}/visibility`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    submit: (sessionId: string, body: {
      providerTarget: 'claude' | 'codex' | 'cursor';
      aiReviewSummaryId?: string;
      finalPrompt?: string;
      credentialScope?: 'personal' | 'organization' | 'none';
    }) => apiFetch<Submission>(`/phase2/sessions/${sessionId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    desktopSubmission: (submissionId: string) =>
      apiFetch<DesktopSubmissionHandoff>(`/phase2/desktop-submissions/${submissionId}`),
    completeDesktopSubmission: (submissionId: string, body: {
      status: 'sent' | 'failed' | 'completed';
      providerResponse?: string;
    }) => apiFetch<Submission>(`/phase2/desktop-submissions/${submissionId}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  },
  sessions: {
    list: () => apiFetch<FeedbackSession[]>('/feedback-sessions'),
    get: (id: string) => apiFetch<FeedbackSession>(`/feedback-sessions/${id}`),
    create: (projectId: string, body: CreateFeedbackSessionRequest) =>
      apiFetch<FeedbackSession>(`/projects/${projectId}/feedback-sessions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    finalize: (id: string, body: { durationMs: number }) =>
      apiFetch<FeedbackSession>(`/feedback-sessions/${id}/finalize`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    patch: (id: string, body: Partial<FeedbackSession>) =>
      apiFetch<FeedbackSession>(`/feedback-sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
  comments: {
    create: (sessionId: string, body: CreateCommentRequest) =>
      apiFetch<FeedbackComment>(`/feedback-sessions/${sessionId}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    vote: (commentId: string, value: 1 | -1) =>
      apiFetch<{ voted: boolean }>(`/comments/${commentId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ value }),
      }),
  },
  tasks: {
    create: (sessionId: string, body: CreateTaskRequest) =>
      apiFetch<ImprovementTask>(`/feedback-sessions/${sessionId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approve: (taskId: string) =>
      apiFetch<ImprovementTask>(`/tasks/${taskId}/approve`, { method: 'POST' }),
    send: (taskId: string) =>
      apiFetch<ImprovementTask>(`/tasks/${taskId}/send`, { method: 'POST' }),
  },
};
