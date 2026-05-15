import type { Metadata } from 'next';
import Link from 'next/link';

const GUIDE_STEPS = [
  {
    number: '01',
    emoji: '👤',
    title: 'Create your web account',
    summary: 'Start on the web so Debugr knows who owns the workspace.',
    details: [
      'Click Get started free.',
      'Sign up with Google or email code.',
      'Create your organization workspace and add your role.',
      'Leave the browser open for the Mac link step.',
    ],
  },
  {
    number: '02',
    emoji: '💻',
    title: 'Download and open the Mac app',
    summary: 'Install the DMG, then launch Debugr from Applications.',
    details: [
      'Download the macOS app from the homepage.',
      'Open the DMG and move Debugr into Applications.',
      'If macOS warns you, approve the app from System Settings.',
      'Keep the app running in the menu bar.',
    ],
  },
  {
    number: '03',
    emoji: '🔗',
    title: 'Link web to your Mac',
    summary: 'The web account and local app pair with a one-time link code.',
    details: [
      'On web onboarding, choose Link this Mac.',
      'Let the browser open the dbugr:// link.',
      'Debugr stores your workspace identity locally.',
      'Your company and role import into the desktop profile.',
    ],
  },
  {
    number: '04',
    emoji: '🛡️',
    title: 'Grant macOS permissions',
    summary: 'Screen capture needs explicit macOS permission before annotations work.',
    details: [
      'Open System Settings when Debugr asks.',
      'Enable Screen Recording for Debugr.',
      'Quit and reopen Debugr if macOS asks for a restart.',
      'Run New Annotation once to confirm the overlay appears.',
    ],
  },
  {
    number: '05',
    emoji: '🔑',
    title: 'Connect AI providers',
    summary: 'Claude and Codex use local API keys. Cursor uses the app and clipboard.',
    details: [
      'Paste your Anthropic API key for Claude CLI.',
      'Paste your OpenAI API key for Codex CLI.',
      'Cursor does not need a login in Debugr.',
      'Keys stay on your Mac and are not sent to the web app.',
    ],
  },
  {
    number: '06',
    emoji: '✍️',
    title: 'Capture and annotate',
    summary: 'Turn a screen into a structured AI-ready feedback session.',
    details: [
      'Press the global shortcut or choose New Annotation.',
      'Select the screen region you want to explain.',
      'Draw boxes around the issue and add clear notes.',
      'Add a session note that describes the desired outcome.',
    ],
  },
  {
    number: '07',
    emoji: '🚦',
    title: 'Choose the submission flow',
    summary: 'Send directly to AI, route through teammates, or publish for public review.',
    details: [
      'Direct to AI is fastest for obvious fixes.',
      'Team review lets teammates add notes before AI sees it.',
      'Public feed gathers broader feedback before final handoff.',
      'You can still curate the final prompt before sending.',
    ],
  },
  {
    number: '08',
    emoji: '🚀',
    title: 'Send to Claude, Codex, or Cursor',
    summary: 'Debugr packages screenshots, annotations, notes, and repo context.',
    details: [
      'Claude CLI opens in Terminal when connected.',
      'Codex CLI opens in Terminal when connected.',
      'Cursor opens your project and copies the prompt.',
      'For Cursor, paste the copied prompt into Cursor chat.',
    ],
  },
] as const;

const PROVIDERS = [
  {
    emoji: '🟧',
    name: 'Claude CLI',
    setup: 'Add your Anthropic API key in Debugr.',
    handoff: 'Debugr opens Terminal and sends the session to Claude CLI.',
    bestFor: 'Large product fixes, design critique, and implementation plans.',
  },
  {
    emoji: '🔵',
    name: 'Codex CLI',
    setup: 'Add your OpenAI API key in Debugr.',
    handoff: 'Debugr opens Terminal and hands the prompt to Codex CLI.',
    bestFor: 'Repo-aware code edits, tests, and follow-up verification.',
  },
  {
    emoji: '⬛',
    name: 'Cursor',
    setup: 'No API key needed in Debugr.',
    handoff: 'Debugr opens Cursor and copies the prompt to your clipboard.',
    bestFor: 'Manual paste into Cursor chat while staying inside your editor.',
  },
] as const;

const PROMPT_RULES = [
  'Paste the whole prompt. Do not trim the screenshot or annotation context.',
  'Tell the agent whether you want code changes, design notes, or an implementation plan.',
  'Ask the agent to run tests or explain what it could not verify.',
  'Keep one Debugr session focused on one product change whenever possible.',
] as const;

export const metadata: Metadata = {
  title: 'How to Use Dbugr.ai with Claude Code, Codex, and Cursor',
  description:
    'A step-by-step guide for linking the Dbugr macOS app, annotating screenshots, connecting AI providers, and sending repo-aware prompts to Claude Code, Codex, or Cursor.',
  alternates: {
    canonical: '/guide',
  },
  openGraph: {
    title: 'How to Use Dbugr.ai',
    description:
      'Link the Mac app, annotate screenshots, connect AI providers, and send repo-aware prompts to Claude Code, Codex, or Cursor.',
    url: '/guide',
    type: 'article',
  },
};

export default function GuidePage() {
  return (
    <div className="guide-page">
      <section className="guide-hero">
        <div className="guide-hero-copy">
          <div className="guide-kicker">How to Guide</div>
          <h1>From first install to AI handoff.</h1>
          <p>
            Follow this checklist to connect the web app, link the macOS app, take
            annotations, add local AI keys, and send clean prompts to Claude, Codex, or Cursor.
          </p>
          <div className="guide-hero-actions">
            <Link className="guide-primary" href="/onboarding?flow=sign-up">Start setup</Link>
            <Link className="guide-secondary" href="/">Back to homepage</Link>
          </div>
        </div>
        <div className="guide-infographic" aria-label="Debugr setup path">
          <div><span>👤</span><strong>Web account</strong></div>
          <div><span>💻</span><strong>Mac app</strong></div>
          <div><span>✍️</span><strong>Annotation</strong></div>
          <div><span>🚀</span><strong>AI handoff</strong></div>
        </div>
      </section>

      <section className="guide-band">
        <div className="guide-section-head">
          <span>Step-by-step</span>
          <h2>Use Debugr in eight moves.</h2>
        </div>
        <div className="guide-timeline">
          {GUIDE_STEPS.map((step) => (
            <article className="guide-step" key={step.number}>
              <div className="guide-step-marker">
                <span>{step.number}</span>
                <strong>{step.emoji}</strong>
              </div>
              <div className="guide-step-body">
                <h3>{step.title}</h3>
                <p>{step.summary}</p>
                <ul>
                  {step.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-provider-band">
        <div className="guide-section-head">
          <span>AI handoff</span>
          <h2>Pick the right target.</h2>
        </div>
        <div className="guide-provider-grid">
          {PROVIDERS.map((provider) => (
            <article className="guide-provider" key={provider.name}>
              <div className="guide-provider-title">
                <span>{provider.emoji}</span>
                <h3>{provider.name}</h3>
              </div>
              <dl>
                <div>
                  <dt>Setup</dt>
                  <dd>{provider.setup}</dd>
                </div>
                <div>
                  <dt>Send behavior</dt>
                  <dd>{provider.handoff}</dd>
                </div>
                <div>
                  <dt>Best for</dt>
                  <dd>{provider.bestFor}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-prompt-band">
        <div className="guide-prompt-card">
          <div>
            <span className="guide-kicker">Copy-paste prompts</span>
            <h2>Cursor users paste manually.</h2>
            <p>
              Claude and Codex receive the handoff through their CLIs. Cursor opens your
              project folder and copies the full Debugr prompt, then you paste it into Cursor chat.
            </p>
          </div>
          <div className="guide-prompt-example">
            <span>📋 Example instruction</span>
            <code>
              Use the attached Debugr annotations and session note to make the requested UI change.
              Update the code, run relevant tests, and summarize what changed.
            </code>
          </div>
        </div>
        <div className="guide-rules">
          {PROMPT_RULES.map((rule) => (
            <div key={rule}>
              <span>✅</span>
              <p>{rule}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="guide-finish">
        <h2>Ready when your first annotation is.</h2>
        <p>
          Once the Mac app is linked and at least one AI target is connected, every annotation
          can become a structured implementation prompt in seconds.
        </p>
        <Link className="guide-primary" href="/onboarding?flow=sign-up">Set up Debugr</Link>
      </section>
    </div>
  );
}
