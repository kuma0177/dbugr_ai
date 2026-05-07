'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    console.info('[phase2-web] dashboard.deprecated_redirect', { destination: '/feed' });
    router.replace('/feed');
  }, [router]);

  return (
    <section className="workspace-page">
      <div className="workspace-hero">
        <div>
          <div className="phase2-kicker">Workspace moved</div>
          <h1>Opening Notes Feed.</h1>
          <p>
            The old dashboard layer is now folded into the left navigation.
            Notes Feed is the workspace home for review, sessions, and AI handoff.
          </p>
        </div>
        <Link className="btn btn-primary" href="/feed">Open Notes Feed</Link>
      </div>
    </section>
  );
}
