import './local-env';
import { prisma } from '@feedbackagent/db';
import { auditLog } from './audit';

const DIGEST_ACTION = 'phase2.comment_digest_sent';
const WINDOW_MINUTES = Number(process.env.COMMENT_DIGEST_WINDOW_MINUTES ?? 10);
const MAX_COMMENTS_PER_RUN = Number(process.env.COMMENT_DIGEST_MAX_COMMENTS ?? 100);
const DRY_RUN = process.env.COMMENT_DIGEST_DRY_RUN === '1';

function logDigest(event: string, details: Record<string, unknown> = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key.toLowerCase().includes('email') && typeof value === 'string') {
        const [local, domain] = value.split('@');
        return [key, `${local.slice(0, 2)}***@${domain ?? 'unknown'}`];
      }
      return [key, value];
    }),
  );
  console.info('[phase2-digest]', event, safeDetails);
}

function appUrl() {
  return (process.env.AUTH_URL || process.env.PUBLIC_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function emailConfigured() {
  return DRY_RUN || Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function excerpt(value: string, max = 180) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function htmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseDigestedCommentIds(metadataJson: string | null): string[] {
  if (!metadataJson) return [];
  try {
    const metadata = JSON.parse(metadataJson) as { commentIds?: unknown };
    return Array.isArray(metadata.commentIds)
      ? metadata.commentIds.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

async function alreadyDigestedCommentIds() {
  const logs = await prisma.auditLog.findMany({
    where: { action: DIGEST_ACTION },
    select: { metadataJson: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return new Set(logs.flatMap((log) => parseDigestedCommentIds(log.metadataJson)));
}

async function sendDigestEmail(params: {
  to: string;
  sessionTitle: string;
  organizationName: string;
  sessionId: string;
  comments: Array<{ authorName: string; body: string; createdAt: Date }>;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const reviewUrl = `${appUrl()}/feed?session=${encodeURIComponent(params.sessionId)}`;
  const rows = params.comments.map((comment) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #e9edf3;">
        <div style="font-weight:700;color:#1f2937;margin-bottom:4px;">${htmlEscape(comment.authorName)}</div>
        <div style="font-size:15px;line-height:1.55;color:#3f4652;">${htmlEscape(excerpt(comment.body, 240))}</div>
      </td>
    </tr>
  `).join('');
  const html = `
    <div style="margin:0;background:#f7fbff;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2f3337;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e9ff;border-radius:28px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px;background:#edf6ff;">
            <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#667085;font-weight:700;">Dbugr review digest</div>
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.08;margin:10px 0 8px;color:#252525;">New feedback is ready.</h1>
            <p style="font-size:16px;line-height:1.55;margin:0;color:#4f5661;">${params.comments.length} new comment${params.comments.length === 1 ? '' : 's'} landed on <strong>${htmlEscape(params.sessionTitle)}</strong> in ${htmlEscape(params.organizationName)}.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
            <a href="${reviewUrl}" style="display:inline-block;margin-top:24px;background:#0090ff;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 22px;">Review comments</a>
            <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">Dbugr batches comments for ${WINDOW_MINUTES} minutes so your team gets signal without inbox spam.</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  if (!emailConfigured() || DRY_RUN) {
    logDigest('email.preview', {
      toEmail: params.to,
      sessionId: params.sessionId,
      commentCount: params.comments.length,
      dryRun: DRY_RUN,
    });
    return { preview: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: `${params.comments.length} new Dbugr comment${params.comments.length === 1 ? '' : 's'} on ${params.sessionTitle}`,
      html,
      text: `${params.comments.length} new Dbugr comments on ${params.sessionTitle}. Review them at ${reviewUrl}`,
    }),
  });

  if (!response.ok) {
    const failure = await response.text().catch(() => '');
    throw new Error(`Resend digest email failed with ${response.status}: ${failure}`);
  }

  return { preview: false };
}

export async function runCommentDigestWorker() {
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  logDigest('run.started', {
    cutoff: cutoff.toISOString(),
    windowMinutes: WINDOW_MINUTES,
    emailConfigured: emailConfigured(),
    dryRun: DRY_RUN,
  });

  const digestedIds = await alreadyDigestedCommentIds();
  const comments = await prisma.feedbackComment.findMany({
    where: {
      createdAt: { lte: cutoff },
      id: { notIn: [...digestedIds] },
      sourceScope: { not: 'owner' },
    },
    include: {
      author: true,
      session: {
        include: {
          creator: true,
          project: { include: { organization: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_COMMENTS_PER_RUN,
  });

  const bySession = new Map<string, typeof comments>();
  for (const comment of comments) {
    bySession.set(comment.feedbackSessionId, [...(bySession.get(comment.feedbackSessionId) ?? []), comment]);
  }

  let sent = 0;
  let skipped = 0;
  for (const [sessionId, sessionComments] of bySession) {
    const session = sessionComments[0]?.session;
    if (!session) continue;
    const organization = session.project.organization;
    const memberships = await prisma.organizationMembership.findMany({
      where: { organizationId: organization.id, status: 'active' },
      include: { user: true },
    });
    const authorIds = new Set(sessionComments.map((comment) => comment.authorId));
    const recipients = memberships
      .map((membership) => membership.user)
      .filter((user) => !authorIds.has(user.id))
      .filter((user, index, users) => users.findIndex((item) => item.email === user.email) === index);

    if (recipients.length === 0) {
      skipped += 1;
      logDigest('session.skipped_no_recipients', {
        sessionId,
        organizationId: organization.id,
        commentCount: sessionComments.length,
      });
      continue;
    }

    let delivered = 0;
    for (const recipient of recipients) {
      await sendDigestEmail({
        to: recipient.email,
        sessionTitle: session.title,
        organizationName: organization.name,
        sessionId,
        comments: sessionComments.map((comment) => ({
          authorName: comment.author.name,
          body: comment.body,
          createdAt: comment.createdAt,
        })),
      });
      delivered += 1;
    }

    const commentIds = sessionComments.map((comment) => comment.id);
    if (!DRY_RUN) {
      await auditLog({
        organizationId: organization.id,
        actorId: session.createdBy,
        action: DIGEST_ACTION,
        targetType: 'feedbackSession',
        targetId: sessionId,
        metadata: {
          commentIds,
          recipientCount: recipients.length,
          windowMinutes: WINDOW_MINUTES,
        },
      });
    }

    sent += 1;
    logDigest(DRY_RUN ? 'session.previewed' : 'session.sent', {
      sessionId,
      organizationId: organization.id,
      commentCount: commentIds.length,
      recipientCount: delivered,
    });
  }

  logDigest('run.completed', {
    groupedSessions: bySession.size,
    sent,
    skipped,
    candidateComments: comments.length,
  });
}

declare const require: { main?: unknown } | undefined;
declare const module: unknown;

if (typeof require !== 'undefined' && require.main === module) {
  void runCommentDigestWorker().catch((error) => {
    console.error('[phase2-digest] run.failed', error);
    process.exitCode = 1;
  });
}
