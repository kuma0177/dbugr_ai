'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { clearOnboardingState, readOnboardingState, writeOnboardingState } from '@/lib/onboarding';

type OnboardingStep = 'sign-in' | 'workspace' | 'link';

export default function OnboardingPage() {
  const [name, setName] = useState('Demo User');
  const [email, setEmail] = useState('demo@example.com');
  const [organizationName, setOrganizationName] = useState('Demo Organization');
  const [role, setRole] = useState('Founder');
  const [teamName, setTeamName] = useState('Product');
  const [inviteEmails, setInviteEmails] = useState('reviewer@example.com');
  const [defaultVisibility, setDefaultVisibility] = useState<'private' | 'org' | 'public'>('private');
  const [authMethod, setAuthMethod] = useState<'google' | 'email' | null>(null);
  const [identityConnected, setIdentityConnected] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [expectedEmailCode, setExpectedEmailCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [desktopLink, setDesktopLink] = useState<{ code: string; deepLinkUrl: string; expiresAt: string } | null>(null);
  const [desktopRedeemStatus, setDesktopRedeemStatus] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteLinks, setInviteLinks] = useState<Array<{ email: string; acceptUrl: string }>>([]);
  const [status, setStatus] = useState('Sign up with Google or email first, then create your organization workspace.');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('sign-in');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingInvite = params.get('invite') ?? '';
    const incomingEmail = params.get('email') ?? '';
    const incomingAuth = params.get('auth');
    if (incomingAuth === 'google' || incomingAuth === 'email') {
      setAuthMethod(incomingAuth);
      setStatus(incomingAuth === 'google'
        ? 'Continue to Google sign-up, then create your organization workspace.'
        : 'Request an email sign-up code, enter it here, then create your organization workspace.');
    }
    if (incomingInvite) {
      setInviteToken(incomingInvite);
      setStatus('Invite detected. Sign up with Google or email, then accept the workspace invitation.');
    }
    if (incomingEmail) setEmail(incomingEmail);

    const localState = readOnboardingState();
    if (localState) {
      setName(localState.userName);
      setEmail(localState.userEmail);
      setOrganizationName(localState.organizationName);
      setRole(localState.role ?? '');
      setTeamName(localState.teamName ?? '');
      setInviteEmails(localState.inviteEmails.join(', '));
      setDefaultVisibility(localState.defaultVisibility);
      setAuthMethod((current) => current ?? 'google');
      setIdentityConnected(true);
      setWorkspaceReady(true);
      setCurrentStep('link');
      setStatus(`Workspace ready: ${localState.organizationName}. ${localState.inviteEmails.length} invite(s) staged.`);
    }

    console.info('[phase2-web] onboarding.bootstrap.started');
    api.phase2.bootstrap()
      .then((data) => {
        if (!localState) {
          setName(data.user.name);
          setEmail(data.user.email);
          setOrganizationName(data.organization.name);
          setDefaultVisibility((data.organization.defaultVisibility as 'private' | 'org' | 'public') ?? 'private');
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
  }, []);

  function connectGooglePreview() {
    setAuthMethod('google');
    setIdentityConnected(true);
    setCurrentStep('workspace');
    setStatus(`Google preview connected as ${email}. Production will redirect to Google OAuth when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.`);
    console.info('[phase2-web] onboarding.google_preview_connected', { email });
  }

  function requestEmailCodePreview() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatus('Enter your email first so we know where to send the code.');
      return;
    }

    setAuthMethod('email');
    setEmailCode('');
    setIdentityConnected(false);
    setLoading(true);
    console.info('[phase2-web] onboarding.email_code_requested.started', { email: normalizedEmail });
    api.phase2.requestEmailCode({ email: normalizedEmail })
      .then((result) => {
        setExpectedEmailCode(result.previewCode ?? '');
        setEmailCodeSent(true);
        setStatus(
          result.delivered
            ? `Verification code sent to ${normalizedEmail}. Check your inbox and spam folder. It expires in ${result.expiresInMinutes} minutes.`
            : `Email delivery is still in preview mode here. Use the temporary code ${result.previewCode ?? ''} to continue. It expires in ${result.expiresInMinutes} minutes.`,
        );
        console.info('[phase2-web] onboarding.email_code_requested.completed', {
          email: normalizedEmail,
          delivered: result.delivered,
          provider: result.provider,
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
      setStatus('Request an email sign-up code first.');
      return;
    }
    setLoading(true);
    api.phase2.verifyEmailCode({ email: email.trim().toLowerCase(), code: emailCode.trim() })
      .then(() => {
        setAuthMethod('email');
        setIdentityConnected(true);
        setCurrentStep('workspace');
        setStatus(`Email verified for ${email.trim().toLowerCase()}. You can create your organization workspace now.`);
        console.info('[phase2-web] onboarding.email_code_verified', { email: email.trim().toLowerCase() });
      })
      .catch((error) => {
        const fallbackMatches = expectedEmailCode && emailCode.trim() === expectedEmailCode;
        if (fallbackMatches) {
          setAuthMethod('email');
          setIdentityConnected(true);
          setCurrentStep('workspace');
          setStatus(`Email verified for ${email.trim().toLowerCase()}. You can create your organization workspace now.`);
          console.info('[phase2-web] onboarding.email_code_verified.preview_fallback', { email: email.trim().toLowerCase() });
          return;
        }
        setStatus(error instanceof Error ? error.message : String(error));
        console.warn('[phase2-web] onboarding.email_code_failed', {
          email: email.trim().toLowerCase(),
          message: error instanceof Error ? error.message : String(error),
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
    setStatus('Sign up with Google or email first, then create your organization workspace.');
  }

  async function createDesktopLink() {
    setDesktopRedeemStatus('Creating secure desktop link code...');
    console.info('[phase2-web] desktop_link.create.started');
    try {
      const result = await api.phase2.createDesktopLink({
        appUrl: window.location.origin,
      });
      setDesktopLink(result);
      setDesktopRedeemStatus(`Desktop link code ready. Expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`);
      console.info('[phase2-web] desktop_link.create.completed', {
        linkId: result.linkId,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      setDesktopRedeemStatus(`Could not create desktop link: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] desktop_link.create.failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function redeemDesktopLinkPreview() {
    if (!desktopLink) return;
    setDesktopRedeemStatus('Redeeming link as the local Mac app preview...');
    console.info('[phase2-web] desktop_link.preview_redeem.started');
    try {
      const result = await api.phase2.redeemDesktopLink({
        code: desktopLink.code,
        desktopDeviceName: 'Local Dbugr Mac preview',
      });
      setDesktopRedeemStatus(`Mac app linked. Link status: ${result.desktopLink.status}.`);
      console.info('[phase2-web] desktop_link.preview_redeem.completed', {
        desktopLinkId: result.desktopLink.id,
        status: result.desktopLink.status,
      });
    } catch (error) {
      setDesktopRedeemStatus(`Link redeem failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] desktop_link.preview_redeem.failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identityConnected) {
      setStatus('Please complete Google or email sign-up before creating the workspace.');
      return;
    }

    setLoading(true);
    setStatus('Creating workspace, owner role, team, invites, and audit event...');
    console.info('[phase2-web] onboarding.submit.started', {
      organizationName,
      inviteCount: inviteEmails.split(',').map((email) => email.trim()).filter(Boolean).length,
      defaultVisibility,
    });
    try {
      const result = await api.phase2.onboarding({
        email,
        name,
        organizationName,
        role,
        teamName,
        defaultVisibility,
        inviteEmails: inviteEmails.split(',').map((email) => email.trim()).filter(Boolean),
      });
      setStatus(`Workspace ready: ${result.organization.name}. ${result.invites.length} invite(s) staged.`);
      setInviteLinks(result.invites.flatMap((invite) => invite.acceptUrl ? [{ email: invite.email, acceptUrl: invite.acceptUrl }] : []));
      writeOnboardingState({
        userName: name,
        userEmail: email,
        organizationName: result.organization.name,
        role,
        teamName,
        defaultVisibility,
        inviteEmails: inviteEmails.split(',').map((email) => email.trim()).filter(Boolean),
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
            { id: 'sign-in' as const, label: 'Sign in', unlocked: true },
            { id: 'workspace' as const, label: 'Workspace', unlocked: identityConnected },
            { id: 'link' as const, label: 'Mac link', unlocked: workspaceReady },
          ].map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={`onboarding-crumb ${currentStep === step.id ? 'active' : ''} ${step.unlocked ? '' : 'locked'}`}
              disabled={!step.unlocked}
              onClick={() => setCurrentStep(step.id)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
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
            <p>Google and email sign-up are simulated here until production auth is fully wired.</p>
          </div>
        </div>
      </section>

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
              <h2>Choose how to sign up</h2>
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
                <span className="google-mark" aria-hidden="true">G</span>
                {identityConnected && authMethod === 'google' ? 'Google connected' : 'Sign up with Google'}
              </button>
            </div>
            <div className={`auth-method ${authMethod === 'email' ? 'active' : ''}`}>
              <div>
                <div className="auth-method-title">Email code</div>
                <p className="phase2-muted">Receive a one-time code by email, then enter it to finish sign-up.</p>
              </div>
              <div className="email-code-grid">
                <div className="email-entry-row">
                  <label className="field-block email-field">
                    <span>Email address</span>
                    <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" aria-label="Sign-up email" />
                  </label>
                  <button className="btn btn-ghost email-action-button" type="button" onClick={requestEmailCodePreview}>
                    {emailCodeSent ? 'Send new code' : 'Send code'}
                  </button>
                </div>
                {emailCodeSent ? (
                  <div className="email-verify-row">
                    <label className="field-block">
                      <span>Verification code</span>
                      <input className="input" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" placeholder="Enter 6-digit code" aria-label="Email sign-up code" />
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
              <span>Signed in as</span>
              <strong>{name || 'Dbugr user'}</strong>
              <p>{email}</p>
            </div>
            <div>
              <span>Sign-up method</span>
              <strong>{authMethod === 'email' ? 'Email code' : 'Google OAuth'}</strong>
              <p>{authMethod === 'email' ? 'Verified by one-time code' : 'Connected through Google sign-up'}</p>
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
            <label className="field-block">
              <span>Role optional</span>
            <input className="input" value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <label className="field-block">
              <span>Team optional</span>
            <input className="input" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <label className="field-block">
              <span>Default visibility</span>
            <select className="select" value={defaultVisibility} onChange={(event) => setDefaultVisibility(event.target.value as typeof defaultVisibility)}>
              <option value="private">Private</option>
              <option value="org">Organization</option>
              <option value="public">Public</option>
            </select>
            </label>
          </div>
          <label className="field-block">
            <span>Invite teammates</span>
            <input className="input" value={inviteEmails} onChange={(event) => setInviteEmails(event.target.value)} placeholder="sarah@company.com, mike@company.com" />
          </label>
          <button className="btn btn-primary onboarding-submit" disabled={loading || !identityConnected}>{loading ? 'Creating workspace...' : 'Create workspace and stage invites'}</button>
        </section>
        ) : null}

        {currentStep === 'link' ? (
          <section className="onboarding-section mac-link-section">
            <div>
              <span className="step-chip">03</span>
              <h2>Link the Mac app</h2>
              <p className="phase2-muted">
                This is the Codex-style handoff: web creates the account and workspace, then the Mac app
                opens via `dbugr://` and redeems a short-lived link code. The desktop handler is the next
                native-app task; the API and web link contract are now in place.
              </p>
            </div>
            <div className="row gap-12">
              <Link className="btn btn-primary" href="/feed">Open review feed</Link>
              <button className="btn btn-primary" type="button" onClick={createDesktopLink}>Create new link code</button>
              {desktopLink ? <a className="btn btn-ghost" href={desktopLink.deepLinkUrl}>Open Dbugr Mac app</a> : null}
              {desktopLink ? <button className="btn btn-ghost" type="button" onClick={redeemDesktopLinkPreview}>Preview redeem</button> : null}
              <button className="btn btn-ghost" type="button" onClick={resetWorkspace}>Reset preview</button>
            </div>
          </section>
        ) : null}
      </form>

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
