import fs from 'node:fs';
import path from 'node:path';

export function loadLocalEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim().replace(/^"(.*)"$/, '$1');
      if (key === 'DATABASE_URL' && rawValue.startsWith('file:')) {
        const filePath = rawValue.slice('file:'.length);
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(path.dirname(envPath), filePath);
        process.env[key] = `file:${absolutePath}`;
      } else if (!process.env[key]) {
        process.env[key] = rawValue;
      }
    }

    return;
  }
}

loadLocalEnv();
