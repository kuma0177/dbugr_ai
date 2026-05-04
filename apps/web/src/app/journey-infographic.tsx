type JourneyInfographicProps = {
  title?: string;
  description?: string;
  className?: string;
};

export function JourneyInfographic({
  title = 'From sign up to AI-ready product changes',
  description = 'This is the path your team follows: create a workspace, install the Mac app, link it once, capture feedback, review it together, then send the final prompt to Claude or Codex.',
  className = '',
}: JourneyInfographicProps) {
  return (
    <section className={`onboarding-panel onboarding-journey-panel ${className}`.trim()}>
      <div className="onboarding-journey-header">
        <div className="phase2-kicker">How Dbugr works</div>
        <h2>{title}</h2>
        <p className="phase2-muted">{description}</p>
      </div>
      <figure
        className="journey-map"
        itemScope
        itemType="https://schema.org/ImageObject"
        aria-label="Dbugr workflow infographic"
      >
        <meta itemProp="name" content="Dbugr workflow infographic" />
        <meta
          itemProp="description"
          content="A flat visual workflow showing how Dbugr users sign up, install the Mac app, link it, capture feedback, review it, and send final prompts to Claude or Codex."
        />
        <div className="journey-graphic-frame">
          <svg
            className="journey-graphic"
            viewBox="0 0 1180 470"
            role="img"
            aria-labelledby="journey-title journey-desc"
          >
            <title id="journey-title">Dbugr onboarding and AI handoff journey</title>
            <desc id="journey-desc">
              Six connected steps show the Dbugr workflow: sign up, install the Mac app, link the app,
              capture and annotate product feedback, review with a team, and send the final prompt to Claude or Codex.
            </desc>
            <defs>
              <linearGradient id="journeyBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f7fbff" />
                <stop offset="55%" stopColor="#fffdf8" />
                <stop offset="100%" stopColor="#f8f5ef" />
              </linearGradient>
              <marker id="journeyArrowBlue" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#74bbff" />
              </marker>
              <marker id="journeyArrowOrange" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#ffb59d" />
              </marker>
              <filter id="journeyShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="rgba(15,23,42,0.08)" />
              </filter>
            </defs>

            <rect x="12" y="12" width="1156" height="446" rx="30" fill="url(#journeyBg)" />

            <path d="M181 160 H230" stroke="#74bbff" strokeWidth="5" strokeLinecap="round" markerEnd="url(#journeyArrowBlue)" />
            <path d="M371 160 H420" stroke="#74bbff" strokeWidth="5" strokeLinecap="round" markerEnd="url(#journeyArrowBlue)" />
            <path d="M561 160 H610" stroke="#74bbff" strokeWidth="5" strokeLinecap="round" markerEnd="url(#journeyArrowBlue)" />
            <path d="M751 160 H800" stroke="#ffb59d" strokeWidth="5" strokeLinecap="round" markerEnd="url(#journeyArrowOrange)" />
            <path d="M941 160 H990" stroke="#ffb59d" strokeWidth="5" strokeLinecap="round" markerEnd="url(#journeyArrowOrange)" />

            <g filter="url(#journeyShadow)">
              <rect x="40" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="74" cy="112" r="18" fill="#edf6ff" />
              <text x="74" y="118" textAnchor="middle" className="journey-svg-step">01</text>
              <text x="74" y="167" textAnchor="middle" className="journey-svg-emoji">📝</text>
              <text x="64" y="208" className="journey-svg-title">Sign up</text>
              <text x="64" y="232" className="journey-svg-copy">Google or email</text>
              <text x="64" y="252" className="journey-svg-copy">gets you in</text>
            </g>

            <g filter="url(#journeyShadow)">
              <rect x="230" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="264" cy="112" r="18" fill="#edf6ff" />
              <text x="264" y="118" textAnchor="middle" className="journey-svg-step">02</text>
              <text x="264" y="167" textAnchor="middle" className="journey-svg-emoji">💻</text>
              <text x="254" y="208" className="journey-svg-title">Get the app</text>
              <text x="254" y="232" className="journey-svg-copy">Download + install</text>
              <text x="254" y="252" className="journey-svg-copy">from Applications</text>
            </g>

            <g filter="url(#journeyShadow)">
              <rect x="420" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="454" cy="112" r="18" fill="#edf6ff" />
              <text x="454" y="118" textAnchor="middle" className="journey-svg-step">03</text>
              <text x="454" y="167" textAnchor="middle" className="journey-svg-emoji">🔗</text>
              <text x="444" y="208" className="journey-svg-title">Link Mac app</text>
              <text x="444" y="232" className="journey-svg-copy">Connect once</text>
              <text x="444" y="252" className="journey-svg-copy">Relink anytime</text>
            </g>

            <g filter="url(#journeyShadow)">
              <rect x="610" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="644" cy="112" r="18" fill="#fff0ea" />
              <text x="644" y="118" textAnchor="middle" className="journey-svg-step journey-svg-step-orange">04</text>
              <text x="644" y="167" textAnchor="middle" className="journey-svg-emoji">📸</text>
              <text x="634" y="208" className="journey-svg-title">Capture</text>
              <text x="634" y="232" className="journey-svg-copy">Screens + notes</text>
              <text x="634" y="252" className="journey-svg-copy">saved in session</text>
            </g>

            <g filter="url(#journeyShadow)">
              <rect x="800" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="834" cy="112" r="18" fill="#fff0ea" />
              <text x="834" y="118" textAnchor="middle" className="journey-svg-step journey-svg-step-orange">05</text>
              <text x="834" y="167" textAnchor="middle" className="journey-svg-emoji">💬</text>
              <text x="824" y="208" className="journey-svg-title">Review</text>
              <text x="824" y="232" className="journey-svg-copy">Team review</text>
              <text x="824" y="252" className="journey-svg-copy">and decisions</text>
            </g>

            <g filter="url(#journeyShadow)">
              <rect x="990" y="78" width="150" height="190" rx="24" fill="#ffffff" />
              <circle cx="1024" cy="112" r="18" fill="#fff0ea" />
              <text x="1024" y="118" textAnchor="middle" className="journey-svg-step journey-svg-step-orange">06</text>
              <g transform="translate(1006 150)">
                <circle cx="12" cy="12" r="13" fill="#fff1ea" />
                <image href="/brand/logo-claude.png" x="1" y="1" width="22" height="22" preserveAspectRatio="xMidYMid meet" />
                <rect x="30" y="0" width="24" height="24" rx="12" fill="#ffffff" />
                <image href="/brand/logo-codex.png" x="32" y="2" width="20" height="20" preserveAspectRatio="xMidYMid meet" />
                <rect x="60" y="0" width="24" height="24" rx="12" fill="#111827" />
                <image href="/brand/logo-cursor.png" x="62" y="2" width="20" height="20" preserveAspectRatio="xMidYMid meet" />
              </g>
              <text x="1014" y="208" className="journey-svg-title">Ship with AI</text>
              <text x="1014" y="232" className="journey-svg-copy">Claude, Codex</text>
              <text x="1014" y="252" className="journey-svg-copy">or Cursor</text>
            </g>

            <rect x="62" y="315" width="1058" height="92" rx="24" fill="#ffffff" opacity="0.86" />
            <text x="92" y="348" className="journey-svg-kicker">WHY THIS FLOW HITS</text>
            <g>
              <rect x="92" y="364" width="252" height="28" rx="14" fill="#edf6ff" />
              <text x="112" y="382" className="journey-svg-copy-strong">Account + workspace ready</text>
              <rect x="434" y="364" width="266" height="28" rx="14" fill="#edf6ff" />
              <text x="454" y="382" className="journey-svg-copy-strong">Mac linked once, reusable later</text>
              <rect x="790" y="364" width="294" height="28" rx="14" fill="#eef9f1" />
              <text x="810" y="382" className="journey-svg-copy-strong">Capture locally, review together, ship faster</text>
            </g>
          </svg>
        </div>
      </figure>
    </section>
  );
}
