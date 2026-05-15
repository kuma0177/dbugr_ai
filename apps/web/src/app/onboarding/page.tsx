'use client';

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { JourneyInfographic } from '@/app/journey-infographic';
import { api } from '@/lib/api';
import { clearOnboardingState, readOnboardingState, writeOnboardingState } from '@/lib/onboarding';

type OnboardingStep = 'sign-in' | 'workspace' | 'link';
type AuthFlow = 'sign-in' | 'sign-up';
const MAX_INVITE_EMAILS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_REPO_URL = 'https://github.com/kuma0177/debgr_ai';
const GITHUB_RELEASE_TAG = 'pre-open-source-ready-stable';
const DEFAULT_MAC_DMG_URL = `${GITHUB_REPO_URL}/releases/download/${GITHUB_RELEASE_TAG}/dbugr-ai-0.0.1-macos-aarch64.dmg`;
const MAC_DMG_DOWNLOAD_URL = process.env.NEXT_PUBLIC_MAC_DMG_URL ?? DEFAULT_MAC_DMG_URL;

type ExistingWorkspace = {
  organization: {
    name: string;
    logoUrl?: string | null;
    defaultVisibility?: 'private' | 'org' | 'public';
  };
  membership: {
    role: string;
    team?: { name: string } | null;
  };
};

type AuthSession = {
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

function deriveWorkspaceName(userName: string) {
  const firstName = userName.trim().split(/\s+/)[0] || 'My';
  return `${firstName}'s workspace`;
}

function initialAuthFlowFromLocation(): AuthFlow {
  if (typeof window === 'undefined') return 'sign-up';
  return new URLSearchParams(window.location.search).get('flow') === 'sign-in' ? 'sign-in' : 'sign-up';
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [role, setRole] = useState('Founder');
  const [teamName, setTeamName] = useState('Product');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [inviteEmailDraft, setInviteEmailDraft] = useState('');
  const [defaultVisibility, setDefaultVisibility] = useState<'private' | 'org' | 'public'>('private');
  const [organizationLogoPreview, setOrganizationLogoPreview] = useState<string | null>(null);
  const [organizationLogoName, setOrganizationLogoName] = useState('');
  const [authMethod, setAuthMethod] = useState<'google' | 'email' | null>(null);
  const [identityConnected, setIdentityConnected] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [expectedEmailCode, setExpectedEmailCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeError, setEmailCodeError] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [desktopLink, setDesktopLink] = useState<{ code: string; deepLinkUrl: string; expiresAt: string } | null>(null);
  const [desktopRedeemStatus, setDesktopRedeemStatus] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteLinks, setInviteLinks] = useState<Array<{ email: string; acceptUrl: string }>>([]);
  const [status, setStatus] = useState(() => {
    const initialFlow = initialAuthFlowFromLocation();
    return `${initialFlow === 'sign-in' ? 'Sign in' : 'Sign up'} with Google or email first, then create your organization workspace.`;
  });
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('sign-in');
  const [authFlow, setAuthFlow] = useState<AuthFlow>(initialAuthFlowFromLocation);
  const [autoRequestedEmailCode, setAutoRequestedEmailCode] = useState(false);

  const authAction = authFlow === 'sign-in' ? 'sign in' : 'sign up';
  const authActionTitle = authFlow === 'sign-in' ? 'Sign in' : 'Sign up';
  const authActionGerund = authFlow === 'sign-in' ? 'signing in' : 'signing up';

  async function completeGoogleIdentity(normalizedEmail: string, resolvedName?: string | null) {
    const displayName = resolvedName?.trim() || name || normalizedEmail.split('@')[0] || 'Dbugr user';
    const result = await api.phase2.ensureIdentity({
      email: normalizedEmail,
      name: displayName,
      authProvider: 'google',
    });
    const finalName = result.user.name || displayName;
    const resolvedFlow: AuthFlow = result.created ? 'sign-up' : 'sign-in';
    setAuthFlow(resolvedFlow);
    setName(finalName);
    setEmail(result.user.email);
    if (result.workspace) {
      continueExistingWorkspace(result.workspace, { name: finalName, email: result.user.email });
      return;
    }
    if (!organizationName.trim() || organizationName === 'Demo Organization') {
      setOrganizationName(deriveWorkspaceName(finalName));
    }
    setAuthMethod('google');
    setIdentityConnected(true);
    setCurrentStep('workspace');
    setStatus(
      result.created
        ? `Google sign up connected as ${normalizedEmail}. Your Dbugr account is now created${result.welcomeEmailSent ? ' and a welcome email is on the way.' : '.'}`
        : `Google sign in connected as ${normalizedEmail}. We matched it to your existing Dbugr account.`
    );
    console.info('[phase2-web] onboarding.google_identity_connected', { email: normalizedEmail, created: result.created });
  }

  async function completeGoogleOAuthSession() {
    setLoading(true);
    setStatus('Finishing Google sign in...');
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Google session failed with ${response.status}`);
      }
      const session = await response.json() as AuthSession;
      const sessionEmail = session.user?.email?.trim().toLowerCase();
      if (!sessionEmail) {
        throw new Error('Google did not return an email address for this account.');
      }
      await completeGoogleIdentity(sessionEmail, session.user?.name);
    } catch (error) {
      setStatus(`Could not complete Google sign in: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] onboarding.google_oauth_session_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingInvite = params.get('invite') ?? '';
    const incomingEmail = params.get('email') ?? '';
    const incomingAuth = params.get('auth');
    const launchedFromDesktop = params.get('desktop') === '1';
    const incomingFlow = params.get('flow') === 'sign-in' ? 'sign-in' : 'sign-up';
    const hasExplicitEntry = Boolean(incomingInvite || incomingAuth || incomingEmail || params.has('flow'));
    setAuthFlow(incomingFlow);
    setStatus(`${incomingFlow === 'sign-in' ? 'Sign in' : 'Sign up'} with Google or email first, then create your organization workspace.`);
    if (incomingAuth === 'google' || incomingAuth === 'email') {
      setAuthMethod(incomingAuth);
      setCurrentStep('sign-in');
      setStatus(incomingAuth === 'google'
        ? `Continue to Google ${incomingFlow === 'sign-in' ? 'sign-in' : 'sign-up'}, then continue to your workspace.`
        : `Request an email ${incomingFlow === 'sign-in' ? 'sign-in' : 'sign-up'} code, enter it here, then continue to your workspace.`);
      if (incomingAuth === 'google') {
        void completeGoogleOAuthSession();
      }
    }
    if (incomingInvite) {
      setInviteToken(incomingInvite);
      setStatus('Invite detected. Sign in or sign up, then accept the workspace invitation.');
    }
    if (incomingEmail) setEmail(incomingEmail);

    const localState = readOnboardingState();
    if (localState) {
      setName(localState.userName);
      if (!incomingEmail) {
        setEmail(localState.userEmail);
      }
      setOrganizationName(localState.organizationName);
      setOrganizationLogoPreview(localState.organizationLogoUrl ?? null);
      setOrganizationLogoName(localState.organizationLogoUrl ? 'Selected logo' : '');
      setRole(localState.role ?? '');
      setTeamName(localState.teamName ?? '');
      setInviteEmails(localState.inviteEmails);
      setDefaultVisibility(localState.defaultVisibility);
      if (!hasExplicitEntry) {
        setAuthMethod((current) => current ?? 'google');
        setIdentityConnected(true);
        setWorkspaceReady(true);
        setCurrentStep('link');
        setAuthFlow('sign-in');
        setStatus(`Workspace ready: ${localState.organizationName}. ${localState.inviteEmails.length} invite(s) staged.`);
      }
    }

    if (!hasExplicitEntry) {
      console.info('[phase2-web] onboarding.bootstrap.started');
      api.phase2.bootstrap()
        .then(async (data) => {
          if (!localState) {
            setName(data.user.name);
            if (!incomingEmail) {
              setEmail(data.user.email);
            }
            setOrganizationName(data.organization.name);
            setOrganizationLogoPreview(data.organization.logoUrl ?? null);
            setOrganizationLogoName(data.organization.logoUrl ? 'Saved logo' : '');
            setDefaultVisibility((data.organization.defaultVisibility as 'private' | 'org' | 'public') ?? 'private');
          }
          if (launchedFromDesktop) {
            setAuthMethod((current) => current ?? 'google');
            setIdentityConnected(true);
            setWorkspaceReady(true);
            setCurrentStep('link');
            setStatus(`Workspace ready: ${data.organization.name}. Link this Mac to continue in the desktop app.`);
            await createDesktopLink();
          }
          console.info('[phase2-web] onboarding.bootstrap.completed', {
            organizationId: data.organization.id,
            members: data.members.length,
            invites: data.invites.length,
          });
        })
        .catch((error) => {
          setStatus(`Bootstrap waiting on API: ${error instanceof Error ? error.message : String(error)}`);
          console.warn('[phase2-web] onboarding.bootstrap.failed', { message: error instanceof Error ? error.message : String(error) });
        });
    }
  }, []);

  useEffect(() => {
    if (
      authMethod === 'email' &&
      currentStep === 'sign-in' &&
      email.trim() &&
      !emailCodeSent &&
      !identityConnected &&
      !autoRequestedEmailCode
    ) {
      setAutoRequestedEmailCode(true);
      requestEmailCodePreview();
    }
  }, [authMethod, currentStep, email, emailCodeSent, identityConnected, autoRequestedEmailCode]);

  function normalizeInviteEmail(raw: string) {
    return raw.trim().toLowerCase().replace(/,$/, '');
  }

  function addInviteEmail(rawEmail: string) {
    const normalizedEmail = normalizeInviteEmail(rawEmail);
    if (!normalizedEmail) return;
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setStatus('Enter a valid teammate email before adding it.');
      return;
    }
    if (inviteEmails.includes(normalizedEmail)) {
      setStatus(`${normalizedEmail} is already in the invite list.`);
      return;
    }
    if (inviteEmails.length >= MAX_INVITE_EMAILS) {
      setStatus(`You can invite up to ${MAX_INVITE_EMAILS} teammates during onboarding.`);
      return;
    }
    setInviteEmails((current) => [...current, normalizedEmail]);
    setInviteEmailDraft('');
    setStatus(`Added ${normalizedEmail}. Existing Dbugr users will join with their current account; new users will receive a pending invite.`);
  }

  function removeInviteEmail(emailToRemove: string) {
    setInviteEmails((current) => current.filter((currentEmail) => currentEmail !== emailToRemove));
  }

  function handleInviteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addInviteEmail(inviteEmailDraft);
    }
  }

  function handleOrganizationLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Choose a PNG, JPG, SVG, or other image file for your organization logo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      setOrganizationLogoPreview(result);
      setOrganizationLogoName(file.name);
      setStatus(`Added ${file.name} as the organization logo preview.`);
    };
    reader.readAsDataURL(file);
  }

  function continueExistingWorkspace(workspace: ExistingWorkspace, user: { name: string; email: string }) {
    writeOnboardingState({
      userName: user.name,
      userEmail: user.email,
      organizationName: workspace.organization.name,
      organizationLogoUrl: workspace.organization.logoUrl ?? undefined,
      role: workspace.membership.role,
      teamName: workspace.membership.team?.name ?? '',
      defaultVisibility: workspace.organization.defaultVisibility ?? 'private',
      inviteEmails: [],
      completedAt: new Date().toISOString(),
    });
    setStatus(`Welcome back, ${user.name}. Opening your ${workspace.organization.name} notes feed.`);
    console.info('[phase2-web] onboarding.existing_workspace_redirect', {
      email: user.email,
      organizationName: workspace.organization.name,
      role: workspace.membership.role,
    });
    router.push('/feed');
  }

  function connectGooglePreview() {
    const callbackUrl = `/onboarding?flow=${authFlow}&auth=google`;
    window.location.href = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  }

  function requestEmailCodePreview() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatus('Enter your email first so we know where to send the code.');
      return;
    }

    setAuthMethod('email');
    setEmailCode('');
    setEmailCodeError('');
    setIdentityConnected(false);
    setEmailCodeSent(false);
    setLoading(true);
    console.info('[phase2-web] onboarding.email_code_requested.started', { email: normalizedEmail });
    api.phase2.requestEmailCode({ email: normalizedEmail })
      .then((result) => {
        setExpectedEmailCode(result.previewCode ?? '');
        setEmailCodeSent(true);
        const resolvedFlow: AuthFlow = result.accountExists ? 'sign-in' : 'sign-up';
        if (authFlow !== resolvedFlow) {
          setAuthFlow(resolvedFlow);
        }
        const actionLabel = result.accountExists
          ? 'You already have a Dbugr account. Enter the verification code to sign in.'
          : 'This will create your Dbugr account after verification. Enter the code to sign up.';
        setStatus(
          result.delivered
            ? `${actionLabel} We sent a code to ${normalizedEmail}. Check your inbox and spam folder. It expires in ${result.expiresInMinutes} minutes.`
            : `${actionLabel} Email delivery is still in preview mode here. Use the temporary code ${result.previewCode ?? ''} to continue. It expires in ${result.expiresInMinutes} minutes.`,
        );
        console.info('[phase2-web] onboarding.email_code_requested.completed', {
          email: normalizedEmail,
          delivered: result.delivered,
          provider: result.provider,
          accountExists: result.accountExists,
        });
      })
      .catch((error) => {
        setEmailCodeSent(false);
        setExpectedEmailCode('');
        setStatus(`Could not send a verification code: ${error instanceof Error ? error.message : String(error)}`);
        console.warn('[phase2-web] onboarding.email_code_requested.failed', {
          email: normalizedEmail,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function verifyEmailCodePreview() {
    if (!emailCodeSent) {
      setStatus(`Request an email ${authAction} code first.`);
      return;
    }
    if (!/^\d{6}$/.test(emailCode.trim())) {
      const message = 'Incorrect Code Received. Enter the 6-digit code from your email.';
      setEmailCodeError(message);
      setStatus(message);
      return;
    }
    setLoading(true);
    api.phase2.verifyEmailCode({ email: email.trim().toLowerCase(), code: emailCode.trim() })
      .then((result) => {
        const resolvedName = result.user.name || name;
        setName(resolvedName);
        setEmail(result.user.email);
        if (result.workspace) {
          continueExistingWorkspace(result.workspace, { name: resolvedName, email: result.user.email });
          return;
        }
        if (!organizationName.trim() || organizationName === 'Demo Organization') {
          setOrganizationName(deriveWorkspaceName(resolvedName));
        }
        setAuthMethod('email');
        setIdentityConnected(true);
        setCurrentStep('workspace');
        setEmailCodeError('');
        setAuthFlow(result.created ? 'sign-up' : 'sign-in');
        setStatus(
          result.created
            ? `Email verified for ${email.trim().toLowerCase()}. Your Dbugr account is now created${result.welcomeEmailSent ? ' and a welcome email is on the way.' : '.'} You can create your organization workspace now.`
            : `Email verified for ${email.trim().toLowerCase()}. We matched it to your existing Dbugr account. You can create your organization workspace now.`
        );
        console.info('[phase2-web] onboarding.email_code_verified', { email: email.trim().toLowerCase(), created: result.created });
      })
      .catch((error) => {
        const fallbackMatches = expectedEmailCode && emailCode.trim() === expectedEmailCode;
        if (fallbackMatches) {
          setAuthMethod('email');
          setIdentityConnected(true);
          setCurrentStep('workspace');
          setEmailCodeError('');
          setStatus(`Email verified for ${email.trim().toLowerCase()}. You can create your organization workspace now.`);
          console.info('[phase2-web] onboarding.email_code_verified.preview_fallback', { email: email.trim().toLowerCase() });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setEmailCodeError(message);
        setStatus(message);
        console.warn('[phase2-web] onboarding.email_code_failed', {
          email: email.trim().toLowerCase(),
          message,
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function resetWorkspace() {
    clearOnboardingState();
    setAuthMethod(null);
    setIdentityConnected(false);
    setEmailCodeSent(false);
    setExpectedEmailCode('');
    setEmailCode('');
    setWorkspaceReady(false);
    setDesktopLink(null);
    setDesktopRedeemStatus('');
    setInviteLinks([]);
    setCurrentStep('sign-in');
    setAuthFlow('sign-up');
    setStatus('Sign up with Google or email first, then create your organization workspace.');
    setOrganizationLogoPreview(null);
    setOrganizationLogoName('');
    setInviteEmails([]);
    setInviteEmailDraft('');
  }

  async function createDesktopLink() {
    setDesktopRedeemStatus('Creating secure desktop link code...');
    console.info('[phase2-web] desktop_link.create.started');
    try {
      const result = await api.phase2.createDesktopLink({
        appUrl: window.location.origin,
      });
      setDesktopLink(result);
      setDesktopRedeemStatus(`Link code ready. It expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`);
      console.info('[phase2-web] desktop_link.create.completed', {
        linkId: result.linkId,
        expiresAt: result.expiresAt,
      });
      return result;
    } catch (error) {
      setDesktopRedeemStatus(`Could not create desktop link: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] desktop_link.create.failed', { message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async function openDesktopLink() {
    const link = desktopLink ?? await createDesktopLink();
    if (!link) return;
    window.location.href = link.deepLinkUrl;
  }

  async function relinkDesktopApp() {
    setDesktopLink(null);
    const link = await createDesktopLink();
    if (link) {
      setDesktopRedeemStatus('Fresh link code created. Use it if the Mac app was reinstalled, signed out, or lost its local session.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identityConnected) {
      setStatus(`Please complete Google or email ${authAction} before creating the workspace.`);
      return;
    }

    setLoading(true);
    setStatus('Creating workspace, owner role, team, invites, and audit event...');
    console.info('[phase2-web] onboarding.submit.started', {
      organizationName,
      inviteCount: inviteEmails.length,
      defaultVisibility,
    });
    try {
      const result = await api.phase2.onboarding({
        email,
        name,
        authProvider: authMethod ?? undefined,
        organizationName,
        organizationLogoUrl: organizationLogoPreview ?? undefined,
        role,
        teamName,
        defaultVisibility,
        inviteEmails,
      });
      setStatus(`Workspace ready: ${result.organization.name}. ${result.invites.length} invite(s) staged.`);
      setInviteLinks(result.invites.flatMap((invite) => invite.acceptUrl ? [{ email: invite.email, acceptUrl: invite.acceptUrl }] : []));
      writeOnboardingState({
        userName: name,
        userEmail: email,
        organizationName: result.organization.name,
        organizationLogoUrl: result.organization.logoUrl ?? organizationLogoPreview ?? undefined,
        role,
        teamName,
        defaultVisibility,
        inviteEmails,
        completedAt: new Date().toISOString(),
      });
      setWorkspaceReady(true);
      setCurrentStep('link');
      await createDesktopLink();
      console.info('[phase2-web] onboarding.submit.completed', {
        organizationId: result.organization.id,
        inviteCount: result.invites.length,
      });
    } catch (error) {
      setStatus(`Onboarding failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] onboarding.submit.failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvite() {
    if (!inviteToken) return;
    setLoading(true);
    setStatus('Accepting invite and joining workspace...');
    console.info('[phase2-web] invite.accept.started', { email });
    try {
      const result = await api.phase2.acceptInvite({ token: inviteToken, email, name });
      writeOnboardingState({
        userName: name,
        userEmail: email,
        organizationName: result.organization.name,
        role: result.membership.role,
        teamName: '',
        defaultVisibility: (result.organization.defaultVisibility as 'private' | 'org' | 'public') ?? 'private',
        inviteEmails: [],
        completedAt: new Date().toISOString(),
      });
      setAuthMethod('google');
      setIdentityConnected(true);
      setWorkspaceReady(true);
      setCurrentStep('link');
      setStatus(`Joined ${result.organization.name}. You can now open the review feed.`);
      console.info('[phase2-web] invite.accept.completed', {
        organizationId: result.organization.id,
        role: result.membership.role,
      });
    } catch (error) {
      setStatus(`Invite failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] invite.accept.failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-back-row">
        <Link className="onboarding-back-link" href="/" aria-label="Back to Dbugr home">
          <span aria-hidden="true">←</span>
          <span>Home</span>
        </Link>
        <nav className="onboarding-crumbs" aria-label="Onboarding progress">
          {[
            { id: 'sign-in' as const, label: 'Sign in', unlocked: true, completed: identityConnected },
            { id: 'workspace' as const, label: 'Workspace', unlocked: identityConnected, completed: workspaceReady },
            { id: 'link' as const, label: 'Mac link', unlocked: workspaceReady, completed: false },
          ].map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={`onboarding-crumb ${currentStep === step.id ? 'active' : ''} ${step.completed ? 'completed' : ''} ${step.unlocked ? '' : 'locked'}`}
              disabled={!step.unlocked}
              onClick={() => setCurrentStep(step.id)}
            >
              <span>{step.completed ? '✓' : String(index + 1).padStart(2, '0')}</span>
              {step.label}
            </button>
          ))}
        </nav>
      </div>

      <section className="onboarding-intro">
        <div className="onboarding-copy">
          <div className="onboarding-copy-main">
            <div className="phase2-kicker">Workspace setup</div>
            <h1>Set up your Dbugr workspace.</h1>
            <p>
              Sign in, create an organization, invite reviewers, and link the Mac app without
              slowing down the local capture flow.
            </p>
          </div>
          <div className="onboarding-preview-note">
            <span>Local preview</span>
            <p>Google and email {authAction} are simulated here until production auth is fully wired.</p>
          </div>
        </div>
      </section>

      <div
        className={`onboarding-status-banner ${status.includes('already have a Dbugr account') ? 'account-existing' : ''}`}
        role="status"
        aria-live="polite"
      >
        {status}
      </div>

      <form className="onboarding-panel" onSubmit={submit}>
        {inviteToken ? (
          <div className="onboarding-callout">
            <div className="phase2-kicker">Workspace invitation</div>
            <h2>Join an existing organization</h2>
            <p className="phase2-muted">
              This invite will create your membership after you verify through Google or email.
              The invite token is hashed on the API and is only shown in this one-time link.
            </p>
            <button className="btn btn-primary mt-16" type="button" disabled={loading || !identityConnected} onClick={acceptInvite}>
              {loading ? 'Joining...' : 'Accept invite'}
            </button>
          </div>
        ) : null}
        {currentStep === 'sign-in' ? (
        <section className="onboarding-section">
          <div className="onboarding-section-header">
            <span className="step-chip">01</span>
            <div>
              <h2>{authFlow === 'sign-in' ? 'Choose how to sign in' : 'Choose how to sign up'}</h2>
              <p>Use Google for OAuth, or use email to verify with a one-time code.</p>
            </div>
          </div>
          <div className="auth-method-grid">
            <div className={`auth-method ${authMethod === 'google' ? 'active' : ''}`}>
              <div>
                <div className="auth-method-title">Google OAuth</div>
                <p className="phase2-muted">Use Google OAuth for identity, team access, and workspace ownership.</p>
              </div>
              <button className="google-oauth-button" type="button" onClick={connectGooglePreview}>
                <img src="/brand/google-g.svg" alt="" className="google-mark" aria-hidden="true" />
                {identityConnected && authMethod === 'google' ? 'Google connected' : `${authActionTitle} with Google`}
              </button>
            </div>
            <div className={`auth-method ${authMethod === 'email' ? 'active' : ''}`}>
              <div>
                <div className="auth-method-title">Email code</div>
                <p className="phase2-muted">Receive a one-time code by email, then enter it to finish {authActionGerund}.</p>
              </div>
              <div className="email-code-grid">
                <div className="email-entry-row">
                  <label className="field-block email-field">
                    <span>Email address</span>
                    <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" aria-label={`${authActionTitle} email`} />
                  </label>
                  <button className="btn btn-ghost email-action-button" type="button" onClick={requestEmailCodePreview}>
                    {emailCodeSent ? 'Send new code' : 'Send code'}
                  </button>
                </div>
                {emailCodeSent ? (
                  <div className="email-verify-row">
                    <label className="field-block">
                      <span>Verification code</span>
                      <input
                        className={`input ${emailCodeError ? 'input-error' : ''}`}
                        value={emailCode}
                        onChange={(event) => {
                          setEmailCode(event.target.value);
                          if (emailCodeError) setEmailCodeError('');
                        }}
                        inputMode="numeric"
                        placeholder="Enter 6-digit code"
                        aria-label={`Email ${authAction} code`}
                        aria-invalid={emailCodeError ? 'true' : 'false'}
                      />
                      {emailCodeError ? <p className="field-error" role="alert">{emailCodeError}</p> : null}
                    </label>
                    <button className={identityConnected && authMethod === 'email' ? 'btn btn-ghost' : 'btn btn-primary'} type="button" onClick={verifyEmailCodePreview}>
                      {identityConnected && authMethod === 'email' ? 'Email verified' : 'Verify code'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
        ) : null}

        {currentStep === 'workspace' ? (
        <section className="onboarding-section">
          <div className="onboarding-section-header">
            <span className="step-chip">02</span>
            <div>
              <h2>Create organization workspace</h2>
              <p>This becomes the private review space for sessions, teammates, and curation.</p>
            </div>
          </div>
          <div className="identity-context-card">
            <div>
              <span>Account connected</span>
              <strong>{name || 'Dbugr user'}</strong>
              <p>{email} is ready to create this workspace.</p>
            </div>
            <div>
              <span>{authActionTitle} method</span>
              <strong>{authMethod === 'email' ? 'Email code' : 'Google OAuth'}</strong>
              <p>{authMethod === 'email' ? 'Verified with a one-time code you entered above.' : `Connected through Google ${authAction}.`}</p>
            </div>
          </div>
          <div className="onboarding-field-grid">
            <label className="field-block">
              <span>Name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field-block">
              <span>Organization / startup</span>
              <input className="input" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} />
            </label>
          </div>
          <div className="onboarding-field-grid three-up">
            <label className="field-block compact-field">
              <span>Role (optional)</span>
              <input className="input" value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <label className="field-block compact-field">
              <span>Team (optional)</span>
              <input className="input" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <label className="field-block compact-field visibility-field">
              <span>Default visibility</span>
              <select className="select" value={defaultVisibility} onChange={(event) => setDefaultVisibility(event.target.value as typeof defaultVisibility)}>
                <option value="private">Private</option>
                <option value="org">Organization</option>
                <option value="public">Public</option>
              </select>
              <p className="field-helper">
                This is the starting audience for new sessions in this workspace. You can still change visibility on each individual session later before sharing, review, or AI handoff.
              </p>
            </label>
          </div>
          <div className="onboarding-field-grid">
            <div className="field-block">
              <span>Organization logo (optional)</span>
              <label className="logo-upload-card">
                <input className="logo-upload-input" type="file" accept="image/*" onChange={handleOrganizationLogoChange} />
                {organizationLogoPreview ? (
                  <img alt="Organization logo preview" className="logo-upload-preview" src={organizationLogoPreview} />
                ) : (
                  <div className="logo-upload-placeholder">Add logo</div>
                )}
                <div className="logo-upload-copy">
                  <strong>{organizationLogoName || 'Upload PNG, JPG, or SVG'}</strong>
                  <p>Use this to brand the workspace for your team. It is saved with the organization now and can be replaced later in workspace settings.</p>
                </div>
              </label>
            </div>
            <div className="field-block">
              <span>Invite teammates</span>
              <div className="invite-builder">
                <div className="invite-builder-row">
                  <input
                    className="input"
                    value={inviteEmailDraft}
                    onChange={(event) => setInviteEmailDraft(event.target.value)}
                    onKeyDown={handleInviteKeyDown}
                    placeholder="sarah@company.com"
                  />
                  <button className="btn btn-ghost invite-builder-button" type="button" onClick={() => addInviteEmail(inviteEmailDraft)}>
                    Add teammate
                  </button>
                </div>
                <p className="field-helper">
                  Add up to {MAX_INVITE_EMAILS} teammates. If someone already has a Dbugr account, the invite attaches to that existing account when they sign in with the same email. Otherwise, the invite stays pending until they create one.
                </p>
                <div className="invite-pill-list" aria-live="polite">
                  {inviteEmails.map((inviteEmail) => (
                    <div className="invite-pill" key={inviteEmail}>
                      <span>{inviteEmail}</span>
                      <button type="button" aria-label={`Remove ${inviteEmail}`} onClick={() => removeInviteEmail(inviteEmail)}>
                        ×
                      </button>
                    </div>
                  ))}
                  {inviteEmails.length === 0 ? <p className="invite-empty">No teammates added yet. You can still create the workspace first and invite people later.</p> : null}
                </div>
                <p className="invite-counter">{inviteEmails.length}/{MAX_INVITE_EMAILS} teammate invites added</p>
              </div>
            </div>
          </div>
          <button className="btn btn-primary onboarding-submit" disabled={loading || !identityConnected}>{loading ? 'Creating workspace...' : 'Create workspace and stage invites'}</button>
        </section>
        ) : null}

        {currentStep === 'link' ? (
          <section className="onboarding-section mac-link-section">
            <div className="onboarding-section-header">
              <span className="step-chip">03</span>
              <div>
                <h2>Download and link the Mac app</h2>
                <p>Install Dbugr on this Mac, then link it to {email} and the {organizationName} workspace.</p>
              </div>
            </div>
            <div className="mac-link-checklist">
              <div className="mac-link-step">
                <span>a</span>
                <div>
                  <h3>Download Dbugr for macOS</h3>
                  <p>Download the Mac installer, open it from Downloads, then drag Dbugr.ai into Applications.</p>
                  <ul className="mac-link-step-list">
                    <li>Click <strong>Download macOS DMG</strong>.</li>
                    <li>Open the downloaded file from your Downloads folder.</li>
                    <li>Drag <strong>Dbugr.ai</strong> into <strong>Applications</strong>.</li>
                  </ul>
                  <a className="btn btn-primary" href={MAC_DMG_DOWNLOAD_URL}>Download macOS DMG</a>
                </div>
              </div>
              <div className="mac-link-step">
                <span>b</span>
                <div>
                  <h3>Open the installed app</h3>
                  <p>Open Dbugr.ai from Applications. If macOS shows a safety prompt the first time, choose Open.</p>
                </div>
              </div>
              <div className="mac-link-step">
                <span>c</span>
                <div>
                  <h3>Link this MacOS app</h3>
                  <p>Click the button below, then switch to the Dbugr Mac app to finish connecting this computer to your account.</p>
                  <div className="row gap-12 mac-link-actions">
                    <button className="btn btn-primary" type="button" onClick={openDesktopLink}>
                      Link this MacOS app
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={relinkDesktopApp}>
                      Relink Mac app
                    </button>
                  </div>
                  <div className="mac-link-help-grid">
                    <div className="mac-link-help-card">
                      <h4>What happens when I click Link this Mac?</h4>
                      <p>Dbugr creates a fresh one-time link code in this browser and hands it to the Mac app so this computer connects to your account safely.</p>
                    </div>
                    <div className="mac-link-help-card">
                      <h4>When should I use Relink Mac app?</h4>
                      <p>Use relink if you reinstalled the app, signed out, moved to a new Mac, or the app stopped recognizing this account.</p>
                    </div>
                  </div>
                  {desktopRedeemStatus ? <p className="mac-link-status">{desktopRedeemStatus}</p> : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </form>

      <JourneyInfographic />

      {inviteLinks.length > 0 ? (
        <section className="onboarding-panel invite-links-panel">
          <div>
            <div className="phase2-kicker">Invite links</div>
            <h2>Share these one-time links with teammates.</h2>
            <p className="phase2-muted">Email delivery can be wired to Resend later; these links already exercise the same accept endpoint.</p>
          </div>
          {inviteLinks.map((invite) => (
            <div className="card" key={invite.email}>
              <div className="phase2-kicker">{invite.email}</div>
              <Link href={invite.acceptUrl}>{invite.acceptUrl}</Link>
            </div>
          ))}
        </section>
      ) : null}

    </div>
  );
}
