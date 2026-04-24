# Integration Plan

## Integration Categories

### 1. Builder Agents

- Codex
- Claude Code
- ChatGPT
- Gemini

Use for turning approved feedback tasks into implementation plans, code changes, PRs, or product answers.

### 2. Product/Design Tools

- Jira
- GitHub Issues
- Linear
- Figma

Use for issue creation, design comments, status tracking, and team workflows.

### 3. Community/Social Sources

- YouTube
- Twitch
- Instagram
- X/Twitter

Use for collecting comments, chat, replies, and public feedback.

## MVP Integration Order

1. Mock providers
2. GitHub Issues
3. Jira
4. Figma comments
5. Codex via MCP/SDK-compatible task handoff
6. Claude Code via MCP
7. YouTube comments
8. Twitch chat/events
9. Instagram/X after API access review

## Provider Interface

Every integration provider should implement:

```ts
interface IntegrationProvider {
  provider: string;
  validateConfig(config: unknown): Promise<boolean>;
  sendTask(task: ImprovementTask): Promise<IntegrationSendResult>;
  getStatus?(externalId: string): Promise<IntegrationStatus>;
}
```

## Routing Logic

A feedback item may route to:

- Jira only
- GitHub only
- Figma only
- Codex/Claude only
- Jira + Codex
- Figma + Jira
- GitHub + Claude

Human approval is required before routing.
