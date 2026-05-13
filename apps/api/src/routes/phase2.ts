import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditLog } from '../lib/audit';

export const phase2Router = Router();

const DEMO_USER_ID = 'user_demo';
const SVG_PLACEHOLDER = 'image/svg+xml; charset=utf-8';

function logPhase2(event: string, details: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString();
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !key.toLowerCase().includes('token'))
      .map(([key, value]) => {
        if (key.toLowerCase().includes('email') && typeof value === 'string') {
          const [local, domain] = value.split('@');
          return [key, `${local.slice(0, 2)}***@${domain ?? 'unknown'}`];
        }
        if (key.toLowerCase().includes('code')) return [key, '[redacted]'];
        return [key, value];
      }),
  );
  console.info(`[phase2] ${stamp} ${event}`, safeDetails);
}

function svgPlaceholder(title: string, description?: string) {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 80);
  const safeDescription = (description || 'Screenshot preview unavailable')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 120);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fdfcfc"/>
      <stop offset="1" stop-color="#f5f3f1"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" rx="32" fill="url(#bg)"/>
  <rect x="72" y="74" width="816" height="392" rx="24" fill="#fff" stroke="rgba(0,0,0,0.08)"/>
  <circle cx="126" cy="126" r="12" fill="#e5e5e5"/>
  <circle cx="164" cy="126" r="12" fill="#e5e5e5"/>
  <circle cx="202" cy="126" r="12" fill="#e5e5e5"/>
  <rect x="118" y="178" width="420" height="22" rx="11" fill="#d9d6d2"/>
  <rect x="118" y="224" width="674" height="18" rx="9" fill="#eeeae6"/>
  <rect x="118" y="260" width="608" height="18" rx="9" fill="#eeeae6"/>
  <rect x="118" y="318" width="198" height="56" rx="28" fill="#0663FB"/>
  <text x="118" y="430" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#000">${safeTitle}</text>
  <text x="118" y="464" font-family="Inter, Arial, sans-serif" font-size="18" fill="#777169">${safeDescription}</text>
</svg>`.trim();
}

function isProbablyLocalPath(value: string) {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

function isAllowedScreenshotPath(value: string) {
  const resolved = path.resolve(value);
  const debugrScreenshotRoot = path.resolve(os.homedir(), 'Library/Application Support/debugr/screenshots');
  const tmpScreenshotRoot = path.resolve(os.tmpdir());
  const isImage = /\.(png|jpe?g|webp)$/i.test(resolved);
  const inDebugrRoot = resolved === debugrScreenshotRoot || resolved.startsWith(`${debugrScreenshotRoot}${path.sep}`);
  const inDebugrTmp = resolved.startsWith(`${tmpScreenshotRoot}${path.sep}debugr_screenshot_`);
  return isImage && (inDebugrRoot || inDebugrTmp);
}

async function canReadFile(value: string) {
  try {
    const stat = await fs.stat(value);
    return stat.isFile();
  } catch {
    return false;
  }
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

function preferredMembership<T extends { organization: { createdByUserId: string | null; id: string } }>(
  memberships: T[],
  userId: string,
): T | null {
  return memberships.find((membership) => membership.organization.createdByUserId === userId)
    ?? memberships.find((membership) => membership.organization.id !== 'org_demo')
    ?? memberships[0]
    ?? null;
}

function slugify(value: string, fallback = 'workspace') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback;
}

async function requestContext(req: Request, options: { allowQueryEmail?: boolean } = {}) {
  const desktopToken = desktopBearerToken(req);
  if (desktopToken) {
    const desktopLink = await prisma.desktopLink.findFirst({
      where: { tokenHash: hashDesktopLinkToken(desktopToken) },
      include: { user: true, organization: true },
    });

    if (!desktopLink || desktopLink.status !== 'redeemed') {
      const error = new Error('This Mac is not linked to a valid Dbugr account. Relink it from onboarding.');
      error.name = 'UNAUTHENTICATED';
      throw error;
    }

    const exactMembership = await prisma.organizationMembership.findFirst({
      where: {
        userId: desktopLink.userId,
        organizationId: desktopLink.organizationId,
        status: 'active',
      },
      include: { organization: true, team: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!exactMembership) {
      const error = new Error('This linked Mac no longer has active access to this organization.');
      error.name = 'FORBIDDEN';
      throw error;
    }

    let membership = exactMembership;
    if (exactMembership.organization.id === 'org_demo') {
      const memberships = await prisma.organizationMembership.findMany({
        where: { userId: desktopLink.userId, status: 'active' },
        include: { organization: true, team: true },
        orderBy: { createdAt: 'desc' },
      });
      membership = preferredMembership(memberships, desktopLink.userId) ?? exactMembership;
    }

    logPhase2('desktop_token.context_loaded', {
      userId: desktopLink.userId,
      desktopLinkOrganizationId: desktopLink.organizationId,
      organizationId: membership.organization.id,
      desktopLinkId: desktopLink.id,
      deviceId: desktopLink.desktopDeviceId,
    });
    return { user: desktopLink.user, membership, organization: membership.organization };
  }

  const headerEmail = typeof req.headers['x-dbugr-user-email'] === 'string'
    ? req.headers['x-dbugr-user-email'].trim().toLowerCase()
    : '';
  const queryEmail = options.allowQueryEmail && typeof req.query.viewerEmail === 'string'
    ? req.query.viewerEmail.trim().toLowerCase()
    : '';
  const email = headerEmail || queryEmail;
  if (!email) return demoContext();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const error = new Error('No Dbugr account exists for this email. Finish onboarding first.');
    error.name = 'UNAUTHENTICATED';
    throw error;
  }

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id, status: 'active' },
    include: { organization: true, team: true },
    orderBy: { createdAt: 'desc' },
  });
  const membership = preferredMembership(memberships, user.id);
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

function mapDesktopSubmissionFlow(flow: 'direct' | 'team' | 'public') {
  if (flow === 'team') {
    return {
      visibility: 'org' as const,
      submissionFlow: 'internal_review' as const,
      reviewStatus: 'collecting_feedback' as const,
      nextAction: 'open_team_review' as const,
    };
  }

  if (flow === 'public') {
    return {
      visibility: 'public' as const,
      submissionFlow: 'public_feed' as const,
      reviewStatus: 'collecting_feedback' as const,
      nextAction: 'open_public_curation' as const,
    };
  }

  return {
    visibility: 'private' as const,
    submissionFlow: 'direct' as const,
    reviewStatus: 'draft' as const,
    nextAction: 'local_ai_handoff' as const,
  };
}

async function ensureDefaultProject(organizationId: string, visibilityDefault = 'private') {
  const existing = await prisma.project.findFirst({
    where: { organizationId, slug: 'desktop-captures' },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  return prisma.project.create({
    data: {
      organizationId,
      name: 'Desktop captures',
      slug: 'desktop-captures',
      visibilityDefault,
    },
  });
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

const desktopSubmissionStatusSchema = z.object({
  status: z.enum(['sent', 'failed', 'completed']),
  providerResponse: z.string().optional(),
});

const desktopSessionSyncSchema = z.object({
  localSessionId: z.string().min(1),
  title: z.string().min(1),
  about: z.string().optional(),
  sessionNote: z.string().optional(),
  projectFolder: z.string().optional(),
  githubRepo: z.string().optional(),
  submissionFlow: z.enum(['direct', 'team', 'public']),
  providerTarget: z.enum(['claude', 'codex', 'cursor']).optional(),
  captures: z.array(z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    note: z.string().optional(),
    screenshotUrl: z.string().optional(),
    previewDataUrl: z.string().optional(),
    timestampMs: z.number().int().nonnegative().optional(),
    annotations: z.array(z.object({
      id: z.string().min(1),
      text: z.string().optional(),
      type: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })).default([]),
  })).default([]),
});

const SQLITE_INT_MAX = 2_147_483_647;

function normalizeDesktopCaptureTimestampMs(
  capture: z.infer<typeof desktopSessionSyncSchema>['captures'][number],
  index: number,
  firstCaptureTimestampMs: number | null,
) {
  const raw = capture.timestampMs;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return index;
  if (raw <= SQLITE_INT_MAX) return raw;
  if (firstCaptureTimestampMs !== null && raw >= firstCaptureTimestampMs) {
    return Math.min(raw - firstCaptureTimestampMs, SQLITE_INT_MAX);
  }
  return index;
}

function uniqueNonEmptyText(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

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

const adminMemberUpdateSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'reviewer', 'guest']).optional(),
  status: z.enum(['active', 'invited', 'revoked']).optional(),
  teamId: z.string().nullable().optional(),
});

const adminInviteCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'reviewer', 'guest']).default('member'),
  teamId: z.string().nullable().optional(),
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

function createDesktopLinkToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashDesktopLinkToken(token: string) {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function desktopBearerToken(req: Request) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice('bearer '.length).trim();
  }
  const headerToken = req.headers['x-dbugr-desktop-token'];
  return typeof headerToken === 'string' ? headerToken.trim() : '';
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

function platformAdminEmails() {
  return new Set(
    (process.env.DEBUGR_SUPER_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPlatformAdmin(user: { email: string; role: string }) {
  return ['owner', 'admin', 'super_admin', 'platform_admin'].includes(user.role) ||
    platformAdminEmails().has(user.email.toLowerCase());
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

async function activeWorkspaceForUser(userId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, status: 'active' },
    include: { organization: true, team: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) return null;

  return {
    organization: membership.organization,
    membership,
  };
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
    `${webBaseUrl}/downloads/dbugr-ai-0.0.1-macos-aarch64.dmg`;

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
  const forcePreviewDelivery =
    req.headers['x-dbugr-test-preview-email'] === '1' &&
    process.env.NODE_ENV !== 'production';
  emailCodeStore.set(email, {
    codeHash: hashEmailCode(code),
    expiresAt: Date.now() + 1000 * 60 * EMAIL_CODE_EXPIRY_MINUTES,
    attempts: 0,
  });

  try {
    const delivery = forcePreviewDelivery
      ? { delivered: false as const, provider: 'preview' as const }
      : await sendEmailCode(email, code);
    logPhase2('email_code.requested', {
      email,
      delivered: delivery.delivered,
      provider: delivery.provider,
      configured: emailProviderConfigured(),
      accountExists: Boolean(existingUser),
      forcePreviewDelivery,
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
    return res.status(401).json({ error: 'Incorrect Code Received. Enter the 6-digit code from your email.' });
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
  const workspace = await activeWorkspaceForUser(identity.user.id);
  logPhase2('email_code.verify_completed', {
    email,
    userId: identity.user.id,
    created: identity.created,
    hasWorkspace: Boolean(workspace),
    organizationId: workspace?.organization.id,
  });
  return res.json({
    data: {
      verified: true,
      user: identity.user,
      created: identity.created,
      welcomeEmailSent,
      workspace,
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
  const workspace = await activeWorkspaceForUser(identity.user.id);
  logPhase2('identity.ensure_completed', {
    email: identity.user.email,
    userId: identity.user.id,
    created: identity.created,
    authProvider: parsed.data.authProvider,
    hasWorkspace: Boolean(workspace),
    organizationId: workspace?.organization.id,
  });

  return res.status(identity.created ? 201 : 200).json({
    data: {
      user: identity.user,
      created: identity.created,
      welcomeEmailSent,
      workspace,
    },
  });
});

phase2Router.get('/phase2/admin/overview', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (!['owner', 'admin'].includes(membership.role)) {
    logPhase2('admin.overview_forbidden', {
      userId: user.id,
      organizationId: organization.id,
      role: membership.role,
    });
    return res.status(403).json({ error: 'Only workspace owners and admins can open the admin panel.' });
  }

  const [members, teams, invites, auditLogs, sessions, comments, desktopLinks] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId: organization.id },
      include: { user: true, team: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.team.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invite.findMany({
      where: { organizationId: organization.id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: organization.id },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.feedbackSession.findMany({
      where: { project: { organizationId: organization.id } },
      select: { id: true, createdBy: true },
    }),
    prisma.feedbackComment.findMany({
      where: { session: { project: { organizationId: organization.id } } },
      select: { id: true, authorId: true },
    }),
    prisma.desktopLink.findMany({
      where: { organizationId: organization.id },
      select: { id: true, userId: true },
    }),
  ]);

  const activity = members.map((member) => ({
    userId: member.userId,
    sessionCount: sessions.filter((session) => session.createdBy === member.userId).length,
    commentCount: comments.filter((comment) => comment.authorId === member.userId).length,
    desktopLinkCount: desktopLinks.filter((link) => link.userId === member.userId).length,
    lastSeenAt: member.user.lastSeenAt?.toISOString() ?? null,
  }));

  logPhase2('admin.overview_loaded', {
    userId: user.id,
    organizationId: organization.id,
    memberCount: members.length,
    inviteCount: invites.length,
    sessionCount: sessions.length,
  });

  return res.json({
    data: {
      viewer: user,
      organization,
      membership,
      members,
      teams,
      invites,
      auditLogs,
      activity,
      totals: {
        users: members.filter((member) => member.status === 'active').length,
        activeMembers: members.filter((member) => member.status === 'active').length,
        teams: teams.length,
        pendingInvites: invites.length,
        sessions: sessions.length,
        comments: comments.length,
        desktopLinks: desktopLinks.length,
      },
    },
  });
});

phase2Router.patch('/phase2/admin/members/:membershipId', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (!['owner', 'admin'].includes(membership.role)) {
    logPhase2('admin.member_update_forbidden', { userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only workspace owners and admins can manage member access.' });
  }

  const parsed = adminMemberUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('admin.member_update_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const target = await prisma.organizationMembership.findFirst({
    where: { id: req.params.membershipId, organizationId: organization.id },
    include: { user: true },
  });
  if (!target) {
    logPhase2('admin.member_update_not_found', { actorId: user.id, membershipId: req.params.membershipId });
    return res.status(404).json({ error: 'That member was not found in this workspace.' });
  }

  if (target.userId === user.id && parsed.data.status === 'revoked') {
    return res.status(400).json({ error: 'You cannot remove your own access from this workspace.' });
  }

  if (membership.role !== 'owner' && target.role === 'owner') {
    return res.status(403).json({ error: 'Only an owner can change another owner.' });
  }

  const updated = await prisma.organizationMembership.update({
    where: { id: target.id },
    data: {
      role: parsed.data.role ?? undefined,
      status: parsed.data.status ?? undefined,
      teamId: parsed.data.teamId === undefined ? undefined : parsed.data.teamId,
    },
    include: { user: true, team: true },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.admin_member_updated',
    targetType: 'organization_membership',
    targetId: updated.id,
    metadata: {
      targetEmail: target.user.email,
      role: updated.role,
      status: updated.status,
      teamId: updated.teamId,
    },
  });

  logPhase2('admin.member_updated', {
    actorId: user.id,
    organizationId: organization.id,
    membershipId: updated.id,
    targetUserId: updated.userId,
    role: updated.role,
    status: updated.status,
  });

  return res.json({ data: { member: updated } });
});

phase2Router.delete('/phase2/admin/members/:membershipId', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (!['owner', 'admin'].includes(membership.role)) {
    logPhase2('admin.member_revoke_forbidden', { userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only workspace owners and admins can remove members.' });
  }

  const target = await prisma.organizationMembership.findFirst({
    where: { id: req.params.membershipId, organizationId: organization.id },
    include: { user: true },
  });
  if (!target) {
    return res.status(404).json({ error: 'That member was not found in this workspace.' });
  }

  if (target.userId === user.id) {
    return res.status(400).json({ error: 'You cannot remove your own access from this workspace.' });
  }

  if (membership.role !== 'owner' && target.role === 'owner') {
    return res.status(403).json({ error: 'Only an owner can remove another owner.' });
  }

  const revoked = await prisma.organizationMembership.update({
    where: { id: target.id },
    data: { status: 'revoked' },
    include: { user: true, team: true },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.admin_member_removed',
    targetType: 'organization_membership',
    targetId: revoked.id,
    metadata: { targetEmail: target.user.email, previousRole: target.role },
  });

  logPhase2('admin.member_removed', {
    actorId: user.id,
    organizationId: organization.id,
    membershipId: revoked.id,
    targetUserId: revoked.userId,
  });

  return res.json({ data: { member: revoked } });
});

phase2Router.post('/phase2/admin/invites', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (!['owner', 'admin'].includes(membership.role)) {
    logPhase2('admin.invite_create_forbidden', { userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only workspace owners and admins can invite teammates.' });
  }

  const parsed = adminInviteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('admin.invite_create_validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const activeMembership = await prisma.organizationMembership.findFirst({
    where: { organizationId: organization.id, user: { email }, status: 'active' },
    include: { user: true },
  });
  if (activeMembership) {
    return res.status(409).json({ error: `${email} is already an active member of this workspace.` });
  }

  const existingInvite = await prisma.invite.findFirst({
    where: {
      organizationId: organization.id,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (existingInvite) {
    return res.status(409).json({ error: `${email} already has a pending invite.` });
  }

  const token = createInviteToken();
  const invite = await prisma.invite.create({
    data: {
      organizationId: organization.id,
      teamId: parsed.data.teamId ?? null,
      email,
      role: parsed.data.role,
      tokenHash: hashInviteToken(token),
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.admin_invite_created',
    targetType: 'invite',
    targetId: invite.id,
    metadata: { email, role: invite.role, teamId: invite.teamId },
  });

  logPhase2('admin.invite_created', {
    actorId: user.id,
    organizationId: organization.id,
    inviteId: invite.id,
    email,
    role: invite.role,
    teamId: invite.teamId,
  });

  return res.status(201).json({
    data: {
      invite: {
        ...invite,
        acceptUrl: `/onboarding?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
      },
    },
  });
});

phase2Router.delete('/phase2/admin/invites/:inviteId', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (!['owner', 'admin'].includes(membership.role)) {
    logPhase2('admin.invite_revoke_forbidden', { userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only workspace owners and admins can revoke invites.' });
  }

  const invite = await prisma.invite.findFirst({
    where: { id: req.params.inviteId, organizationId: organization.id, revokedAt: null },
  });
  if (!invite) {
    return res.status(404).json({ error: 'That invite was not found or was already removed.' });
  }

  const revoked = await prisma.invite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.admin_invite_revoked',
    targetType: 'invite',
    targetId: revoked.id,
    metadata: { email: revoked.email, role: revoked.role },
  });

  logPhase2('admin.invite_revoked', {
    actorId: user.id,
    organizationId: organization.id,
    inviteId: revoked.id,
    email: revoked.email,
  });

  return res.json({ data: { invite: revoked } });
});

phase2Router.delete('/phase2/admin/audit/:auditLogId', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  if (membership.role !== 'owner') {
    logPhase2('admin.audit_delete_forbidden', { userId: user.id, role: membership.role });
    return res.status(403).json({ error: 'Only workspace owners can remove audit items from this admin view.' });
  }

  const audit = await prisma.auditLog.findFirst({
    where: { id: req.params.auditLogId, organizationId: organization.id },
  });
  if (!audit) {
    return res.status(404).json({ error: 'That audit item was not found.' });
  }

  await prisma.auditLog.delete({ where: { id: audit.id } });
  logPhase2('admin.audit_deleted', {
    actorId: user.id,
    organizationId: organization.id,
    auditLogId: audit.id,
    auditAction: audit.action,
  });

  return res.json({ data: { deleted: true, auditLogId: audit.id } });
});

phase2Router.get('/phase2/platform-admin/overview', async (req: Request, res: Response) => {
  const email = typeof req.headers['x-dbugr-user-email'] === 'string'
    ? req.headers['x-dbugr-user-email'].trim().toLowerCase()
    : '';
  if (!email) {
    return res.status(401).json({ error: 'Sign in before opening the platform admin panel.' });
  }

  const viewer = await prisma.user.findUnique({ where: { email } });
  if (!viewer || !isPlatformAdmin(viewer)) {
    logPhase2('platform_admin.overview_forbidden', { email, userId: viewer?.id });
    return res.status(403).json({ error: 'Only Dbugr platform admins can search across all organizations.' });
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : '';

  const [users, organizations, memberships, invites, sessions, comments] = await Promise.all([
    prisma.user.findMany({
      where: query ? {
        OR: [
          { email: { contains: query } },
          { name: { contains: query } },
        ],
      } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.organization.findMany({
      where: organizationId ? { id: organizationId } : query ? { name: { contains: query } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.organizationMembership.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: { organization: true, team: true },
    }),
    prisma.invite.findMany({
      where: { acceptedAt: null, revokedAt: null, ...(organizationId ? { organizationId } : {}) },
    }),
    prisma.feedbackSession.findMany({
      where: organizationId ? { project: { organizationId } } : undefined,
      select: { id: true, createdBy: true, project: { select: { organizationId: true } } },
    }),
    prisma.feedbackComment.findMany({
      where: organizationId ? { session: { project: { organizationId } } } : undefined,
      select: { id: true, authorId: true },
    }),
  ]);

  const scopedOrganizationIds = new Set(organizations.map((organization) => organization.id));
  const userSummaries = users.map((listedUser) => {
    const userMemberships = memberships.filter((entry) =>
      entry.userId === listedUser.id && (!organizationId || entry.organizationId === organizationId),
    );

    return {
      user: listedUser,
      memberships: userMemberships,
      sessionCount: sessions.filter((session) => session.createdBy === listedUser.id).length,
      commentCount: comments.filter((comment) => comment.authorId === listedUser.id).length,
      lastSeenAt: listedUser.lastSeenAt?.toISOString() ?? null,
    };
  }).filter((summary) => !organizationId || summary.memberships.length > 0);

  const organizationSummaries = organizations.map((organization) => ({
    organization,
    memberCount: memberships.filter((entry) => entry.organizationId === organization.id).length,
    pendingInvites: invites.filter((invite) => invite.organizationId === organization.id).length,
    sessionCount: sessions.filter((session) => session.project.organizationId === organization.id).length,
  }));

  logPhase2('platform_admin.overview_loaded', {
    actorId: viewer.id,
    query,
    organizationId,
    userCount: userSummaries.length,
    organizationCount: organizationSummaries.length,
  });

  return res.json({
    data: {
      viewer,
      users: userSummaries,
      organizations: organizationSummaries,
      totals: {
        users: userSummaries.length,
        organizations: organizationSummaries.length,
        activeMemberships: memberships.filter((entry) =>
          entry.status === 'active' && (!scopedOrganizationIds.size || scopedOrganizationIds.has(entry.organizationId)),
        ).length,
        pendingInvites: invites.length,
        sessions: sessions.length,
        comments: comments.length,
      },
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

  if (link.status === 'redeemed') {
    logPhase2('desktop_link.redeem_already_redeemed', { linkId: link.id });
    return res.status(409).json({ error: 'Desktop link code was already redeemed. Create a fresh link from onboarding to connect another app.' });
  }

  if (link.expiresAt.getTime() < Date.now()) {
    await prisma.desktopLink.update({ where: { id: link.id }, data: { status: 'expired' } });
    logPhase2('desktop_link.redeem_expired', { linkId: link.id });
    return res.status(410).json({ error: 'Desktop link code expired. Create a new link from onboarding.' });
  }

  const desktopLinkToken = createDesktopLinkToken();
  const redeemed = await prisma.desktopLink.update({
    where: { id: link.id },
    data: {
      status: 'redeemed',
      redeemedAt: new Date(),
      desktopDeviceId: parsed.data.desktopDeviceId ?? crypto.randomUUID(),
      desktopDeviceName: parsed.data.desktopDeviceName ?? 'Dbugr Mac app',
      tokenHash: hashDesktopLinkToken(desktopLinkToken),
    },
  });

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
    tokenPersisted: Boolean(redeemed.tokenHash),
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

phase2Router.post('/phase2/desktop-sessions/sync', async (req: Request, res: Response) => {
  const parsed = desktopSessionSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('desktop_session_sync.validation_failed', { issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  const mapping = mapDesktopSubmissionFlow(parsed.data.submissionFlow);
  const project = await ensureDefaultProject(organization.id, organization.defaultVisibility);
  const desktopMetadata = {
    source: 'desktop',
    localSessionId: parsed.data.localSessionId,
    providerTarget: parsed.data.providerTarget ?? null,
    syncedAt: new Date().toISOString(),
  };

  logPhase2('desktop_session_sync.started', {
    userId: user.id,
    organizationId: organization.id,
    localSessionId: parsed.data.localSessionId,
    desktopFlow: parsed.data.submissionFlow,
    visibility: mapping.visibility,
    submissionFlow: mapping.submissionFlow,
    captureCount: parsed.data.captures.length,
  });

  const existingSession = await prisma.feedbackSession.findFirst({
    where: {
      createdBy: user.id,
      project: { organizationId: organization.id },
      aiTaskBrief: { contains: parsed.data.localSessionId },
    },
    orderBy: { createdAt: 'desc' },
  });

  const session = existingSession
    ? await prisma.feedbackSession.update({
        where: { id: existingSession.id },
        data: {
          title: parsed.data.title,
          about: parsed.data.about ?? parsed.data.sessionNote ?? existingSession.about,
          projectFolder: parsed.data.projectFolder ?? null,
          githubRepo: parsed.data.githubRepo ?? null,
          teamId: membership.teamId ?? null,
          visibility: mapping.visibility,
          submissionFlow: mapping.submissionFlow,
          reviewStatus: mapping.reviewStatus,
          status: mapping.submissionFlow === 'direct' ? 'ready' : 'published',
          publicPublishedAt: mapping.visibility === 'public'
            ? (existingSession.publicPublishedAt ?? new Date())
            : null,
          aiTaskBrief: JSON.stringify(desktopMetadata),
        },
      })
    : await prisma.feedbackSession.create({
        data: {
          projectId: project.id,
          createdBy: user.id,
          teamId: membership.teamId ?? null,
          title: parsed.data.title,
          about: parsed.data.about ?? parsed.data.sessionNote ?? null,
          projectFolder: parsed.data.projectFolder ?? null,
          githubRepo: parsed.data.githubRepo ?? null,
          visibility: mapping.visibility,
          submissionFlow: mapping.submissionFlow,
          reviewStatus: mapping.reviewStatus,
          status: mapping.submissionFlow === 'direct' ? 'ready' : 'published',
          publicPublishedAt: mapping.visibility === 'public' ? new Date() : null,
          aiTaskBrief: JSON.stringify(desktopMetadata),
        },
      });

  await prisma.feedbackFrame.deleteMany({ where: { feedbackSessionId: session.id } });
  const firstCaptureTimestampMs = parsed.data.captures.find((capture) => Number.isFinite(capture.timestampMs))?.timestampMs ?? null;
  const frameInputs = parsed.data.captures.map((capture, index) => {
    const annotationNotes = capture.annotations
      .filter((annotation) => annotation.text?.trim())
      .map((annotation) => annotation.text?.trim());
    const description = uniqueNonEmptyText([capture.note, ...annotationNotes]).join('\n\n') || capture.title || 'Desktop capture';

    return {
      feedbackSessionId: session.id,
      timestampMs: normalizeDesktopCaptureTimestampMs(capture, index, firstCaptureTimestampMs),
      imageUrl: capture.screenshotUrl ?? capture.previewDataUrl ?? 'desktop-capture://pending-upload',
      cursorX: 0,
      cursorY: 0,
      clickType: 'desktop-sync',
      description,
    };
  });
  if (frameInputs.length) {
    await prisma.feedbackFrame.createMany({ data: frameInputs });
  }

  let syncedAnnotationCount = 0;
  for (const capture of parsed.data.captures) {
    for (const annotation of capture.annotations) {
      const body = annotation.text?.trim();
      if (!body) continue;
      syncedAnnotationCount += 1;
    }
  }

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.desktop_session_synced',
    targetType: 'feedbackSession',
    targetId: session.id,
    metadata: {
      localSessionId: parsed.data.localSessionId,
      desktopFlow: parsed.data.submissionFlow,
      visibility: mapping.visibility,
      submissionFlow: mapping.submissionFlow,
      captureCount: parsed.data.captures.length,
      annotationCount: syncedAnnotationCount,
    },
  });

  const syncedSession = await prisma.feedbackSession.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      creator: true,
      project: { include: { organization: true } },
      comments: { include: { author: true, curationDecisions: true }, orderBy: { createdAt: 'desc' } },
      frames: true,
      _count: { select: { comments: true, frames: true, curationDecisions: true, submissions: true } },
    },
  });

  logPhase2('desktop_session_sync.completed', {
    sessionId: session.id,
    userId: user.id,
    organizationId: organization.id,
    nextAction: mapping.nextAction,
    syncedFrameCount: frameInputs.length,
    syncedAnnotationCount,
  });

  return res.status(existingSession ? 200 : 201).json({
    data: {
      session: syncedSession,
      mapping: {
        desktopFlow: parsed.data.submissionFlow,
        visibility: mapping.visibility,
        submissionFlow: mapping.submissionFlow,
        reviewStatus: mapping.reviewStatus,
      },
      syncedFrameCount: frameInputs.length,
      syncedAnnotationCount,
      nextAction: mapping.nextAction,
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

phase2Router.get('/phase2/frames/:id/image', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req, { allowQueryEmail: true });
  } catch (error) {
    return handleContextError(error, res);
  }
  const { user, organization } = context;

  const frame = await prisma.feedbackFrame.findFirst({
    where: {
      id: req.params.id,
      session: {
        OR: [
          { createdBy: user.id },
          { visibility: 'public' },
          { project: { organizationId: organization.id }, visibility: { in: ['org', 'public'] } },
        ],
      },
    },
    include: { session: true },
  });

  if (!frame) {
    return res.status(404).type(SVG_PLACEHOLDER).send(svgPlaceholder('Capture not found'));
  }

  const imageUrl = frame.imageUrl || '';
  if (imageUrl.startsWith('data:image/')) {
    const [meta, data] = imageUrl.split(',', 2);
    const mime = meta.match(/^data:([^;]+)/)?.[1] || 'image/png';
    return res.type(mime).send(Buffer.from(data || '', imageUrl.includes(';base64,') ? 'base64' : 'utf8'));
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return res.redirect(imageUrl);
  }

  if (isProbablyLocalPath(imageUrl)) {
    const resolved = path.resolve(imageUrl);
    if (isAllowedScreenshotPath(resolved) && await canReadFile(resolved)) {
      return res.sendFile(resolved);
    }
  }

  logPhase2('frame_image.placeholder_returned', {
    frameId: frame.id,
    sessionId: frame.feedbackSessionId,
    imageUrlScheme: imageUrl.split(':')[0] || 'empty',
  });
  return res
    .type(SVG_PLACEHOLDER)
    .send(svgPlaceholder(frame.session.title, frame.description || 'Capture exists, but the original image is not available to the browser.'));
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
  const existingContribution = await prisma.feedbackComment.findFirst({
    where: {
      feedbackSessionId: req.params.id,
      authorId: user.id,
      sourceScope: { in: ['team', 'public'] },
      parentCommentId: null,
    },
    orderBy: { createdAt: 'asc' },
  });
  const contribution = existingContribution
    ? await prisma.$transaction(async (tx) => {
        await tx.curationDecision.deleteMany({ where: { contributionId: existingContribution.id } });
        return tx.feedbackComment.update({
          where: { id: existingContribution.id },
          data: {
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
      })
    : await prisma.feedbackComment.create({
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
    action: existingContribution ? 'phase2.contribution_updated' : 'phase2.contribution_created',
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId ?? req.params.id,
    metadata: { sessionId: req.params.id, contributionType: parsed.data.contributionType, visibility: parsed.data.visibility },
  });
  logPhase2(existingContribution ? 'contribution.updated' : 'contribution.created', {
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

phase2Router.get('/phase2/desktop-submissions/:id', async (req: Request, res: Response) => {
  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: {
      session: {
        include: {
          project: true,
          creator: true,
          comments: { include: { author: true, curationDecisions: true }, orderBy: { createdAt: 'desc' } },
          frames: true,
          _count: { select: { comments: true, frames: true, curationDecisions: true, submissions: true } },
        },
      },
    },
  });
  if (!submission || submission.session.project.organizationId !== organization.id) {
    logPhase2('desktop_submission_handoff.not_found', { submissionId: req.params.id, userId: user.id });
    return res.status(404).json({ error: 'Submission not found for this workspace.' });
  }
  if (!canManageSession(membership.role, submission.session.createdBy, user.id)) {
    logPhase2('desktop_submission_handoff.permission_denied', {
      submissionId: submission.id,
      sessionId: submission.feedbackSessionId,
      userId: user.id,
      role: membership.role,
    });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can send this submission.' });
  }

  logPhase2('desktop_submission_handoff.loaded', {
    submissionId: submission.id,
    sessionId: submission.feedbackSessionId,
    providerTarget: submission.providerTarget,
    status: submission.status,
    promptChars: submission.finalPrompt.length,
  });

  return res.json({
    data: {
      submission,
      session: submission.session,
      finalPrompt: submission.finalPrompt,
      providerTarget: submission.providerTarget,
      projectFolder: submission.session.projectFolder,
      githubRepo: submission.session.githubRepo,
    },
  });
});

phase2Router.post('/phase2/desktop-submissions/:id/status', async (req: Request, res: Response) => {
  const parsed = desktopSubmissionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    logPhase2('desktop_submission_status.validation_failed', { submissionId: req.params.id, issues: parsed.error.issues.length });
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let context;
  try {
    context = await requestContext(req);
  } catch (error) {
    return handleContextError(error, res);
  }

  const { user, membership, organization } = context;
  const existing = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: { session: { include: { project: true } } },
  });
  if (!existing || existing.session.project.organizationId !== organization.id) {
    logPhase2('desktop_submission_status.not_found', { submissionId: req.params.id, userId: user.id });
    return res.status(404).json({ error: 'Submission not found for this workspace.' });
  }
  if (!canManageSession(membership.role, existing.session.createdBy, user.id)) {
    logPhase2('desktop_submission_status.permission_denied', {
      submissionId: existing.id,
      sessionId: existing.feedbackSessionId,
      userId: user.id,
      role: membership.role,
    });
    return res.status(403).json({ error: 'Only the session owner, org owner, or org admin can update this submission.' });
  }

  const updated = await prisma.submission.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.status,
      providerResponse: parsed.data.providerResponse ?? existing.providerResponse,
      completedAt: parsed.data.status === 'completed' ? new Date() : existing.completedAt,
    },
  });

  await auditLog({
    organizationId: organization.id,
    actorId: user.id,
    action: 'phase2.desktop_submission_status_updated',
    targetType: 'submission',
    targetId: updated.id,
    metadata: {
      sessionId: updated.feedbackSessionId,
      providerTarget: updated.providerTarget,
      status: updated.status,
    },
  });
  logPhase2('desktop_submission_status.updated', {
    submissionId: updated.id,
    sessionId: updated.feedbackSessionId,
    status: updated.status,
  });
  return res.json({ data: updated });
});
