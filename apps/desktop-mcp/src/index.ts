/**
 * Debugr Desktop MCP Server
 *
 * A lightweight, zero-dependency (no DB) MCP server that reads Debugr desktop
 * annotation sessions from a local JSON file written by the Tauri app.
 *
 * File location: ~/Library/Application Support/debugr/sessions.json  (macOS)
 *                ~/.config/debugr/sessions.json                       (Linux)
 *                %APPDATA%\debugr\sessions.json                        (Windows)
 *
 * ── Claude Desktop config (~/.claude/claude_desktop_config.json) ──────────────
 *
 *   {
 *     "mcpServers": {
 *       "debugr": {
 *         "command": "node",
 *         "args": ["/path/to/debugr/apps/desktop-mcp/dist/index.js"]
 *       }
 *     }
 *   }
 *
 * ── Codex CLI config (~/.codex/config.yaml) ────────────────────────────────
 *
 *   mcpServers:
 *     debugr:
 *       command: node
 *       args:
 *         - /path/to/debugr/apps/desktop-mcp/dist/index.js
 *
 * Or if running from source with tsx (both clients):
 *   "command": "npx",
 *   "args": ["tsx", "/path/to/debugr/apps/desktop-mcp/src/index.ts"]
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Session file location ─────────────────────────────────────────────────────

function sessionsFilePath(): string {
  const override = process.env.DEBUGR_SESSIONS_FILE;
  if (override) return override;

  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'debugr', 'sessions.json');
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'debugr', 'sessions.json');
    default:
      return path.join(os.homedir(), '.config', 'debugr', 'sessions.json');
  }
}

// ── Types (mirroring the desktop app's localStorage schema) ──────────────────

interface Annotation {
  id: string;
  kind: 'region' | 'pin';
  note: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  screenshotUrl?: string;
}

interface DebugSession {
  id: string;
  title: string;
  about?: string;
  projectFolder?: string;
  githubRepo?: string;
  status: string;
  lastTarget?: string;
  createdAt: string;
  updatedAt?: string;
  annotations: Annotation[];
}

// ── File I/O helpers ──────────────────────────────────────────────────────────

function readSessions(): DebugSession[] {
  const filePath = sessionsFilePath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // Support both { sessions: [...] } wrapper and bare array
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.sessions)) return data.sessions;
    return [];
  } catch {
    return [];
  }
}

function sessionsFileInfo(): string {
  const p = sessionsFilePath();
  try {
    const stat = fs.statSync(p);
    return `${p} (last modified: ${stat.mtime.toISOString()})`;
  } catch {
    return `${p} (not found — open Debugr and save a session first)`;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_sessions',
    description:
      'List all Debugr annotation sessions saved on this machine. Returns id, title, status, project folder, and annotation count for each session.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Optional filter: only return sessions with this status (e.g. "active", "sent").',
        },
      },
    },
  },
  {
    name: 'get_session',
    description:
      'Get the full details of a single Debugr session, including all annotations with their notes and screenshot references.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The id of the session to retrieve.',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_pending_sessions',
    description:
      'Return all sessions that have annotations but have not yet been sent to Claude or Codex (status != "sent"). Useful for automatically picking up new work from Debugr.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'build_prompt',
    description:
      'Build a structured plain-text prompt from a Debugr session that is ready to paste into Claude or Codex. Includes the session title, description, project path, GitHub repo, and all annotation notes.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The id of the session to build a prompt for.',
        },
      },
      required: ['session_id'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleListSessions(args: { status?: string }) {
  const all = readSessions();
  const filtered = args.status
    ? all.filter((s) => s.status === args.status)
    : all;

  const summary = filtered.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    projectFolder: s.projectFolder ?? null,
    annotationCount: s.annotations?.length ?? 0,
    createdAt: s.createdAt,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            sessions: summary,
            total: summary.length,
            file: sessionsFileInfo(),
          },
          null,
          2
        ),
      },
    ],
  };
}

function handleGetSession(args: { session_id: string }) {
  const all = readSessions();
  const session = all.find((s) => s.id === args.session_id);
  if (!session) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Session '${args.session_id}' not found` }) }],
      isError: true,
    };
  }

  // Strip large base64 screenshot URLs from the JSON response to keep output manageable
  const cleaned = {
    ...session,
    annotations: session.annotations.map((a) => ({
      ...a,
      screenshotUrl: a.screenshotUrl
        ? `[base64 PNG — ${Math.round((a.screenshotUrl.length * 3) / 4 / 1024)} KB]`
        : null,
    })),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(cleaned, null, 2) }],
  };
}

function handleGetPendingSessions() {
  const all = readSessions();
  const pending = all.filter(
    (s) => s.status !== 'sent' && (s.annotations?.length ?? 0) > 0
  );

  const summary = pending.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    projectFolder: s.projectFolder ?? null,
    githubRepo: s.githubRepo ?? null,
    annotationCount: s.annotations?.length ?? 0,
    createdAt: s.createdAt,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ pending: summary, count: summary.length }, null, 2),
      },
    ],
  };
}

function handleBuildPrompt(args: { session_id: string }) {
  const all = readSessions();
  const session = all.find((s) => s.id === args.session_id);
  if (!session) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Session '${args.session_id}' not found` }) }],
      isError: true,
    };
  }

  const lines: string[] = [];
  lines.push(`# Debugr Session: ${session.title}`);
  lines.push('');
  if (session.about) {
    lines.push(`## Description`);
    lines.push(session.about);
    lines.push('');
  }
  if (session.projectFolder) {
    lines.push(`**Project folder:** ${session.projectFolder}`);
  }
  if (session.githubRepo) {
    lines.push(`**GitHub repo:** ${session.githubRepo}`);
  }
  lines.push('');
  lines.push(`## Annotations (${session.annotations?.length ?? 0})`);
  lines.push('');

  (session.annotations ?? []).forEach((ann, i) => {
    lines.push(`### ${i + 1}. ${ann.kind === 'region' ? 'Region' : 'Pin'}`);
    if (ann.kind === 'region' && ann.w != null) {
      lines.push(`*Area: x=${ann.x}, y=${ann.y}, w=${ann.w}, h=${ann.h}*`);
    } else if (ann.kind === 'pin') {
      lines.push(`*Location: x=${ann.x}, y=${ann.y}*`);
    }
    if (ann.note) {
      lines.push('');
      lines.push(ann.note);
    }
    if (ann.screenshotUrl) {
      lines.push('');
      lines.push('*(screenshot attached)*');
    }
    lines.push('');
  });

  lines.push('---');
  lines.push(
    'Please review the annotations above and make the described changes to the codebase.'
  );

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

// ── MCP server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'debugr-desktop', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'list_sessions':
      return handleListSessions(args as { status?: string });
    case 'get_session':
      return handleGetSession(args as { session_id: string });
    case 'get_pending_sessions':
      return handleGetPendingSessions();
    case 'build_prompt':
      return handleBuildPrompt(args as { session_id: string });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
