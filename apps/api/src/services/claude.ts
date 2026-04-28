/**
 * Claude API Service
 * Handles communication with Claude for feedback generation
 * Uses Anthropic API directly for Railway deployment
 */

import Anthropic from '@anthropic-ai/sdk';

export interface CaptureContext {
  title: string;
  notes?: string;
  boxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    notes: Array<{ text: string }>;
  }>;
  repoUrl?: string;
  repoName?: string;
  repoBranch?: string;
}

export interface AgentFeedback {
  title: string;
  summary: string;
  next_steps: string[];
}

/**
 * Call Claude to generate feedback on a capture/annotation
 * @param context The capture context (screenshot, annotations, repo info)
 * @param sessionId For logging purposes
 */
export async function generateClaudeFeedback(
  context: CaptureContext,
  sessionId: string
): Promise<AgentFeedback> {
  try {
    console.log(`[claude] Generating feedback for session ${sessionId}`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    const client = new Anthropic({ apiKey });

    // Build the context string from capture data
    const boxDescriptions = context.boxes
      .map(
        (box, idx) =>
          `Box ${idx + 1} (coords: ${Math.round(box.x)},${Math.round(box.y)} size: ${Math.round(box.width)}×${Math.round(box.height)}): ${
            box.notes.map((n) => n.text).join('; ') || '(no notes)'
          }`
      )
      .join('\n');

    const systemPrompt = `You are a code review assistant helping developers fix bugs and improve their software.
You will receive:
1. A screenshot annotation session (title, notes, highlighted areas)
2. Repo context (if available)

Your job is to:
1. Analyze the issue described in the annotations
2. Identify the likely root cause
3. Suggest a specific fix with code examples
4. Outline next steps

Be concise and actionable. Focus on the specific issue, not general advice.`;

    const userMessage = `
Title: ${context.title}
${context.notes ? `Notes: ${context.notes}` : ''}

${context.boxes.length > 0 ? `Annotated areas:\n${boxDescriptions}` : 'No specific areas highlighted.'}

${context.repoName ? `Repository: ${context.repoName}${context.repoBranch ? ` (branch: ${context.repoBranch})` : ''}` : 'Repository context not available.'}

Please analyze this issue and provide:
1. A title summarizing the problem
2. A brief summary of the root cause
3. 2-3 concrete next steps to fix it`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log(`[claude] Generated ${text.length} characters of feedback for ${sessionId}`);

    // Parse the response into structured feedback
    const feedback = parseClaudeResponse(text, context.title);
    return feedback;
  } catch (error) {
    console.error(`[claude] Error generating feedback for session ${sessionId}:`, error);

    // Fallback: return a default response
    return {
      title: 'Unable to analyze',
      summary: `Sorry, I couldn't process this feedback right now. Please try again in a moment. Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      next_steps: ['Check your network connection', 'Verify your ANTHROPIC_API_KEY is configured', 'Try sending the session again'],
    };
  }
}

/**
 * Parse Claude's response into structured feedback
 * Attempts to extract title, summary, and next steps
 */
function parseClaudeResponse(text: string, defaultTitle: string): AgentFeedback {
  // Try to extract sections by looking for numbered items or headers
  const lines = text.split('\n').filter((l) => l.trim());

  // Simple heuristic: first sentence/line is the summary
  let title = defaultTitle;
  let summary = '';
  let nextSteps: string[] = [];

  // Look for "next steps" or numbered list
  const nextStepsMatch = text.match(/next\s+steps?:|suggested\s+fixes?:|action\s+items?:/i);
  const summaryText = nextStepsMatch ? text.substring(0, nextStepsMatch.index) : text;

  // Extract first sentence as title (if we can)
  const titleMatch = summaryText.match(/^[^.!?]+[.!?]/);
  if (titleMatch) {
    title = titleMatch[0].replace(/^[0-9.)\-\s]*/, '').trim();
  }

  // Use rest as summary
  summary = summaryText
    .split('\n')
    .slice(1) // Skip the first sentence we used as title
    .join('\n')
    .trim();

  // Extract next steps (look for numbered items or bullets)
  const stepsMatch = text.match(/(?:next\s+steps?:|action\s+items?:|suggested\s+fixes?:)([\s\S]*?)(?=$|\n\n)/i);
  if (stepsMatch) {
    const stepsText = stepsMatch[1];
    nextSteps = stepsText
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.replace(/^[\d.)\-*]\s*/, '').trim())
      .filter((l) => l.length > 0)
      .slice(0, 3); // Max 3 steps
  }

  // Fallback
  if (nextSteps.length === 0) {
    nextSteps = ['Review the suggested changes', 'Test the fix locally', 'Create a pull request'];
  }

  return {
    title: title || defaultTitle,
    summary: summary || text,
    next_steps: nextSteps,
  };
}

/**
 * Call Claude to generate feedback (Codex variant)
 * Same as Claude but with slightly different system prompt for code agents
 */
export async function generateCodexFeedback(
  context: CaptureContext,
  sessionId: string
): Promise<AgentFeedback> {
  try {
    console.log(`[codex] Generating feedback for session ${sessionId}`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    const client = new Anthropic({ apiKey });

    // Build the context string from capture data
    const boxDescriptions = context.boxes
      .map(
        (box, idx) =>
          `Box ${idx + 1} (coords: ${Math.round(box.x)},${Math.round(box.y)} size: ${Math.round(box.width)}×${Math.round(box.height)}): ${
            box.notes.map((n) => n.text).join('; ') || '(no notes)'
          }`
      )
      .join('\n');

    const systemPrompt = `You are an expert code agent assistant (Codex-like) helping developers implement fixes.
You will receive:
1. A screenshot annotation session (title, notes, highlighted areas)
2. Repo context (if available)

Your job is to:
1. Analyze the code issue described
2. Provide a concrete code fix with examples
3. Suggest implementation approach
4. List specific files to modify

Be technical and code-focused. Provide actionable diffs or pseudocode.`;

    const userMessage = `
Title: ${context.title}
${context.notes ? `Notes: ${context.notes}` : ''}

${context.boxes.length > 0 ? `Annotated areas:\n${boxDescriptions}` : 'No specific areas highlighted.'}

${context.repoName ? `Repository: ${context.repoName}${context.repoBranch ? ` (branch: ${context.repoBranch})` : ''}` : 'Repository context not available.'}

As a code agent, please:
1. Identify the exact code location causing this issue
2. Provide a concrete fix (show the before/after code)
3. List any dependencies or tests you'd need to update
4. Suggest validation steps`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log(`[codex] Generated ${text.length} characters of feedback for ${sessionId}`);

    // Parse the response into structured feedback
    const feedback = parseClaudeResponse(text, context.title);
    return feedback;
  } catch (error) {
    console.error(`[codex] Error generating feedback for session ${sessionId}:`, error);

    // Fallback: return a default response
    return {
      title: 'Unable to analyze',
      summary: `Sorry, I couldn't process this feedback right now. Please try again in a moment. Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      next_steps: [
        'Check that your ANTHROPIC_API_KEY is set',
        'Verify the API key has access to claude-3-5-sonnet',
        'Try sending the session again',
      ],
    };
  }
}
