import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create demo organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-organization' },
    update: {
      defaultVisibility: 'private',
      allowPublicSharing: true,
      requirePublicApproval: true,
      allowPersonalProviderKeys: true,
      allowOrgProviderKeys: false,
      requireRedactionConfirmation: true,
    },
    create: {
      name: 'Demo Organization',
      slug: 'demo-organization',
      defaultVisibility: 'private',
      allowPublicSharing: true,
      requirePublicApproval: true,
      allowPersonalProviderKeys: true,
      allowOrgProviderKeys: false,
      requireRedactionConfirmation: true,
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
    update: {
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
    create: {
      id: 'user_demo',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'owner',
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
  });

  console.log(`✓ User: ${user.id}`);

  const membership = await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: 'owner', status: 'active' },
    create: {
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
      status: 'active',
    },
  });

  console.log(`✓ Membership: ${membership.id}`);

  const teammate = await prisma.user.upsert({
    where: { email: 'reviewer@example.com' },
    update: { name: 'Reviewer Teammate', authProvider: 'google' },
    create: {
      email: 'reviewer@example.com',
      name: 'Reviewer Teammate',
      role: 'reviewer',
      authProvider: 'google',
    },
  });

  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: teammate.id } },
    update: { role: 'reviewer', status: 'active' },
    create: {
      organizationId: org.id,
      userId: teammate.id,
      role: 'reviewer',
      status: 'active',
    },
  });

  const reviewSession = await prisma.feedbackSession.upsert({
    where: { id: 'session_phase2_demo' },
    update: {
      title: 'Twitter-style onboarding polish',
      visibility: 'org',
      submissionFlow: 'internal_review',
      reviewStatus: 'collecting_feedback',
      about: 'Make the onboarding and submit flow match the Dbugr design system before AI handoff.',
      projectFolder: '/Users/kumar/debugr',
      githubRepo: 'kuma0177/debgr_ai',
    },
    create: {
      id: 'session_phase2_demo',
      projectId: project.id,
      createdBy: user.id,
      title: 'Twitter-style onboarding polish',
      visibility: 'org',
      submissionFlow: 'internal_review',
      reviewStatus: 'collecting_feedback',
      about: 'Make the onboarding and submit flow match the Dbugr design system before AI handoff.',
      projectFolder: '/Users/kumar/debugr',
      githubRepo: 'kuma0177/debgr_ai',
      status: 'draft',
    },
  });

  await prisma.feedbackComment.upsert({
    where: { id: 'comment_phase2_demo_accept' },
    update: {
      body: 'Primary CTAs should stay #0086fc and use softer 500 weight.',
      contributionType: 'suggested_edit',
      sourceScope: 'team',
      visibility: 'org',
    },
    create: {
      id: 'comment_phase2_demo_accept',
      feedbackSessionId: reviewSession.id,
      authorId: teammate.id,
      body: 'Primary CTAs should stay #0086fc and use softer 500 weight.',
      contributionType: 'suggested_edit',
      sourceScope: 'team',
      visibility: 'org',
    },
  });

  console.log(`✓ Phase 2 demo session: ${reviewSession.id}`);

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
