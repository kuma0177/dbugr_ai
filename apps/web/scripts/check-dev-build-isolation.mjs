import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const webDir = process.cwd();
const devPort = 3010;
const devDistDir = '.next-dev-regression';
const buildDistDir = '.next-build-regression';
const devUrl = `http://127.0.0.1:${devPort}`;
const nextEnvPath = path.join(webDir, 'next-env.d.ts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = 'no response yet';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url} to become healthy: ${lastError}`);
}

async function assertHealthy(url, label) {
  const response = await fetch(url, { redirect: 'manual' });
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status} instead of 200`);
  }
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: webDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function runBuild() {
  await new Promise((resolve, reject) => {
    const build = spawnLogged('pnpm', ['exec', 'next', 'build'], {
      env: {
        ...process.env,
        DEBUGR_NEXT_DIST_DIR: buildDistDir,
      },
    });

    build.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build exited with code ${code}`));
    });

    build.on('error', reject);
  });
}

async function main() {
  const originalNextEnv = await readFile(nextEnvPath, 'utf8').catch(() => null);

  await rm(path.join(webDir, devDistDir), { recursive: true, force: true });
  await rm(path.join(webDir, buildDistDir), { recursive: true, force: true });

  const devServer = spawnLogged('pnpm', ['exec', 'next', 'dev', '--turbopack', '-p', String(devPort)], {
    env: {
      ...process.env,
      DEBUGR_NEXT_DIST_DIR: devDistDir,
    },
  });

  try {
    await waitForHealthy(devUrl, 30_000);
    await assertHealthy(devUrl, 'Dev server before build');
    await runBuild();
    await assertHealthy(devUrl, 'Dev server after build');
    console.log(`Regression check passed: dev on ${devDistDir} stayed healthy while build wrote to ${buildDistDir}.`);
  } finally {
    devServer.kill('SIGTERM');
    await sleep(1000);
    if (!devServer.killed) {
      devServer.kill('SIGKILL');
    }
    if (originalNextEnv !== null) {
      await writeFile(nextEnvPath, originalNextEnv);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
