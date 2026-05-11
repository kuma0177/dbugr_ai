'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { displayOnboardingName, readOnboardingState, writeOnboardingState } from '@/lib/onboarding';

export function NavShell() {
  const [signedInEmail, setSignedInEmail] = useState('');
  const [signedInName, setSignedInName] = useState('');

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch((error) => {
          console.warn('[phase2-web] service_worker_cleanup_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch((error) => {
          console.warn('[phase2-web] cache_storage_cleanup_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }

    let cancelled = false;
    const sync = () => {
      const state = readOnboardingState();
      setSignedInEmail(state?.userEmail ?? '');
      setSignedInName(displayOnboardingName(state));
    };

    const refreshFromApi = async () => {
      const state = readOnboardingState();
      if (!state?.userEmail) return;
      try {
        const data = await api.phase2.bootstrap();
        if (cancelled) return;
        const nextState = {
          ...state,
          userName: data.user.name || displayOnboardingName(state),
          userEmail: data.user.email,
          organizationName: data.organization.name,
          organizationLogoUrl: data.organization.logoUrl ?? state.organizationLogoUrl,
          role: data.membership.role,
          teamName: data.membership.team?.name ?? state.teamName,
          defaultVisibility: (data.organization.defaultVisibility as typeof state.defaultVisibility) ?? state.defaultVisibility,
        };
        writeOnboardingState(nextState);
      } catch (error) {
        console.warn('[phase2-web] nav.identity_refresh_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    sync();
    void refreshFromApi();
    window.addEventListener('storage', sync);
    window.addEventListener('dbugr-auth-changed', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', sync);
      window.removeEventListener('dbugr-auth-changed', sync);
    };
  }, []);

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand" aria-label="Debugr home">
        <img src="/brand/icon-nav-1024.png" alt="" className="nav-brand-icon" />
        <span>Dbugr.ai</span>
      </Link>
      <div className="nav-links">
        {signedInEmail ? (
          <>
            <div className="nav-signed-in" aria-label={`Signed in as ${signedInName || signedInEmail}`}>
              <span>Signed in as</span>
              <strong>{signedInName || signedInEmail}</strong>
            </div>
            <Link className="nav-auth-button nav-auth-button-secondary" href="/feed">Notes Feed</Link>
            <Link className="nav-auth-button nav-auth-button-primary" href="/admin">Admin</Link>
          </>
        ) : (
          <>
            <Link className="nav-auth-button nav-auth-button-secondary" href="/onboarding?flow=sign-in">Sign in</Link>
            <Link className="nav-auth-button nav-auth-button-primary" href="/onboarding?flow=sign-up">Get started free</Link>
          </>
        )}
      </div>
    </nav>
  );
}
