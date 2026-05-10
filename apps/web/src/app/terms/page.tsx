import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms | Dbugr.ai',
  description: 'Terms of use for Dbugr.ai.',
};

export default function TermsPage() {
  return (
    <article className="legal-page">
      <Link className="legal-back" href="/">Back to Dbugr.ai</Link>
      <header className="legal-header">
        <p className="legal-kicker">Terms of Use</p>
        <h1>Terms</h1>
        <p>Last updated: May 9, 2026</p>
      </header>

      <section>
        <h2>Use Of Dbugr</h2>
        <p>
          Dbugr.ai is provided for local development, product testing, and AI coding workflow
          experimentation. You are responsible for how you use the software and any content you capture.
        </p>
      </section>

      <section>
        <h2>Your Content</h2>
        <p>
          You retain responsibility for screenshots, annotations, prompts, repo context, API keys,
          and other materials you add to Dbugr. Do not capture or submit content that you do not have
          permission to use or share.
        </p>
      </section>

      <section>
        <h2>AI And Integrations</h2>
        <p>
          Dbugr can prepare context for AI tools and third-party services. Review prompts and captured
          content before sending them to external providers such as Claude, Codex, Cursor, GitHub, Jira,
          or MCP-compatible clients.
        </p>
      </section>

      <section>
        <h2>No Warranty</h2>
        <p>
          The project is under active development and is provided as-is. Features may change, break,
          or be removed while the product and repository are being prepared for broader open-source use.
        </p>
      </section>

      <section>
        <h2>Open-Source License</h2>
        <p>
          Until a license file is added to the repository, the code should be treated as source-available
          for review and collaboration, not formally open-source licensed.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may be updated as the project matures. Material updates should be reflected in
          the repository and linked from the homepage footer.
        </p>
      </section>
    </article>
  );
}
