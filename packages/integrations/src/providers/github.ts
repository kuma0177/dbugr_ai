import type { IntegrationConfig, IntegrationProvider, SendTaskInput, SendTaskResult } from '../types';

export class GitHubProvider implements IntegrationProvider {
  provider = 'github';

  isConfigured(config: IntegrationConfig): boolean {
    return !!(config.githubToken && config.githubOwner && config.githubRepo);
  }

  async sendTask(task: SendTaskInput, config: IntegrationConfig): Promise<SendTaskResult> {
    const { githubToken, githubOwner, githubRepo } = config;
    if (!githubToken || !githubOwner || !githubRepo) {
      throw new Error('GitHub integration not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.');
    }

    const body = [
      task.description,
      '',
      '---',
      `**FeedbackAgent session:** ${task.sessionTitle ?? task.sessionId}`,
      `**Session ID:** \`${task.sessionId}\``,
    ].join('\n');

    const res = await fetch(
      `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: task.title,
          body,
          labels: ['feedbackagent'],
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { number: number; html_url: string };
    return {
      externalId: String(data.number),
      externalUrl: data.html_url,
      provider: 'github',
    };
  }
}
