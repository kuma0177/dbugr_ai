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

function slugify(value: string, fallback = 'workspace') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback;
}

async function requestContext(req: Request) {
  const email = typeof req.headers['x-dbugr-user-email'] === 'string'
    ? req.headers['x-dbugr-user-email'].trim().toLowerCase()
    : '';
  if (!email) return demoContext();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const error = new Error('No Dbugr account exists for this email. Finish onboarding first.');
    error.name = 'UNAUTHENTICATED';
    throw error;
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, status: 'active' },
    include: { organization: true, team: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) {
    const error = new Error('This account is not attached to an active organization.');
    error.name = 'FORBIDDEN';
    throw error;
  }

  return { user, membership, organization: membership.organization };
}

function handleContextError(error: unknown, res: Response) {
  if (error instanceof Error && error.name === 'UNAUTHENTICATED') {
    return res.status(401).json({ error: error.message });
  }
  if (error instanceof Error && error.name === 'FORBIDDEN') {
    return res.status(403).json({ error: error.message });
  }
  throw error;
}

function canManageSession(role: string, sessionOwnerId: string, actorId: string) {
  return sessionOwnerId === actorId || role === 'owner' || role === 'admin';
}

const onboardingSchema = z.object({
  email: z.string().email().optional(),
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

const visibilitySchema = z.object({
  visibility: z.enum(['private', 'org', 'public']),
  submissionFlow: z.enum(['direct', 'internal_review', 'public_feed']).optional(),
  redactionConfirmed: z.boolean().default(false),
});

const submitSchema = z.object({
  providerTarget: z.enum(['claude', 'codex', 'cursor']),
  aiReviewSummaryId: z.string().optional(),
  finalPrompt: z.string().min(1).optional(),
  credentialScope: z.enum(['personal', 'organization', 'none']).default('personal'),
});

const desktopLinkSchema = z.object({
  appUrl: z.string().url().optional(),
});

const desktopRedeemSchema = z.object({
  code: z.string().min(6),
  desktopDeviceId: z.string().optional(),
  desktopDeviceName: z.string().optional(),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(12),
  email: z.string().email(),
  name: z.string().min(1),
});

function createDesktopLinkCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function hashDesktopLinkCode(code: string) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function createInviteToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function hashInviteToken(token: string) {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

phase2Router.get('/phase2/bootstrap', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, membership, organization } = context;
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

  const email = parsed.data.email?.trim().toLowerCase() || 'demo@example.com';
  const slug = slugify(parsed.data.organizationName);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: parsed.data.name,
      role: parsed.data.role || 'owner',
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
    create: {
      id: email === 'demo@example.com' ? DEMO_USER_ID : undefined,
      email,
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
            slug: slugify(parsed.data.teamName),
          },
        },
        update: { name: parsed.data.teamName },
        create: {
          organizationId: organization.id,
          name: parsed.data.teamName,
          slug: slugify(parsed.data.teamName),
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

  const invites = await Promise.all(parsed.data.inviteEmails.map(async (email) => {
    const token = createInviteToken();
    const invite = await prisma.invite.create({
      data: {
        organizationId: organization.id,
        teamId: team?.id ?? null,
        email,
        role: 'member',
        tokenHash: hashInviteToken(token),
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });
    return {
      ...invite,
      acceptUrl: `/onboarding?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    };
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

phase2Router.post('/phase2/invites/accept', async (req: Request, res: Response) => {
  const parsed = inviteAcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('invite.accept_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const invite = await prisma.invite.findFirst({
    where: { tokenHash: hashInviteToken(parsed.data.token) },
    include: { organization: true, team: true },
  });
  if (!invite || invite.revokedAt) {
    logPhase2('invite.accept_not_found', { email });
    return res.status(404).json({ error: 'Invite not found or revoked.' });
  }
  if (invite.acceptedAt) {
    logPhase2('invite.accept_already_used', { inviteId: invite.id, email });
    return res.status(409).json({ error: 'Invite has already been accepted.' });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    logPhase2('invite.accept_expired', { inviteId: invite.id, email });
    return res.status(410).json({ error: 'Invite expired. Ask the workspace owner for a new one.' });
  }
  if (invite.email.toLowerCase() !== email) {
    logPhase2('invite.accept_email_mismatch', { inviteId: invite.id });
    return res.status(403).json({ error: 'Invite email does not match this account.' });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { name: parsed.data.name, authProvider: 'google', lastSeenAt: new Date() },
    create: {
      email,
      name: parsed.data.name,
      role: invite.role,
      authProvider: 'google',
      lastSeenAt: new Date(),
    },
  });
  const membership = await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } },
    update: { role: invite.role, status: 'active', teamId: invite.teamId ?? null },
    create: {
      organizationId: invite.organizationId,
      userId: user.id,
      teamId: invite.teamId ?? null,
      role: invite.role,
      status: 'active',
    },
  });
  const acceptedInvite = await prisma.invite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });
  await auditLog({
    organizationId: invite.organizationId,
    actorId: user.id,
    action: 'phase2.invite_accepted',
    targetType: 'invite',
    targetId: invite.id,
    metadata: { role: invite.role, teamId: invite.teamId },
  });
  logPhase2('invite.accepted', {
    inviteId: invite.id,
    userId: user.id,
    organizationId: invite.organizationId,
    role: invite.role,
  });
  return res.status(201).json({
    data: { user, organization: invite.organization, team: invite.team, membership, invite: acceptedInvite },
  });
});

phase2Router.post('/phase2/desktop-link', async (req: Request, res: Response) => {
  const parsed = desktopLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    logPhase2('desktop_link.validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, organization } = context;
  const code = createDesktopLinkCode();
  const codeHash = hashDesktopLinkCode(code);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 10);
  const appUrl = parsed.data.appUrl ?? 'http://localhost:3000';
  const apiUrl = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3001}/api`;
  const deepLinkUrl = `dbugr://link?code=${encodeURIComponent(code)}&api=${encodeURIComponent(apiUrl)}&app=${encodeURIComponent(appUrl)}`;

  const link = await prisma.desktopLink.create({
    data: {
      userId: user.id,
      organizationId: organization.id,
      codeHash,
      status: 'pending',
      expiresAt,
    },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.desktop_link_created',
    targetType: 'desktopLink',
    targetId: link.id,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  logPhase2('desktop_link.created', {
    linkId: link.id,
    userId: user.id,
    organizationId: organization.id,
    expiresAt: expiresAt.toISOString(),
    codeChars: code.length,
  });

  return res.status(201).json({
    data: {
      linkId: link.id,
      code,
      deepLinkUrl,
      expiresAt,
      status: link.status,
    },
  });
});

phase2Router.post('/phase2/desktop-link/redeem', async (req: Request, res: Response) => {
  const parsed = desktopRedeemSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('desktop_link.redeem_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const codeHash = hashDesktopLinkCode(parsed.data.code);
  const link = await prisma.desktopLink.findUnique({
    where: { codeHash },
    include: { user: true, organization: true },
  });

  if (!link) {
    logPhase2('desktop_link.redeem_not_found', { codeChars: parsed.data.code.length });
    return res.status(404).json({ error: 'Desktop link code not found.' });
  }

  if (link.expiresAt.getTime() < Date.now()) {
    await prisma.desktopLink.update({ where: { id: link.id }, data: { status: 'expired' } });
    logPhase2('desktop_link.redeem_expired', { linkId: link.id });
    return res.status(410).json({ error: 'Desktop link code expired. Create a new link from onboarding.' });
  }

  const redeemed = await prisma.desktopLink.update({
    where: { id: link.id },
    data: {
      status: 'redeemed',
      redeemedAt: new Date(),
      desktopDeviceId: parsed.data.desktopDeviceId ?? crypto.randomUUID(),
      desktopDeviceName: parsed.data.desktopDeviceName ?? 'Dbugr Mac app',
    },
  });

  const desktopLinkToken = crypto.randomBytes(24).toString('base64url');

  await auditLog({
    organizationId: link.organizationId,
    actorId: link.userId,
    action: 'phase2.desktop_link_redeemed',
    targetType: 'desktopLink',
    targetId: link.id,
    metadata: { desktopDeviceName: redeemed.desktopDeviceName },
  });

  logPhase2('desktop_link.redeemed', {
    linkId: link.id,
    userId: link.userId,
    organizationId: link.organizationId,
    desktopDeviceId: redeemed.desktopDeviceId,
  });

  return res.json({
    data: {
      user: link.user,
      organization: link.organization,
      desktopLink: redeemed,
      desktopLinkToken,
    },
  });
});

phase2Router.get('/phase2/feed', async (req: Request, res: Response) => {
  const scope = feedScopeSchema.parse(req.query.scope || 'organization');
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, organization } = context;

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
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, organization } = context;
  const session = await prisma.feedbackSession.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { createdBy: user.id },
        { visibility: 'public' },
        { project: { organizationId: organization.id }, visibility: { in: ['org', 'public'] } },
      ],
    },
  });
  if (!session) {
    logPhase2('contribution.permission_denied', { sessionId: req.params.id, userId: user.id });
    return res.status(404).json({ error: 'Session not found or not visible to this account.' });
  }
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
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, membership, organization } = context;
  const contribution = await prisma.feedbackComment.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { session: true },
  });
  if (!canManageSession(membership.role, contribution.session.createdBy, user.id)) {
    logPhase2('curation.permission_denied', { contributionId: contribution.id, userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can curate feedback.' });
  }
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
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, membership, organization } = context;
  const session = await prisma.feedbackSession.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      comments: { include: { curationDecisions: true, author: true } },
      frames: true,
    },
  });
  if (!canManageSession(membership.role, session.createdBy, user.id)) {
    logPhase2('preflight.permission_denied', { sessionId: session.id, userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can create AI preflight summaries.' });
  }
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

phase2Router.post('/phase2/sessions/:id/visibility', async (req: Request, res: Response) => {
  const parsed = visibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('visibility.validation_failed', { sessionId: req.params.id, issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, membership, organization } = context;
  const session = await prisma.feedbackSession.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { project: true },
  });
  if (!canManageSession(membership.role, session.createdBy, user.id)) {
    logPhase2('visibility.permission_denied', { sessionId: session.id, userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can change visibility.' });
  }
  if (session.project.organizationId !== organization.id) {
    logPhase2('visibility.org_mismatch', { sessionId: session.id, organizationId: organization.id });
    return res.status(404).json({ error: 'Session not found in this organization.' });
  }
  if (parsed.data.visibility === 'public') {
    if (!organization.allowPublicSharing) {
      logPhase2('visibility.public_blocked_by_policy', { sessionId: session.id, organizationId: organization.id });
      return res.status(403).json({ error: 'Public sharing is disabled by organization policy.' });
    }
    if (organization.requireRedactionConfirmation && !parsed.data.redactionConfirmed) {
      logPhase2('visibility.public_missing_redaction', { sessionId: session.id });
      return res.status(400).json({ error: 'Confirm redaction review before publishing publicly.' });
    }
  }

  const updated = await prisma.feedbackSession.update({
    where: { id: session.id },
    data: {
      visibility: parsed.data.visibility,
      submissionFlow: parsed.data.submissionFlow ?? (
        parsed.data.visibility === 'public' ? 'public_feed' : parsed.data.visibility === 'org' ? 'internal_review' : 'direct'
      ),
      reviewStatus: parsed.data.visibility === 'private' ? 'draft' : 'collecting_feedback',
      redactionConfirmedAt: parsed.data.visibility === 'public' ? new Date() : session.redactionConfirmedAt,
      publicPublishedAt: parsed.data.visibility === 'public' ? new Date() : session.publicPublishedAt,
      publicApprovedByUserId: parsed.data.visibility === 'public' && !organization.requirePublicApproval ? user.id : session.publicApprovedByUserId,
      publicApprovedAt: parsed.data.visibility === 'public' && !organization.requirePublicApproval ? new Date() : session.publicApprovedAt,
    },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.session_visibility_changed',
    targetType: 'feedbackSession',
    targetId: session.id,
    metadata: {
      from: session.visibility,
      to: updated.visibility,
      submissionFlow: updated.submissionFlow,
      redactionConfirmed: parsed.data.redactionConfirmed,
    },
  });
  logPhase2('visibility.changed', {
    sessionId: session.id,
    userId: user.id,
    from: session.visibility,
    to: updated.visibility,
    submissionFlow: updated.submissionFlow,
  });
  return res.json({ data: updated });
});

phase2Router.post('/phase2/sessions/:id/submissions', async (req: Request, res: Response) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('submission.validation_failed', { sessionId: req.params.id, issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, membership, organization } = context;
  const session = await prisma.feedbackSession.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { frames: true, reviewSummaries: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!canManageSession(membership.role, session.createdBy, user.id)) {
    logPhase2('submission.permission_denied', { sessionId: session.id, userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can submit to AI.' });
  }

  const summary = parsed.data.aiReviewSummaryId
    ? await prisma.aIReviewSummary.findUnique({ where: { id: parsed.data.aiReviewSummaryId } })
    : session.reviewSummaries[0] ?? null;
  const finalPrompt = parsed.data.finalPrompt ?? summary?.editedPrompt ?? summary?.finalPromptDraft;
  if (!finalPrompt) {
    logPhase2('submission.missing_prompt', { sessionId: session.id });
    return res.status(400).json({ error: 'Generate or provide a final prompt before submitting.' });
  }

  const submission = await prisma.submission.create({
    data: {
      feedbackSessionId: session.id,
      submittedByUserId: user.id,
      providerTarget: parsed.data.providerTarget,
      credentialScope: parsed.data.credentialScope,
      aiReviewSummaryId: summary?.id ?? null,
      finalPrompt,
      screenshotAssetIdsJson: JSON.stringify(session.frames.map((frame) => frame.id)),
      status: 'created',
    },
  });
  await prisma.feedbackSession.update({
    where: { id: session.id },
    data: { reviewStatus: 'submitted', status: 'routed' },
  });
  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.submission_created',
    targetType: 'submission',
    targetId: submission.id,
    metadata: {
      sessionId: session.id,
      providerTarget: submission.providerTarget,
      credentialScope: submission.credentialScope,
      promptChars: finalPrompt.length,
      screenshotCount: session.frames.length,
    },
  });
  logPhase2('submission.created', {
    submissionId: submission.id,
    sessionId: session.id,
    providerTarget: submission.providerTarget,
    credentialScope: submission.credentialScope,
    promptChars: finalPrompt.length,
    screenshotCount: session.frames.length,
  });
  return res.status(201).json({ data: submission });
});
