import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create demo organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo',
    },
  });

  console.log(`✓ Organization: ${org.id}`);

  // Create demo project
  const project = await prisma.project.upsert({
    where: { id: 'proj_demo' },
    update: {},
    create: {
      id: 'proj_demo',
      organizationId: org.id,
      name: 'Demo Project',
      slug: 'demo-project',
    },
  });

  console.log(`✓ Project: ${project.id}`);

  // Create demo user
  const user = await prisma.user.upsert({
    where: { id: 'user_demo' },
    update: {},
    create: {
      id: 'user_demo',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'owner',
    },
  });

  console.log(`✓ User: ${user.id}`);

  console.log('\n✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
