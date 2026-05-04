import Link from 'next/link';

export default function HomePage() {
  return (
    <div>
      <section className="phase2-hero">
        <div className="phase2-card">
          <div className="phase2-kicker">Phase 2 social review</div>
          <h1 className="phase2-title">Turn annotations into a team review loop.</h1>
          <p className="phase2-lede">
            Dbugr keeps the native macOS capture flow fast, then brings sessions to a warm web
            review hub for Google sign-in, teams, feeds, comments, curation, and AI-ready summaries.
          </p>
          <div className="row gap-12 mt-24">
            <Link className="btn btn-primary" href="/onboarding">Start onboarding</Link>
            <Link className="btn btn-ghost" href="/feed">Open review feed</Link>
          </div>
        </div>
        <div className="phase2-card">
          <div className="phase2-kicker">Current scope</div>
          <div className="stack gap-16 mt-16">
            <div><strong>Startup-ready first.</strong><p className="phase2-muted">Google auth shape, org setup, internal review, public feed, and owner curation.</p></div>
            <div><strong>Enterprise-compatible by design.</strong><p className="phase2-muted">Roles, audit events, visibility scopes, policy flags, and local-first AI credentials.</p></div>
            <div><strong>Railway deployment target.</strong><p className="phase2-muted">Web/API can deploy as Railway services with managed database configuration.</p></div>
          </div>
        </div>
      </section>

      <section className="phase2-grid">
        <div className="phase2-card">
          <div className="phase2-kicker">1</div>
          <h2>Onboard</h2>
          <p className="phase2-muted">Continue with Google, create an org, add role/team, and invite teammates.</p>
        </div>
        <div className="phase2-card">
          <div className="phase2-kicker">2</div>
          <h2>Review</h2>
          <p className="phase2-muted">Move sessions into private, internal review, or public feed visibility.</p>
        </div>
        <div className="phase2-card">
          <div className="phase2-kicker">3</div>
          <h2>Curate</h2>
          <p className="phase2-muted">Accept, reject, or edit suggestions before they enter the final AI prompt.</p>
        </div>
      </section>
    </div>
  );
}
