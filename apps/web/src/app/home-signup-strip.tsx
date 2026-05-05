'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function HomeSignupStrip() {
  const router = useRouter();
  const [email, setEmail] = useState('');

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
        <button className="btn btn-ghost signup-email-button" type="submit">
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
