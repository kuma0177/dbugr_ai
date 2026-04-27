import type { IntegrationConfig, IntegrationProvider, SendTaskInput, SendTaskResult } from '../types';

export class MockProvider implements IntegrationProvider {
  constructor(public provider: string) {}

  isConfigured(_config: IntegrationConfig): boolean {
    return true; // mock always available as fallback
  }

  async sendTask(task: SendTaskInput, _config: IntegrationConfig): Promise<SendTaskResult> {
    // Simulate a short network delay
    await new Promise((r) => setTimeout(r, 200));
    const id = `MOCK-${Date.now()}`;
    return {
      externalId: id,
      externalUrl: `https://mock-${task.target}.example.com/issues/${id}`,
      provider: this.provider,
    };
  }
}
