import type { Metadata } from 'next';
import Link from 'next/link';
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
          <Link href="/" className="nav-brand" aria-label="Debugr home">
            <img src="/brand/icon-nav-1024.png" alt="" className="nav-brand-icon" />
            <span>Dbugr.ai</span>
          </Link>
          <div className="nav-links">
            <Link className="nav-auth-button nav-auth-button-secondary" href="/onboarding?auth=email">Sign in</Link>
            <Link className="nav-auth-button nav-auth-button-primary" href="/onboarding?auth=google">Get started</Link>
          </div>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
