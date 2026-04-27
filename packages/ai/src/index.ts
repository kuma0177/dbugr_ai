import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = 'claude-sonnet-4-5';

async function callModel(prompt: string): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not set');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type');
  return block.text.trim();
}

function extractJson(raw: string): unknown {
  const match = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const jsonStr = match ? match[1] : raw;
  return JSON.parse(jsonStr);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptCleanupInput {
  rawTranscript: string;
  cursorEvents?: Array<{ timestampMs: number; x: number; y: number; type: string }>;
  frameDescriptions?: Array<{ timestampMs: number; description: string }>;
}

export interface TranscriptCleanupResult {
  clean_transcript: string;
  key_moments: Array<{
    timestamp_ms: number;
    summary: string;
    mentioned_ui: string;
    cursor_reference: string;
  }>;
  user_intent: 'bug' | 'feature_request' | 'copy_feedback' | 'design_feedback' | 'ux_feedback' | 'general';
  uncertainties: string[];
}

export interface FeedbackSummarizationInput {
  transcript: string;
  frames?: Array<{ timestampMs: number; description?: string; cursorX: number; cursorY: number }>;
  comments?: Array<{ body: string }>;
}

export interface FeedbackSummarizationResult {
  title: string;
  summary: string;
  problem_statement: string;
  evidence: Array<{
    timestamp_ms: number;
    description: string;
    cursor: { x: number; y: number };
    frame_id: string;
  }>;
  recommended_action: string;
  acceptance_criteria: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'bug' | 'feature' | 'design' | 'copy' | 'ux' | 'performance' | 'other';
  agent_task: {
    title: string;
    description: string;
    implementation_notes: string;
    files_or_areas_to_inspect: string[];
  };
}

export interface CommunityAggregationInput {
  comments: Array<{ body: string; votesCount: number }>;
}

export interface CommunityAggregationResult {
  themes: Array<{
    theme: string;
    support_count: number;
    representative_comments: string[];
  }>;
  duplicates: string[];
  contradictions: string[];
  recommended_task: {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    target: string;
  };
}

// ---------------------------------------------------------------------------
// Transcript cleanup
// ---------------------------------------------------------------------------

export async function cleanTranscript(
  input: TranscriptCleanupInput
): Promise<TranscriptCleanupResult | null> {
  const prompt = `You are cleaning up a voice transcript from a user giving product feedback while recording their screen.

Return JSON only (no markdown, no explanation):

{
  "clean_transcript": "",
  "key_moments": [
    { "timestamp_ms": 0, "summary": "", "mentioned_ui": "", "cursor_reference": "" }
  ],
  "user_intent": "bug | feature_request | copy_feedback | design_feedback | ux_feedback | general",
  "uncertainties": []
}

Input:
- Raw transcript: ${input.rawTranscript}
- Cursor events: ${JSON.stringify(input.cursorEvents ?? [])}
- Frame descriptions: ${JSON.stringify(input.frameDescriptions ?? [])}`;

  try {
    const raw = await callModel(prompt);
    return extractJson(raw) as TranscriptCleanupResult;
  } catch (err) {
    console.error('[ai] cleanTranscript failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feedback summarization → summary + task brief
// ---------------------------------------------------------------------------

export async function summarizeFeedback(
  input: FeedbackSummarizationInput
): Promise<FeedbackSummarizationResult | null> {
  const prompt = `You are converting screen-recorded user feedback into a structured product improvement brief.

Return JSON only (no markdown, no explanation):

{
  "title": "",
  "summary": "",
  "problem_statement": "",
  "evidence": [
    { "timestamp_ms": 0, "description": "", "cursor": { "x": 0, "y": 0 }, "frame_id": "" }
  ],
  "recommended_action": "",
  "acceptance_criteria": [""],
  "severity": "low | medium | high | critical",
  "category": "bug | feature | design | copy | ux | performance | other",
  "agent_task": {
    "title": "",
    "description": "",
    "implementation_notes": "",
    "files_or_areas_to_inspect": []
  }
}

Input:
- Transcript: ${input.transcript}
- Frames: ${JSON.stringify(input.frames ?? [])}
- Comments: ${JSON.stringify(input.comments ?? [])}`;

  try {
    const raw = await callModel(prompt);
    return extractJson(raw) as FeedbackSummarizationResult;
  } catch (err) {
    console.error('[ai] summarizeFeedback failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Community feedback aggregation
// ---------------------------------------------------------------------------

export async function aggregateCommunityFeedback(
  input: CommunityAggregationInput
): Promise<CommunityAggregationResult | null> {
  const prompt = `You are analyzing a public feedback thread attached to an AI/product output.

Return JSON only (no markdown, no explanation):

{
  "themes": [
    { "theme": "", "support_count": 0, "representative_comments": [] }
  ],
  "duplicates": [],
  "contradictions": [],
  "recommended_task": {
    "title": "",
    "description": "",
    "priority": "low | medium | high",
    "target": "jira | github | codex | claude | figma"
  }
}

Input comments:
${JSON.stringify(input.comments)}`;

  try {
    const raw = await callModel(prompt);
    return extractJson(raw) as CommunityAggregationResult;
  } catch (err) {
    console.error('[ai] aggregateCommunityFeedback failed:', err);
    return null;
  }
}
