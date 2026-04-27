import { Router, Request, Response } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const systemRouter = Router();

interface ChromeTab {
  title: string;
  url: string;
}

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
          'Chrome tab access returned no pages. If Chrome is open, macOS may be blocking local tab inspection for this app. Paste a URL instead or use the overlay launcher directly from the target page.',
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
