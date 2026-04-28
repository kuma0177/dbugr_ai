import type {
  FeedbackSession,
  FeedbackComment,
  ImprovementTask,
  CreateFeedbackSessionRequest,
  CreateCommentRequest,
  CreateTaskRequest,
} from '@feedbackagent/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json.data as T;
}

export const api = {
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
