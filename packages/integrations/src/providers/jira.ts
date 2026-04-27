import type { IntegrationConfig, IntegrationProvider, SendTaskInput, SendTaskResult } from '../types';

export class JiraProvider implements IntegrationProvider {
  provider = 'jira';

  isConfigured(config: IntegrationConfig): boolean {
    return !!(config.jiraHost && config.jiraEmail && config.jiraApiToken && config.jiraProjectKey);
  }

  async sendTask(task: SendTaskInput, config: IntegrationConfig): Promise<SendTaskResult> {
    const { jiraHost, jiraEmail, jiraApiToken, jiraProjectKey } = config;
    if (!jiraHost || !jiraEmail || !jiraApiToken || !jiraProjectKey) {
      throw new Error('Jira integration not configured. Set JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY.');
    }

    const credentials = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
    const description = [
      task.description,
      '',
      `FeedbackAgent session: ${task.sessionTitle ?? task.sessionId}`,
      `Session ID: ${task.sessionId}`,
    ].join('\n');

    const res = await fetch(`https://${jiraHost}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          project: { key: jiraProjectKey },
          summary: task.title,
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: description }],
              },
            ],
          },
          issuetype: { name: 'Bug' },
          labels: ['feedbackagent'],
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { id: string; key: string; self: string };
    return {
      externalId: data.key,
      externalUrl: `https://${jiraHost}/browse/${data.key}`,
      provider: 'jira',
    };
  }
}
