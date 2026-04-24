/**
 * Seeds the database with a default org, project, and user for local development.
 * Run once via: ts-node src/lib/seed.ts
 */
import { prisma } from '@feedbackagent/db';

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: { name: 'Demo Org', slug: 'demo-org' },
  });

  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: { email: 'demo@example.com', name: 'Demo User', role: 'admin' },
  });

  const project = await prisma.project.upsert({
    where: { id: 'proj_demo' },
    update: {},
    create: {
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
