import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dbugr.ai',
  description: 'Collaborative screenshot review and AI handoff for product teams',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <a href="/" className="nav-brand" aria-label="Debugr home">
            <img src="/brand/icon-32.png" alt="" className="nav-brand-icon" />
            <span>Dbugr.ai</span>
          </a>
          <div className="nav-links">
            <a href="/onboarding">Onboarding</a>
            <a href="/feed">Review feed</a>
            <a href="/sessions">Sessions</a>
          </div>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
