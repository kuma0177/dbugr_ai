import { Router, Request, Response } from 'express';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const systemRouter = Router();

type AgentTarget = 'claude' | 'codex' | 'cursor';

const smokeLogEntries: Array<{
  timestamp: string;
  stage: string;
  sessionId: string | null;
  title: string | null;
  target: string | null;
  url: string | null;
  details: unknown;
}> = [];

interface ChromeTab {
  title: string;
  url: string;
}

function getRepoContext() {
  const repoUrl = process.env.TARGET_REPO_URL?.trim()
    || (process.env.GITHUB_OWNER && process.env.GITHUB_REPO
      ? `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
      : '');
  const repoBranch = process.env.TARGET_REPO_BRANCH?.trim() || 'main';
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  const repoName = match ? `${match[1]}/${match[2].replace(/\.git$/, '')}` : '';
  return { repoUrl, repoName, repoBranch };
}

function getRepoRoot() {
  return process.env.DEBUGR_REPO_ROOT?.trim() || path.resolve(__dirname, '../../../../');
}

function getApiBaseUrl() {
  return process.env.DEBUGR_API_URL?.trim() || 'http://127.0.0.1:3001/api';
}

function parseTarget(value: unknown): AgentTarget {
  return value === 'codex' || value === 'cursor' ? value : 'claude';
}

function agentLabel(target: AgentTarget) {
  if (target === 'codex') return 'Codex';
  if (target === 'cursor') return 'Cursor';
  return 'Claude Code';
}

systemRouter.get('/system/bridge-setup', (req: Request, res: Response) => {
  const target = parseTarget(req.query.target);
  const repoRoot = getRepoRoot();
  const apiBaseUrl = getApiBaseUrl();

  return res.json({
    data: {
      target,
      repoRoot,
      commands: {
        mcp: {
          label: 'MCP server',
          cwd: `${repoRoot}/apps/mcp-server`,
          command: 'pnpm dev',
          description:
            'Launches the local stdio MCP server so Claude Desktop or Codex can point at Debugr context.',
        },
        script: {
          label: 'Background script',
          cwd: `${repoRoot}/apps/desktop`,
          command: `node scripts/background-bridge.mjs --target ${target} --api ${apiBaseUrl}`,
          description:
            'Starts the local relay that watches Debugr and can hand the command to your CLI session.',
        },
      },
    },
  });
});

async function readChromeTabs(): Promise<ChromeTab[]> {
  const scriptLines = [
    'tell application id "com.google.Chrome"',
    'set tabOutput to ""',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'set tabOutput to tabOutput & (title of t as text) & "|||" & (URL of t as text) & linefeed',
    'end repeat',
    'end repeat',
    'return tabOutput',
    'end tell',
  ];

  const { stdout, stderr } = await execFileAsync('osascript', scriptLines.flatMap((line) => ['-e', line]));

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, url] = line.split('|||');
      return {
        title: title?.trim() || 'Untitled tab',
        url: url?.trim() || '',
      };
    })
    .filter((tab) => tab.url.startsWith('http://') || tab.url.startsWith('https://'));
}

systemRouter.get('/system/chrome-tabs', async (_req: Request, res: Response) => {
  try {
    const tabs = await readChromeTabs();
    if (tabs.length === 0) {
      return res.status(503).json({
        error:
          'Chrome tab access returned no pages. If Chrome is open, macOS may be blocking local tab inspection for this app. Paste a URL instead or keep going and capture another app or browser window from the native screen picker.',
      });
    }
    return res.json({ data: tabs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: `Could not read Chrome tabs. Make sure Google Chrome is running and that local automation access is allowed. Details: ${message}`,
    });
  }
});

systemRouter.get('/system/handoff-context', (req: Request, res: Response) => {
  const target = parseTarget(req.query.target);
  const label = agentLabel(target);
  const { repoUrl, repoName, repoBranch } = getRepoContext();

  return res.json({
    data: {
      target,
      agentLabel: label,
      agentSessionLabel: `Current ${label} work session`,
      repoUrl: repoUrl || null,
      repoName: repoName || null,
      repoBranch,
      ready: Boolean(repoUrl),
      warning: repoUrl
        ? null
        : 'No linked GitHub repo is configured for this target yet. Set TARGET_REPO_URL or GITHUB_OWNER/GITHUB_REPO before sending feedback.',
    },
  });
});

systemRouter.post('/system/smoke-log', (req: Request, res: Response) => {
  const stage = typeof req.body?.stage === 'string' ? req.body.stage : 'unknown';
  const entry = {
    timestamp: new Date().toISOString(),
    stage,
    sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : null,
    title: typeof req.body?.title === 'string' ? req.body.title : null,
    target: typeof req.body?.target === 'string' ? req.body.target : null,
    url: typeof req.body?.url === 'string' ? req.body.url : null,
    details: req.body?.details ?? null,
  };

  smokeLogEntries.unshift(entry);
  smokeLogEntries.splice(100);
  console.log('[system] smoke log:', JSON.stringify(entry));
  return res.status(201).json({ data: entry });
});

systemRouter.get('/system/smoke-log', (_req: Request, res: Response) => {
  return res.json({ data: smokeLogEntries });
});
