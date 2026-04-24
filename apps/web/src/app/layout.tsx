import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FeedbackAgent',
  description: 'Feedback-to-agent orchestration platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <a href="/" className="nav-brand">FeedbackAgent</a>
          <div className="nav-links">
            <a href="/">Inbox</a>
            <a href="/settings">Settings</a>
          </div>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
