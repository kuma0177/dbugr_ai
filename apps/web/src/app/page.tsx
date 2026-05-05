import type { Metadata } from 'next';
import { JourneyInfographic } from './journey-infographic';
import { HomeSignupStrip } from './home-signup-strip';

export const metadata: Metadata = {
  title: 'Dbugr.ai | From screenshot to shippable prompt',
  description:
    'Dbugr.ai helps product teams capture screenshots, review feedback, and turn approved changes into AI-ready prompts for Claude, Codex, and Cursor.',
  openGraph: {
    title: 'Dbugr.ai | From screenshot to shippable prompt',
    description:
      'Capture visual feedback, review it together, and send approved product changes to Claude, Codex, or Cursor.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dbugr.ai | From screenshot to shippable prompt',
    description:
      'Capture visual feedback, review it together, and send approved product changes to Claude, Codex, or Cursor.',
  },
};

export default function HomePage() {
  return (
    <div className="marketing-shell">
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-eyebrow">Capture locally. Review together.</div>
          <h1 className="phase2-title home-title">From screenshot to shippable prompt.</h1>
          <p className="phase2-lede home-lede">
            Dbugr.ai helps app builders capture visual feedback, annotate product changes, and
            turn approved comments into clean instructions for Claude, Codex, and Cursor through MCP.
          </p>
          <HomeSignupStrip />
          <p className="home-note">
            Create a private workspace for your team, or share publicly to get feedback from the builder community.
          </p>
        </div>
        <div className="product-card product-story" aria-label="Annotated screenshot, review board, and AI handoff preview">
          <div className="annotated-screen">
            <div className="screen-toolbar">
              <span />
              <span />
              <span />
            </div>
            <div className="screen-hero-block">
              <span className="annotation-pin pin-primary">1</span>
              <div className="screen-copy-line wide" />
              <div className="screen-copy-line" />
              <button className="screen-cta">Get started</button>
            </div>
            <div className="screen-grid">
              <div>
                <span className="annotation-pin pin-secondary">2</span>
              </div>
              <div>
                <span className="annotation-pin pin-tertiary">3</span>
              </div>
            </div>
          </div>

          <div className="session-board-preview">
            <div className="phase2-kicker">Session board</div>
            <h2>Landing page cleanup</h2>
            <div className="feedback-item accepted">
              <span className="feedback-status">Accepted</span>
              <p>Make the CTA read “Get started with Google.”</p>
            </div>
            <div className="feedback-item review">
              <span className="feedback-status">Needs review</span>
              <p>Tighten the hero copy around MCP handoff.</p>
            </div>
            <div className="feedback-item ready">
              <span className="feedback-status">Ready for AI</span>
              <p>Export approved comments as implementation steps.</p>
            </div>
          </div>

          <div className="handoff-bar">
            <div>
              <span className="phase2-kicker">Approved prompt</span>
              <p>3 changes ready for Claude, Codex, or Cursor.</p>
            </div>
            <button type="button">Send to Cursor</button>
          </div>
        </div>
      </section>

      <section className="home-steps">
        <div className="phase2-card home-step">
          <div className="step-number">01</div>
          <h2>Annotate visually</h2>
          <p className="phase2-muted">Point, comment, and explain product issues directly on screenshots.</p>
        </div>
        <div className="phase2-card home-step">
          <div className="step-number">02</div>
          <h2>Decide together</h2>
          <p className="phase2-muted">Share feedback privately with your team or publicly with the builder community.</p>
        </div>
        <div className="phase2-card home-step">
          <div className="step-number">03</div>
          <h2>Send to your AI stack</h2>
          <p className="phase2-muted">Export clear prompts through MCP to Claude, Codex, or Cursor.</p>
        </div>
      </section>

      <JourneyInfographic className="home-journey" />
    </div>
  );
}
