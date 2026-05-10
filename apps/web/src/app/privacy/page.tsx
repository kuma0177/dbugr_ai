import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy | Dbugr.ai',
  description: 'Privacy notice for Dbugr.ai.',
};

export default function PrivacyPage() {
  return (
    <article className="legal-page">
      <Link className="legal-back" href="/">Back to Dbugr.ai</Link>
      <header className="legal-header">
        <p className="legal-kicker">Privacy Notice</p>
        <h1>Privacy</h1>
        <p>Last updated: May 9, 2026</p>
      </header>

      <section>
        <h2>Overview</h2>
        <p>
          Dbugr.ai is built as a local-first screen capture and annotation tool for AI coding workflows.
          The current product is primarily intended for local development and private testing.
        </p>
      </section>

      <section>
        <h2>Information You Provide</h2>
        <p>
          Depending on how you use the app, Dbugr may store your name, email, workspace details,
          annotation notes, session metadata, screenshots, and integration settings in your local
          development environment.
        </p>
      </section>

      <section>
        <h2>Local Storage</h2>
        <p>
          Local development uses SQLite and browser local storage for prototype workflows. Screenshots,
          notes, and local settings may remain on your machine until you delete them.
        </p>
      </section>

      <section>
        <h2>Third-Party Services</h2>
        <p>
          If you connect providers such as Claude, Codex, Cursor, GitHub, Jira, or MCP-compatible tools,
          information you choose to send may be processed by those services under their own policies.
        </p>
      </section>

      <section>
        <h2>Open-Source Development</h2>
        <p>
          If you contribute to the repository, your GitHub profile, issues, pull requests, comments,
          and commit metadata may be visible publicly through GitHub.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For privacy questions, open a GitHub issue or contact the repository maintainer through
          the project repository.
        </p>
      </section>
    </article>
  );
}
