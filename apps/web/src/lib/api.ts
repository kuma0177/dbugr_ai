import type {
  FeedbackSession,
  FeedbackComment,
  ImprovementTask,
  Organization,
  OrganizationMembership,
  Invite,
  AIReviewSummary,
  CurationDecision,
  Submission,
  CreateFeedbackSessionRequest,
  CreateCommentRequest,
  CreateTaskRequest,
} from '@feedbackagent/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api';

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
    throw new Error(json?.error ?? raw ?? 'Request failed');
  }

  if (!json) {
    throw new Error('The server returned an empty response.');
  }

  return json.data as T;
}

export const api = {
  phase2: {
    requestEmailCode: (body: { email: string }) => apiFetch<{
      delivered: boolean;
      provider: 'resend' | 'preview';
      expiresInMinutes: number;
      previewCode: string | null;
    }>('/phase2/auth/email-code/request', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    verifyEmailCode: (body: { email: string; code: string }) => apiFetch<{
      verified: boolean;
    }>('/phase2/auth/email-code/verify', {
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
    onboarding: (body: {
      email?: string;
      name: string;
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
