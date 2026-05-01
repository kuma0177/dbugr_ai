export type FeedbackStatus =
  | 'draft'
  | 'processing'
  | 'ready'
  | 'published'
  | 'routed'
  | 'resolved';

export type FeedbackVisibility = 'private' | 'public' | 'org';

export type UserIntent =
  | 'bug'
  | 'feature_request'
  | 'copy_feedback'
  | 'design_feedback'
  | 'ux_feedback'
  | 'general';

export type TaskStatus =
  | 'draft'
  | 'approved'
  | 'sent'
  | 'in_progress'
  | 'completed'
  | 'rejected';

export type IntegrationTarget =
  | 'jira'
  | 'github'
  | 'codex'
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'figma';

export type IntegrationProvider =
  | 'jira'
  | 'github'
  | 'figma'
  | 'codex'
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'youtube'
  | 'twitch'
  | 'instagram'
  | 'x';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  repoUrl?: string;
  jiraProjectKey?: string;
  figmaFileKey?: string;
  visibilityDefault: FeedbackVisibility;
  createdAt: string;
}

export interface CursorEvent {
  timestampMs: number;
  x: number;
  y: number;
  type: 'move' | 'click' | 'scroll';
}

export interface FeedbackFrame {
  id: string;
  feedbackSessionId: string;
  timestampMs: number;
  imageUrl: string;
  cursorX: number;
  cursorY: number;
  clickType?: string;
  regionX?: number;
  regionY?: number;
  regionW?: number;
  regionH?: number;
  description?: string;
}

export interface FeedbackComment {
  id: string;
  feedbackSessionId: string;
  parentCommentId?: string;
  authorId: string;
  author?: User;
  body: string;
  visibility: FeedbackVisibility;
  votesCount: number;
  createdAt: string;
  replies?: FeedbackComment[];
}

export interface FeedbackVote {
  id: string;
  feedbackCommentId: string;
  userId: string;
  value: 1 | -1;
  createdAt: string;
}

export interface ImprovementTask {
  id: string;
  feedbackSessionId: string;
  title: string;
  description: string;
  status: TaskStatus;
  target: IntegrationTarget;
  externalUrl?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskBrief {
  title: string;
  description: string;
  target: IntegrationTarget;
  context: {
    sessionId: string;
    summary: string;
    transcript: string;
    affectedArea?: string;
    priority: 'low' | 'medium' | 'high';
  };
}

export interface FeedbackSession {
  id: string;
  projectId: string;
  createdBy: string;
  title: string;
  about?: string | null;
  projectFolder?: string | null;
  githubRepo?: string | null;
  status: FeedbackStatus;
  visibility: FeedbackVisibility;
  videoUrl?: string;
  audioUrl?: string;
  transcript?: string;
  aiSummary?: string;
  aiTaskBrief?: string;
  userIntent?: UserIntent;
  createdAt: string;
  updatedAt: string;
  frames?: FeedbackFrame[];
  comments?: FeedbackComment[];
  tasks?: ImprovementTask[];
}

export interface Integration {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  configJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadataJson?: Record<string, unknown>;
  createdAt: string;
}

// API request/response shapes
export interface CreateFeedbackSessionRequest {
  title: string;
  visibility?: FeedbackVisibility;
  about?: string;
  projectFolder?: string;
  githubRepo?: string;
  userIntent?: string;
}

export interface FinalizeFeedbackSessionRequest {
  durationMs: number;
  cursorEvents?: CursorEvent[];
}

export interface CreateCommentRequest {
  body: string;
  parentCommentId?: string;
}

export interface CreateTaskRequest {
  target: IntegrationTarget;
  title: string;
  description: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
