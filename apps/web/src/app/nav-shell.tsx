'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavShell() {
  const pathname = usePathname();
  const showAuthButtons = !pathname.startsWith('/onboarding');

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand" aria-label="Debugr home">
        <img src="/brand/icon-nav-1024.png" alt="" className="nav-brand-icon" />
        <span>Dbugr.ai</span>
      </Link>
      {showAuthButtons ? (
        <div className="nav-links">
          <Link className="nav-auth-button nav-auth-button-secondary" href="/onboarding?flow=sign-in&auth=email">Sign in</Link>
          <Link className="nav-auth-button nav-auth-button-primary" href="/onboarding?flow=sign-up&auth=google">Get started</Link>
        </div>
      ) : null}
    </nav>
  );
}
