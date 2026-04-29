import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debugr',
  description: 'Feedback-to-agent orchestration platform',
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
            <span>Debugr</span>
          </a>
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
