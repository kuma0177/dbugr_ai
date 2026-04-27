/**
 * Seeds the database with a default org, project, and user for local development.
 * Run once via: ts-node src/lib/seed.ts
 */
import { prisma } from '@feedbackagent/db';

async function main() {
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
}

main().catch(console.error).finally(() => prisma.$disconnect());
