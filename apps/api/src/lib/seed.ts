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
    await prisma.submission.deleteMany({});
    await prisma.desktopLink.deleteMany({});
    await prisma.aIReviewSummary.deleteMany({});
    await prisma.curationDecision.deleteMany({});
    await prisma.feedbackVote.deleteMany({});
    await prisma.feedbackComment.deleteMany({});
    await prisma.feedbackFrame.deleteMany({});
    await prisma.improvementTask.deleteMany({});
    await prisma.feedbackSession.deleteMany({});
    await prisma.providerCredential.deleteMany({});
    await prisma.invite.deleteMany({});
    await prisma.organizationMembership.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.integration.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.user.deleteMany({});

    const org = await prisma.organization.create({
      data: {
        id: 'org_demo',
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

    const user = await prisma.user.create({
      data: {
        id: 'user_demo',
        email: 'demo@example.com',
        name: 'Demo User',
        role: 'owner',
        authProvider: 'google',
        lastSeenAt: new Date(),
      },
    });

    const teammate = await prisma.user.create({
      data: {
        id: 'user_reviewer_demo',
        email: 'reviewer@example.com',
        name: 'Reviewer Teammate',
        role: 'reviewer',
        authProvider: 'google',
      },
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

    const team = await prisma.team.create({
      data: {
        id: 'team_product_demo',
        organizationId: org.id,
        name: 'Product',
        slug: 'product',
      },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: org.id,
        teamId: team.id,
        userId: user.id,
        role: 'owner',
        status: 'active',
      },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: org.id,
        teamId: team.id,
        userId: teammate.id,
        role: 'reviewer',
        status: 'active',
      },
    });

    const reviewSession = await prisma.feedbackSession.create({
      data: {
        id: 'session_phase2_demo',
        projectId: project.id,
        createdBy: user.id,
        teamId: team.id,
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

    await prisma.feedbackFrame.create({
      data: {
        id: 'frame_phase2_demo',
        feedbackSessionId: reviewSession.id,
        timestampMs: 0,
        imageUrl: '/demo/phase2-onboarding.png',
        cursorX: 320,
        cursorY: 180,
        description: 'Phase 2 social review demo capture placeholder.',
      },
    });

    await prisma.feedbackComment.create({
      data: {
        id: 'comment_phase2_demo_accept',
        feedbackSessionId: reviewSession.id,
        authorId: teammate.id,
        body: 'Primary CTAs should stay #0086fc and use softer 500 weight.',
        contributionType: 'suggested_edit',
        sourceScope: 'team',
        visibility: 'org',
      },
    });

    console.log('Seeded:', {
      org: org.id,
      team: team.id,
      user: user.id,
      teammate: teammate.id,
      project: project.id,
      reviewSession: reviewSession.id,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
