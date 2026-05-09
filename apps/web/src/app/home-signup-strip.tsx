'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { displayOnboardingName, readOnboardingState } from '@/lib/onboarding';

export function HomeSignupStrip() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<{ name: string; email: string; hasWorkspace: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => {
      const state = readOnboardingState();
      setSignedIn(state?.userEmail ? {
        name: displayOnboardingName(state),
        email: state.userEmail,
        hasWorkspace: Boolean(state.organizationName),
      } : null);
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('dbugr-auth-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('dbugr-auth-changed', sync);
    };
  }, []);

  function goToOnboarding(auth: 'email' | 'google') {
    const params = new URLSearchParams({ flow: 'sign-up', auth });
    const normalizedEmail = email.trim();
    if (normalizedEmail) params.set('email', normalizedEmail);
    router.push(`/onboarding?${params.toString()}`);
  }

  function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    goToOnboarding('email');
  }

  if (signedIn) {
    return (
      <div className="home-signed-in-panel" aria-label={`Signed in as ${signedIn.name}`}>
        <div>
          <span>Signed in as</span>
          <strong>{signedIn.name}</strong>
          <small>{signedIn.email}</small>
        </div>
        <div className="home-signed-in-actions">
          <a className="btn btn-primary" href={signedIn.hasWorkspace ? '/feed' : '/onboarding?flow=sign-in'}>
            {signedIn.hasWorkspace ? 'Open notes feed' : 'Finish workspace setup'}
          </a>
          <a className="btn btn-ghost" href="/feed">Open team review</a>
        </div>
      </div>
    );
  }

  return (
    <div className="signup-strip" aria-label="Sign up options">
      {/* Google first — primary CTA */}
      <button
        className="hv2-google-btn"
        type="button"
        onClick={() => goToOnboarding('google')}
      >
        <img src="/brand/google-g.svg" alt="" width={18} height={18} aria-hidden="true" />
        Continue with Google
      </button>

      {/* OR divider */}
      <div className="hv2-or-divider" aria-hidden="true">
        <span />
        <span>or</span>
        <span />
      </div>

      {/* Email fallback */}
      <form className="hv2-email-row" onSubmit={handleEmailSubmit}>
        <input
          className="hv2-email-input"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email address"
          type="email"
        />
        <button className="hv2-send-code-btn" type="submit">
          Send code
        </button>
      </form>
    </div>
  );
}
