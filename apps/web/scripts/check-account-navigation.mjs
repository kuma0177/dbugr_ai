import { readFile } from 'node:fs/promises';
import path from 'node:path';

const webDir = path.resolve(new URL('..', import.meta.url).pathname);

async function assertFileContains(relativePath, expectations) {
  const fullPath = path.join(webDir, relativePath);
  const source = await readFile(fullPath, 'utf8');
  for (const expectation of expectations) {
    if (!source.includes(expectation)) {
      throw new Error(`${relativePath} is missing expected account navigation marker: ${expectation}`);
    }
  }
}

await assertFileContains('src/app/nav-shell.tsx', [
  'href="/profile"',
  '<LogoutButton',
]);

await assertFileContains('src/app/feed/page.tsx', [
  'href="/profile"',
  'review-nav-button',
]);

await assertFileContains('src/app/public/page.tsx', [
  'href="/profile"',
  '<LogoutButton',
]);

await assertFileContains('src/app/profile/page.tsx', [
  'api.phase2.bootstrap',
  'api.phase2.adminOverview',
  'api.phase2.deleteAccount',
  'Delete account',
]);

await assertFileContains('src/lib/api.ts', [
  "deleteAccount: () => apiFetch",
  "'/phase2/account'",
]);

console.log('Account navigation regression check passed.');
