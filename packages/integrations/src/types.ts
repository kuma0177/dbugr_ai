export interface IntegrationConfig {
  // GitHub
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  // Jira
  jiraHost?: string;      // e.g. "yourteam.atlassian.net"
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraProjectKey?: string;
  // Codex / Claude (code generation)
  claudeApiKey?: string;
  targetRepoUrl?: string; // Full repo URL: https://github.com/owner/repo
  targetRepoBranch?: string;
  autoMerge?: boolean;
}

export interface SendTaskInput {
  title: string;
  description: string;
  target: string;
  sessionId: string;
  sessionTitle?: string;
  externalUrl?: string;
}

export interface SendTaskResult {
  externalId: string;
  externalUrl: string;
  provider: string;
}

export interface IntegrationProvider {
  provider: string;
  isConfigured(config: IntegrationConfig): boolean;
  sendTask(task: SendTaskInput, config: IntegrationConfig): Promise<SendTaskResult>;
}
