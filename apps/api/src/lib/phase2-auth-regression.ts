import './local-env';
import { prisma } from '@feedbackagent/db';

const BASE = process.env.PHASE2_API_BASE_URL ?? 'http://127.0.0.1:3001/api';

type ApiEnvelope<T> = {
  data?: T;
  error?: unknown;
};

type EmailCodeRequest = {
  delivered: boolean;
  provider: 'resend' | 'preview';
  accountExists: boolean;
  expiresInMinutes: number;
  previewCode: string | null;
};

type WorkspaceSummary = {
  organization: {
    id: string;
    name: string;
    defaultVisibility?: 'private' | 'org' | 'public';
  };
  membership: {
    id: string;
    role: string;
    team?: { name: string } | null;
  };
};

type IdentityResponse = {
  verified?: boolean;
  user: { id: string; name: string; email: string };
  created: boolean;
  welcomeEmailSent: boolean;
  workspace?: WorkspaceSummary | null;
};

type OnboardingResponse = {
  user: { id: string; email: string; name: string; profileRole?: string | null };
  organization: { id: string; name: string; defaultVisibility: string };
  membership: { id: string; role: string };
  invites: Array<{ id: string; email: string; acceptUrl?: string }>;
};

type AdminOverview = {
  organization: { id: string; name: string };
  members: Array<{ id: string; role: string; status: string; userId?: string; user: { email: string } }>;
  invites: Array<{ id: string; email: string; role: string; revokedAt?: string | null }>;
  auditLogs: Array<{ id: string; action: string }>;
  totals?: { users: number; activeMembers: number; pendingInvites: number };
};

type AdminInviteResponse = {
  invite: { id: string; email: string; role: string; acceptUrl?: string };
};

type DesktopLinkResponse = {
  linkId: string;
  code: string;
  deepLinkUrl: string;
  expiresAt: string;
  status: 'pending' | 'redeemed' | 'expired';
};

type DesktopLinkRedeemResponse = {
  desktopLinkToken: string;
  desktopLink: { id: string; status: string; redeemedAt?: string | null };
  user: { email: string; profileRole?: string | null };
  organization: { name: string };
};

type PublicFeedResponse = {
  scope: string;
  sessions: Array<{
    id: string;
    creator?: { email?: string | null };
    comments?: Array<{ author?: { email?: string | null } }>;
  }>;
};

type RequestOptions = RequestInit & {
  expectedStatus?: number;
  allowFailure?: boolean;
};

const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function log(event: string, details: Record<string, unknown> = {}) {
  console.info(`[phase2-auth-regression] ${event}`, {
    runId,
    ...details,
  });
}

function redactEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 4)}***@${domain}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request<T>(label: string, path: string, options: RequestOptions = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const raw = await response.text();
  const json = raw ? JSON.parse(raw) as ApiEnvelope<T> : {};
  const durationMs = Date.now() - startedAt;
  const expectedStatus = options.expectedStatus ?? 200;

  log('http.completed', {
    label,
    method: options.method ?? 'GET',
    path,
    status: response.status,
    expectedStatus,
    durationMs,
  });

  if (response.status !== expectedStatus && !options.allowFailure) {
    throw new Error(`${label} expected HTTP ${expectedStatus}, got ${response.status}: ${raw}`);
  }

  return {
    status: response.status,
    data: json.data as T,
    error: json.error,
    raw,
  };
}

async function requestPreviewCode(email: string) {
  const result = await request<EmailCodeRequest>('request preview email code', '/phase2/auth/email-code/request', {
    method: 'POST',
    expectedStatus: 201,
    headers: { 'x-dbugr-test-preview-email': '1' },
    body: JSON.stringify({ email }),
  });

  assert(result.data.previewCode, `Expected preview code for ${redactEmail(email)}`);
  assert(/^\d{6}$/.test(result.data.previewCode), 'Preview code must be a 6-digit string');
  return result.data;
}

async function verifyCode(email: string, code: string, expectedStatus = 200) {
  return request<IdentityResponse>('verify email code', '/phase2/auth/email-code/verify', {
    method: 'POST',
    expectedStatus,
    body: JSON.stringify({ email, code }),
  });
}

async function createWorkspace(email: string, name: string, organizationName: string) {
  const result = await request<OnboardingResponse>('create workspace', '/phase2/onboarding', {
    method: 'POST',
    expectedStatus: 201,
    body: JSON.stringify({
      email,
      name,
      authProvider: 'email',
      organizationName,
      role: 'Founder',
      teamName: 'Product',
      defaultVisibility: 'org',
      inviteEmails: [`reviewer-${runId}@example.com`],
    }),
  });
  assert(result.data.membership.role === 'owner', 'Workspace creator should become owner');
  assert(result.data.user.profileRole === 'Founder', 'Workspace creator profile role should preserve the web onboarding role');
  assert(result.data.invites.length === 1, 'Workspace should stage exactly one invite');
  return result.data;
}

async function scenarioNewUserSignupThenExistingDashboard() {
  const email = `phase2-new-${runId}@example.com`;
  const name = 'Phase Two New User';
  const organizationName = `Phase 2 Regression ${runId}`;

  log('scenario.started', { scenario: 'new_user_signup_then_existing_dashboard', email: redactEmail(email) });
  const firstCode = await requestPreviewCode(email);
  assert(!firstCode.accountExists, 'Brand-new email should report accountExists=false');

  const firstVerify = await verifyCode(email, firstCode.previewCode!);
  assert(firstVerify.data.created, 'First email-code verification should create the user');
  assert(!firstVerify.data.workspace, 'New user should not have a workspace before onboarding');

  const workspace = await createWorkspace(email, name, organizationName);
  assert(workspace.organization.name === organizationName, 'Created workspace should preserve organization name');

  const secondCode = await requestPreviewCode(email);
  assert(secondCode.accountExists, 'Existing email should report accountExists=true after workspace creation');
  const secondVerify = await verifyCode(email, secondCode.previewCode!);
  assert(!secondVerify.data.created, 'Existing email-code verification should not create another user');
  assert(secondVerify.data.workspace, 'Existing user with workspace should receive workspace redirect payload');
  assert(secondVerify.data.workspace?.organization.name === organizationName, 'Existing workspace payload should match user organization');

  log('scenario.passed', { scenario: 'new_user_signup_then_existing_dashboard', organizationId: workspace.organization.id });
  return { email, name, organizationName, workspace };
}

async function scenarioExistingUserWithoutWorkspaceStillSetsUpWorkspace() {
  const email = `phase2-no-workspace-${runId}@example.com`;

  log('scenario.started', { scenario: 'existing_user_without_workspace', email: redactEmail(email) });
  const firstCode = await requestPreviewCode(email);
  const firstVerify = await verifyCode(email, firstCode.previewCode!);
  assert(firstVerify.data.created, 'First verification should create no-workspace user');

  const secondCode = await requestPreviewCode(email);
  assert(secondCode.accountExists, 'Second request should detect existing no-workspace account');
  const secondVerify = await verifyCode(email, secondCode.previewCode!);
  assert(!secondVerify.data.created, 'Second verification should reuse existing no-workspace user');
  assert(!secondVerify.data.workspace, 'Existing user without active membership should stay in workspace setup');

  log('scenario.passed', { scenario: 'existing_user_without_workspace' });
}

async function scenarioWrongCodeFriendlyError() {
  const email = `phase2-wrong-code-${runId}@example.com`;

  log('scenario.started', { scenario: 'wrong_code_friendly_error', email: redactEmail(email) });
  await requestPreviewCode(email);
  const result = await verifyCode(email, '000000', 401);
  assert(
    result.error === 'Incorrect Code Received. Enter the 6-digit code from your email.',
    `Wrong-code error should be user-friendly, got ${JSON.stringify(result.error)}`,
  );

  log('scenario.passed', { scenario: 'wrong_code_friendly_error' });
}

async function scenarioGoogleResolvesExistingEmail(email: string, organizationName: string) {
  log('scenario.started', { scenario: 'google_resolves_existing_email', email: redactEmail(email) });
  const result = await request<IdentityResponse>('google ensure identity', '/phase2/auth/identity/ensure', {
    method: 'POST',
    body: JSON.stringify({
      email,
      name: 'Phase Two Google Linked User',
      authProvider: 'google',
    }),
  });

  assert(!result.data.created, 'Google sign-in should reuse the existing email account');
  assert(result.data.workspace?.organization.name === organizationName, 'Google sign-in should return existing workspace');
  log('scenario.passed', { scenario: 'google_resolves_existing_email' });
}

async function scenarioAdminOwnerCanInspectWorkspace(email: string) {
  log('scenario.started', { scenario: 'admin_owner_can_inspect_workspace', email: redactEmail(email) });
  const result = await request<AdminOverview>('admin overview', '/phase2/admin/overview', {
    headers: { 'x-dbugr-user-email': email },
  });

  assert(result.data.members.length >= 1, 'Admin overview should include at least the workspace owner');
  assert(result.data.invites.length >= 1, 'Admin overview should include staged invite for regression workspace');
  assert(
    result.data.totals?.users === result.data.members.filter((member) => member.status === 'active').length,
    'Admin total users should count only active users',
  );
  assert(result.data.auditLogs.some((entry) => entry.action === 'phase2.onboarding_completed'), 'Admin audit log should include onboarding completion');

  const inviteEmail = `admin-added-${runId}@example.com`;
  const invite = await request<AdminInviteResponse>('admin create teammate invite', '/phase2/admin/invites', {
    method: 'POST',
    expectedStatus: 201,
    headers: { 'x-dbugr-user-email': email },
    body: JSON.stringify({ email: inviteEmail, role: 'reviewer' }),
  });
  assert(invite.data.invite.email === inviteEmail, 'Admin-created invite should preserve invite email');
  assert(invite.data.invite.role === 'reviewer', 'Admin-created invite should preserve invite role');
  assert(invite.data.invite.acceptUrl?.includes('/onboarding?invite='), 'Admin-created invite should include an onboarding accept URL');

  const duplicateInvite = await request('admin duplicate teammate invite', '/phase2/admin/invites', {
    method: 'POST',
    expectedStatus: 409,
    headers: { 'x-dbugr-user-email': email },
    body: JSON.stringify({ email: inviteEmail, role: 'reviewer' }),
  });
  assert(typeof duplicateInvite.error === 'string' && duplicateInvite.error.includes('pending invite'), 'Duplicate admin invite should explain the pending invite');

  await request('admin revoke teammate invite', `/phase2/admin/invites/${invite.data.invite.id}`, {
    method: 'DELETE',
    headers: { 'x-dbugr-user-email': email },
  });

  log('scenario.passed', {
    scenario: 'admin_owner_can_inspect_workspace',
    members: result.data.members.length,
    invites: result.data.invites.length,
  });
}

async function scenarioPlatformAdminIsProtected(email: string) {
  log('scenario.started', { scenario: 'platform_admin_is_protected', email: redactEmail(email) });
  const result = await request('platform admin protected', '/phase2/platform-admin/overview', {
    headers: { 'x-dbugr-user-email': email },
    expectedStatus: 403,
  });

  assert(result.status === 403, 'Platform admin endpoint should be forbidden without super-admin configuration');
  log('scenario.passed', { scenario: 'platform_admin_is_protected' });
}

async function scenarioAnonymousPublicFeedDoesNotRequireDemoContext() {
  log('scenario.started', { scenario: 'anonymous_public_feed_does_not_require_demo_context' });
  const result = await request<PublicFeedResponse>('anonymous public feed', '/phase2/feed?scope=public');

  assert(result.data.scope === 'public', 'Anonymous public feed should return the public scope');
  for (const session of result.data.sessions) {
    assert(!session.creator?.email, 'Anonymous public feed should not expose creator email addresses');
    for (const comment of session.comments ?? []) {
      assert(!comment.author?.email, 'Anonymous public feed should not expose comment author email addresses');
    }
  }

  log('scenario.passed', { scenario: 'anonymous_public_feed_does_not_require_demo_context' });
}

async function scenarioDesktopLinkHandshakePersistsAfterCodeExpiry(email: string) {
  log('scenario.started', { scenario: 'desktop_link_handshake_persists_after_code_expiry', email: redactEmail(email) });

  const created = await request<DesktopLinkResponse>('create desktop link', '/phase2/desktop-link', {
    method: 'POST',
    expectedStatus: 201,
    headers: { 'x-dbugr-user-email': email },
    body: JSON.stringify({ appUrl: 'http://localhost:3000' }),
  });
  assert(created.data.status === 'pending', 'New desktop link should start pending');
  assert(created.data.deepLinkUrl.startsWith('dbugr://link?'), 'Desktop link should use the dbugr deep-link scheme');

  const redeemed = await request<DesktopLinkRedeemResponse>('redeem desktop link', '/phase2/desktop-link/redeem', {
    method: 'POST',
    body: JSON.stringify({
      code: created.data.code,
      desktopDeviceId: `regression-${runId}`,
      desktopDeviceName: 'Regression Mac',
    }),
  });
  assert(redeemed.data.desktopLinkToken.length > 20, 'Redeemed desktop link should return a bearer token');
  assert(redeemed.data.desktopLink.status === 'redeemed', 'Redeemed desktop link should be marked redeemed');
  assert(redeemed.data.user.email === email, 'Redeemed desktop link should return the linked web user');
  assert(redeemed.data.user.profileRole === 'Founder', 'Redeemed desktop link should return the web profile role for Mac profile import');

  const duplicateRedeem = await request('redeem desktop link twice', '/phase2/desktop-link/redeem', {
    method: 'POST',
    expectedStatus: 409,
    body: JSON.stringify({
      code: created.data.code,
      desktopDeviceName: 'Duplicate Regression Mac',
    }),
  });
  assert(typeof duplicateRedeem.error === 'string' && duplicateRedeem.error.includes('already redeemed'), 'Redeeming the same desktop link twice should fail clearly');

  await prisma.desktopLink.update({
    where: { id: redeemed.data.desktopLink.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const bootstrap = await request<{ user: { email: string } }>('desktop token bootstrap after code expiry', '/phase2/bootstrap', {
    headers: { Authorization: `Bearer ${redeemed.data.desktopLinkToken}` },
  });
  assert(bootstrap.data.user.email === email, 'Redeemed desktop token should remain valid after the one-time code expiry');

  log('scenario.passed', { scenario: 'desktop_link_handshake_persists_after_code_expiry' });
}

async function main() {
  log('suite.started', { baseUrl: BASE });
  const primary = await scenarioNewUserSignupThenExistingDashboard();
  await scenarioExistingUserWithoutWorkspaceStillSetsUpWorkspace();
  await scenarioWrongCodeFriendlyError();
  await scenarioGoogleResolvesExistingEmail(primary.email, primary.organizationName);
  await scenarioDesktopLinkHandshakePersistsAfterCodeExpiry(primary.email);
  await scenarioAdminOwnerCanInspectWorkspace(primary.email);
  await scenarioPlatformAdminIsProtected(primary.email);
  await scenarioAnonymousPublicFeedDoesNotRequireDemoContext();
  log('suite.passed', { baseUrl: BASE });
}

void main().catch((error) => {
  console.error('[phase2-auth-regression] suite.failed', {
    runId,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});

export {};
