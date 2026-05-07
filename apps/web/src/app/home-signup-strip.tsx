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
    const params = new URLSearchParams({
      flow: 'sign-up',
      auth,
    });

    const normalizedEmail = email.trim();
    if (normalizedEmail) {
      params.set('email', normalizedEmail);
    }

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
      <form className="signup-email-row" onSubmit={handleEmailSubmit}>
        <input
          className="signup-email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email"
          aria-label="Email address"
        />
        <button className="btn btn-primary signup-email-button" type="submit">
          Sign up with email
        </button>
      </form>
      <div className="signup-google-row">
        <button
          className="google-oauth-button signup-google"
          type="button"
          onClick={() => goToOnboarding('google')}
        >
          <img src="/brand/google-g.svg" alt="" className="google-mark" aria-hidden="true" />
          Sign up with Google
        </button>
      </div>
    </div>
  );
}
