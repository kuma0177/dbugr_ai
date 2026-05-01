/**
 * Seeds the database with a default org, project, and user for local development.
 * Run with: pnpm --filter @feedbackagent/api seed
 */
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnv() {
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
      } else {
        process.env[key] = rawValue;
      }
    }

    return;
  }
}

async function main() {
  loadLocalEnv();
  const { prisma } = await import('@feedbackagent/db');

  try {
    // Wipe existing demo data in dependency order
    await prisma.auditLog.deleteMany({});
    await prisma.feedbackVote.deleteMany({});
    await prisma.feedbackComment.deleteMany({});
    await prisma.feedbackFrame.deleteMany({});
    await prisma.improvementTask.deleteMany({});
    await prisma.feedbackSession.deleteMany({});
    await prisma.integration.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.user.deleteMany({});

    const org = await prisma.organization.create({
      data: { id: 'org_demo', name: 'Demo Org', slug: 'demo-org' },
    });

    const user = await prisma.user.create({
      data: { id: 'user_demo', email: 'demo@example.com', name: 'Demo User', role: 'admin' },
    });

    const project = await prisma.project.create({
      data: {
        id: 'proj_demo',
        organizationId: org.id,
        name: 'Demo Project',
        slug: 'demo-project',
        visibilityDefault: 'private',
      },
    });

    console.log('Seeded:', { org: org.id, user: user.id, project: project.id });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
