import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const dbPackageDir = path.join(repoRoot, 'packages', 'db');
const dbEnvPath = path.join(dbPackageDir, '.env');

function readDatabaseUrlFromEnvFile() {
  if (!fs.existsSync(dbEnvPath)) return null;
  const raw = fs.readFileSync(dbEnvPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (key !== 'DATABASE_URL') continue;
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"(.*)"$/, '$1');
    return value;
  }
  return null;
}

function resolveDatabaseUrl() {
  const explicitDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (explicitDatabaseUrl?.startsWith('file:')) return explicitDatabaseUrl;

  const envFileUrl = readDatabaseUrlFromEnvFile();
  if (!envFileUrl) return null;

  if (envFileUrl.startsWith('file:')) {
    const filePath = envFileUrl.slice('file:'.length);
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(dbPackageDir, filePath);
    return `file:${absolutePath}`;
  }

  return envFileUrl;
}

const databaseUrl = resolveDatabaseUrl();

if (!databaseUrl) {
  console.error('[railway-db-prepare] Missing DATABASE_URL and no fallback found in packages/db/.env');
  process.exit(1);
}

const result = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'db', 'push', '--schema', 'packages/db/prisma/schema.prisma'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
