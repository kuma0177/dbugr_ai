import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';
import crypto from 'node:crypto';
import { auditLog } from '../lib/audit';

export const phase2Router = Router();

const DEMO_USER_ID = 'user_demo';

function logPhase2(event: string, details: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString();
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !key.toLowerCase().includes('token')),
  );
  console.info(`[phase2] ${stamp} ${event}`, safeDetails);
}

async function demoContext() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: DEMO_USER_ID } });
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, status: 'active' },
    include: { organization: true, team: true },
  });
  if (!membership) {
    throw new Error('Demo user is missing an organization membership. Run pnpm db:setup.');
  }
  return { user, membership, organization: membership.organization };
}

const onboardingSchema = z.object({
  name: z.string().min(1),
  organizationName: z.string().min(1),
  role: z.string().optional(),
  teamName: z.string().optional(),
  inviteEmails: z.array(z.string().email()).default([]),
  defaultVisibility: z.enum(['private', 'org', 'public']).default('private'),
});

const feedScopeSchema = z.enum(['private', 'organization', 'public']).default('organization');

const contributionSchema = z.object({
  targetType: z.enum(['session', 'capture', 'annotation']).default('session'),
  targetId: z.string().optional(),
  contributionType: z.enum(['comment', 'suggested_edit', 'question', 'risk', 'requirement']).default('comment'),
  body: z.string().min(1),
  suggestedText: z.string().optional(),
  visibility: z.enum(['private', 'org', 'public']).default('org'),
});

const curationSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'edited', 'duplicate', 'needs_clarification']),
  editedText: z.string().optional(),
  reason: z.string().optional(),
});

const preflightSchema = z.object({
  providerTarget: z.enum(['claude', 'codex', 'cursor']).default('claude'),
});

phase2Router.get('/phase2/bootstrap', async (_req: Request, res: Response) => {
  const { user, membership, organization } = await demoContext();
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: organization.id },
    include: { user: true, team: true },
    orderBy: { createdAt: 'asc' },
  });
  const invites = await prisma.invite.findMany({
    where: { organizationId: organization.id, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  logPhase2('bootstrap.loaded', {
    userId: user.id,
    organizationId: organization.id,
    role: membership.role,
    memberCount: members.length,
    inviteCount: invites.length,
  });
  return res.json({
    data: {
      user,
      organization,
      membership,
      members,
      invites,
      policies: {
        defaultVisibility: organization.defaultVisibility,
        allowPublicSharing: organization.allowPublicSharing,
        requirePublicApproval: organization.requirePublicApproval,
        allowPersonalProviderKeys: organization.allowPersonalProviderKeys,
        allowOrgProviderKeys: organization.allowOrgProviderKeys,
        requireRedactionConfirmation: organization.requireRedactionConfirmation,
      },
    },
  });
});

phase2Router.post('/phase2/onboarding', async (req: Request, res: Response) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('onboarding.validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const slug = parsed.data.organizationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'workspace';

  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {
      name: parsed.data.name,
      role: parsed.data.role || 'owner',
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
    create: {
      id: DEMO_USER_ID,
      email: 'demo@example.com',
      name: parsed.data.name,
      role: parsed.data.role || 'owner',
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug },
    update: {
      name: parsed.data.organizationName,
      defaultVisibility: parsed.data.defaultVisibility,
    },
    create: {
      name: parsed.data.organizationName,
      slug,
      createdByUserId: user.id,
      defaultVisibility: parsed.data.defaultVisibility,
    },
  });

  const team = parsed.data.teamName
    ? await prisma.team.upsert({
        where: {
          organizationId_slug: {
            organizationId: organization.id,
            slug: parsed.data.teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          },
        },
        update: { name: parsed.data.teamName },
        create: {
          organizationId: organization.id,
          name: parsed.data.teamName,
          slug: parsed.data.teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        },
      })
    : null;

  const membership = await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: 'owner', status: 'active', teamId: team?.id ?? null },
    create: {
      organizationId: organization.id,
      userId: user.id,
      teamId: team?.id ?? null,
      role: 'owner',
      status: 'active',
    },
  });

  const invites = await Promise.all(parsed.data.inviteEmails.map((email) => {
    const tokenHash = crypto.createHash('sha256').update(`${email}:${Date.now()}:${crypto.randomUUID()}`).digest('hex');
    return prisma.invite.create({
      data: {
        organizationId: organization.id,
        teamId: team?.id ?? null,
        email,
        role: 'member',
        tokenHash,
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });
  }));

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.onboarding_completed',
    targetType: 'organization',
    targetId: organization.id,
    metadata: { inviteCount: invites.length, hasTeam: Boolean(team), defaultVisibility: organization.defaultVisibility },
  });

  logPhase2('onboarding.completed', {
    userId: user.id,
    organizationId: organization.id,
    teamId: team?.id ?? null,
    inviteCount: invites.length,
  });

  return res.status(201).json({ data: { user, organization, membership, team, invites } });
});

phase2Router.get('/phase2/feed', async (req: Request, res: Response) => {
  const scope = feedScopeSchema.parse(req.query.scope || 'organization');
  const { user, organization } = await demoContext();

  const where = scope === 'private'
    ? { createdBy: user.id, visibility: 'private' }
    : scope === 'public'
      ? { visibility: 'public' }
      : { project: { organizationId: organization.id }, visibility: { in: ['org', 'public'] } };

  const sessions = await prisma.feedbackSession.findMany({
    where,
    include: {
      creator: true,
      project: { include: { organization: true } },
      comments: { include: { author: true, curationDecisions: true }, orderBy: { createdAt: 'desc' } },
      frames: true,
      _count: { select: { comments: true, frames: true, curationDecisions: true, submissions: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });

  logPhase2('feed.loaded', {
    scope,
    organizationId: organization.id,
    userId: user.id,
    resultCount: sessions.length,
  });

  return res.json({ data: { scope, sessions } });
});

phase2Router.post('/phase2/sessions/:id/contributions', async (req: Request, res: Response) => {
  const parsed = contributionSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('contribution.validation_failed', { sessionId: req.params.id, issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { user, organization } = await demoContext();
  const contribution = await prisma.feedbackComment.create({
    data: {
      feedbackSessionId: req.params.id,
      authorId: user.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId ?? null,
      contributionType: parsed.data.contributionType,
      sourceScope: parsed.data.visibility === 'public' ? 'public' : 'team',
      body: parsed.data.body,
      suggestedText: parsed.data.suggestedText,
      visibility: parsed.data.visibility,
    },
    include: { author: true },
  });
  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.contribution_created',
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId ?? req.params.id,
    metadata: { sessionId: req.params.id, contributionType: parsed.data.contributionType, visibility: parsed.data.visibility },
  });
  logPhase2('contribution.created', {
    sessionId: req.params.id,
    contributionId: contribution.id,
    targetType: contribution.targetType,
    contributionType: contribution.contributionType,
    visibility: contribution.visibility,
  });
  return res.status(201).json({ data: contribution });
});

phase2Router.post('/phase2/contributions/:id/curation', async (req: Request, res: Response) => {
  const parsed = curationSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('curation.validation_failed', { contributionId: req.params.id, issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { user, organization } = await demoContext();
  const contribution = await prisma.feedbackComment.findUniqueOrThrow({ where: { id: req.params.id } });
  const decision = await prisma.curationDecision.create({
    data: {
      contributionId: contribution.id,
      feedbackSessionId: contribution.feedbackSessionId,
      decidedByUserId: user.id,
      decision: parsed.data.decision,
      editedText: parsed.data.editedText,
      reason: parsed.data.reason,
      includedInPayload: parsed.data.decision === 'accepted' || parsed.data.decision === 'edited',
    },
  });
  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.curation_decision_created',
    targetType: 'contribution',
    targetId: contribution.id,
    metadata: { decision: decision.decision, includedInPayload: decision.includedInPayload },
  });
  logPhase2('curation.created', {
    contributionId: contribution.id,
    decisionId: decision.id,
    decision: decision.decision,
    includedInPayload: decision.includedInPayload,
  });
  return res.status(201).json({ data: decision });
});

phase2Router.post('/phase2/sessions/:id/preflight', async (req: Request, res: Response) => {
  const parsed = preflightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { user, organization } = await demoContext();
  const session = await prisma.feedbackSession.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      comments: { include: { curationDecisions: true, author: true } },
      frames: true,
    },
  });
  const accepted = session.comments.filter((comment) =>
    comment.curationDecisions.some((decision) => decision.includedInPayload),
  );
  const keyAsks = [
    session.about || `Resolve feedback for ${session.title}.`,
    ...accepted.map((comment) => comment.suggestedText || comment.body),
  ];
  const finalPromptDraft = [
    `Goal:`,
    `- ${session.about || session.title}`,
    ``,
    `Must consider:`,
    ...keyAsks.map((ask) => `- ${ask}`),
    ``,
    `Context:`,
    `- Project folder: ${session.projectFolder || 'not provided'}`,
    `- GitHub repo: ${session.githubRepo || 'not provided'}`,
    `- Captures: ${session.frames.length}`,
  ].join('\n');

  const summary = await prisma.aIReviewSummary.create({
    data: {
      feedbackSessionId: session.id,
      providerTarget: parsed.data.providerTarget,
      inputContributionIds: JSON.stringify(accepted.map((comment) => comment.id)),
      goal: session.about || session.title,
      keyAsksJson: JSON.stringify(keyAsks),
      acceptedFeedbackSummary: accepted.length
        ? accepted.map((comment) => `${comment.author.name}: ${comment.suggestedText || comment.body}`).join('\n')
        : 'No accepted social feedback yet. Use the original annotation context.',
      conflictsJson: JSON.stringify([]),
      doNotChangeJson: JSON.stringify(['Do not include rejected comments in the AI payload.']),
      finalPromptDraft,
      createdByUserId: user.id,
    },
  });
  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.ai_preflight_created',
    targetType: 'feedbackSession',
    targetId: session.id,
    metadata: { providerTarget: parsed.data.providerTarget, acceptedContributionCount: accepted.length },
  });
  logPhase2('preflight.created', {
    sessionId: session.id,
    summaryId: summary.id,
    providerTarget: summary.providerTarget,
    acceptedContributionCount: accepted.length,
    finalPromptChars: finalPromptDraft.length,
  });
  return res.status(201).json({ data: summary });
});
