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
  authProvider: z.enum(['email', 'google']).optional(),
  organizationName: z.string().min(1),
  organizationLogoUrl: z.string().max(2_000_000).optional(),
  role: z.string().optional(),
  teamName: z.string().optional(),
  inviteEmails: z.array(z.string().email()).max(10, 'You can invite up to 10 teammates during onboarding.').default([]),
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

const emailCodeRequestSchema = z.object({
  email: z.string().email(),
});

const emailCodeVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().trim().regex(/^\d{6}$/),
});

const ensureIdentitySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  authProvider: z.enum(['email', 'google']),
});

type EmailCodeEntry = {
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

const emailCodeStore = new Map<string, EmailCodeEntry>();
const EMAIL_CODE_EXPIRY_MINUTES = 10;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function createEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashEmailCode(code: string) {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

function emailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function getPublicWebBaseUrl() {
  const candidates = [
    process.env.EMAIL_ASSET_BASE_URL,
    process.env.PUBLIC_WEB_URL,
    process.env.WEB_URL,
    process.env.AUTH_URL,
    'https://dbugrweb-production.up.railway.app',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate.includes('localhost') || candidate.includes('127.0.0.1')) continue;
    return candidate.replace(/\/$/, '');
  }

  return 'https://dbugrweb-production.up.railway.app';
}

function deriveNameFromEmail(email: string) {
  const local = email.split('@')[0] || 'Dbugr user';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return 'Dbugr user';
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mergeAuthProviders(existing: string, incoming: 'email' | 'google') {
  const providers = new Set(
    existing
      .split(',')
      .map((provider) => provider.trim())
      .filter(Boolean)
      .filter((provider) => provider !== 'demo'),
  );
  providers.add(incoming);
  return Array.from(providers).join(',');
}

async function ensureUserIdentity({
  email,
  name,
  authProvider,
}: {
  email: string;
  name?: string;
  authProvider: 'email' | 'google';
}) {
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const resolvedName = name?.trim() || existingUser?.name || deriveNameFromEmail(normalizedEmail);

  if (existingUser) {
    const user = await prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        name: resolvedName,
        authProvider: mergeAuthProviders(existingUser.authProvider, authProvider),
        lastSeenAt: new Date(),
      },
    });
    return { user, created: false };
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: resolvedName,
      role: 'member',
      authProvider,
      lastSeenAt: new Date(),
    },
  });

  return { user, created: true };
}

async function sendEmailCode(email: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { delivered: false as const, provider: 'preview' as const };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Your Dbugr sign-in code',
      text: [
        'Dbugr sign-in verification',
        '',
        `Your verification code is ${code}.`,
        '',
        `It expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.`,
        'If you did not request this code, you can ignore this email.',
      ].join('\n'),
      html: `
        <div style="margin:0;padding:24px 12px;background:#ffffff;">
          <div style="max-width:560px;margin:0 auto;background:#fffdf9;border:1px solid #ebe4d8;border-radius:24px;overflow:hidden;box-shadow:0 12px 36px rgba(26,26,26,0.06);">
            <div style="padding:24px 20px;background:linear-gradient(135deg,#f8fbff 0%,#eef6ff 100%);border-bottom:1px solid #e2ebf7;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px 0;">
                <tr>
                  <td style="padding:0 12px 0 0;vertical-align:middle;">
                    <img src="${getPublicWebBaseUrl()}/brand/icon-nav-1024.png" alt="Dbugr.ai" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:16px;background:#ffffff;border:1px solid #d9e7f7;box-shadow:0 8px 22px rgba(0,144,255,0.10);" />
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;line-height:1.1;color:#272522;">Dbugr.ai</div>
                    <div style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8479;margin-top:8px;">Workspace sign-in</div>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.04;color:#272522;font-weight:500;">Sign in to your workspace.</h1>
              <p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#4e4a45;">Use this one-time code to continue into Dbugr and link your Mac app to the right account.</p>
            </div>
            <div style="padding:24px 20px;">
              <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#8a8479;margin-bottom:10px;">Verification code</div>
              <div style="display:inline-block;max-width:100%;padding:16px 18px;border-radius:18px;background:#eef7ff;border:1px solid rgba(0,144,255,0.22);font-family:Arial,sans-serif;font-size:30px;line-height:1.05;font-weight:700;letter-spacing:0.18em;color:#0090ff;box-sizing:border-box;">${code}</div>
              <p style="margin:18px 0 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#4e4a45;">This code expires in <strong>${EMAIL_CODE_EXPIRY_MINUTES} minutes</strong> and can only be used once.</p>
              <p style="margin:10px 0 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#4e4a45;">If you did not request this code, you can safely ignore this email.</p>
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2ebf7;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#8a8479;">Dbugr keeps your AI provider keys on your device by default. This email only verifies your web identity.</div>
            </div>
          </div>
        </div>`,
    }),
  });

  if (!response.ok) {
    const failure = await response.text();
    throw new Error(`Resend failed with ${response.status}: ${failure}`);
  }

  return { delivered: true as const, provider: 'resend' as const };
}

async function sendWelcomeEmail(email: string, name: string, authProvider: 'email' | 'google') {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { delivered: false as const, provider: 'preview' as const };
  }

  const webBaseUrl = getPublicWebBaseUrl();
  const authLabel = authProvider === 'google' ? 'Google' : 'email verification';
  const downloadUrl =
    process.env.NEXT_PUBLIC_MAC_DMG_URL ??
    'https://github.com/kuma0177/debgr_ai/releases/download/stable-macos-claude-codex-cli/dbugr-ai-0.0.1-macos-aarch64.dmg';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Welcome to Dbugr.ai',
      text: [
        `Welcome to Dbugr.ai, ${name}.`,
        '',
        `Your account was created using ${authLabel}.`,
        '',
        'How to use Dbugr:',
        '1. Create or join a workspace on the web.',
        '2. Download the Dbugr Mac app DMG.',
        '3. Install Dbugr.ai into Applications.',
        '4. Link this Mac from onboarding.',
        '5. Capture screenshots, collect review feedback, and send approved changes to Claude, Codex, or Cursor.',
        '',
        `Open Dbugr.ai: ${webBaseUrl}`,
        `Download the Mac app: ${downloadUrl}`,
      ].join('\n'),
      html: `
        <div style="margin:0;padding:24px 12px;background:#ffffff;">
          <div style="max-width:600px;margin:0 auto;background:#fffdf9;border:1px solid #ebe4d8;border-radius:24px;overflow:hidden;box-shadow:0 12px 36px rgba(26,26,26,0.06);">
            <div style="padding:24px 20px;background:linear-gradient(135deg,#f8fbff 0%,#eef6ff 100%);border-bottom:1px solid #e2ebf7;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px 0;">
                <tr>
                  <td style="padding:0 12px 0 0;vertical-align:middle;">
                    <img src="${webBaseUrl}/brand/icon-nav-1024.png" alt="Dbugr.ai" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:16px;background:#ffffff;border:1px solid #d9e7f7;box-shadow:0 8px 22px rgba(0,144,255,0.10);" />
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;line-height:1.1;color:#272522;">Dbugr.ai</div>
                    <div style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8479;margin-top:8px;">Welcome</div>
                  </td>
                </tr>
              </table>
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.04;color:#272522;font-weight:500;">Your account is ready.</h1>
              <p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#4e4a45;">Hi ${name}, you’re in. Dbugr uses ${authLabel} for this account and keeps the capture flow on your Mac fast and local.</p>
            </div>
            <div style="padding:24px 20px;">
              <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#8a8479;margin-bottom:12px;">Your first 3 steps</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0 12px;">
                <tr>
                  <td style="width:33.33%;padding:0 6px 0 0;vertical-align:top;">
                    <div style="height:100%;padding:16px 14px;border-radius:18px;background:#f8fbff;border:1px solid #dcecff;">
                      <div style="font-size:24px;line-height:1;margin-bottom:10px;">🌐</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.3;color:#272522;margin-bottom:6px;">Create your workspace</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.55;color:#4e4a45;">Finish setup on the web so your sessions, teammates, and review history all stay organized.</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 3px;vertical-align:top;">
                    <div style="height:100%;padding:16px 14px;border-radius:18px;background:#f8fbff;border:1px solid #dcecff;">
                      <div style="font-size:24px;line-height:1;margin-bottom:10px;">💻</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.3;color:#272522;margin-bottom:6px;">Install the Mac app</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.55;color:#4e4a45;">Download the DMG, open it from Downloads, then drag Dbugr.ai into Applications.</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 0 0 6px;vertical-align:top;">
                    <div style="height:100%;padding:16px 14px;border-radius:18px;background:#f8fbff;border:1px solid #dcecff;">
                      <div style="font-size:24px;line-height:1;margin-bottom:10px;">🔗</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.3;color:#272522;margin-bottom:6px;">Link this Mac</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.55;color:#4e4a45;">Connect the Mac app once, then start capturing, reviewing, and sending approved prompts to AI.</div>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:20px;">
                <a href="${webBaseUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0090ff;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;margin-right:8px;">Open Dbugr.ai</a>
                <a href="${downloadUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#eef7ff;color:#0090ff;border:1px solid rgba(0,144,255,0.18);font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">Download the Mac app</a>
              </div>
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2ebf7;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#8a8479;">If you later sign in with the same email through Google or email verification, Dbugr will attach you to this same account instead of creating a duplicate user.</div>
            </div>
          </div>
        </div>`,
    }),
  });

  if (!response.ok) {
    const failure = await response.text();
    throw new Error(`Resend welcome email failed with ${response.status}: ${failure}`);
  }

  return { delivered: true as const, provider: 'resend' as const };
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
  const authProvider = parsed.data.authProvider ?? 'google';

  const identity = email === 'demo@example.com'
    ? {
        user: await prisma.user.upsert({
          where: { id: DEMO_USER_ID },
          update: {
            email,
            name: parsed.data.name,
            role: parsed.data.role || 'owner',
            authProvider,
            lastSeenAt: new Date(),
          },
          create: {
            id: DEMO_USER_ID,
            email,
            name: parsed.data.name,
            role: parsed.data.role || 'owner',
            authProvider,
            lastSeenAt: new Date(),
          },
        }),
        created: false,
      }
    : await ensureUserIdentity({
        email,
        name: parsed.data.name,
        authProvider,
      });

  const user = identity.user;

  if (identity.created) {
    try {
      await sendWelcomeEmail(user.email, user.name, authProvider);
      logPhase2('welcome_email.sent_from_onboarding', { email: user.email, authProvider });
    } catch (error) {
      logPhase2('welcome_email.failed_from_onboarding', {
        email: user.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const organization = await prisma.organization.upsert({
    where: { slug },
    update: {
      name: parsed.data.organizationName,
      logoUrl: parsed.data.organizationLogoUrl ?? null,
      defaultVisibility: parsed.data.defaultVisibility,
    },
    create: {
      name: parsed.data.organizationName,
      slug,
      logoUrl: parsed.data.organizationLogoUrl ?? null,
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

  const identity = await ensureUserIdentity({
    email,
    name: parsed.data.name,
    authProvider: 'google',
  });
  const user = identity.user;

  if (identity.created) {
    try {
      await sendWelcomeEmail(user.email, user.name, 'google');
      logPhase2('welcome_email.sent_from_invite', { email: user.email });
    } catch (error) {
      logPhase2('welcome_email.failed_from_invite', {
        email: user.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
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

phase2Router.post('/phase2/auth/email-code/request', async (req: Request, res: Response) => {
  const parsed = emailCodeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('email_code.request_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({ where: { email } });
  const code = createEmailCode();
  emailCodeStore.set(email, {
    codeHash: hashEmailCode(code),
    expiresAt: Date.now() + 1000 * 60 * EMAIL_CODE_EXPIRY_MINUTES,
    attempts: 0,
  });

  try {
    const delivery = await sendEmailCode(email, code);
    logPhase2('email_code.requested', {
      email,
      delivered: delivery.delivered,
      provider: delivery.provider,
      configured: emailProviderConfigured(),
    });
    return res.status(201).json({
      data: {
        delivered: delivery.delivered,
        provider: delivery.provider,
        accountExists: Boolean(existingUser),
        expiresInMinutes: EMAIL_CODE_EXPIRY_MINUTES,
        previewCode: delivery.delivered ? null : code,
      },
    });
  } catch (error) {
    logPhase2('email_code.request_failed', {
      email,
      message: error instanceof Error ? error.message : String(error),
      configured: emailProviderConfigured(),
    });
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Could not send verification email.',
    });
  }
});

phase2Router.post('/phase2/auth/email-code/verify', async (req: Request, res: Response) => {
  const parsed = emailCodeVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('email_code.verify_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const entry = emailCodeStore.get(email);
  if (!entry) {
    logPhase2('email_code.verify_missing', { email });
    return res.status(404).json({ error: 'No verification code was requested for this email yet.' });
  }

  if (entry.expiresAt < Date.now()) {
    emailCodeStore.delete(email);
    logPhase2('email_code.verify_expired', { email });
    return res.status(410).json({ error: 'That verification code expired. Request a new one.' });
  }

  if (entry.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    emailCodeStore.delete(email);
    logPhase2('email_code.verify_locked', { email });
    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
  }

  if (entry.codeHash !== hashEmailCode(parsed.data.code)) {
    entry.attempts += 1;
    emailCodeStore.set(email, entry);
    logPhase2('email_code.verify_failed', { email, attempts: entry.attempts });
    return res.status(401).json({ error: 'That code does not match. Check the code and try again.' });
  }

  emailCodeStore.delete(email);
  const identity = await ensureUserIdentity({
    email,
    authProvider: 'email',
  });

  let welcomeEmailSent = false;
  if (identity.created) {
    try {
      await sendWelcomeEmail(identity.user.email, identity.user.name, 'email');
      welcomeEmailSent = true;
      logPhase2('welcome_email.sent_from_email_verify', { email: identity.user.email });
    } catch (error) {
      logPhase2('welcome_email.failed_from_email_verify', {
        email: identity.user.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logPhase2('email_code.verified', { email, userId: identity.user.id, created: identity.created });
  return res.json({
    data: {
      verified: true,
      user: identity.user,
      created: identity.created,
      welcomeEmailSent,
    },
  });
});

phase2Router.post('/phase2/auth/identity/ensure', async (req: Request, res: Response) => {
  const parsed = ensureIdentitySchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('identity.ensure_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const identity = await ensureUserIdentity({
    email: parsed.data.email,
    name: parsed.data.name,
    authProvider: parsed.data.authProvider,
  });

  let welcomeEmailSent = false;
  if (identity.created) {
    try {
      await sendWelcomeEmail(identity.user.email, identity.user.name, parsed.data.authProvider);
      welcomeEmailSent = true;
      logPhase2('welcome_email.sent_from_identity_ensure', { email: identity.user.email, authProvider: parsed.data.authProvider });
    } catch (error) {
      logPhase2('welcome_email.failed_from_identity_ensure', {
        email: identity.user.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logPhase2('identity.ensured', {
    email: identity.user.email,
    userId: identity.user.id,
    created: identity.created,
    authProvider: parsed.data.authProvider,
  });

  return res.status(identity.created ? 201 : 200).json({
    data: {
      user: identity.user,
      created: identity.created,
      welcomeEmailSent,
    },
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
