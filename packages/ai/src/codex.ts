import Anthropic from '@anthropic-ai/sdk';

/**
 * Takes a feedback summary and generates:
 * 1. Implementation plan (what to change, why, risks)
 * 2. Code changes (actual diffs/patches)
 *
 * Returns structured output for PR creation.
 */

export interface CodeGenInput {
  feedbackSummary: string;
  problemStatement: string;
  acceptanceCriteria: string[];
  repoUrl: string;
  repoName: string;
  recentContext?: string; // Recent commits, file structure, etc.
}

export interface CodeChange {
  filePath: string;
  before: string;
  after: string;
  description: string;
}

export interface CodeGenResult {
  title: string;
  implementationPlan: string;
  reasoning: string;
  risks: string[];
  changes: CodeChange[];
  testingStrategy: string;
  deploymentNotes: string;
}

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = 'claude-sonnet-4-5';

async function generateCode(input: CodeGenInput): Promise<CodeGenResult | null> {
  const client = getClient();
  if (!client) {
    console.warn('[codex] ANTHROPIC_API_KEY not set');
    return null;
  }

  const prompt = `You are a senior software engineer tasked with implementing a code improvement based on user feedback.

Your job:
1. Analyze the feedback and requirements
2. Generate a clear implementation plan
3. Create actual code changes (as diffs/patches)
4. Explain testing and deployment strategy

Repo: ${input.repoUrl} (${input.repoName})

## Feedback
${input.feedbackSummary}

## Problem Statement
${input.problemStatement}

## Acceptance Criteria
${input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Recent Repo Context
${input.recentContext || '(No context provided)'}

---

Respond in JSON format (no markdown, no explanation, just valid JSON):

{
  "title": "Brief title of the change (as it would appear in commit message)",
  "implementationPlan": "Detailed step-by-step plan of what needs to change and why",
  "reasoning": "Technical reasoning behind the approach",
  "risks": [
    "Potential risk 1",
    "Potential risk 2"
  ],
  "changes": [
    {
      "filePath": "src/components/SearchResults.tsx",
      "description": "What changed in this file",
      "before": "// Original code snippet (relevant section)\n...",
      "after": "// New code snippet (relevant section)\n..."
    }
  ],
  "testingStrategy": "How to test these changes",
  "deploymentNotes": "Any special deployment instructions"
}`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type');

    const jsonStr = block.text.trim();
    const result = JSON.parse(jsonStr) as CodeGenResult;
    return result;
  } catch (err) {
    console.error('[codex] Code generation failed:', err);
    return null;
  }
}

export async function generateCodeForFeedback(
  input: CodeGenInput
): Promise<CodeGenResult | null> {
  return generateCode(input);
}
