#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);

function readArg(flag, fallback = '') {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const target = readArg('--target', 'claude');
const apiBase = readArg('--api', 'http://127.0.0.1:3001/api');

function now() {
  return new Date().toLocaleTimeString();
}

async function readJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  console.log(`[debugr bridge ${now()}] Background relay started for ${target}`);
  console.log(`[debugr bridge ${now()}] Watching ${apiBase}/system/handoff-context?target=${target}`);

  let lastReady = false;

  while (true) {
    try {
      const json = await readJson(`${apiBase}/system/handoff-context?target=${encodeURIComponent(target)}`);
      const data = json?.data ?? {};
      const ready = Boolean(data.ready);
      if (ready !== lastReady) {
        lastReady = ready;
        console.log(
          `[debugr bridge ${now()}] ${ready ? 'Repo context is ready' : 'Waiting for repo context'}${data.repoName ? ` for ${data.repoName}` : ''}`
        );
      }
      if (data.warning && !ready) {
        console.log(`[debugr bridge ${now()}] ${data.warning}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[debugr bridge ${now()}] Waiting for API: ${message}`);
    }

    await sleep(3000);
  }
}

main().catch((error) => {
  console.error('[debugr bridge] fatal:', error);
  process.exit(1);
});
