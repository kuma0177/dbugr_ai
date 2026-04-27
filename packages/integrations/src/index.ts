export * from './types';
export { GitHubProvider } from './providers/github';
export { JiraProvider } from './providers/jira';
export { MockProvider } from './providers/mock';
export { CodexProvider, ClaudeCodeProvider } from './providers/codex';

import type { IntegrationConfig, IntegrationProvider, SendTaskInput, SendTaskResult } from './types';
import { GitHubProvider } from './providers/github';
import { JiraProvider } from './providers/jira';
import { MockProvider } from './providers/mock';
import { CodexProvider, ClaudeCodeProvider } from './providers/codex';

const PROVIDERS: Record<string, IntegrationProvider> = {
  github: new GitHubProvider(),
  jira: new JiraProvider(),
  codex: new CodexProvider(),
  claude: new ClaudeCodeProvider(),
  figma: new MockProvider('figma'),
  chatgpt: new MockProvider('chatgpt'),
  gemini: new MockProvider('gemini'),
};

/**
 * Build integration config from environment variables.
 * In production, tokens come from the DB (decrypted); env vars are the
 * local-dev / CI fallback.
 */
export function configFromEnv(): IntegrationConfig {
  return {
    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,
    jiraHost: process.env.JIRA_HOST,
    jiraEmail: process.env.JIRA_EMAIL,
    jiraApiToken: process.env.JIRA_API_TOKEN,
    jiraProjectKey: process.env.JIRA_PROJECT_KEY,
    claudeApiKey: process.env.CLAUDE_API_KEY,
    targetRepoUrl: process.env.TARGET_REPO_URL,
    targetRepoBranch: process.env.TARGET_REPO_BRANCH || 'main',
    autoMerge: process.env.AUTO_MERGE === 'true',
  };
}

/**
 * Send a task to the given target provider.
 * Falls back to MockProvider if the real provider is not configured.
 */
export async function dispatchTask(
  task: SendTaskInput,
  config: IntegrationConfig
): Promise<SendTaskResult> {
  const provider = PROVIDERS[task.target] ?? new MockProvider(task.target);

  if (provider.isConfigured(config)) {
    return provider.sendTask(task, config);
  }

  console.warn(`[integrations] ${task.target} not configured — using mock`);
  return new MockProvider(task.target).sendTask(task, config);
}
