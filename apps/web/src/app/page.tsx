import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeSignupStrip } from './home-signup-strip';

const GITHUB_REPO_URL = 'https://github.com/kuma0177/debgr_ai';
const GITHUB_RELEASE_TAG = 'pre-open-source-ready-stable';
const DEFAULT_MAC_DMG_URL = `${GITHUB_REPO_URL}/releases/download/${GITHUB_RELEASE_TAG}/dbugr-ai-0.0.1-macos-aarch64.dmg`;
const MAC_DMG_DOWNLOAD_URL = process.env.NEXT_PUBLIC_MAC_DMG_URL ?? DEFAULT_MAC_DMG_URL;
const GITHUB_RELEASE_URL = `${GITHUB_REPO_URL}/releases/tag/${GITHUB_RELEASE_TAG}`;

export const metadata: Metadata = {
  title: 'Screenshot Feedback Tool for Claude Code, Codex, and Cursor',
  description:
    'Capture screenshots, annotate product feedback on macOS, and send repo-aware prompts to Claude Code, Codex, or Cursor in under 30 seconds.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Dbugr.ai | Screenshot Feedback for AI Coding Agents',
    description:
      'Capture screenshots, annotate product feedback on macOS, and send repo-aware prompts to Claude Code, Codex, or Cursor in under 30 seconds.',
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dbugr.ai | Screenshot Feedback for AI Coding Agents',
    description:
      'Capture annotated screenshots and send repo-aware prompts to Claude Code, Codex, or Cursor.',
  },
};

const HOME_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://www.dbugr.ai/#organization',
      name: 'Dbugr.ai',
      url: 'https://www.dbugr.ai/',
      logo: 'https://www.dbugr.ai/brand/icon-nav-1024.png',
      sameAs: [GITHUB_REPO_URL],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://www.dbugr.ai/#website',
      url: 'https://www.dbugr.ai/',
      name: 'Dbugr.ai',
      description:
        'A macOS screenshot annotation tool for turning product feedback into AI coding agent prompts.',
      publisher: { '@id': 'https://www.dbugr.ai/#organization' },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://www.dbugr.ai/#software',
      name: 'Dbugr.ai',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS 13+',
      url: 'https://www.dbugr.ai/',
      downloadUrl: MAC_DMG_DOWNLOAD_URL,
      codeRepository: GITHUB_REPO_URL,
      description:
        'Dbugr.ai captures annotated screenshots on macOS and routes structured, repo-aware feedback to Claude Code, Codex, and Cursor.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
  ],
} as const;

const FLOW_STEPS = [
  { n: '01', title: 'Capture',  body: 'Press ⌃⌘Z from any app. Pick the region.',           phase: 'blue'  },
  { n: '02', title: 'Annotate', body: 'Draw boxes, add notes. One frame = one task.',          phase: 'blue'  },
  { n: '03', title: 'Frame',    body: 'Name the session. Add a one-line context note.',        phase: 'blue'  },
  { n: '04', title: 'Route',    body: 'Direct to AI, team review, or public feed.',            phase: 'ember' },
  { n: '05', title: 'Review',   body: 'Teammates curate before the agent sees it.',            phase: 'ember' },
  { n: '06', title: 'Ship',     body: 'Claude, Codex, or Cursor picks it up directly.',       phase: 'green' },
] as const;

const AI_TARGETS = [
  {
    name: 'Claude CLI',
    desc: 'Anthropic API key stored locally. Opens Claude in Terminal on Send.',
    status: 'Connected',
    statusPhase: 'green' as const,
    logoSrc: '/brand/logo-claude.png',
  },
  {
    name: 'Codex CLI',
    desc: 'OpenAI API key stored locally. Opens Codex CLI in Terminal on Send.',
    status: 'Connected',
    statusPhase: 'green' as const,
    logoSrc: '/brand/logo-codex.png',
  },
  {
    name: 'Cursor',
    desc: 'Sends the annotated session directly into your active Cursor workspace.',
    status: 'Ready',
    statusPhase: 'yellow' as const,
    logoSrc: '/brand/logo-cursor.png',
  },
];

const FEATURES = [
  { emoji: '⌃⌘Z', title: 'Global shortcut',   body: 'Press from any app. Dbugr overlays the screen immediately without stealing focus.' },
  { emoji: '📋',   title: 'Session framing',   body: 'One session note travels with all captures. Claude / Codex knows the full context.' },
  { emoji: '👥',   title: 'Team review',       body: 'Share to team feed before AI sees it. Teammates accept or flag annotations.' },
  { emoji: '🌐',   title: 'Public feed',       body: 'Share with your community for signal. Curate the best notes into the final prompt.' },
  { emoji: '🔗',   title: 'MCP server',        body: 'Your captures are exposed as an MCP context source for Claude, Codex, and Cursor.' },
  { emoji: '🔒',   title: 'Local-first',       body: 'API keys never leave your Mac. Screenshots stay in your workspace until you submit.' },
];

const HERO_BULLETS = [
  { emoji: '📸', text: 'Capture the bug.' },
  { emoji: '✍️', text: 'Mark exactly what should change.' },
  { emoji: '🚀', text: 'Send it to Claude, Codex, or Cursor.' },
  { emoji: '👥', text: 'Work solo, with your team, or in public.' },
  { emoji: '🧭', text: 'Ship without the ticket archaeology.' },
] as const;

const PROOF_POINTS = [
  {
    title: 'Context beats guesswork.',
    body: 'Developers keep asking for clear reproduction steps and useful context. Dbugr captures both while the moment is fresh.',
    sourceLabel: 'Bug report quality study',
    sourceHref: 'https://www.st.cs.uni-saarland.de/publications/details/bettenburg-tr-2008/',
  },
  {
    title: 'Screenshots are signal.',
    body: 'Visual evidence is not just an attachment anymore. Research is exploring screenshots as input for automated bug reproduction.',
    sourceLabel: 'Screenshot reproduction research',
    sourceHref: 'https://2025.msrconf.org/details/msr-2025-technical-papers/26/An-Empirical-Study-on-Leveraging-Images-in-Automated-Bug-Report-Reproduction',
  },
  {
    title: 'Agents need receipts.',
    body: 'AI coding tools are strongest when the prompt includes what changed, where it happened, and why it matters.',
    sourceLabel: 'AI developer productivity research',
    sourceHref: 'https://www.microsoft.com/en-us/research/publication/the-impact-of-ai-on-developer-productivity-evidence-from-github-copilot/',
  },
] as const;

function AnnotationPreview() {
  return (
    <div className="hv2-preview" aria-label="Annotation capture preview">
      <div className="hv2-preview-browser">
        <div className="hv2-preview-dots">
          <span style={{ background: '#FF5F57' }} />
          <span style={{ background: '#FFBD2E' }} />
          <span style={{ background: '#28C840' }} />
        </div>
        <div className="hv2-preview-urlbar" />
      </div>
      <div className="hv2-preview-screen">
        <div className="hv2-preview-nav">
          <div className="hv2-preview-nav-logo" />
          <div className="hv2-preview-nav-links">
            <div className="hv2-preview-nav-link" />
            <div className="hv2-preview-nav-link" />
          </div>
          <div className="hv2-preview-nav-cta" />
        </div>
        <div className="hv2-preview-body">
          <div className="hv2-preview-card">
            <div className="hv2-preview-line" style={{ width: '75%', height: 9 }} />
            <div className="hv2-preview-line" style={{ width: '55%', height: 7, marginTop: 8 }} />
            <div className="hv2-preview-line" style={{ width: '40%', height: 7, marginTop: 6 }} />
          </div>
          <div className="hv2-preview-card hv2-preview-card--annotated">
            <div className="hv2-preview-line" style={{ width: '80%', height: 9 }} />
            <div className="hv2-preview-line" style={{ width: '60%', height: 7, marginTop: 8 }} />
            <div className="hv2-preview-annotation-box">
              <span className="hv2-preview-annotation-pin">1</span>
            </div>
          </div>
        </div>
        <div className="hv2-preview-footer">
          <div className="hv2-preview-footer-status">
            <span className="hv2-preview-dot ember" />
            Annotation added
          </div>
          <div className="hv2-preview-footer-actions">
            <span className="hv2-preview-ghost-btn">Discard</span>
            <span className="hv2-preview-send-btn">Send to AI →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="hv2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_STRUCTURED_DATA) }}
      />

      {/* ── Hero ───────────────────────────────────── */}
      <section className="hv2-hero">
        <div className="hv2-hero-inner">
          <div className="hv2-hero-copy">
            <div className="hv2-eyebrow">
              <span className="hv2-eyebrow-dot" />
              Now with Claude, Codex &amp; Cursor
            </div>
            <h1 className="hv2-title">
              Turn visual feedback into shipped AI code in fewer steps.
            </h1>
            <ul className="hv2-hero-bullets" aria-label="How Dbugr turns visual feedback into code">
              {HERO_BULLETS.map((item) => (
                <li key={item.text}>
                  <span aria-hidden="true">{item.emoji}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <div className="hv2-hero-actions" aria-label="Get Dbugr">
              <a className="hv2-hero-download" href={MAC_DMG_DOWNLOAD_URL}>
                Download for macOS
              </a>
              <a className="hv2-hero-source" href={GITHUB_REPO_URL} rel="noreferrer" target="_blank">
                View source on Github
              </a>
            </div>
            <HomeSignupStrip />
            <div className="hv2-trust">
              <span className="hv2-trust-item">
                <span className="hv2-trust-dot green" />
                Free to start
              </span>
              <span className="hv2-trust-sep">·</span>
              <span>macOS 13+</span>
              <span className="hv2-trust-sep">·</span>
              <span>No credit card</span>
            </div>
          </div>
          <AnnotationPreview />
        </div>
      </section>

      {/* ── Proof ─────────────────────────────────── */}
      <section className="hv2-proof-band" aria-labelledby="proof-title">
        <div className="hv2-proof-band-inner">
          <div className="hv2-proof-band-head">
            <div className="hv2-section-label">Why it works</div>
            <h2 id="proof-title">Less explaining. More shipping.</h2>
          </div>
          <div className="hv2-proof-grid">
            {PROOF_POINTS.map((point) => (
              <article className="hv2-proof-card" key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.body}</p>
                <a href={point.sourceHref} rel="noreferrer" target="_blank">
                  Source: {point.sourceLabel}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────── */}
      <section className="hv2-flow">
        <div className="hv2-section-inner">
          <div className="hv2-section-label">How it works</div>
          <h2 className="hv2-section-title">From annotated screenshot to AI coding agent in 6 steps.</h2>
          <div className="hv2-flow-grid">
            <div className="hv2-flow-connector" aria-hidden="true" />
            {FLOW_STEPS.map((s) => (
              <div key={s.n} className={`hv2-flow-step hv2-flow-step--${s.phase}`}>
                <div className="hv2-flow-num">{s.n}</div>
                <div className="hv2-flow-step-title">{s.title}</div>
                <p className="hv2-flow-step-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Targets ────────────────────────────── */}
      <section className="hv2-targets">
        <div className="hv2-targets-inner">
          <div className="hv2-targets-header">
            <div className="hv2-section-label">AI targets</div>
            <h2 className="hv2-section-title large">
              Connect Claude Code, Codex,<br />or Cursor once.
            </h2>
            <p className="hv2-targets-desc">
              Your API keys stay on your Mac. Dbugr opens the right CLI or Cursor workspace
              and hands off annotated screenshot context without a cloud middleman.
            </p>
          </div>
          <div className="hv2-targets-list">
            {AI_TARGETS.map((t) => (
              <div key={t.name} className="hv2-target-row">
                <div className="hv2-target-icon">
                  <img src={t.logoSrc} alt="" width={20} height={20} />
                </div>
                <div className="hv2-target-info">
                  <div className="hv2-target-header-row">
                    <span className="hv2-target-name">{t.name}</span>
                    <span className={`hv2-target-status hv2-target-status--${t.statusPhase}`}>
                      <span className="hv2-target-status-dot" />
                      {t.status}
                    </span>
                  </div>
                  <p className="hv2-target-desc">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────── */}
      <section className="hv2-features">
        <div className="hv2-section-inner">
          <div className="hv2-features-header">
            <div className="hv2-section-label">Features</div>
            <h2 className="hv2-section-title">Built for developers, designers, and AI-assisted teams.</h2>
          </div>
          <div className="hv2-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="hv2-feature-cell">
                <div className="hv2-feature-emoji" aria-hidden="true">{f.emoji}</div>
                <div className="hv2-feature-title">{f.title}</div>
                <p className="hv2-feature-body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Open Source ───────────────────────────── */}
      <section className="hv2-open-source">
        <div className="hv2-open-source-inner">
          <div className="hv2-open-source-copy">
            <div className="hv2-section-label">Open source</div>
            <h2 className="hv2-section-title">Local-first, inspectable, and ready to fork.</h2>
            <p>
              Dbugr is published as a monorepo with the desktop app, web review surface,
              API, worker, shared packages, and release notes in one place.
            </p>
          </div>
          <div className="hv2-release-card">
            <span className="hv2-release-kicker">macOS release</span>
            <strong>Dbugr.ai DMG</strong>
            <p>Download the packaged Mac app from GitHub Releases, then link it from web onboarding.</p>
            <div className="hv2-release-actions">
              <a href={MAC_DMG_DOWNLOAD_URL}>Download DMG</a>
              <a href={GITHUB_RELEASE_URL} rel="noreferrer" target="_blank">Release notes</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────── */}
      <section className="hv2-cta">
        <div className="hv2-cta-inner">
          <h2 className="hv2-cta-title">Ship feedback faster.</h2>
          <p className="hv2-cta-body">
            Download the Mac app, connect your AI coding tool, and turn visual bugs into actionable prompts.
          </p>
          <div className="hv2-cta-buttons">
            <a className="hv2-cta-btn-primary" href="/onboarding?flow=sign-up&auth=google">
              <img src="/brand/google-g.svg" alt="" width={18} height={18} aria-hidden="true" />
              Sign up with Google
            </a>
            <a className="hv2-cta-btn-secondary" href={MAC_DMG_DOWNLOAD_URL}>
              Download Mac app
            </a>
          </div>
          <p className="hv2-cta-note">Free · macOS 13+ · No credit card needed</p>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────── */}
      <footer className="hv2-footer">
        <div className="hv2-footer-brand">
          <img src="/brand/icon-32.png" alt="Dbugr" width={20} height={20} className="hv2-footer-icon" />
          <span className="hv2-footer-name">Dbugr</span>
          <span className="hv2-footer-ai">· ai</span>
        </div>
        <nav className="hv2-footer-links" aria-label="Footer navigation">
          <Link className="hv2-footer-link" href="/privacy">Privacy</Link>
          <Link className="hv2-footer-link" href="/terms">Terms</Link>
          <a
            className="hv2-footer-link"
            href={GITHUB_REPO_URL}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>
      </footer>

    </div>
  );
}
